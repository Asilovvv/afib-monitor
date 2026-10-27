"""Reference SNR for tools/mobile/snr_test.ts: the Notebook-16 definition (same code as firmware/afib_stream.py snr_of,
with fs as a parameter) on synthetic strips with known noise. Writes fixtures/snr_cases.json. Run once; committed."""
import json, sys, random
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfiltfilt, find_peaks
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from app.ecgsynth import synth_ecg

FS = 125
def snr_of(mv, fs=FS):
    y = sosfiltfilt(butter(2, [0.5, 40], btype='band', fs=fs, output='sos'), np.asarray(mv))
    e = np.gradient(y) ** 2
    pk, _ = find_peaks(e, distance=int(0.3 * fs), height=0.3 * np.percentile(e, 99))
    h = int(0.3 * fs)
    r = [int(p - 10 + np.argmax(np.abs(y[max(0, p - 10):p + 10]))) for p in pk]
    r = [p for p in r if h <= p < len(y) - h]
    if len(r) < 10:
        return None, len(r)
    beats = np.array([y[p - h:p + h] for p in r])
    idx = np.arange(2 * h, dtype=float)
    shifts = np.arange(-2, 2.001, 0.05)
    for _ in range(3):
        tmpl = beats.mean(axis=0)
        beats = np.array([min((np.interp(idx + d, idx, b) for d in shifts), key=lambda v: np.sum((v - tmpl) ** 2))
                          for b in np.array([y[p - h:p + h] for p in r])])
    tmpl = beats.mean(axis=0)
    pn = float(np.mean((beats[:, 10:-10] - tmpl[10:-10]) ** 2))
    ps = float(y.var()) - pn
    return (10 * np.log10(ps / pn) if ps > 0 else float('-inf')), len(r)

cases = []
for name, noise, seed in [("clean", 0.0, 1), ("mild_noise", 0.05, 2), ("heavy_noise", 0.2, 3), ("afib_mild", 0.05, 4)]:
    x = np.array(synth_ecg(30, FS, afib=name.startswith("afib"), bpm=70, seed=seed))
    rng = np.random.default_rng(seed)
    x = x + rng.normal(0, noise, len(x)) + 0.1 * np.sin(2 * np.pi * 0.3 * np.arange(len(x)) / FS)   # noise + baseline wander
    v, n = snr_of(x)
    cases.append({"name": name, "fs": FS, "snr_db": None if v is None else round(v, 2), "beats": n, "x": [round(float(a), 4) for a in x]})
    print(name, v, n)
Path(__file__).with_name("fixtures").joinpath("snr_cases.json").write_text(json.dumps(cases))
