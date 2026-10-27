"""Guard strips: 10 fixed 30-s strips whose verdicts are FROZEN as data (guard_strips.json / .txt, committed).
Unlike make_cases.py (which re-derives expectations from the current server code), these expectations never move:
if a change to ecgtools.check / rr.ts / check30.h alters any verdict, CI fails. Changing the data is a deliberate,
reviewed act — regenerate only with a new notebook that justifies the new rule.

    PYTHONPATH=backend python tools/parity/make_guard.py        # (re)generate; diff must be empty unless intended

Synthetic only (app/ecgsynth.py, fixed seeds): real PhysioNet strips are not redistributed here (license/attribution
lives in the notebooks); the Kaggle notebooks remain the check on real data."""
import json, random, sys
from pathlib import Path
from app.ecgsynth import synth_ecg
from app import ecgtools

SPEC = [  # name, afib, bpm, seed, noise sigma
    ("regular_70", False, 70, 101, 0.0), ("regular_55", False, 55, 102, 0.0), ("regular_120", False, 120, 103, 0.0),
    ("regular_noisy", False, 70, 104, 0.03), ("afib_95", True, 95, 105, 0.0), ("afib_70", True, 70, 106, 0.0),
    ("afib_130", True, 130, 107, 0.0), ("afib_noisy", True, 95, 108, 0.03),
    ("garbage_noise", False, 70, 109, 0.8), ("flat_line", False, 70, 110, None),
]
out = []
for name, af, bpm, seed, sigma in SPEC:
    if sigma is None:
        x = [0.0] * (30 * 125)
    else:
        x = synth_ecg(30, afib=af, bpm=bpm, seed=seed)
        if sigma:
            r = random.Random(seed); x = [v + r.gauss(0, sigma) for v in x]
    c = ecgtools.check(x)
    out.append({"name": name, "fs": 125, "expected": c["verdict"], "beats": c["beats"], "x": [round(v, 4) for v in x]})
    print(f"{name:14s} {c['verdict']:11s} beats={c['beats']} irr={c['irregularity']} sqi={c['sqi']:.2f} bsqi={c['bsqi']:.2f}")
here = Path(__file__).parent
json.dump(out, open(here / "guard_strips.json", "w"))
code = {"no_verdict": 0, "regular": 1, "irregular": 2}
open(here / "guard_strips.txt", "w").write("\n".join(f"{code[c['expected']]} {len(c['x'])} " + " ".join(repr(v) for v in c["x"]) for c in out))
