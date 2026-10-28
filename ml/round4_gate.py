"""Round 4, task 2: a quality gate for the live verdict, chosen and tested as fixed in ml/ROUND4_PREREG.md §1.

    python ml/round4_gate.py tune  --ref REFDATA --afdb AFDB_DIR     # tuning data only; writes the choice
    python ml/round4_gate.py test  --ref REFDATA --afdb AFDB_DIR     # run once, after the choice is committed

REFDATA = the folder made by tools/data/fetch_refdata.py (nstdb/, mitdb/, training2017/, REFERENCE-v3.csv);
AFDB_DIR = the folder with the AFDB records (afib_stream.py downloads them to afdb_cache/).
The device's live path runs through tools/parity/live_host.cpp (the firmware's own headers).
"""
import argparse
import json
import os
import sys
import time
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "firmware"))
from live_emul import LiveHost, model_prob  # noqa: E402

FS = 250
OUT = os.path.join(HERE, "round4_out")
CHOICE = os.path.join(HERE, "ROUND4_GATE_CHOICE.json")
TUNE_AFDB, TEST_AFDB = ["04015", "05121", "07879"], ["05261", "08215"]
GRID = {"g1": np.round(np.arange(0.50, 0.995, 0.01), 2), "g2": np.round(np.arange(0.50, 0.995, 0.01), 2),
        "g3": np.round(np.arange(0.30, 0.905, 0.01), 2)}
HOLD = 8          # a bad window blocks this decision and the next 7 (32 beats at 4 beats per decision)


def bandpass(x):
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(2, [0.5, 40], btype="band", fs=FS, output="sos"), x)


def load_noise(ref, kind):
    import wfdb
    from scipy.signal import resample_poly
    r = wfdb.rdrecord(os.path.join(ref, "nstdb", kind), channels=[0])
    z = resample_poly(np.nan_to_num(r.p_signal[:, 0]), 25, 36)      # 360 -> 250 Hz
    h = len(z) // 2
    return z[:h], z[h:]                                               # tuning half, test half


def seeded(*parts):
    return np.random.RandomState(zlib.crc32("|".join(map(str, parts)).encode()) % 2 ** 31)


def add_noise_whole(x, z, snr, rng):
    """CinC protocol (ml/NOISE_SQI.md): one noise stretch over the whole recording, SNR after the band-pass."""
    s = rng.randint(0, len(z) - len(x))
    zz = z[s:s + len(x)]
    ps, pn = bandpass(x).var(), bandpass(zz).var()
    return x + zz * np.sqrt(ps / (pn * 10 ** (snr / 10))) if pn > 0 else x.copy()


def add_noise_bursts(x, z, snr, rng, on=120, period=240, first=240):
    """AFDB protocol: noise switched on for 2 min every 4 min from minute 4; SNR per burst after the band-pass."""
    y = x.copy(); xb = bandpass(x); segs = []
    L = on * FS
    for t0 in range(first * FS, len(x) - L, period * FS):
        s = rng.randint(0, len(z) - L)
        zz = z[s:s + L]
        ps, pn = xb[t0:t0 + L].var(), bandpass(zz).var()
        if pn > 0:
            y[t0:t0 + L] += zz * np.sqrt(ps / (pn * 10 ** (snr / 10)))
        segs.append((t0, t0 + L))
    return y, segs


def run_host(records, lag):
    dec = LiveHost(lag=lag).run(records)
    if dec:
        p = model_prob(np.array([d["q"] for d in dec]))
        for d, pp in zip(dec, p):
            d["af"] = bool(pp >= 0.5); d["prob"] = float(pp); del d["q"]
    return dec


def by_name(dec):
    out = {}
    for d in dec:
        out.setdefault(d["name"], []).append(d)
    return out


def bad_flags(seq, g, t):
    """Per decision: blocked by the gate (a bad window now or at one of the previous HOLD-1 decisions)."""
    bad = np.array([d[g] < t for d in seq], bool) if isinstance(seq, list) else seq[g] < t
    c = np.concatenate([[0], np.cumsum(bad)])
    k = np.arange(len(bad))
    return (c[k + 1] - c[np.maximum(0, k + 1 - HOLD)]) > 0


def compare(clean, noisy, segs=None):
    """For each noisy decision: affected (its RR span overlaps a noise burst; every decision when the whole recording
    is noisy), comparable (a clean decision within 2 s), changed (comparable and the other verdict)."""
    n = np.array([d["n"] for d in noisy], np.int64)
    if not len(n):
        return np.zeros((0, 3), bool)
    if segs is None:
        aff = np.ones(len(n), bool)
    else:
        s0 = np.array([a for a, b in segs], np.int64); s1 = np.array([b for a, b in segs], np.int64)
        lo = n - np.array([d["span"] for d in noisy], np.int64)
        k = np.searchsorted(s0, n, side="left") - 1          # last burst starting before the decision
        aff = (k >= 0) & (lo < s1[np.maximum(k, 0)])
    cn = np.array([d["n"] for d in clean], np.int64)
    if not len(cn):
        return np.stack([aff, np.zeros(len(n), bool), np.zeros(len(n), bool)], 1)
    caf = np.array([d["af"] for d in clean], bool)
    j = np.clip(np.searchsorted(cn, n), 1, len(cn) - 1) if len(cn) > 1 else np.zeros(len(n), int)
    if len(cn) > 1:
        j = np.where(np.abs(cn[j - 1] - n) <= np.abs(cn[j] - n), j - 1, j)
    comp = np.abs(cn[j] - n) <= 2 * FS
    naf = np.array([d["af"] for d in noisy], bool)
    return np.stack([aff, comp, comp & (caf[j] != naf)], 1)


def garr(seq):
    return {g: np.array([d[g] for d in seq], float) for g in ("g1", "g2", "g3")}


def evaluate(cleanarr, cmp, g, t, le=(6, 0), kinds=("em", "ma")):
    """cleanarr: [per-recording gate arrays]; cmp: {(kind, snr): [(compare result, gate arrays) per recording]}."""
    kept = np.concatenate([~bad_flags(a, g, t) for a in cleanarr]) if cleanarr else np.zeros(0, bool)
    row = dict(gate=g, t=t, clean_kept=float(kept.mean()) if len(kept) else 0.0, clean_n=int(len(kept)), detail={})
    for key, lst in cmp.items():
        ch = bl = af = afb = nc = 0
        for res, arr in lst:
            if not len(res):
                continue
            blk = bad_flags(arr, g, t)
            aff, comp, chg = res[:, 0], res[:, 1], res[:, 2]
            ch += int((aff & chg).sum()); bl += int((aff & chg & blk).sum())
            af += int(aff.sum()); afb += int((aff & blk).sum()); nc += int((aff & ~comp).sum())
        row["detail"][f"{key[0]}_{key[1]}"] = dict(changed=ch, blocked=bl, share_blocked=bl / ch if ch else None,
                                                   affected=af, affected_blocked=afb, not_comparable=nc)
    sel = [v for k, v in row["detail"].items() if k.split("_")[0] in kinds and int(k.split("_")[1]) in le]
    ch = sum(v["changed"] for v in sel); bl = sum(v["blocked"] for v in sel)
    row.update(changed_le6=ch, blocked_le6=bl, share_blocked_le6=bl / ch if ch else 0.0)
    return row


def measure_lag(clean_all):
    v = [d["lagmed"] for seq in clean_all.values() for d in seq if d["lagmed"] != 999]
    return int(round(float(np.median(v))))


def tune(a):
    os.makedirs(OUT, exist_ok=True)
    import wfdb
    noise = {k: load_noise(a.ref, k)[0] for k in ("em", "ma")}
    sig = {r: np.nan_to_num(wfdb.rdrecord(os.path.join(a.afdb, r), channels=[0]).p_signal[:, 0]) for r in TUNE_AFDB}
    t0 = time.time()
    clean = by_name(run_host(sig, lag=0))
    lag = measure_lag(clean)
    print(f"lag of the live detector mark after the R peak: {lag} samples ({time.time() - t0:.0f} s)", flush=True)
    clean = by_name(run_host(sig, lag=lag))
    noisy = {}
    for kind in ("em", "ma"):
        for snr in (12, 6, 0):
            recs, segs = {}, {}
            for r in TUNE_AFDB:
                y, sg = add_noise_bursts(sig[r], noise[kind], snr, seeded("tune", r, kind, snr))
                recs[r] = y; segs[r] = sg
            dec = by_name(run_host(recs, lag=lag))
            noisy[(kind, snr)] = {r: (dec.get(r, []), segs[r]) for r in TUNE_AFDB}
            print(f"  {kind} {snr} dB done ({time.time() - t0:.0f} s)", flush=True)

    cmp = {key: [(compare(clean.get(r, []), seq, sg), garr(seq)) for r, (seq, sg) in per.items()]
           for key, per in noisy.items()}
    cleanarr = [garr(seq) for seq in clean.values()]
    table = []
    for g, ths in GRID.items():
        for t in ths:
            table.append(evaluate(cleanarr, cmp, g, float(t)))
    ok = [r for r in table if r["clean_kept"] >= 0.97]
    order = {"g1": 0, "g2": 1, "g3": 2}
    best = max(ok, key=lambda r: (round(r["share_blocked_le6"] or 0, 6), round(r["clean_kept"], 6), -order[r["gate"]]))
    json.dump(dict(lag=lag, table=table), open(os.path.join(OUT, "gate_tune.json"), "w"), indent=1, default=float)
    choice = dict(gate=best["gate"], threshold=best["t"], lag=lag, hold_decisions=HOLD,
                  tuning=dict(clean_kept=best["clean_kept"], share_blocked_le6=best["share_blocked_le6"],
                              changed_le6=best["changed_le6"], blocked_le6=best["blocked_le6"],
                              detail=best["detail"]),
                  made=time.strftime("%Y-%m-%d %H:%M"), rule="ml/ROUND4_PREREG.md §1")
    json.dump(choice, open(CHOICE, "w"), indent=1)
    for g in GRID:
        rows = [r for r in table if r["gate"] == g and r["clean_kept"] >= 0.97]
        if rows:
            r = max(rows, key=lambda r: r["share_blocked_le6"] or 0)
            print(f"best {g}: t={r['t']:.2f} clean kept {r['clean_kept']:.3f} blocked {r['share_blocked_le6']:.3f} "
                  f"({r['blocked_le6']}/{r['changed_le6']})")
    print("CHOICE:", json.dumps({k: choice[k] for k in ("gate", "threshold", "lag")}), "->", CHOICE)


def test(a):
    """Run once after ROUND4_GATE_CHOICE.json is committed (ml/ROUND4_PREREG.md §1, T1 and T2)."""
    import wfdb
    import pandas as pd
    from scipy.signal import resample_poly
    ch = json.load(open(CHOICE)); g, t, lag = ch["gate"], float(ch["threshold"]), int(ch["lag"])
    print(f"gate {g} < {t} -> bad, lag {lag}", flush=True)
    noise = {k: load_noise(a.ref, k)[1] for k in ("em", "ma", "bw")}          # test halves
    t0 = time.time()
    # T1: CinC 2017, AF and Normal, resampled to 250 Hz
    ref = pd.read_csv(os.path.join(a.ref, "REFERENCE-v3.csv"), header=None, names=["record", "label"])
    ref = ref[ref.label.isin(["A", "N"])]
    sig, lab = {}, {}
    for rec, l in zip(ref.record, ref.label):
        r = wfdb.rdrecord(os.path.join(a.ref, "training2017", rec))
        sig[rec] = resample_poly(np.nan_to_num(r.p_signal[:, 0]), 5, 6); lab[rec] = l
    clean = by_name(run_host(sig, lag))
    use = [r for r in sig if r in clean]                        # >= 33 beats on the clean signal (>= 1 decision)
    print(f"T1: {len(use)} of {len(sig)} recordings have a live decision ({time.time() - t0:.0f} s)", flush=True)
    cmp1, rec_rows = {}, []
    for kind in ("em", "ma", "bw"):
        for snr in (12, 6, 0):
            recs = {r: add_noise_whole(sig[r], noise[kind], snr, seeded("test", r, kind, snr)) for r in use}
            dec = by_name(run_host(recs, lag))
            cmp1[(kind, snr)] = [(compare(clean[r], dec.get(r, [])), garr(dec.get(r, []))) for r in use]
            for r in use:                                         # per recording, as ml/NOISE_SQI.md
                seq = dec.get(r, [])
                if not seq:
                    rec_rows.append(dict(record=r, label=lab[r], noise=kind, snr=snr, n=0)); continue
                blk = bad_flags(garr(seq), g, t); af = np.array([d["af"] for d in seq])
                rec_rows.append(dict(record=r, label=lab[r], noise=kind, snr=snr, n=len(seq),
                                     frac_af=float(af.mean()), n_shown=int((~blk).sum()),
                                     frac_af_shown=float(af[~blk].mean()) if (~blk).any() else None))
            print(f"  T1 {kind} {snr} dB ({time.time() - t0:.0f} s)", flush=True)
    for r in use:
        seq = clean[r]; blk = bad_flags(garr(seq), g, t); af = np.array([d["af"] for d in seq])
        rec_rows.append(dict(record=r, label=lab[r], noise="clean", snr=99, n=len(seq), frac_af=float(af.mean()),
                             n_shown=int((~blk).sum()), frac_af_shown=float(af[~blk].mean()) if (~blk).any() else None))
    t1 = evaluate([garr(clean[r]) for r in use], cmp1, g, t)
    # T2: AFDB 05261, 08215, noise bursts at 6 dB
    sig2 = {r: np.nan_to_num(wfdb.rdrecord(os.path.join(a.afdb, r), channels=[0]).p_signal[:, 0]) for r in TEST_AFDB}
    clean2 = by_name(run_host(sig2, lag))
    cmp2 = {}
    for kind in ("em", "ma"):
        recs, segs = {}, {}
        for r in TEST_AFDB:
            recs[r], segs[r] = add_noise_bursts(sig2[r], noise[kind], 6, seeded("test", r, kind, 6))
        dec = by_name(run_host(recs, lag))
        cmp2[(kind, 6)] = [(compare(clean2.get(r, []), dec.get(r, []), segs[r]), garr(dec.get(r, []))) for r in TEST_AFDB]
        print(f"  T2 {kind} 6 dB ({time.time() - t0:.0f} s)", flush=True)
    t2 = evaluate([garr(clean2.get(r, [])) for r in TEST_AFDB], cmp2, g, t, le=(6,))
    # the pass rule
    def pooled(kind):
        ch = sum(t1["detail"][f"{kind}_{n}"]["changed"] for n in (6, 0)) + t2["detail"][f"{kind}_6"]["changed"]
        bl = sum(t1["detail"][f"{kind}_{n}"]["blocked"] for n in (6, 0)) + t2["detail"][f"{kind}_6"]["blocked"]
        return bl, ch
    em, ma = pooled("em"), pooled("ma")
    crit = {"1_clean_kept_T1>=0.95": t1["clean_kept"] >= 0.95, "1_clean_kept_T2>=0.95": t2["clean_kept"] >= 0.95,
            "2_em_blocked>=0.80": em[1] > 0 and em[0] / em[1] >= 0.80,
            "3_ma_blocked>=0.80": ma[1] > 0 and ma[0] / ma[1] >= 0.80}
    R = pd.DataFrame(rec_rows)
    def per_rec(df):
        y = df.label == "A"; v = df[df.n > 0]
        out = {}
        for nm, col in (("ungated", "frac_af"), ("gated", "frac_af_shown")):
            w = v[v[col].notna()] if nm == "gated" else v
            yy = w.label == "A"; pred = w[col] >= 0.5
            out[nm] = dict(sens=float(pred[yy].mean()) if yy.any() else None, spec=float((~pred[~yy]).mean()) if (~yy).any() else None,
                           false_af_on_N=int((pred & ~yy).sum()), recordings=int(len(w)))
        out["no_verdict_N"] = float((v[~(v.label == "A")].frac_af_shown.isna()).mean()) if len(v) else None
        out["no_verdict_A"] = float((v[v.label == "A"].frac_af_shown.isna()).mean()) if len(v) else None
        return out
    proto = {f"{k}_{n}": per_rec(R[(R.noise == k) & (R.snr == n)]) for k, n in [("clean", 99)] + [(k, n) for k in ("em", "ma", "bw") for n in (12, 6, 0)]}
    res = dict(choice=ch, T1=t1, T2=t2, em_blocked=em, ma_blocked=ma, criteria=crit, passed=all(crit.values()),
               cinc_protocol=proto, run=time.strftime("%Y-%m-%d %H:%M"))
    os.makedirs(OUT, exist_ok=True)
    json.dump(res, open(os.path.join(HERE, "ROUND4_GATE_TEST.json"), "w"), indent=1, default=float)
    R.to_csv(os.path.join(OUT, "gate_test_recordings.csv"), index=False)
    print(json.dumps(dict(T1_clean_kept=t1["clean_kept"], T2_clean_kept=t2["clean_kept"], em=em, ma=ma, criteria=crit,
                          passed=res["passed"]), indent=1, default=float))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["tune", "test"])
    ap.add_argument("--ref", required=True)
    ap.add_argument("--afdb", required=True)
    a = ap.parse_args()
    if a.stage == "tune":
        tune(a)
    else:
        test(a)


if __name__ == "__main__":
    main()
