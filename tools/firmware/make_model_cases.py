"""Fixed int8 inputs for the RR model and the outputs the reference TFLite interpreter gives on a PC.
The board runs the same inputs with "Q …" (afib_stream.py --model-check) and must return the same int8 outputs
(±1 LSB for kernel rounding). Written once; committed as model_cases.json."""
import json, os, numpy as np
from pathlib import Path
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
import tensorflow as tf
ROOT = Path(__file__).resolve().parents[2]
it = tf.lite.Interpreter(model_path=str(ROOT / "firmware/models/afib_rr_int8.tflite")); it.allocate_tensors()
I, O = it.get_input_details()[0], it.get_output_details()[0]
s, z = I["quantization"]
rng = np.random.default_rng(2026)

def q(rr):
    rr = np.clip(np.asarray(rr, np.float32), 0.2, 2.0); m = rr.mean()
    f = np.stack([(rr - 0.8) / 0.25, (rr / m - 1) / 0.15], -1)
    return np.clip(np.round(f / s) + z, -128, 127).astype(np.int8)

cases = []
for k in range(20):   # regular sinus at different rates
    cases.append(("regular", q(rng.uniform(0.5, 1.2) * (1 + 0.02 * rng.standard_normal(32)))))
for k in range(20):   # AF-like: irregularly irregular, realistic spread
    cases.append(("af_like", q(rng.uniform(0.45, 0.9) * (1 + 0.18 * rng.standard_normal(32)))))
for k in range(20):   # arbitrary int8 vectors: exercises every kernel path
    cases.append(("random", rng.integers(-128, 128, 64).astype(np.int8).reshape(32, 2)))
out = []
for kind, x in cases:
    it.set_tensor(I["index"], x[None]); it.invoke()
    out.append({"kind": kind, "input": x.reshape(-1).tolist(), "expected": int(it.get_tensor(O["index"])[0, 0])})
(Path(__file__).parent / "model_cases.json").write_text(json.dumps(out))
for kind in ("regular", "af_like", "random"):
    e = [(c["expected"] + 128) / 256 for c in out if c["kind"] == kind]
    print(kind, "prob min/median/max", round(min(e), 3), round(float(np.median(e)), 3), round(max(e), 3))
