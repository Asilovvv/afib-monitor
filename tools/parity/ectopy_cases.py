"""Strips + server PVC features/probabilities for the device parity test (tools/parity/ectopy_host.cpp).
    PYTHONPATH=backend python tools/parity/ectopy_cases.py model.json /tmp/ecto.txt"""
import json, random, sys
from app import ecgtools
from app.ectopy import beat_features, score
from app.ecgsynth import synth_ecg
model = json.load(open(sys.argv[1]))
out = []
for k in range(40):
    x = synth_ecg(30, afib=k % 3 == 1, bpm=random.Random(k).choice([60, 75, 95]), seed=40 + k)
    if k % 4 == 0:
        r = random.Random(k); x = [v + r.gauss(0, 0.15) for v in x]
    p = ecgtools.r_peaks(x)
    fe = beat_features(x, p)
    out.append(f"{len(x)} {len(p)} {len(fe)} " + " ".join(repr(v) for v in x) + " " + " ".join(map(str, p)) + " "
               + " ".join(" ".join(repr(v) for v in f) + " " + repr(score(f, model)) for _, f in fe))
open(sys.argv[2], "w").write("\n".join(out))
