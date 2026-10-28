"""Round 4, tasks 3-5 as fixed in ml/ROUND4_PREREG.md §2-§4: false "irregular" at rest, one outlier beat,
candidate changes C0/C1/C2, the live model on sinus rhythm, and what the bench SNR number means.

    python ml/round4_rest.py --ref REFDATA        # REFDATA = folder made by tools/data/fetch_refdata.py

Writes ml/ROUND4_REST.json (all numbers) and prints a summary. The 30-s check is the device's code
(tools/parity/check30_detail.cpp, built from check30.h); the live path is tools/parity/live_host.cpp.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import zlib
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "firmware"))
sys.path.insert(0, os.path.join(ROOT, "firmware"))
from live_emul import LiveHost, model_prob, input_quant  # noqa: E402

BEAT = set("NLRBAaJSVrFejnE/fQ?")
NOISY = {"~", "|"}
HR_BINS = [(0, 60), (60, 70), (70, 80), (80, 90), (90, 100), (100, 999)]
RMSSD_BINS = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 9999)]
SOS = np.array([[0.1424442454, 0.2848884908, 0.1424442454, 1.0, -0.6856000535, 0.2606960323],
                [1.0, -2.0, 1.0, 1.0, -1.9822347504, 0.9823948463]])     # the firmware band-pass at 250 Hz


def rnd3(v):                       # C round() to 3 decimals (half away from zero), as check30.h
    return np.floor(np.asarray(v) * 1000 + 0.5) / 1000


def irr_c0(r):
    r = np.asarray(r)
    if len(r) < 4:
        return None
    return float(rnd3(np.mean(np.abs(np.diff(r))) / np.mean(r)))


def irr_c1(r):
    r = np.asarray(r)
    if len(r) < 4:
        return None
    d = np.sort(np.abs(np.diff(r)))[:-2]          # the two largest |dRR| removed
    if len(d) < 1:
        return None
    return float(rnd3(np.mean(d) / np.mean(r)))


def rr_ms(samples, fs):
    """RR as the device measures it: rounded to ms, kept within 0.25-2.0 s."""
    r = np.floor(np.diff(np.asarray(samples, float)) * 1000.0 / fs + 0.5) / 1000.0
    return r[(r >= 0.25) & (r <= 2.0)]


def verdicts(row):
    """C0/C1/C2 verdicts from the device's check internals (gates of v3 unchanged)."""
    gate = row["beats"] >= 16 and row["sqi"] >= 0.4 and row["ok"] and row["bsqi"] >= 0.8
    out = {}
    for name, irr, thr in (("C0", row["irr"], 0.10), ("C1", irr_c1(row["rr"]), 0.10), ("C2", row["irr"], 0.12)):
        out[name] = 0 if (not gate or irr is None) else (2 if irr > thr else 1)
    return out


def run_check(strips):
    """strips: {name: 125-Hz filtered samples} -> {name: dict of the device check's internals}."""
    exe = os.path.join(tempfile.gettempdir(), f"c30d_{os.getpid()}")
    if not os.path.exists(exe):
        subprocess.run(["g++", "-O2", "-std=c++17", "-I", os.path.join(ROOT, "firmware", "AFibMonitor"),
                        os.path.join(ROOT, "tools", "parity", "check30_detail.cpp"), "-o", exe], check=True)
    chunks = []
    for nm, x in strips.items():
        b = nm.encode(); x = np.asarray(x, np.float32)
        chunks += [np.int32(len(b)).tobytes(), b, np.int32(len(x)).tobytes(), x.tobytes()]
    r = subprocess.run([exe], input=b"".join(chunks), capture_output=True, check=True)
    out = {}
    for ln in r.stdout.decode().splitlines():
        p = ln.split()
        k = int(p[9])
        out[p[1]] = dict(verdict=int(p[2]), beats=int(p[3]), sqi=float(p[4]), irr=float(p[5]), bsqi=float(p[6]),
                         bpm=int(p[7]), ok=p[8] == "1", rr=[float(v) for v in p[10:10 + k]])
    return out


def hr_bin(hr):
    for a, b in HR_BINS:
        if a <= hr < b:
            return f"{a}-{b if b < 999 else ''}"
    return "?"


def share(v):
    v = np.asarray(v, float)
    return float(v.mean()) if len(v) else None


# ---------------------------------------------------------------------------------------------------- 2a, 2d(i), 3
def ref_windows(samples, symbols, fs, win=30.0):
    """Non-overlapping 30-s windows of an annotated record: ('allN' | 'oneX' | None, beat samples)."""
    t = samples / fs
    beat = np.array([s in BEAT for s in symbols]); nz = np.array([s in NOISY for s in symbols])
    out = []
    for w0 in np.arange(0, t[-1] - win, win):
        sel = (t >= w0) & (t < w0 + win)
        if nz[sel].any():
            continue
        bs = sel & beat
        if bs.sum() < 16:
            continue
        sym = symbols[bs]
        nonN = int((sym != "N").sum())
        kind = "allN" if nonN == 0 else ("oneX" if nonN == 1 else None)
        if kind:
            out.append((kind, samples[bs]))
    return out


def rule_level(db, name):
    rows = []
    recs = sorted({k.split("_")[0] for k in db.files})
    for rec in recs:
        fs = float(db[f"{rec}_fs"]); s = db[f"{rec}_ann_sample"]; y = db[f"{rec}_ann_symbol"]
        for kind, bs in ref_windows(s, y, fs):
            r = rr_ms(bs, fs)
            c0, c1 = irr_c0(r), irr_c1(r)
            if c0 is None:
                continue
            rows.append(dict(db=name, rec=rec, kind=kind, hr=60 / np.mean(r), irr=c0, irr1=c1))
    return rows


def model_windows(db, name, step=4):
    """32-RR windows of consecutive N beats without noise marks, stride 4 beats -> int8 inputs as the device."""
    s_, z_ = input_quant()
    f32 = np.float32
    X, info = [], []
    recs = sorted({k.split("_")[0] for k in db.files})
    for rec in recs:
        fs = float(db[f"{rec}_fs"]); s = db[f"{rec}_ann_sample"]; y = db[f"{rec}_ann_symbol"]
        # runs of consecutive annotations that are all N (any other mark breaks the run)
        isn = (y == "N")
        i = 0
        while i < len(y):
            if not isn[i]:
                i += 1; continue
            j = i
            while j < len(y) and isn[j]:
                j += 1
            run = s[i:j]
            if len(run) >= 33:
                rr = (np.diff(run) / fs).astype(f32)
                for k in range(0, len(rr) - 31, step):
                    w = np.clip(rr[k:k + 32], f32(0.2), f32(2.0))
                    m = np.add.accumulate(w, dtype=f32)[-1] / f32(32)
                    f0 = (w - f32(0.8)) / f32(0.25); f1 = (w / m - f32(1.0)) / f32(0.15)
                    q = np.stack([f0, f1], -1).astype(f32) / f32(s_)
                    q = np.clip(np.sign(q) * np.floor(np.abs(q) + 0.5) + z_, -128, 127).astype(np.int8)
                    X.append(q.ravel())
                    info.append((name, rec, float(60 / np.mean(w)), float(np.sqrt(np.mean(np.diff(w.astype(float)) ** 2)) * 1000)))
            i = j
    return np.array(X, np.int8), info


# ---------------------------------------------------------------------------------------------------- 2b, 2d(ii)
def nsrdb_segments(db):
    """Yield (rec, seg, raw mV at 250 Hz, filtered 125 Hz, ann samples (250 Hz, in-segment), symbols)."""
    from scipy.signal import resample_poly, sosfilt
    recs = sorted({k.split("_")[0] for k in db.files})
    for rec in recs:
        fs = float(db[f"{rec}_fs"]); g = float(db[f"{rec}_gain"]); b0 = float(db[f"{rec}_baseline"])
        sig = db[f"{rec}_sig"]; starts = db[f"{rec}_starts"]
        s = db[f"{rec}_ann_sample"]; y = db[f"{rec}_ann_symbol"]
        for k in range(sig.shape[0]):
            mv = (sig[k].astype(float) - b0) / g
            raw = resample_poly(mv, 125, 64)                       # 128 -> 250 Hz
            y125 = sosfilt(SOS, raw)[::2]
            sel = (s >= starts[k]) & (s < starts[k] + sig.shape[1])
            a250 = np.floor((s[sel] - starts[k]) * 250.0 / fs + 0.5).astype(int)
            yield rec, k, raw, y125, a250, y[sel]


def window_kind(a250, sym, w0, w1):
    sel = (a250 >= w0) & (a250 < w1)
    sy = sym[sel]
    if any(v in NOISY for v in sy):
        return "noise_mark"
    beats = [v for v in sy if v in BEAT]
    return "allN" if all(v == "N" for v in beats) else "ectopic"


def _snr(x):
    import afib_stream as A
    v, n = A.snr_of_array(np.asarray(x, float))
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    a = ap.parse_args()
    T0 = time.time()
    res = {}
    nsr2 = np.load(os.path.join(a.ref, "nsr2db.npz"))
    nsr1 = np.load(os.path.join(a.ref, "nsrdb.npz"))

    # ---- 2a rule level, reference beats
    rows = rule_level(nsr2, "nsr2db") + rule_level(nsr1, "nsrdb")
    R = {}
    for dbn in ("nsr2db", "nsrdb", "both"):
        al = [r for r in rows if r["kind"] == "allN" and (dbn == "both" or r["db"] == dbn)]
        irr = np.array([r["irr"] for r in al]); irr1 = np.array([r["irr1"] if r["irr1"] is not None else 0 for r in al])
        hr = np.array([r["hr"] for r in al])
        per = {}
        for r in al:
            per.setdefault(r["rec"], []).append(r["irr"] > 0.10)
        R[dbn] = dict(windows=len(al), people=len(per),
                      C0=share(irr > 0.10), C1=share(irr1 > 0.10), C2=share(irr > 0.12),
                      borderline_0p09_0p11=share((irr >= 0.09) & (irr <= 0.11)),
                      by_hr={hr_bin(lo + 0.001): dict(n=int(((hr >= lo) & (hr < hi)).sum()),
                                                     C0=share(irr[(hr >= lo) & (hr < hi)] > 0.10),
                                                     C1=share(irr1[(hr >= lo) & (hr < hi)] > 0.10),
                                                     C2=share(irr[(hr >= lo) & (hr < hi)] > 0.12)) for lo, hi in HR_BINS},
                      people_over_10pct=int(sum(np.mean(v) > 0.10 for v in per.values())),
                      people_over_25pct=int(sum(np.mean(v) > 0.25 for v in per.values())))
        one = [r for r in rows if r["kind"] == "oneX" and (dbn == "both" or r["db"] == dbn)]
        R[dbn]["one_ectopic"] = dict(windows=len(one), C0=share([r["irr"] > 0.10 for r in one]),
                                     C1=share([(r["irr1"] or 0) > 0.10 for r in one]), C2=share([r["irr"] > 0.12 for r in one]))
    res["2a_rule_level"] = R
    print("2a done", f"{time.time() - T0:.0f} s", flush=True)

    # ---- 3 model on reference sinus RR
    X2, i2 = model_windows(nsr2, "nsr2db"); X1, i1 = model_windows(nsr1, "nsrdb")
    X = np.concatenate([X2, X1]); info = i2 + i1
    p = model_prob(X)
    hr = np.array([v[2] for v in info]); rm = np.array([v[3] for v in info]); dbs = np.array([v[0] for v in info])
    M = dict(windows=int(len(p)), share_ge_0p5=share(p >= 0.5), median=float(np.median(p)),
             p95=float(np.percentile(p, 95)), p99=float(np.percentile(p, 99)),
             by_db={d: dict(n=int((dbs == d).sum()), share_ge_0p5=share(p[dbs == d] >= 0.5)) for d in ("nsr2db", "nsrdb")},
             by_hr={f"{lo}-{hi if hi < 999 else ''}": dict(n=int(((hr >= lo) & (hr < hi)).sum()),
                    share_ge_0p5=share(p[(hr >= lo) & (hr < hi)] >= 0.5)) for lo, hi in HR_BINS},
             by_rmssd_ms={f"{lo}-{hi if hi < 9999 else ''}": dict(n=int(((rm >= lo) & (rm < hi)).sum()),
                          share_ge_0p5=share(p[(rm >= lo) & (rm < hi)] >= 0.5)) for lo, hi in RMSSD_BINS})
    res["3_model_reference_rr"] = M
    print("3 (reference RR) done", f"{time.time() - T0:.0f} s", flush=True)

    # ---- 2b signal level NSRDB, 2d(ii) one spike, 3 with the firmware detector, 4a SNR of clean windows
    from scipy.signal import sosfilt
    strips, meta, spiked, live_in, snr_pool = {}, {}, {}, {}, []
    for rec, k, raw, y125, a250, sym in nsrdb_segments(nsr1):
        live_in[f"{rec}_{k}"] = raw
        for w in range(19):                                   # 30-s windows from 10 s on
            w0 = (10 + 30 * w) * 250; w1 = w0 + 30 * 250
            if w1 > len(raw):
                break
            nm = f"{rec}_{k}_{w}"
            strips[nm] = y125[w0 // 2:w1 // 2]
            kind = window_kind(a250, sym, w0, w1)
            meta[nm] = kind
            if kind == "allN":
                snr_pool.append((nm, raw[w0:w1]))
                bs = a250[(a250 >= w0) & (a250 < w1) & np.isin(sym, list(BEAT))]
                if len(bs) >= 3:
                    rng = np.random.RandomState(zlib.crc32(nm.encode()) % 2 ** 31)
                    j = rng.randint(0, len(bs) - 1)
                    lo_, hi_ = bs[j] + int(0.15 * 250), bs[j + 1] - int(0.15 * 250)
                    if hi_ > lo_:
                        pos = rng.randint(lo_, hi_)
                        amp = np.median(raw[bs] - np.median(raw[w0:w1]))
                        sp = np.zeros(w1 - w0 + 2500); sp[pos - w0 + 2500:pos - w0 + 2503] = -1.5 * amp
                        add = sosfilt(SOS, sp)[2500:]                       # linear: filtered spike adds on
                        spiked[nm] = y125[w0 // 2:w1 // 2] + add[::2][:len(strips[nm])]
    C = run_check(strips)
    S = run_check(spiked)
    mism = sum(verdicts(C[n])["C0"] != C[n]["verdict"] for n in C)
    assert mism == 0, f"C0 recomputed from the internals differs from the device verdict in {mism} windows"
    B = {}
    for kind in ("allN", "ectopic", "noise_mark"):
        names = [n for n in strips if meta[n] == kind and n in C]
        v = {c: np.array([verdicts(C[n])[c] for n in names]) for c in ("C0", "C1", "C2")}
        hrv = np.array([C[n]["bpm"] for n in names])
        B[kind] = dict(windows=len(names), **{c: dict(irregular=share(v[c] == 2), regular=share(v[c] == 1),
                                                       no_verdict=share(v[c] == 0)) for c in v},
                       by_hr={f"{lo}-{hi if hi < 999 else ''}": dict(n=int(((hrv >= lo) & (hrv < hi)).sum()),
                              C0_irregular=share(v["C0"][(hrv >= lo) & (hrv < hi)] == 2)) for lo, hi in HR_BINS})
    res["2b_signal_nsrdb"] = B
    base_reg = [n for n in spiked if n in C and n in S and verdicts(C[n])["C0"] == 1]
    res["2d_ii_one_spike"] = dict(windows=len(base_reg), **{c: dict(
        flips_to_irregular=share([verdicts(S[n])[c] == 2 for n in base_reg if verdicts(C[n])[c] == 1]),
        becomes_no_verdict=share([verdicts(S[n])[c] == 0 for n in base_reg if verdicts(C[n])[c] == 1]))
        for c in ("C0", "C1", "C2")})
    print("2b/2d done", f"{time.time() - T0:.0f} s", flush=True)

    dec = LiveHost(lag=-1).run(live_in)
    pdv = model_prob(np.array([d["q"] for d in dec])) if dec else np.zeros(0)
    # keep decisions whose RR span holds only N beats (annotations) and no noise marks
    keep = []
    seg_ann = {}
    for rec, k, raw, y125, a250, sym in nsrdb_segments(nsr1):
        seg_ann[f"{rec}_{k}"] = (a250, sym)
    for d, pp in zip(dec, pdv):
        a250, sym = seg_ann[d["name"]]
        sel = (a250 >= d["n"] - d["span"]) & (a250 < d["n"])
        if len(sym[sel]) and all(v == "N" for v in sym[sel]):
            keep.append(pp)
    keep = np.array(keep)
    res["3_model_firmware_detector_nsrdb"] = dict(decisions=int(len(keep)), share_ge_0p5=share(keep >= 0.5),
                                                  median=float(np.median(keep)) if len(keep) else None)
    print("3 (firmware detector) done", f"{time.time() - T0:.0f} s", flush=True)

    # ---- 2c CinC 2017 (notebook protocol: first 30 s, band-pass at 300 Hz, resampled to 125 Hz) + C0/C1/C2 on AF
    import pandas as pd
    import wfdb
    from scipy.signal import butter, resample_poly
    ref = pd.read_csv(os.path.join(a.ref, "REFERENCE-v3.csv"), header=None, names=["record", "label"])
    sos300 = butter(2, [0.5, 40], btype="band", fs=300, output="sos")
    cstr, clab, raw250 = {}, {}, {}
    for rec, lab in zip(ref.record, ref.label):
        if lab not in ("A", "N"):
            continue
        r = wfdb.rdrecord(os.path.join(a.ref, "training2017", rec))
        x = np.nan_to_num(r.p_signal[:30 * r.fs, 0])
        cstr[rec] = resample_poly(sosfilt(sos300, x), 5, 12); clab[rec] = lab
        if lab == "N":
            raw250[rec] = resample_poly(x, 5, 6)
    CC = run_check(cstr)
    Cn = dict()
    for lab in ("A", "N"):
        names = [n for n in cstr if clab[n] == lab and n in CC]
        v = {c: np.array([verdicts(CC[n])[c] for n in names]) for c in ("C0", "C1", "C2")}
        Cn[lab] = dict(n=len(names), **{c: dict(irregular=share(v[c] == 2), regular=share(v[c] == 1),
                                                 no_verdict=share(v[c] == 0)) for c in v})
        if lab == "N":
            hrv = np.array([CC[n]["bpm"] for n in names])
            Cn[lab]["by_hr"] = {f"{lo}-{hi if hi < 999 else ''}": dict(n=int(((hrv >= lo) & (hrv < hi)).sum()),
                                C0_irregular=share(v["C0"][(hrv >= lo) & (hrv < hi)] == 2),
                                C1_irregular=share(v["C1"][(hrv >= lo) & (hrv < hi)] == 2),
                                C2_irregular=share(v["C2"][(hrv >= lo) & (hrv < hi)] == 2)) for lo, hi in HR_BINS}
    res["2c_cinc2017"] = Cn
    # proposal rule (ROUND4_PREREG §2): AF irregular falls by <= 2 points and Normal irregular falls by >= 30 %
    prop = {}
    for c in ("C1", "C2"):
        dA = Cn["A"]["C0"]["irregular"] - Cn["A"][c]["irregular"]
        rN = 1 - Cn["N"][c]["irregular"] / Cn["N"]["C0"]["irregular"]
        a2 = res["2a_rule_level"]["both"]; d2 = res["2d_ii_one_spike"]
        prop[c] = dict(AF_drop_points=dA * 100, Normal_relative_drop=rN,
                       lowers_2a=a2[c] < a2["C0"] and a2["one_ectopic"][c] < a2["one_ectopic"]["C0"],
                       lowers_2d=(d2[c]["flips_to_irregular"] or 0) < (d2["C0"]["flips_to_irregular"] or 0),
                       proposed=bool(dA * 100 <= 2 and rN >= 0.30))
        prop[c]["proposed"] = bool(prop[c]["proposed"] and prop[c]["lowers_2a"] and prop[c]["lowers_2d"])
    res["proposal_rule"] = prop
    print("2c done", f"{time.time() - T0:.0f} s", flush=True)

    # ---- 4 bench SNR meaning: random 300 clean NSRDB windows, random 300 CinC Normal (+ ma noise 24/18/12 dB)
    from round4_gate import load_noise, add_noise_whole, seeded
    rng = np.random.RandomState(0)
    pool = [snr_pool[i][1] for i in rng.choice(len(snr_pool), min(300, len(snr_pool)), replace=False)]
    cn = sorted(raw250)
    pick = [cn[i] for i in np.random.RandomState(0).choice(len(cn), 300, replace=False)]
    ma = load_noise(a.ref, "ma")[1]
    jobs = pool + [raw250[r] for r in pick]
    for snr in (24, 18, 12):
        jobs += [add_noise_whole(raw250[r], ma, snr, seeded("snrcal", r, snr)) for r in pick]
    with Pool(2) as P:
        v = P.map(_snr, jobs, chunksize=8)
    v = np.array([np.nan if x is None else x for x in v], float)
    parts = {"nsrdb_clean": v[:len(pool)], "cinc_N_clean": v[len(pool):len(pool) + 300]}
    for i, snr in enumerate((24, 18, 12)):
        parts[f"cinc_N_ma_{snr}dB"] = v[len(pool) + 300 * (i + 1):len(pool) + 300 * (i + 2)]
    res["4_bench_snr"] = {k: dict(n=int(np.isfinite(x).sum()), median=float(np.nanmedian(x)),
                                  q25=float(np.nanpercentile(x, 25)), q75=float(np.nanpercentile(x, 75))) for k, x in parts.items()}
    print("4 done", f"{time.time() - T0:.0f} s", flush=True)
    res["run"] = time.strftime("%Y-%m-%d %H:%M")
    json.dump(res, open(os.path.join(HERE, "ROUND4_REST.json"), "w"), indent=1, default=float)
    print(json.dumps(res, indent=1, default=float)[:6000])


if __name__ == "__main__":
    main()
