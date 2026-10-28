"""Review a live AD8232 recording (afib_stream.py --live N --out file.csv): are the heartbeats the firmware
finds the real ones?

For the recording it runs
  * the firmware path, emulated in float32 (same band-pass, decimation and R detector as afib_main.cpp,
    shared with tools/firmware/emulate_eval.py), and
  * an independent reference detector (wfdb XQRS on the raw 250 Hz signal),
then compares beat counts and RR intervals and runs the int8 RR model on the last 32 intervals of each.

Reading the result (written before the first live recording was reviewed):
  * firmware RR irregular, reference RR regular, model high only on firmware RR -> detector error on this
    signal (extra or missed beats), not the rhythm;
  * both irregular and both model outputs high -> the intervals really are uneven; this tool cannot say why
    (premature beats, sinus arrhythmia, AF ...). That needs a 12-lead ECG read by a doctor.
  * too few beats in either -> the recording is not usable.
This is a research check of the prototype, not a medical interpretation.

Usage: python tools/firmware/rr_review.py gel_1.csv [--png out.png]
"""
import argparse
import csv
import os
import sys

import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import emulate_eval as E  # noqa: E402  (filter, detector constants and the int8 model)

f32 = np.float32
FS_RAW = 250


def load(path):
    t, v = [], []
    with open(path) as fh:
        for r in csv.DictReader(fh):
            t.append(float(r["t_s"])); v.append(float(r["mv"]))
    return np.array(v, f32)


def firmware_beats(x):
    """Beat times (s) exactly as the firmware detector reports them (envelope crossing, 125 Hz)."""
    z = np.zeros((2, 2), f32); tog = False
    buf = np.zeros(E.MA_N, f32); ssum = f32(0); prev = f32(0); pk = f32(0); last = -10**6; armed = True; i = 0
    beats = []
    for v in x:
        for s in range(2):
            c = E.SOS[s]; y = f32(c[0] * v + z[s, 0]); z[s, 0] = f32(c[1] * v - c[3] * y + z[s, 1]); z[s, 1] = f32(c[2] * v - c[4] * y); v = y
        tog = not tog
        if not tog:
            continue
        d = f32(v - prev); prev = v; e = f32(d * d); k = i % E.MA_N
        ssum = f32(ssum + e - buf[k]); buf[k] = e; env = f32(ssum / E.MA_N); pk = max(f32(pk * E.rDecay), env)
        if i >= E.R_WARM:
            if armed and env > E.R_THR * pk and i - last > E.R_REFR:
                beats.append(i / E.FS); last = i; armed = False
            elif not armed and env < f32(0.5) * E.R_THR * pk:
                armed = True
        i += 1
    return np.array(beats)


def reference_beats(x):
    import wfdb.processing as wp
    idx = wp.xqrs_detect(sig=x.astype(float), fs=FS_RAW, verbose=False)
    idx = idx[idx >= 2 * FS_RAW]          # same 2-s warm-up as the firmware detector
    return idx / FS_RAW


def describe(name, beats):
    rr = np.diff(beats)
    if len(rr) < 4:
        print(f"{name:10s} beats {len(beats):3d}  — too few for an RR review"); return rr, None
    rmssd = float(np.sqrt(np.mean(np.diff(rr) ** 2)))
    irr = float(np.mean(np.abs(np.diff(rr))) / np.mean(rr))
    prob = E.model(list(rr[-E.N_RR:])) if len(rr) >= E.N_RR else None
    print(f"{name:10s} beats {len(beats):3d}  HR {60 / np.mean(rr):5.1f}/min  RR {rr.min():.2f}-{rr.max():.2f} s  "
          f"RMSSD {rmssd * 1000:5.0f} ms  irregularity {irr:.3f}  model(last 32 RR) "
          + ("n/a (<32 RR)" if prob is None else f"{prob:.3f}"))
    return rr, prob


def match(a, b, tol=0.15):
    """Greedy match of beat times after removing the median lag between the two detectors."""
    if len(a) == 0 or len(b) == 0:
        return 0, 0.0
    lag = np.median([b[np.argmin(np.abs(b - t))] - t for t in a])
    a2 = a + lag; used = set(); m = 0
    for t in a2:
        j = int(np.argmin(np.abs(b - t)))
        if abs(b[j] - t) <= tol and j not in used:
            used.add(j); m += 1
    return m, float(lag)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--png")
    a = ap.parse_args()
    x = load(a.csv)
    print(f"{a.csv}: {len(x)} samples = {len(x) / FS_RAW:.1f} s, raw {x.min():.0f}-{x.max():.0f} mV")
    fb, rb = firmware_beats(x), reference_beats(x)
    rr_f, p_f = describe("firmware", fb)
    rr_r, p_r = describe("reference", rb)
    m, lag = match(fb, rb)
    print(f"matched beats {m}  (firmware only {len(fb) - m}, reference only {len(rb) - m}; firmware lag {lag * 1000:.0f} ms)")
    if len(rr_f) >= 4 and len(rr_r) >= 4:
        print("RR firmware :", " ".join(f"{v:.2f}" for v in rr_f))
        print("RR reference:", " ".join(f"{v:.2f}" for v in rr_r))
    if a.png:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        t = np.arange(len(x)) / FS_RAW
        rows = int(np.ceil(t[-1] / 10))
        fig, axs = plt.subplots(rows, 1, figsize=(14, 2.2 * rows), squeeze=False)
        for k in range(rows):
            ax = axs[k, 0]; s, e = k * 10, (k + 1) * 10
            sel = (t >= s) & (t < e)
            ax.plot(t[sel], x[sel], lw=0.7, color="#333")
            for bt in rb[(rb >= s) & (rb < e)]:
                ax.axvline(bt, color="#1f77b4", lw=0.8, alpha=0.7)
            for bt in fb[(fb >= s) & (fb < e)]:
                ax.axvline(bt - lag, color="#d62728", lw=0.8, ls="--", alpha=0.8)
            ax.set_xlim(s, e); ax.set_yticks([])
        axs[0, 0].set_title("raw ECG; blue = reference beats, red dashed = firmware beats (lag removed)")
        axs[-1, 0].set_xlabel("s")
        fig.tight_layout(); fig.savefig(a.png, dpi=110)
        print("saved", a.png)


if __name__ == "__main__":
    main()
