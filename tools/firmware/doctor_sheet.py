"""PDF for a doctor from the prototype's 30-second checks (afib_stream.py --checks N): a summary page and one page
of ECG strips per check, in Russian. The output contains health data — keep it out of the repository.

    python tools/firmware/doctor_sheet.py --log checks.log --out doctor_sheet.pdf check_1.csv ... check_5.csv
        [--note "free text for the observations section"] [--date "29.10.2026"]

Strips: 25 mm/s on an ECG-paper grid, band-pass 0.5–40 Hz (zero phase, display only), amplitude in ADC units
(the AD8232 module is not calibrated in mV). Beats are marked by an independent detector (wfdb XQRS) and RR
intervals are printed in ms. The device's own verdict and numbers come from the log line of each check.
"""
import argparse
import os
import re

import numpy as np

FS = 250
VERDICT = {"0": "НЕ УДАЛОСЬ ПРОЧИТАТЬ", "1": "РИТМ РОВНЫЙ", "2": "РИТМ НЕРОВНЫЙ"}
QUESTIONS = [
    "Есть ли на ЭКГ в 12 отведениях признаки нарушения ритма (фибрилляция предсердий, экстрасистолы)?",
    "На полосках прототипа интервалы RR меняются плавно (проверки 1, 2 и 4): похоже ли это на синусовую "
    "(дыхательную) аритмию?",
    "Отмеченные на полосках одиночные отклонения — артефакт электрода или внеочередной удар?",
    "Нужно ли дополнительное обследование (например, суточное мониторирование по Холтеру)?",
]


def parse_log(path):
    rows = {}
    for line in open(path, encoding="utf-8"):
        m = re.search(r"check (\d+): CHECK (.*)", line)
        if m:
            kv = dict(p.split("=", 1) for p in m.group(2).split() if "=" in p)
            kv["time"] = line[11:16]
            rows[int(m.group(1))] = kv
    return rows


def ecg_axes(ax, t0, t1, ymin, ymax):
    for x in np.arange(t0, t1 + 1e-9, 0.04):
        ax.axvline(x, color="#f4c7c3", lw=0.3, zorder=0)
    for x in np.arange(t0, t1 + 1e-9, 0.2):
        ax.axvline(x, color="#e8968f", lw=0.6, zorder=0)
    step = (ymax - ymin) / 10
    for y in np.arange(ymin, ymax + 1e-9, step / 5):
        ax.axhline(y, color="#f4c7c3", lw=0.3, zorder=0)
    for y in np.arange(ymin, ymax + 1e-9, step):
        ax.axhline(y, color="#e8968f", lw=0.6, zorder=0)
    ax.set_xlim(t0, t1); ax.set_ylim(ymin, ymax)
    ax.set_yticks([]); ax.set_xticks(np.arange(np.ceil(t0), t1 + 1e-9, 1.0))
    ax.tick_params(labelsize=7, length=0)
    for s in ax.spines.values():
        s.set_visible(False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="+")
    ap.add_argument("--log", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--note", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--times", default="", help="end time of each check, comma-separated (default: from the log)")
    a = ap.parse_args()

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from scipy.signal import butter, sosfiltfilt
    import wfdb.processing as wp
    plt.rcParams["font.family"] = "DejaVu Sans"

    log = parse_log(a.log)
    for k, tm in enumerate([x.strip() for x in a.times.split(",") if x.strip()], 1):
        log.setdefault(k, {})["time"] = tm
    sos = butter(2, [0.5, 40], btype="band", fs=FS, output="sos")
    checks = []
    for path in a.csv:
        k = int(re.search(r"(\d+)\.csv$", path).group(1))
        mv = np.loadtxt(path, delimiter=",", skiprows=1, usecols=1)
        y = sosfiltfilt(sos, mv)
        beats = wp.xqrs_detect(sig=mv.astype(float), fs=FS, verbose=False)
        beats = beats[beats >= int(0.3 * FS)]
        # snap to the largest |deflection| near the detection (XQRS marks the QRS onset region)
        beats = np.array([b - 15 + int(np.argmax(np.abs(y[max(0, b - 15):b + 15]))) for b in beats])
        floor = np.flatnonzero(mv <= 20)                       # deflections to the bottom of the ADC scale
        marks = [g[0] for g in np.split(floor, np.flatnonzero(np.diff(floor) > FS // 4) + 1) if len(g)] if len(floor) else []
        checks.append(dict(k=k, y=y, beats=beats, info=log.get(k, {}), marks=marks))

    W, H = 11.69, 8.27   # A4 landscape, inches
    with PdfPages(a.out) as pdf:
        # ---- page 1: summary
        fig = plt.figure(figsize=(W, H))
        tx = fig.text
        tx(0.06, 0.94, "Записи с исследовательского прототипа AFib Monitor — для врача", fontsize=16, weight="bold")
        times = [c["info"].get("time", "") for c in checks if c["info"]]
        tx(0.06, 0.905, f"ФИО: ______________________________    Дата рождения: ____________    "
                        f"Дата записи: {a.date} {times[0] if times else ''}–{times[-1] if times else ''}", fontsize=10.5)
        txt = [
            ("Это не медицинское изделие.", "Учебный исследовательский прототип (дипломная работа). Его результаты — не диагноз."),
            ("Как записано.", "Одно отведение: электроды под правой ключицей (RA) и под левой ключицей (LA), референс "
                              "слева под рёбрами (RL) — примерно I отведение. Модуль AD8232, 250 Гц, полоса 0,5–40 Гц. "
                              "Сидя, в покое; гелевые электроды."),
            ("Что сделал прибор.", f"{len(checks)} подряд 30-секундных проверок ритма. Правило прибора: «неровно», если "
                                   "среднее |ΔRR| / среднее RR > 0,10. Порог выбран на открытых данных PhysioNet/CinC 2017; "
                                   "на них у людей с нормальным ритмом прибор говорит «неровно» в 8,9 % проверок."),
        ]
        y0 = 0.86
        for head, body in txt:
            tx(0.06, y0, head, fontsize=10.5, weight="bold")
            import textwrap
            lines = textwrap.wrap(body, 128)
            for i, l in enumerate(lines):
                tx(0.06 + (0.0 if i else 0.0), y0 - 0.024 * (i + 1), l, fontsize=10)
            y0 -= 0.024 * (len(lines) + 1) + 0.012
        # table
        cols = ["№", "Окончание", "Результат прибора", "ЧСС, уд/мин", "Ударов", "Неровность (порог 0,10)", "Качество сигнала"]
        xs = [0.06, 0.10, 0.19, 0.38, 0.48, 0.56, 0.76]
        for x, c in zip(xs, cols):
            tx(x, y0, c, fontsize=9.5, weight="bold")
        for c in checks:
            y0 -= 0.03
            i = c["info"]
            vals = [str(c["k"]), i.get("time", "—"), VERDICT.get(i.get("verdict"), "—"), i.get("bpm", "—"),
                    i.get("beats", "—"), i.get("irr", "—").replace(".", ","), i.get("sqi", "—").replace(".", ",")]
            for x, v in zip(xs, vals):
                tx(x, y0, v, fontsize=9.5, color="#B8322E" if i.get("verdict") == "2" and x == xs[2] else "black")
        y0 -= 0.05
        tx(0.06, y0, "Наблюдения разработчика (не диагноз).", fontsize=10.5, weight="bold")
        import textwrap
        for l in textwrap.wrap(a.note, 128):
            y0 -= 0.024; tx(0.06, y0, l, fontsize=10)
        y0 -= 0.045
        tx(0.06, y0, "Вопросы врачу.", fontsize=10.5, weight="bold")
        for n, q in enumerate(QUESTIONS, 1):
            for j, l in enumerate(textwrap.wrap(f"{n}. {q}", 128)):
                y0 -= 0.024; tx(0.06 + (0.012 if j else 0), y0, l, fontsize=10)
        foot = ("Полоски — на следующих страницах: 25 мм/с, сетка ЭКГ-бумаги; амплитуда в условных единицах (модуль "
                "не откалиброван в мВ; верхушки R-зубцов срезаны верхом шкалы АЦП). Удары отмечены независимым алгоритмом "
                "(XQRS), над ними — RR в мс.")
        for n_, l in enumerate(textwrap.wrap(foot, 150)):
            tx(0.06, 0.07 - 0.02 * n_, l, fontsize=8.5, color="#555")
        pdf.savefig(fig); plt.close(fig)

        # ---- one page per check
        for c in checks:
            y, beats, i = c["y"], c["beats"], c["info"]
            t = np.arange(len(y)) / FS
            fig = plt.figure(figsize=(W, H))
            fig.text(0.05, 0.955, f"Проверка {c['k']} · окончание {i.get('time', '—')} · прибор: "
                                  f"{VERDICT.get(i.get('verdict'), '—')} · ЧСС {i.get('bpm', '—')} · неровность "
                                  f"{i.get('irr', '—').replace('.', ',')} (порог 0,10)", fontsize=12, weight="bold")
            lo, hi = np.percentile(y, 0.5), np.percentile(y, 99.9)
            pad = (hi - lo) * 0.25
            rows = int(np.ceil(t[-1] / 10))
            rows = min(rows, 3)
            for r in range(rows):
                ax = fig.add_axes([0.05, 0.71 - r * 0.205, 0.92, 0.175])
                s0, s1 = r * 10.0, r * 10.0 + 10.0
                ecg_axes(ax, s0, s1, lo - pad, hi + pad)
                sel = (t >= s0) & (t <= s1)
                ax.plot(t[sel], y[sel], color="black", lw=0.7)
                bt = beats / FS
                for b0, b1 in zip(bt[:-1], bt[1:]):
                    if s0 <= b1 <= s1:
                        ax.text((b0 + b1) / 2 if b0 >= s0 else b1 - 0.25, hi + pad * 0.55, f"{(b1 - b0) * 1000:.0f}",
                                fontsize=7, ha="center", color="#1f4e8c")
                for b in bt[(bt >= s0) & (bt <= s1)]:
                    ax.plot([b], [hi + pad * 0.2], marker="v", ms=3, color="#1f4e8c")
                for m in c["marks"]:
                    if s0 <= m / FS <= s1:
                        ax.annotate(f"{m / FS:.1f} с: отклонение до края шкалы", xy=(m / FS, lo - pad * 0.5),
                                    xytext=(m / FS + 0.35, lo - pad * 0.3), fontsize=8, color="#B8322E",
                                    arrowprops=dict(arrowstyle="->", color="#B8322E", lw=0.8))
            # RR over time
            ax = fig.add_axes([0.05, 0.07, 0.92, 0.15])
            bt = beats / FS; rr = np.diff(bt) * 1000
            ax.plot(bt[1:], rr, "o-", color="#1f4e8c", ms=3, lw=1)
            ax.axhline(rr.mean(), color="#999", lw=0.8, ls="--")
            ax.set_xlim(0, min(30.5, t[-1])); ax.set_ylabel("RR, мс", fontsize=8); ax.set_xlabel("секунды", fontsize=8)
            ax.tick_params(labelsize=7); ax.grid(alpha=0.3)
            ax.set_title("Интервалы RR по ходу записи (пунктир — среднее)", fontsize=9, loc="left")
            pdf.savefig(fig); plt.close(fig)
    print("saved", a.out)


if __name__ == "__main__":
    main()
