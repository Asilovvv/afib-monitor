#!/usr/bin/env python3
"""
afib_stream.py — sends real ECG from the MIT-BIH AF Database to the CoreS3 SE over USB
and reads the device's predictions.

Install once:   pip install wfdb pyserial numpy
Find the port:  ls /dev/cu.usbmodem*        (macOS)

Demo (real time, shows on the screen like a live patient):
    python afib_stream.py --port /dev/cu.usbmodem101 --record 08215 --rhythm AFIB
    python afib_stream.py --port /dev/cu.usbmodem101 --record 05261 --rhythm N

On-device evaluation (fast, many windows, prints sensitivity / specificity):
    python afib_stream.py --port /dev/cu.usbmodem101 --eval --minutes 20 --speed 10

Benchmark (inference time and RAM on the chip):
    python afib_stream.py --port /dev/cu.usbmodem101 --bench

Live ECG from the AD8232 (laptop on battery, sit still), saved as CSV at 250 Hz, then its SNR:
    python afib_stream.py --port /dev/cu.usbmodem101 --live 30 --out gel_1.csv
    python afib_stream.py --snr gel_1.csv reusable_1.csv
"""
import argparse
import csv
import os
import sys
import threading
import time

import numpy as np

FS_RAW = 250
WIN_RAW = 2500                      # 10 s at 250 Hz
LABELS = {'(N': 0, '(AFIB': 1}
# The 5 test records used in the notebook can be pasted here after the Kaggle run
DEFAULT_EVAL = ['07879', '05261', '04015', '05121', '08215']   # test patients from the Kaggle run
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'afdb_cache')


def load_record(rec):
    """Channel 0 in mV + list of (start_sample, end_sample, label) rhythm segments."""
    import wfdb
    os.makedirs(CACHE, exist_ok=True)
    if not os.path.exists(os.path.join(CACHE, rec + '.hea')):
        print(f'Downloading record {rec} from PhysioNet...')
        wfdb.dl_database('afdb', CACHE, records=[rec], annotators=['atr'])
    sig = wfdb.rdrecord(os.path.join(CACHE, rec), channels=[0]).p_signal[:, 0]
    ann = wfdb.rdann(os.path.join(CACHE, rec), 'atr')
    starts = list(ann.sample)
    ends = starts[1:] + [len(sig)]
    segs = []
    for s, e, note in zip(starts, ends, ann.aux_note):
        lab = LABELS.get(note.strip().rstrip('\x00'))
        segs.append((int(s), int(e), lab))
    return np.nan_to_num(sig), segs


def label_of(segs, a, b):
    """Rhythm label of raw samples [a, b) if the whole window is one N/AFIB segment, else None."""
    for s, e, lab in segs:
        if s <= a and b <= e:
            return lab
    return None


class Device:
    def __init__(self, port):
        import serial
        self.ser = serial.Serial(port, 115200, timeout=0.1)
        time.sleep(2.0)                       # board may reset when the port opens
        self.ser.reset_input_buffer()
        self.preds = []
        self.lines = []
        self.stop = False
        self.t = threading.Thread(target=self._reader, daemon=True)
        self.t.start()

    def _reader(self):
        buf = b''
        while not self.stop:
            try:
                buf += self.ser.read(4096)
            except Exception:
                break
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                s = line.decode(errors='ignore').strip()
                if not s:
                    continue
                self.lines.append(s)
                if s.startswith('PRED'):
                    kv = dict(p.split('=', 1) for p in s.split()[1:] if '=' in p)
                    self.preds.append(kv)
                    self.on_pred(kv)
                elif s.startswith(('BENCH', 'INFO', 'Model', 'RESET')):
                    print('  device:', s)

    def on_pred(self, kv):
        pass

    def send(self, text):
        self.ser.write(text.encode())

    def stream(self, samples, speed=1.0, chunk=25):
        """Send raw mV samples at speed x real time."""
        period = chunk / FS_RAW / speed
        t_next = time.perf_counter()
        for i in range(0, len(samples), chunk):
            block = samples[i:i + chunk]
            self.send(''.join(f'D {v:.4f}\n' for v in block))
            t_next += period
            dt = t_next - time.perf_counter()
            if dt > 0:
                time.sleep(dt)

    def close(self):
        time.sleep(0.5)
        self.stop = True
        self.ser.close()


def live(args):
    """Record the device's own raw ECG (command "E 1") for N seconds into a CSV: t_s, mv."""
    dev = Device(args.port)
    dev.send('E 1\n')
    t0 = time.time()
    while time.time() - t0 < args.live:
        time.sleep(0.5)
        print(f'\r  recording {time.time() - t0:4.0f} / {args.live:.0f} s', end='', flush=True)
    dev.send('E 0\n')
    time.sleep(1.0)
    dev.close()
    mv = [float(l.split()[1]) for l in dev.lines if l.startswith('E ') and len(l.split()) == 2]
    status = [l for l in dev.lines if l.startswith('RAW')]
    out = args.out or time.strftime('live_%Y%m%d_%H%M%S.csv')
    with open(out, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['t_s', 'mv'])
        for i, v in enumerate(mv):
            w.writerow([f'{i / FS_RAW:.3f}', v])
    print(f'\nsaved {out}: {len(mv)} samples = {len(mv) / FS_RAW:.1f} s;', status[-1] if status else 'no RAW status line')
    if status and 'dropped=0' not in status[-1]:
        print('  WARNING: samples were dropped on the device, repeat the recording')


def snr_of(path):
    """SNR defined as in Notebook 16 (band-passed 0.5-40 Hz signal power / noise power, whole recording).
    Noise = what is left of each beat after subtracting the average beat; signal power = total power - noise power."""
    from scipy.signal import butter, sosfiltfilt, find_peaks
    mv = np.loadtxt(path, delimiter=',', skiprows=1, usecols=1)
    y = sosfiltfilt(butter(2, [0.5, 40], btype='band', fs=FS_RAW, output='sos'), mv)
    e = np.gradient(y) ** 2
    pk, _ = find_peaks(e, distance=int(0.3 * FS_RAW), height=0.3 * np.percentile(e, 99))
    h = int(0.3 * FS_RAW)
    r = [int(p - 10 + np.argmax(np.abs(y[max(0, p - 10):p + 10]))) for p in pk]
    r = [p for p in r if h <= p < len(y) - h]
    if len(r) < 10:
        return None, len(r)
    beats = np.array([y[p - h:p + h] for p in r])
    idx = np.arange(2 * h, dtype=float)
    shifts = np.arange(-2, 2.001, 0.05)              # sub-sample alignment, else timing jitter counts as "noise"
    for _ in range(3):
        tmpl = beats.mean(axis=0)
        beats = np.array([min((np.interp(idx + d, idx, b) for d in shifts), key=lambda v: np.sum((v - tmpl) ** 2))
                          for b in np.array([y[p - h:p + h] for p in r])])
    tmpl = beats.mean(axis=0)
    pn = float(np.mean((beats[:, 10:-10] - tmpl[10:-10]) ** 2))
    ps = float(y.var()) - pn
    return (10 * np.log10(ps / pn) if ps > 0 else float('-inf')), len(r)


def snr(args):
    for p in args.snr:
        v, n = snr_of(p)
        print(f'{p}: ' + (f'SNR {v:.1f} dB from {n} beats' if v is not None else f'too few beats ({n}), repeat'))
    print('Requirement (ml/SNR_REQUIREMENT.md): >= 9 dB for electrode motion, >= 18 dB for muscle noise.')


def demo(args):
    sig, segs = load_record(args.record)
    want = LABELS.get('(' + args.rhythm) if args.rhythm else None
    start = int(args.start * FS_RAW)
    if want is not None:
        cand = [(s, e) for s, e, lab in segs if lab == want and e - s >= FS_RAW * 60]
        if not cand:
            sys.exit(f'No {args.rhythm} segment of 1+ minute in record {args.record}')
        start = cand[0][0]
    stop = min(len(sig), start + int(args.minutes * 60 * FS_RAW))
    print(f'Record {args.record}: streaming {(stop - start) / FS_RAW / 60:.1f} min from '
          f'{start / FS_RAW / 60:.1f} min, speed x{args.speed}. Ctrl+C to stop.')

    dev = Device(args.port)

    def show(kv):
        n = int(kv['n']); span = int(kv.get('span', WIN_RAW))
        truth = label_of(segs, start + n - span, start + n)
        t = {0: 'Normal', 1: 'AFib', None: 'mixed'}[truth]
        p = float(kv['prob'])
        print(f'  t={n / FS_RAW:6.1f}s  AFib prob={p:5.2f}  -> {"AFIB  " if p >= 0.5 else "NORMAL"}'
              f'  (cardiologist: {t})  BPM={kv["bpm"]}  {int(kv["infer_us"]) / 1000:.1f} ms')
    dev.on_pred = show
    dev.send('R\n')
    try:
        dev.stream(sig[start:stop], speed=args.speed)
    except KeyboardInterrupt:
        pass
    dev.close()


def evaluate(args):
    records = args.records.split(',') if args.records else DEFAULT_EVAL
    dev = Device(args.port)
    rows = []
    for rec in records:
        sig, segs = load_record(rec)
        dev.preds = []
        dev.send('R\n')
        time.sleep(0.3)
        n_samples = min(len(sig), int(args.minutes * 60 * FS_RAW)) if args.minutes else len(sig)
        # pick a stretch that contains both rhythms where possible
        start = 0
        af = [s for s, e, lab in segs if lab == 1]
        if af and args.minutes:
            start = max(0, af[0] - n_samples // 2)
        stop = min(len(sig), start + n_samples)
        print(f'Record {rec}: {(stop - start) / FS_RAW / 60:.1f} min at x{args.speed}...')
        dev.stream(sig[start:stop], speed=args.speed)
        time.sleep(1.0)
        for kv in dev.preds:
            n = int(kv['n']); span = int(kv.get('span', WIN_RAW))
            truth = label_of(segs, start + n - span, start + n)
            if truth is None or kv.get('flat') == '1':
                continue
            rows.append(dict(record=rec, n=n, truth=truth, prob=float(kv['prob']),
                             pred=int(kv['label']), infer_us=int(kv['infer_us'])))
    dev.close()

    if not rows:
        sys.exit('No predictions received — check the port and that the firmware is running.')
    y = np.array([r['truth'] for r in rows])
    p = np.array([r['pred'] for r in rows])
    tp = int(((p == 1) & (y == 1)).sum()); tn = int(((p == 0) & (y == 0)).sum())
    fp = int(((p == 1) & (y == 0)).sum()); fn = int(((p == 0) & (y == 1)).sum())
    sens = tp / max(tp + fn, 1); spec = tn / max(tn + fp, 1)
    acc = (tp + tn) / len(y); f1 = 2 * tp / max(2 * tp + fp + fn, 1)
    us = np.array([r['infer_us'] for r in rows])
    print('\n=== On-device results (ESP32-S3, int8) ===')
    print(f'windows: {len(y)}  (AFib {int(y.sum())}, Normal {int((1 - y).sum())})')
    print(f'TP={tp} TN={tn} FP={fp} FN={fn}')
    print(f'sensitivity={sens:.4f} specificity={spec:.4f} accuracy={acc:.4f} F1={f1:.4f}')
    print(f'inference time: mean {us.mean() / 1000:.2f} ms, max {us.max() / 1000:.2f} ms')
    out = 'device_predictions.csv'
    with open(out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print('saved', out)


def model_check(args):
    """Board day A4 diagnostic: the same int8 inputs on the board ("Q …") and on a PC (tools/firmware/model_cases.json).
    Equal outputs (±1) = the inference engine on the chip is fine and the difference is in beat detection."""
    import json, urllib.request
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'model_cases.json')
    if not os.path.exists(here):
        url = 'https://raw.githubusercontent.com/Asilovvv/afib-monitor/main/tools/firmware/model_cases.json'
        urllib.request.urlretrieve(url, here)
    cases = json.load(open(here))
    dev = Device(args.port)
    got = []
    for c in cases:
        n0 = len(dev.lines)
        dev.send('Q ' + ' '.join(str(v) for v in c['input']) + '\n')
        t0 = time.time()
        while time.time() - t0 < 2:
            new = [l for l in dev.lines[n0:] if l.startswith('QOUT')]
            if new:
                break
            time.sleep(0.01)
        v = new[0].split()[1] if new else 'timeout'
        got.append(int(v) if v.lstrip('-').isdigit() else None)
    dev.close()
    bad = 0
    for kind in ('regular', 'af_like', 'random'):
        rows = [(c['expected'], g) for c, g in zip(cases, got) if c['kind'] == kind]
        diff = [abs(e - g) if g is not None else 999 for e, g in rows]
        bad += sum(d > 1 for d in diff)
        pe = [round((e + 128) / 256, 3) for e, _ in rows]; pg = [round((g + 128) / 256, 3) if g is not None else None for _, g in rows]
        print(f'{kind:8s} max |board - PC| = {max(diff)} LSB   PC prob {pe[:5]}…   board prob {pg[:5]}…')
    print('MODEL CHECK', 'OK: board = PC' if bad == 0 else f'MISMATCH in {bad} of {len(cases)} cases: the inference on the chip differs')


def bench(args):
    dev = Device(args.port)
    dev.send('I\n'); time.sleep(0.5)
    dev.send('B\n'); time.sleep(8)
    dev.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', help='e.g. /dev/cu.usbmodem101 or COM5')
    ap.add_argument('--record', default='08215')
    ap.add_argument('--rhythm', choices=['N', 'AFIB'], help='jump to the first 1+ min segment of this rhythm')
    ap.add_argument('--start', type=float, default=0, help='start time, seconds')
    ap.add_argument('--minutes', type=float, default=3)
    ap.add_argument('--speed', type=float, default=1.0, help='1 = real time; eval can use 10')
    ap.add_argument('--eval', action='store_true')
    ap.add_argument('--records', help='comma-separated records for --eval')
    ap.add_argument('--bench', action='store_true')
    ap.add_argument('--model-check', action='store_true', help='same int8 inputs on the board and on a PC')
    ap.add_argument('--live', type=float, help='record the device ECG for this many seconds')
    ap.add_argument('--out', help='CSV file for --live')
    ap.add_argument('--snr', nargs='+', help='CSV files from --live')
    a = ap.parse_args()
    if a.snr:
        snr(a)
        sys.exit()
    if not a.port:
        ap.error('--port is required')
    if a.live:
        live(a)
    elif a.bench:
        bench(a)
    elif a.model_check:
        model_check(a)
    elif a.eval:
        evaluate(a)
    else:
        demo(a)
