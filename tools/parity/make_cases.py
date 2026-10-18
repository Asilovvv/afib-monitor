"""Writes 40 synthetic 30-s strips (regular, AF-like, some noisy) with the server's check() verdicts.
    PYTHONPATH=backend python tools/parity/make_cases.py /tmp/parity.json
    node --experimental-strip-types tools/parity/parity.mts /tmp/parity.json
The phone (mobile/src/rr.ts) must give the same R-peaks and the same verdict on every strip."""
import json, random, sys
from app.ecgsynth import synth_ecg
from app import ecgtools

cases = []
for k in range(40):
    x = synth_ecg(30, afib=k % 2 == 1, bpm=random.Random(k).choice([55, 70, 95, 120]), seed=k)
    if k % 5 == 0:
        r = random.Random(k)
        x = [v + r.gauss(0, 0.3 if k % 10 else 0.8) for v in x]
    cases.append({"x": x, "py": ecgtools.check(x), "peaks": ecgtools.r_peaks(x), "amp": ecgtools.r_peaks_amp(x)})
json.dump(cases, open(sys.argv[1], "w"))
