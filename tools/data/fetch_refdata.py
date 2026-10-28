"""Download the public reference ECG data used in round 4 (motion gate, false "irregular" at rest).

Run on the laptop, from the folder made by tools/flash_m5.sh (PhysioNet is reachable there):

    cd ~/afib-flash && venv/bin/python fetch_refdata.py

Everything goes to ./refdata (about 200 MB, 5-20 minutes). Nothing personal is read or sent.
Sources (PhysioNet open data; the AWS mirror is tried first because it is faster):
  * MIT-BIH Noise Stress Test DB (nstdb): noise records em / ma / bw and the 12 standard noisy records
  * MIT-BIH Arrhythmia DB records 118 and 119: the clean originals of the nstdb records
  * MIT-BIH Normal Sinus Rhythm DB (nsrdb): 18 healthy adults; beat annotations in full and
    12 x 10-minute ECG segments per record, spread over the 24 h (day and night)
  * Normal Sinus Rhythm RR Interval DB (nsr2db): 54 healthy adults, beat annotations only (24 h)
  * PhysioNet/CinC Challenge 2017 training set: 8,528 single-lead recordings with labels
The result is packed into five files so that they can be copied in one go:
  nstdb_mitdb.zip, nsrdb.npz, nsr2db.npz, training2017.zip, REFERENCE-v3.csv
"""
import os
import subprocess
import sys
import time
import zipfile

import numpy as np

BASES = ["https://physionet-open.s3.amazonaws.com/", "https://physionet.org/files/"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refdata")
NSTDB = [f"{b}e{s}" for b in (118, 119) for s in ("24", "18", "12", "06", "00", "_6")] + ["bw", "em", "ma"]
NSRDB = ["16265", "16272", "16273", "16420", "16483", "16539", "16773", "16786", "16795",
         "17052", "17453", "18177", "18184", "19088", "19090", "19093", "19140", "19830"]
NSR2DB = [f"nsr{i:03d}" for i in range(1, 55)]
SEGMENTS, SEG_MIN = 12, 10


def curl(rel, dst):
    """Download one file (resumable); try the mirror first."""
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for base in BASES:
        r = subprocess.run(["curl", "-fsSL", "--retry", "3", "--max-time", "1800", "-o", dst + ".part", base + rel])
        if r.returncode == 0:
            os.replace(dst + ".part", dst)
            return
    sys.exit(f"could not download {rel} — check the internet connection and run the same command again")


def step(title):
    print(f"\n== {title}", flush=True)


def main():
    import wfdb
    from wfdb.io import download
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)

    step("1/5 MIT-BIH noise stress test + records 118, 119")
    z = os.path.join(OUT, "nstdb_mitdb.zip")
    if not os.path.exists(z):
        for rec in NSTDB:
            for ext in ("hea", "dat") + (("atr",) if rec[0].isdigit() else ()):
                curl(f"nstdb/1.0.0/{rec}.{ext}", os.path.join(OUT, "nstdb", f"{rec}.{ext}"))
        for rec in ("118", "119"):
            for ext in ("hea", "dat", "atr"):
                curl(f"mitdb/1.0.0/{rec}.{ext}", os.path.join(OUT, "mitdb", f"{rec}.{ext}"))
        with zipfile.ZipFile(z + ".part", "w", zipfile.ZIP_DEFLATED) as zf:
            for d in ("nstdb", "mitdb"):
                for f in sorted(os.listdir(os.path.join(OUT, d))):
                    zf.write(os.path.join(OUT, d, f), f"{d}/{f}")
        os.replace(z + ".part", z)
    print("  ok", os.path.getsize(z) // 1024, "KB")

    step(f"2/5 Normal sinus rhythm (nsrdb): annotations + {SEGMENTS} x {SEG_MIN} min per record")
    z = os.path.join(OUT, "nsrdb.npz")
    if not os.path.exists(z):
        pack = {}
        for i, rec in enumerate(NSRDB, 1):
            for base in BASES:
                download.config.db_index_url = base
                try:
                    h = wfdb.rdheader(rec, pn_dir="nsrdb/1.0.0")
                    ann = wfdb.rdann(rec, "atr", pn_dir="nsrdb/1.0.0")
                    seg = int(SEG_MIN * 60 * h.fs)
                    starts = np.linspace(0, h.sig_len - seg, SEGMENTS).astype(np.int64)
                    sig = [wfdb.rdrecord(rec, pn_dir="nsrdb/1.0.0", sampfrom=int(s), sampto=int(s) + seg,
                                         channels=[0], physical=False).d_signal[:, 0].astype(np.int16) for s in starts]
                    pack[f"{rec}_fs"] = np.array(h.fs)
                    pack[f"{rec}_gain"] = np.array(h.adc_gain[0])
                    pack[f"{rec}_baseline"] = np.array(h.baseline[0])
                    pack[f"{rec}_starts"] = starts
                    pack[f"{rec}_sig"] = np.stack(sig)
                    pack[f"{rec}_ann_sample"] = np.asarray(ann.sample, np.int64)
                    pack[f"{rec}_ann_symbol"] = np.asarray(ann.symbol)
                    break
                except Exception as e:  # try the other mirror
                    err = e
            else:
                sys.exit(f"could not read nsrdb {rec}: {err}")
            print(f"  {i}/{len(NSRDB)} {rec}", flush=True)
        np.savez_compressed(z + ".part.npz", **pack)
        os.replace(z + ".part.npz", z)
    print("  ok", os.path.getsize(z) // 1024, "KB")

    step("3/5 Normal sinus rhythm RR intervals (nsr2db): 54 people, beat annotations")
    z = os.path.join(OUT, "nsr2db.npz")
    if not os.path.exists(z):
        pack = {}
        for i, rec in enumerate(NSR2DB, 1):
            for base in BASES:
                download.config.db_index_url = base
                try:
                    h = wfdb.rdheader(rec, pn_dir="nsr2db/1.0.0")
                    ann = wfdb.rdann(rec, "ecg", pn_dir="nsr2db/1.0.0")
                    pack[f"{rec}_fs"] = np.array(h.fs)
                    pack[f"{rec}_ann_sample"] = np.asarray(ann.sample, np.int64)
                    pack[f"{rec}_ann_symbol"] = np.asarray(ann.symbol)
                    break
                except Exception as e:
                    err = e
            else:
                sys.exit(f"could not read nsr2db {rec}: {err}")
            if i % 6 == 0:
                print(f"  {i}/{len(NSR2DB)}", flush=True)
        np.savez_compressed(z + ".part.npz", **pack)
        os.replace(z + ".part.npz", z)
    print("  ok", os.path.getsize(z) // 1024, "KB")

    step("4/5 PhysioNet/CinC Challenge 2017 training set (about 100 MB)")
    curl("challenge-2017/1.0.0/REFERENCE-v3.csv", os.path.join(OUT, "REFERENCE-v3.csv"))
    curl("challenge-2017/1.0.0/training2017.zip", os.path.join(OUT, "training2017.zip"))
    print("  ok", os.path.getsize(os.path.join(OUT, "training2017.zip")) // (1 << 20), "MB")

    step("5/5 check")
    files = ["nstdb_mitdb.zip", "nsrdb.npz", "nsr2db.npz", "training2017.zip", "REFERENCE-v3.csv"]
    for f in files:
        print(f"  {f:18s} {os.path.getsize(os.path.join(OUT, f)) / (1 << 20):7.1f} MB")
    print(f"\nDONE in {(time.time() - t0) / 60:.1f} min: {OUT}")


if __name__ == "__main__":
    main()
