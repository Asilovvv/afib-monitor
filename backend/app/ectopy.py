"""Early ventricular beats (PVC) from beat shape + timing — research estimate for the doctor, not shown to patients.

Pure Python, the same in the training notebook (ml/pvc_small.ipynb, pasted unchanged), on the server and, ported,
on the device (firmware/AFibMonitor/ectopy.h). A small tree ensemble trained on MIT-BIH DS1 and tested on DS2
(other people) decides "ventricular ectopic vs not" per beat. Counting PVCs is a medical-device claim: research only.
"""
from __future__ import annotations

import json
import math
import os
import statistics

from .ecgtools import _highpass

HALF_S = 0.25            # beat window ±250 ms
N_PREV_SHAPES = 20       # median template of the previous beats
N_PREV_RR = 10           # local mean RR
# Decision threshold on the model probability. 0.5 in Notebook 13; 0.8 chosen in Notebook 14 on DS1 out-of-fold
# predictions (V F1 0.830 -> 0.854), then on DS2: PPV 89.1 -> 95.5 %, sensitivity 95.4 -> 92.6 % (ml/PVC_GATE.md).
THRESHOLD = 0.8


def beat_features(x: list[float], peaks: list[int], fs: int = 125) -> list[tuple[int, list[float]]]:
    """(peak index, 39 features) for every beat that has 11 beats before it and one after it."""
    y = _highpass(x, fs)
    half = int(HALF_S * fs)
    n = len(y)
    shapes: list[list[float]] = []
    out = []
    for i in range(N_PREV_RR + 1, len(peaks) - 1):
        p = peaks[i]
        a, b = p - half, p + half + 1
        if a < 0 or b > n:
            continue
        w = y[a:b]
        med = statistics.median(w)
        prev_amp = [abs(y[q]) for q in peaks[max(0, i - N_PREV_SHAPES):i]]
        amp = statistics.median(prev_amp) if prev_amp else 0.0
        amp = amp if amp > 1e-6 else 1e-6
        seg = [(v - med) / amp for v in w]
        prev = shapes[-N_PREV_SHAPES:]
        tmpl = [statistics.median(col) for col in zip(*prev)] if len(prev) >= 5 else seg
        corr = _pearson(seg, tmpl)
        h = [abs(v) for v in seg[half - 12:half + 13]]
        hm = max(h)
        width = sum(1 for v in h if v >= 0.5 * hm) / fs if hm > 0 else 0.0
        pre = (peaks[i] - peaks[i - 1]) / fs
        post = (peaks[i + 1] - peaks[i]) / fs
        loc = sum((peaks[k] - peaks[k - 1]) / fs for k in range(i - N_PREV_RR, i)) / N_PREV_RR
        out.append((p, [pre, post, loc, pre / loc, post / pre, corr, width] + seg[::2]))
        shapes.append(seg)
    return out


def _pearson(a: list[float], b: list[float]) -> float:
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    da = [u - ma for u in a]
    db = [v - mb for v in b]
    sa, sb = math.sqrt(sum(u * u for u in da)), math.sqrt(sum(v * v for v in db))
    if sa == 0 or sb == 0:
        return 0.0
    return sum(u * v for u, v in zip(da, db)) / (sa * sb)


# ---------------------------------------------------------------- model (exported from the notebook)
_MODEL_PATH = os.path.join(os.path.dirname(globals().get("__file__", "")), "pvc_model.json")   # also works when pasted into a notebook
_MODEL = None


def load_model(path: str = _MODEL_PATH) -> dict | None:
    global _MODEL
    if _MODEL is None and os.path.exists(path):
        _MODEL = json.load(open(path))
    return _MODEL


def score(f: list[float], model: dict) -> float:
    """Probability that the beat is a ventricular ectopic beat.
    model = {"kind": "trees", "baseline": b, "trees": [[[feature, threshold, left, right, value, is_leaf], ...], ...]}
            {"kind": "logistic", "mean": [...], "scale": [...], "coef": [...], "intercept": c}"""
    if model["kind"] == "logistic":
        z = model["intercept"] + sum(c * (v - m) / s for c, v, m, s in zip(model["coef"], f, model["mean"], model["scale"]))
    else:
        z = model["baseline"]
        for nodes in model["trees"]:
            k = 0
            while not nodes[k][5]:
                feat, thr, left, right = nodes[k][0], nodes[k][1], nodes[k][2], nodes[k][3]
                k = left if f[int(feat)] <= thr else right
            z += nodes[k][4]
    return 1.0 / (1.0 + math.exp(-z))


def count_pvc(x: list[float], peaks: list[int], fs: int = 125, model: dict | None = None) -> dict | None:
    """{"beats": judged beats, "pvc": early ventricular beats, "pvc_at_s": [...]} or None without a model."""
    model = model or load_model()
    if not model:
        return None
    feats = beat_features(x, peaks, fs)
    hits = [p for p, f in feats if score(f, model) >= THRESHOLD]
    return {"beats": len(feats), "pvc": len(hits), "pvc_at_s": [round(p / fs, 2) for p in hits]}
