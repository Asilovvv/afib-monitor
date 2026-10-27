"""Pilot endpoints exactly as fixed in docs/pilot/ANALYSIS_PLAN.md v1.0 — no other analysis lives here.

    python tools/pilot_analyze.py --key OUT/key.csv --reading reading_sheet_filled.csv --exports DIR --visits visits.csv \
        [--sus sus.csv] [--ae ae.csv] --report results.md

sus.csv: code,q1..q10 (1–5).  ae.csv: code,date,type,serious(yes/no),description."""
import argparse, csv, json, math, random, sys
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import analytics  # noqa: E402

TZ = 6.0
B, SEED = 2000, 0
LABELS = {"sinus", "af", "other_irregular", "unreadable"}


def wilson(k: int, n: int, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(max(0.0, c - h), 3), round(min(1.0, c + h), 3))


def ci(t) -> str:
    return "—" if t is None or t[0] is None else f"{t[0]}–{t[1]}"


def boot(per: dict[str, list], stat) -> tuple:
    """Cluster bootstrap over participants (ANALYSIS_PLAN §3)."""
    keys = sorted(per); rng = random.Random(SEED); vals = []
    for _ in range(B):
        smp = [per[rng.choice(keys)] for _ in keys]
        v = stat(smp)
        if v is not None:
            vals.append(v)
    if not vals:
        return (None, None)
    vals.sort()
    return (round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3))


def kappa(pairs: list[tuple[str, str]]):
    n = len(pairs)
    if n == 0:
        return None
    cats = ("regular", "irregular")
    po = sum(a == b for a, b in pairs) / n
    pe = sum((sum(a == c for a, _ in pairs) / n) * (sum(b == c for _, b in pairs) / n) for c in cats)
    return None if pe == 1 else (po - pe) / (1 - pe)


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(median(xs), 3) if xs else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    for k in ("key", "reading", "exports", "visits", "report"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--sus"); ap.add_argument("--ae")
    a = ap.parse_args(argv)
    key = list(csv.DictReader(open(a.key)))
    reading = {r["code"]: r["label"].strip() for r in csv.DictReader(open(a.reading))}
    missing = [k["code"] for k in key if reading.get(k["code"], "") not in LABELS]
    if missing:
        sys.exit(f"{len(missing)} strips have no valid label (first: {missing[:5]}); the key must not be opened before all labels are in")
    visits = {r["code"]: datetime.fromisoformat(r["visit1"]) for r in csv.DictReader(open(a.visits))}

    by = {}
    for k in key:
        by.setdefault(k["participant"], []).append(k)

    # E1 — strips with a verdict
    e1 = {p: [k["verdict"] != "no_verdict" for k in ks] for p, ks in by.items()}
    e1_pp = {p: sum(v) / len(v) for p, v in e1.items()}
    e1_ci = boot(e1, lambda s: median([sum(v) / len(v) for v in s]))

    # E2 — adherence by the server rule, days 1–14 (participants with ≥ 7 days only)
    e2_pp = {}
    for p, day0 in visits.items():
        f = Path(a.exports) / f"{p}.json"
        if not f.exists():
            continue
        ex = json.loads(f.read_text())
        times = (ex.get("check_plan") or {}).get("times") or []
        start = day0 + timedelta(days=1) - timedelta(hours=TZ); end = day0 + timedelta(days=15) - timedelta(hours=TZ)
        checks = sorted((datetime.fromisoformat(k["ts"]) - timedelta(hours=TZ), k["verdict"]) for k in by.get(p, []))
        last = max((t for t, _ in checks), default=None)
        if last is None or last < start + timedelta(days=6) or not times:
            continue                                    # dropped out before day 7 or no plan: not in E2
        s = analytics.check_adherence(times, start, end, checks, TZ)
        e2_pp[p] = s["adherence"]
    e2_ci = boot({p: [v] for p, v in e2_pp.items()}, lambda s: median([v[0] for v in s]))

    # E3 — agreement with the cardiologist
    pairs_by = {}
    for k in key:
        lab = reading[k["code"]]
        if k["verdict"] == "no_verdict" or lab == "unreadable":
            continue
        doc = "regular" if lab == "sinus" else "irregular"
        pairs_by.setdefault(k["participant"], []).append((k["verdict"], doc))
    pairs = [x for v in pairs_by.values() for x in v]
    agree = sum(a_ == b_ for a_, b_ in pairs)
    kap = kappa(pairs)
    kap_ci = boot(pairs_by, lambda s: kappa([x for v in s for x in v])) if len(pairs) >= 30 else (None, None)
    af = [k for k in key if reading[k["code"]] == "af" and k["verdict"] != "no_verdict"]
    sinus = [k for k in key if reading[k["code"]] == "sinus" and k["verdict"] != "no_verdict"]
    unread = sum(reading[k["code"]] == "unreadable" for k in key) / len(key) if key else 0

    # E4 — SNR ≥ 18 dB
    e4 = {p: [k["snr_db"] != "" and float(k["snr_db"]) >= 18 for k in ks] for p, ks in by.items()}

    # E5 — SUS
    sus = []
    if a.sus and Path(a.sus).exists():
        for r in csv.DictReader(open(a.sus)):
            q = [int(r[f"q{i}"]) for i in range(1, 11)]
            sus.append(2.5 * sum((q[i] - 1) if i % 2 == 0 else (5 - q[i]) for i in range(10)))
    # E6 — adverse events
    ae = list(csv.DictReader(open(a.ae))) if a.ae and Path(a.ae).exists() else []

    n_strips = len(key); k1 = sum(k["verdict"] != "no_verdict" for k in key)
    L = [f"# Результаты пилота — по плану анализа v1.0", "",
         f"Участников с записями: {len(by)}; записей (дни 1–14): {n_strips}. Рассчитано {datetime.now():%Y-%m-%d %H:%M}, `tools/pilot_analyze.py`.", "",
         "| # | Конечная точка | Результат | 95 % ДИ | Порог | Итог |", "|---|---|---|---|---|---|"]
    m1, m2 = med(e1_pp.values()), med(e2_pp.values())
    L.append(f"| E1 | Записи с вердиктом, медиана по участникам | {m1} | {ci(e1_ci)} | ≥ 0,80 | {'достигнут' if m1 is not None and m1 >= 0.8 else 'не достигнут'} |")
    L.append(f"| E2 | Выполнение расписания, медиана ({len(e2_pp)} участн.) | {m2} | {ci(e2_ci)} | ≥ 0,70 | {'достигнут' if m2 is not None and m2 >= 0.7 else 'не достигнут'} |")
    L.append(f"| E3 | Совпадение с кардиологом ({len(pairs)} пар) | {round(agree / len(pairs), 3) if pairs else '—'} | {ci(wilson(agree, len(pairs)))} (Уилсон, записи зависимы) | — | описательно |")
    L.append(f"| E3 | Каппа Коэна | {round(kap, 3) if kap is not None else '—'} | {ci(kap_ci)} | — | {'< 30 пар: только доля' if len(pairs) < 30 else 'описательно'} |")
    L.append(f"| E3a | «Неровный» при ФП по кардиологу | {sum(k['verdict'] == 'irregular' for k in af)}/{len(af)} | {ci(wilson(sum(k['verdict'] == 'irregular' for k in af), len(af)))} | — | описательно |")
    L.append(f"| E3a | «Неровный» при синусовом ритме | {sum(k['verdict'] == 'irregular' for k in sinus)}/{len(sinus)} | {ci(wilson(sum(k['verdict'] == 'irregular' for k in sinus), len(sinus)))} | — | описательно |")
    L.append(f"| E4 | SNR ≥ 18 дБ, медиана по участникам | {med([sum(v) / len(v) for v in e4.values()])} | {ci(boot(e4, lambda s: median([sum(v) / len(v) for v in s])))} | — | описательно |")
    L.append(f"| E5 | SUS, медиана (n={len(sus)}) | {med(sus) if sus else '—'} | — | ≥ 68 «выше среднего» | описательно |")
    L.append(f"| E6 | Участники с нежелательными явлениями | {len({r['code'] for r in ae})}; серьёзных: {sum(r.get('serious', '').lower() == 'yes' for r in ae)} | — | — | — |")
    L += ["", f"Объединённая доля записей с вердиктом (для сравнения с открытыми данными): {k1}/{n_strips}, 95 % ДИ {ci(wilson(k1, n_strips))}.",
          f"Доля записей, которые кардиолог не смог прочитать: {round(unread, 3)}{' — больше 30 %, см. план §4' if unread > 0.3 else ''}.",
          f"Выбыли до дня 7 или без плана (не в E2): {sorted(set(visits) - set(e2_pp))}.", "",
          "Этот пилот не оценивает точность изделия для регистрации и пользу для здоровья (план анализа §5)."]
    Path(a.report).write_text("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
