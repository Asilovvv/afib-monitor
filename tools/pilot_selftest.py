"""Dry run of the pilot pipeline on synthetic participants (no real data): exports → blinded pack → "cardiologist"
labels from the known truth → endpoints. Checks that the pack carries no participant code, date or verdict, that the
analysis refuses to run while labels are missing, and that the numbers land where the synthetic truth puts them.

    python tools/pilot_selftest.py            (≈ 1–2 min; writes into a temp folder)"""
import csv, json, random, subprocess, sys, tempfile
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.ecgsynth import synth_ecg  # noqa: E402

rng = random.Random(42)
tmp = Path(tempfile.mkdtemp(prefix="pilot_selftest_"))
ex_dir = tmp / "exports"; ex_dir.mkdir()
truth: dict[tuple[str, str], str] = {}                       # (participant, local ts minute) → sinus | af
visits = []
PEOPLE = {"P01": (0.9, 0.0), "P02": (0.8, 1.0), "P03": (0.6, 0.5), "P04": (0.95, 0.0)}   # adherence, AF share
for p, (adh, af_share) in PEOPLE.items():
    day0 = datetime(2026, 12, 1)
    visits.append((p, day0.date().isoformat()))
    ecg = []
    for d in range(1, 15):
        for hh in (8, 20):
            if rng.random() > adh:
                continue
            local = day0 + timedelta(days=d, hours=hh, minutes=rng.randint(-40, 40))
            af = rng.random() < af_share
            x = synth_ecg(30, afib=af, bpm=rng.choice([65, 80, 95]), seed=rng.randint(0, 10**6))
            if rng.random() < 0.1:
                x = [v + rng.gauss(0, 0.8) for v in x]       # a noisy one: should give no verdict
            ecg.append({"ts": (local - timedelta(hours=6)).isoformat() + "Z", "fs": 125, "reason": "check", "state": 1, "prob": 0, "bpm": 80, "samples": [round(v, 4) for v in x]})
            truth[(p, local.isoformat(timespec="minutes"))] = "af" if af else "sinus"
    (ex_dir / f"{p}.json").write_text(json.dumps({"format": "afib-monitor-export/1", "ecg": ecg, "check_plan": {"times": ["08:00", "20:00"], "active": True}}))
with open(tmp / "visits.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["code", "visit1"]); w.writerows(visits)

py = sys.executable
out = tmp / "out"
subprocess.run([py, str(ROOT / "tools/pilot_blind.py"), "--exports", str(ex_dir), "--visits", str(tmp / "visits.csv"), "--out", str(out)], check=True)

# 1. blinding: the pack has no participant codes, dates or verdict words
txt = subprocess.run(["pdftotext", str(out / "reading_pack.pdf"), "-"], capture_output=True, text=True).stdout
assert txt.count("sinus | af | other_irregular | unreadable") == len(truth)      # the label hint on every page
txt = txt.replace("sinus | af | other_irregular | unreadable", "")
for bad in ["P01", "P02", "2026", "regular", "irregular", "no_verdict", "ровный"]:
    assert bad not in txt, f"pack leaks {bad!r}"
key = list(csv.DictReader(open(out / "key.csv")))
assert len(key) == len(truth), (len(key), len(truth))
n_pages = int([l for l in subprocess.run(["pdfinfo", str(out / "reading_pack.pdf")], capture_output=True, text=True).stdout.splitlines() if l.startswith("Pages")][0].split()[-1])
assert n_pages == len(key)

# 2. analysis refuses to run while labels are missing
r = subprocess.run([py, str(ROOT / "tools/pilot_analyze.py"), "--key", str(out / "key.csv"), "--reading", str(out / "reading_sheet.csv"),
                    "--exports", str(ex_dir), "--visits", str(tmp / "visits.csv"), "--report", str(tmp / "r.md")], capture_output=True, text=True)
assert r.returncode != 0 and "no valid label" in r.stderr + r.stdout

# 3. "cardiologist" labels from the truth, 5 % unreadable; SUS and one adverse event
with open(tmp / "reading_filled.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["code", "label"])
    for k in key:
        w.writerow([k["code"], "unreadable" if rng.random() < 0.05 else truth[(k["participant"], k["ts"])]])
with open(tmp / "sus.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["code"] + [f"q{i}" for i in range(1, 11)])
    for p in PEOPLE:
        w.writerow([p] + [4, 2] * 5)                          # SUS = 75 for everyone
with open(tmp / "ae.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["code", "date", "type", "serious", "description"]); w.writerow(["P03", "2026-12-05", "skin", "no", "redness"])
subprocess.run([py, str(ROOT / "tools/pilot_analyze.py"), "--key", str(out / "key.csv"), "--reading", str(tmp / "reading_filled.csv"),
                "--exports", str(ex_dir), "--visits", str(tmp / "visits.csv"), "--sus", str(tmp / "sus.csv"), "--ae", str(tmp / "ae.csv"),
                "--report", str(tmp / "results.md")], check=True, capture_output=True)
rep = (tmp / "results.md").read_text()
assert "| E5 | SUS, медиана (n=4) | 75.0 |" in rep, rep
assert "серьёзных: 0" in rep and "| E6 | Участники с нежелательными явлениями | 1;" in rep
# adherence of P03 was 0.6 by design: E2 median must sit between the lowest and highest planned adherence
e2 = float([l for l in rep.splitlines() if l.startswith("| E2 ")][0].split("|")[3])
assert 0.55 <= e2 <= 1.0, e2
print(rep)
print(f"pilot selftest ok ({len(key)} strips, files in {tmp})")
