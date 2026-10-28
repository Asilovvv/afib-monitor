"""The device's live path on a PC: tools/parity/live_host.cpp (compiled from the firmware's own headers) for the
signal chain, the detector, the gate candidates and the int8 model inputs; the firmware's int8 model run here.

    from live_emul import LiveHost, model_prob
    with LiveHost(lag=0) as h:
        dec = h.run({"rec1": mv_250hz_array, ...})      # list of dicts, one per live decision
    p = model_prob(np.array([d["q"] for d in dec]))
"""
import os
import subprocess
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "tools", "parity", "live_host.cpp")
MODEL = os.path.join(ROOT, "firmware", "models", "afib_rr_int8.tflite")   # bit-exact with the _nodil file on a PC
_BIN = None
_IT = None


def build():
    global _BIN
    if _BIN is None:
        out = os.path.join(tempfile.gettempdir(), "live_host_" + str(os.getpid()))
        subprocess.run(["g++", "-O2", "-std=c++17", "-I", os.path.join(ROOT, "firmware", "AFibMonitor"), SRC, "-o", out],
                       check=True)
        _BIN = out
    return _BIN


def _interp():
    global _IT
    if _IT is None:
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
        import warnings
        warnings.filterwarnings("ignore")
        import tensorflow as tf
        _IT = tf.lite.Interpreter(model_path=MODEL)
        _IT.allocate_tensors()
    return _IT


def input_quant():
    d = _interp().get_input_details()[0]
    s, z = d["quantization"]
    return float(s), int(z)


def model_prob(q, batch=1024):
    """q: (n, 64) int8 inputs as the device builds them -> AF probability per decision (as the device computes it)."""
    it = _interp()
    q = np.asarray(q, np.int8).reshape(-1, 32, 2)
    out = []
    for i in range(0, len(q), batch):
        xb = q[i:i + batch]
        inp = it.get_input_details()[0]
        it.resize_tensor_input(inp["index"], [len(xb), 32, 2]); it.allocate_tensors()
        inp, o = it.get_input_details()[0], it.get_output_details()[0]
        it.set_tensor(inp["index"], xb)
        it.invoke()
        s, z = o["quantization"]
        out.append((it.get_tensor(o["index"]).astype(np.float32).ravel() - z) * s)
    return np.concatenate(out) if out else np.zeros(0, np.float32)


class LiveHost:
    def __init__(self, lag=0):
        self.lag = int(lag)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def run(self, records, fmt="%.4f"):
        """records: {name: raw mV at 250 Hz}. Returns a list of decision dicts."""
        s, z = input_quant()
        lines = []
        for name, x in records.items():
            lines.append(f"R {name}")
            lines.append("\n".join(fmt % v for v in np.asarray(x, float)))
            lines.append("E")
        r = subprocess.run([build(), repr(s), str(z), str(self.lag)], input="\n".join(lines) + "\n",
                           capture_output=True, text=True, check=True)
        dec = []
        for ln in r.stdout.splitlines():
            p = ln.split()
            if not p or p[0] != "D":
                continue
            dec.append(dict(name=p[1], n=int(p[2]), sd=float(p[3]), g1=float(p[4]), g2=float(p[5]), g3=float(p[6]),
                            beats10=int(p[7]), lagmed=int(p[8]), q=np.array(p[9:], dtype=np.int16).astype(np.int8)))
        return dec
