"""CI test of the device's live path on a PC (tools/parity/live_host.cpp, built from the firmware's headers).

A synthetic ECG (3 min, fixed seed) with two bursts of artifact is run through the live path. Checks:
  1. regression: every decision (raw index, the gate's agreement value, the 64 int8 model inputs) equals the frozen
     file tools/parity/live_expected.txt — any change of the filter, detector, RR window or gate shows up here;
     after an intended change, regenerate with --write and say why in the commit;
  2. behaviour: before the first burst the gate lets every decision through; every burst blocks at least one
     decision, and a decision is shown again only after 8 decisions without a noisy window (live_gate.h HOLD).

    python tools/parity/live_cases.py /tmp/live_host [--write]
"""
import os
import subprocess
import sys

import numpy as np

FS = 250
HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = os.path.join(HERE, "live_expected.txt")
SCALE, ZP, LAG = "0.09118762612342834", "-74", "-1"      # model input quantisation, gate lag (ROUND4_GATE_CHOICE)
BURSTS = [(70, 90), (140, 150)]


def synthetic_ecg():
    n = 180 * FS
    t = np.arange(n) / FS
    x = 0.1 * np.sin(2 * np.pi * 0.3 * t)                                # baseline wander
    beat_t, tt = [], 0.6
    while tt < 180 - 1:
        beat_t.append(tt)
        hr = 70 + 10 * np.sin(2 * np.pi * tt / 20.0)                     # 60-80 /min, slow change
        tt += 60.0 / hr
    for b in beat_t:
        x += 0.10 * np.exp(-0.5 * ((t - (b - 0.16)) / 0.020) ** 2)       # P
        x += 1.00 * np.exp(-0.5 * ((t - b) / 0.010) ** 2)                # QRS
        x -= 0.15 * np.exp(-0.5 * ((t - (b + 0.03)) / 0.010) ** 2)       # S
        x += 0.25 * np.exp(-0.5 * ((t - (b + 0.25)) / 0.040) ** 2)       # T
    rng = np.random.RandomState(0)
    x += 0.01 * rng.randn(n)
    art = np.random.RandomState(1)
    for a, b in BURSTS:                                                   # motion-like artifact: swings + spikes
        i0, i1 = a * FS, b * FS
        x[i0:i1] += 0.6 * np.sin(2 * np.pi * 1.3 * t[i0:i1])
        for s in range(i0, i1, int(0.27 * FS)):
            k = s + art.randint(0, 40)
            x[k:k + 3] += art.choice([-1.4, 1.4])
    return x.astype(np.float32)


def run(binary, x):
    nb = b"synthetic"
    data = np.int32(len(nb)).tobytes() + nb + np.int32(len(x)).tobytes() + x.tobytes()
    r = subprocess.run([binary, SCALE, ZP, LAG, "bin"], input=data, capture_output=True, check=True)
    rows = []
    for ln in r.stdout.decode().splitlines():
        p = ln.split()
        # n, g2 and the 64 inputs; g1/g3/lag diagnostics are not frozen (they are not used by the device)
        rows.append(" ".join([p[2], p[5]] + p[10:]))
    return rows


def main():
    binary = sys.argv[1]
    rows = run(binary, synthetic_ecg())
    if "--write" in sys.argv:
        open(EXPECTED, "w").write("\n".join(rows) + "\n")
        print(f"wrote {len(rows)} decisions to {EXPECTED}")
        return
    exp = open(EXPECTED).read().split("\n")[:-1]
    bad = [i for i, (a, b) in enumerate(zip(rows, exp)) if a != b]
    if len(rows) != len(exp) or bad:
        print(f"live path changed: {len(rows)} decisions vs {len(exp)} frozen; first differences at {bad[:5]}")
        sys.exit(1)
    n = np.array([int(r.split()[0]) for r in rows]); g2 = np.array([float(r.split()[1]) for r in rows])
    bad = g2 < 0.71
    c = np.concatenate([[0], np.cumsum(bad)]); k = np.arange(len(bad))
    blocked = (c[k + 1] - c[np.maximum(0, k + 1 - 8)]) > 0
    first = n < BURSTS[0][0] * FS
    assert not blocked[first].any(), "the gate blocked a clean decision before the first burst"
    for a, b in BURSTS:
        inb = (n >= a * FS) & (n < (b + 10) * FS)
        assert blocked[inb].any(), f"the burst {a}-{b} s was not blocked"
    print(f"live path OK: {len(rows)} decisions identical to the frozen file; clean decisions before {BURSTS[0][0]} s "
          f"shown ({first.sum()}), {blocked.sum()} decisions blocked around the bursts")


if __name__ == "__main__":
    main()
