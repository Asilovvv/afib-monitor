"""Blinded reading pack for the pilot cardiologist (docs/pilot/ANALYSIS_PLAN.md §1).

    python tools/pilot_blind.py --exports DIR --visits visits.csv --out OUT [--seed 7]

DIR holds one export per participant named P01.json, P02.json … (the app's "Download my data" file).
visits.csv: code,visit1  (e.g. P01,2026-12-03) — day 0 of each participant; days 1–14 are used.
Writes into OUT:
  reading_pack.pdf   one 30-s strip per page, ECG paper 25 mm/s, 10 mm/mV, only a random code R0001…  → to the cardiologist
  reading_sheet.csv  code,label   (label: sinus | af | other_irregular | unreadable)                     → to the cardiologist
  key.csv            code,participant,ts,fs,verdict,beats,snr_db                                         → stays with the engineer
The algorithm verdict is recomputed with backend/app/ecgtools.check (the pinned version), never read from the server."""
import argparse, csv, json, random, sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import ecgtools  # noqa: E402

import numpy as np  # noqa: E402
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

sys.path.insert(0, str(ROOT / "tools" / "mobile"))
from snr_ref import snr_of  # noqa: E402  same SNR definition as the phone and Notebook 16


def strips_in_window(export: dict, day0: datetime) -> list[dict]:
    start, end = day0 + timedelta(days=1), day0 + timedelta(days=15)
    out = []
    for e in export.get("ecg", []):
        if e.get("reason") != "check":
            continue
        ts = datetime.fromisoformat(str(e["ts"]).replace("Z", "+00:00")).replace(tzinfo=None) + timedelta(hours=6)  # local
        if start <= ts < end:
            out.append({**e, "local": ts})
    return out


def page(pdf: PdfPages, code: str, x: list[float], fs: int):
    """A4 landscape, three 10-s rows on mm paper. Only the code — no name, date or verdict."""
    W, H = 297 / 25.4, 210 / 25.4
    fig = plt.figure(figsize=(W, H))
    fig.text(0.04, 0.95, code, fontsize=16, fontweight="bold", family="monospace")
    fig.text(0.96, 0.95, "25 mm/s · 10 mm/mV · single lead", fontsize=9, ha="right", color="#555")
    y = np.asarray(x, float); y = y - np.median(y)
    for r in range(3):
        seg = y[r * 10 * fs:(r + 1) * 10 * fs]
        ax = fig.add_axes([0.04, 0.66 - r * 0.29, 0.92, 0.26])
        ax.set_xlim(0, 10); ax.set_ylim(-2, 2)
        for v in np.arange(0, 10.001, 0.04): ax.axvline(v, color="#f6c9c9", lw=0.3, zorder=0)
        for v in np.arange(0, 10.001, 0.2): ax.axvline(v, color="#e58b8b", lw=0.6, zorder=0)
        for v in np.arange(-2, 2.001, 0.1): ax.axhline(v, color="#f6c9c9", lw=0.3, zorder=0)
        for v in np.arange(-2, 2.001, 0.5): ax.axhline(v, color="#e58b8b", lw=0.6, zorder=0)
        ax.plot(np.arange(len(seg)) / fs, np.clip(seg, -2, 2), color="#111", lw=0.7)
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values(): s.set_visible(False)
        ax.text(10.05, 1.7, f"{r * 10}–{(r + 1) * 10} s", fontsize=8, color="#555", clip_on=False)
    fig.text(0.04, 0.03, "Label on reading_sheet.csv: sinus | af | other_irregular | unreadable", fontsize=8, color="#555")
    pdf.savefig(fig); plt.close(fig)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--exports", required=True); ap.add_argument("--visits", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(argv)
    visits = {r["code"]: datetime.fromisoformat(r["visit1"]) for r in csv.DictReader(open(a.visits))}
    items = []
    for code, day0 in sorted(visits.items()):
        f = Path(a.exports) / f"{code}.json"
        if not f.exists():
            print(f"warning: no export for {code}"); continue
        for e in strips_in_window(json.loads(f.read_text()), day0):
            items.append((code, e))
    random.Random(a.seed).shuffle(items)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    with PdfPages(out / "reading_pack.pdf") as pdf, open(out / "key.csv", "w", newline="") as kf, open(out / "reading_sheet.csv", "w", newline="") as rf:
        kw, rw = csv.writer(kf), csv.writer(rf)
        kw.writerow(["code", "participant", "ts", "fs", "verdict", "beats", "snr_db"]); rw.writerow(["code", "label"])
        for i, (pcode, e) in enumerate(items, 1):
            rcode = f"R{i:04d}"
            c = ecgtools.check(e["samples"], e["fs"])
            snr, _ = snr_of(e["samples"], e["fs"])
            kw.writerow([rcode, pcode, e["local"].isoformat(timespec="minutes"), e["fs"], c["verdict"], c["beats"], "" if snr is None else round(snr, 2)])
            rw.writerow([rcode, ""])
            page(pdf, rcode, e["samples"], e["fs"])
    print(f"{len(items)} strips from {len(visits)} participants → {out}/reading_pack.pdf (to the cardiologist), key.csv (keep)")


if __name__ == "__main__":
    main()
