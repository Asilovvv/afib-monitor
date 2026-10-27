"""Laptop reference for BOARD_DAY A4: float32 emulation of the firmware path (afib_main.cpp): filterSample -> decimate -> detectorStep -> runModel,
fed exactly what afib_stream.py --eval sent ("D %.4f" of channel 0, from start = max(0, firstAF - n/2))."""
import os, sys, numpy as np, wfdb
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "firmware"))
import afib_stream as A
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
import tensorflow as tf
f32 = np.float32
SOS = np.array([[0.1424442454, 0.2848884908, 0.1424442454, -0.6856000535, 0.2606960323],
                [1.0, -2.0, 1.0, -1.9822347504, 0.9823948463]], f32)
FS, N_RR, MA_N, R_THR, R_REFR, R_WARM = 125, 32, 19, f32(0.35), 31, 250
rDecay = f32(0.5 ** (1 / (2 * FS)))
it = tf.lite.Interpreter(model_path=str(ROOT / 'firmware/models/afib_rr_int8_nodil.tflite')); it.allocate_tensors()
I, O = it.get_input_details()[0], it.get_output_details()[0]

def model(rr):
    rr = np.clip(np.array(rr, f32), f32(0.2), f32(2.0)); m = rr.mean(dtype=f32)
    f = np.stack([(rr - f32(0.8)) / f32(0.25), (rr / m - f32(1)) / f32(0.15)], -1)
    s, z = I['quantization']; q = np.clip(np.floor(np.abs(f / s) + 0.5) * np.sign(f / s) + z, -128, 127).astype(np.int8)[None]
    it.set_tensor(I['index'], q); it.invoke(); so, zo = O['quantization']
    return float((it.get_tensor(O['index'])[0, 0].astype(np.float32) - zo) * so)

def run(rec):
    path = os.path.join(A.CACHE, rec)
    sig = np.nan_to_num(wfdb.rdrecord(path, channels=[0]).p_signal[:, 0]); ann = wfdb.rdann(path, 'atr')
    starts = list(ann.sample); notes = [a.strip().rstrip('\x00') for a in ann.aux_note]
    af = [s for s, n in zip(starts, notes) if n == '(AFIB']
    n_s = 20 * 60 * 250; start = max(0, af[0] - n_s // 2) if af else 0
    x = np.array([float(f'{v:.4f}') for v in sig[start:start + n_s]], f32)
    z = np.zeros((2, 2), f32); tog = False
    buf = np.zeros(MA_N, f32); ssum = f32(0); prev = f32(0); pk = f32(0); last = -10**6; armed = True; i = 0
    rr = []; lastBeat = -1; since = 0; preds = []; raw = 0
    for v in x:
        raw += 1
        for s in range(2):
            c = SOS[s]; y = f32(c[0] * v + z[s, 0]); z[s, 0] = f32(c[1] * v - c[3] * y + z[s, 1]); z[s, 1] = f32(c[2] * v - c[4] * y); v = y
        tog = not tog
        if not tog: continue
        d = f32(v - prev); prev = v; e = f32(d * d); k = i % MA_N
        ssum = f32(ssum + e - buf[k]); buf[k] = e; env = f32(ssum / MA_N); pk = max(f32(pk * rDecay), env)
        if i >= R_WARM:
            if armed and env > R_THR * pk and i - last > R_REFR:
                if lastBeat >= 0:
                    rr.append((i - lastBeat) / FS); rr = rr[-N_RR:]; since += 1
                lastBeat = i; last = i; armed = False
            elif not armed and env < f32(0.5) * R_THR * pk:
                armed = True
        i += 1
        if len(rr) >= N_RR and since >= 4:
            since = 0; preds.append((raw, model(rr), int(round(sum(rr) * 250))))
    return preds, start


if __name__ == "__main__":
    if len(sys.argv) > 1: A.CACHE = sys.argv[1]   # folder with the afdb records afib_stream.py downloaded
    tp = tn = fp = fn = 0
    for rec in A.DEFAULT_EVAL:
        preds, start = run(rec); _, segs = A.load_record(rec)
        for n, p, span in preds:
            t = A.label_of(segs, start + n - span, start + n)   # same labelling as afib_stream.py --eval
            if t is None: continue
            y = p >= 0.5; tp += y and t == 1; tn += (not y) and t == 0; fp += y and t == 0; fn += (not y) and t == 1
    print(f"laptop: windows {tp+tn+fp+fn} (AF {tp+fn}, normal {tn+fp}) TP={tp} TN={tn} FP={fp} FN={fn} "
          f"sensitivity={tp/(tp+fn):.4f} specificity={tn/(tn+fp):.4f}")
