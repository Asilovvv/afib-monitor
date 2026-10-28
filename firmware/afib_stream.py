#!/usr/bin/env python3
"""
afib_stream.py — sends real ECG from the MIT-BIH AF Database to the CoreS3 SE over USB
and reads the device's predictions.

Install once:   pip install wfdb pyserial numpy
The port is found automatically (ESP32-S3 USB, VID 0x303A); --port /dev/cu.usbmodem101 picks one by hand.

Demo (real time, shows on the screen like a live patient):
    python afib_stream.py --port /dev/cu.usbmodem101 --record 08215 --rhythm AFIB
    python afib_stream.py --port /dev/cu.usbmodem101 --record 05261 --rhythm N

On-device evaluation (fast, many windows, prints sensitivity / specificity):
    python afib_stream.py --port /dev/cu.usbmodem101 --eval --minutes 20 --speed 10

Benchmark (inference time and RAM on the chip):
    python afib_stream.py --port /dev/cu.usbmodem101 --bench

Live ECG from the AD8232 (laptop on battery, sit still), saved as CSV at 250 Hz, then its SNR:
    python afib_stream.py --port /dev/cu.usbmodem101 --live 30 --out gel_1.csv
    python afib_stream.py --port /dev/cu.usbmodem101 --checks 5        # A6: five 30-s checks, verdicts logged
    python afib_stream.py --snr gel_1.csv reusable_1.csv

Review a recording on the laptop (no board needed): beats found by the firmware detector (emulated, float32)
against an independent detector (wfdb XQRS), RR intervals, SNR, and what the screen showed (*_screen.txt):
    python afib_stream.py --review gel_1.csv check_1.csv
    python afib_stream.py --live 60 --out move_2.csv --review       # record, then review at once
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


ESP32S3_VID = 0x303A                # Espressif USB-Serial/JTAG (CoreS3 SE)


def find_port():
    """The board's serial port; the name changes with the USB socket (usbmodem101, usbmodem1101, ...)."""
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    cand = [p for p in ports if p.vid == ESP32S3_VID] or \
           [p for p in ports if 'usbmodem' in p.device or 'ttyACM' in p.device]
    if len(cand) == 1:
        print(f'  port: {cand[0].device} (found automatically)')
        return cand[0].device
    if not cand:
        sys.exit('Board not found. Connect the CoreS3 SE with a USB-C DATA cable and check that its screen is on.')
    sys.exit('Several possible boards: ' + ', '.join(p.device for p in cand) + ' — choose one with --port')


# ---- firmware path on a PC (afib_main.cpp: filterSample -> keep every 2nd sample -> detectorStep), float32 ----
FW_SOS = np.array([[0.1424442454, 0.2848884908, 0.1424442454, -0.6856000535, 0.2606960323],
                   [1.0, -2.0, 1.0, -1.9822347504, 0.9823948463]], np.float32)
FW_FS, FW_MA, FW_THR, FW_REFR, FW_WARM = 125, 19, np.float32(0.35), 31, 250
FW_DECAY = np.float32(0.5 ** (1 / (2 * FW_FS)))


def fw_beats(mv):
    """Beat times (s from the start) exactly as the firmware's live detector reports them."""
    f32 = np.float32
    z = np.zeros((2, 2), f32); tog = False
    buf = np.zeros(FW_MA, f32); ssum = f32(0); prev = f32(0); pk = f32(0); last = -10 ** 6; armed = True; i = 0
    beats = []
    for v in np.asarray(mv, f32):
        for k in range(2):
            c = FW_SOS[k]; y = f32(c[0] * v + z[k, 0]); z[k, 0] = f32(c[1] * v - c[3] * y + z[k, 1]); z[k, 1] = f32(c[2] * v - c[4] * y); v = y
        tog = not tog
        if not tog:
            continue
        d = f32(v - prev); prev = v; e = f32(d * d); j = i % FW_MA
        ssum = f32(ssum + e - buf[j]); buf[j] = e; env = f32(ssum / FW_MA); pk = max(f32(pk * FW_DECAY), env)
        if i >= FW_WARM:
            if armed and env > FW_THR * pk and i - last > FW_REFR:
                beats.append(i / FW_FS); last = i; armed = False
            elif not armed and env < f32(0.5) * FW_THR * pk:
                armed = True
        i += 1
    return np.array(beats)


def irregularity(rr):
    """Mean |successive RR difference| / mean RR, RR within 0.25-2.0 s (the 30-s check's measure)."""
    rr = np.asarray([r for r in rr if 0.25 <= r <= 2.0])
    return None if len(rr) < 4 else float(np.mean(np.abs(np.diff(rr))) / np.mean(rr))


def match_beats(a, b, tol=0.15):
    """Beats in a with a partner in b within tol s, after removing the median lag between the detectors."""
    if len(a) == 0 or len(b) == 0:
        return 0, 0.0
    lag = float(np.median([b[np.argmin(np.abs(b - t))] - t for t in a]))
    used, m = set(), 0
    for t in a + lag:
        j = int(np.argmin(np.abs(b - t)))
        if abs(b[j] - t) <= tol and j not in used:
            used.add(j); m += 1
    return m, lag


def review(paths):
    """Laptop review of recordings made with --live / --checks (no board needed)."""
    import wfdb.processing as wp
    for path in paths:
        mv = np.loadtxt(path, delimiter=',', skiprows=1, usecols=1, ndmin=1)
        print(f'\n{path}: {len(mv) / FS_RAW:.1f} s, raw {mv.min():.0f}-{mv.max():.0f} mV')
        if len(mv) < 10 * FS_RAW:
            print('  too short for a review (< 10 s)'); continue
        fb = fw_beats(mv)
        rb = wp.xqrs_detect(sig=mv.astype(float), fs=FS_RAW, verbose=False) / FS_RAW
        rb = rb[rb >= 2.0]                       # the firmware detector warms up for 2 s
        m, lag = match_beats(fb, rb)
        for name, b in (('firmware', fb), ('reference', rb)):
            rr = np.diff(b); irr = irregularity(rr)
            print(f'  {name:9s} beats {len(b):3d}' + (f'  HR {60 / rr.mean():5.1f}/min  RR {rr.min():.2f}-{rr.max():.2f} s'
                  f'  irregularity {irr:.3f}' if len(rr) >= 4 and irr is not None else '  (too few beats)'))
        print(f'  same beats: {m}  (only firmware {len(fb) - m}, only reference {len(rb) - m})'
              + ('  -> detector agrees' if len(fb) == len(rb) == m else '  -> look at the differences'))
        v, n = snr_of(path)
        print('  SNR ' + (f'{v:.1f} dB from {n} beats' if v is not None else f'not computed (only {n} beats)'))
        scr = os.path.splitext(path)[0] + '_screen.txt'
        if os.path.exists(scr):
            kv = [dict(x.split('=', 1) for x in l.split()[1:] if '=' in x) for l in open(scr) if l.startswith('PRED')]
            shown = [('no signal' if k.get('flat') == '1' else 'poor signal (clipped)' if k.get('clip') == '1' else
                      'poor signal (noise)' if k.get('noisy') == '1' else
                      'model >= 0.5' if k.get('label') == '1' else 'model < 0.5') for k in kv]
            print('  screen updates:', {s_: shown.count(s_) for s_ in dict.fromkeys(shown)})


class Device:
    def __init__(self, port):
        import serial
        self.ser = serial.Serial(port or find_port(), 115200, timeout=0.1)
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
    preds = [l for l in dev.lines if l.startswith('PRED')]
    if preds:                                  # what the screen showed during the recording (verdict, prob, clip)
        po = os.path.splitext(out)[0] + '_screen.txt'
        open(po, 'w').write('\n'.join(preds) + '\n')
        print(f'saved {po}: {len(preds)} screen verdicts')
    if status and 'dropped=0' not in status[-1]:
        print('  WARNING: samples were dropped on the device, repeat the recording')
    return out


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
    rows, gated = [], {}
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
            if kv.get('noisy') == '1':        # the noise gate showed "poor signal" instead of a verdict
                gated[truth] = gated.get(truth, 0) + 1
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
    if gated:
        print(f'noise gate: no verdict on {gated.get(1, 0)} AF and {gated.get(0, 0)} normal windows (not counted below)')
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


def checks(args):
    """Board day A6: start N 30-second checks over USB ("C") and log each device verdict ("CHECK verdict=…"),
    with the raw ECG of each check saved next to it (check_<k>.csv) for tools/firmware/rr_review.py."""
    names = {'0': 'REPEAT THE CHECK', '1': 'REGULAR RHYTHM', '2': 'IRREGULAR'}
    dev = Device(args.port)
    rows = []
    for k in range(1, args.checks + 1):
        n0 = len(dev.lines)
        dev.send('E 1\n'); time.sleep(0.2); dev.send('C\n')
        t0 = time.time(); res = None
        while time.time() - t0 < 45:
            res = next((l for l in dev.lines[n0:] if l.startswith('CHECK verdict')), None)
            if res:
                break
            print(f'\r  check {k}/{args.checks}: {time.time() - t0:4.0f} s — sit still', end='', flush=True)
            time.sleep(0.5)
        dev.send('E 0\n'); time.sleep(0.5)
        mv = [float(l.split()[1]) for l in dev.lines[n0:] if l.startswith('E ') and len(l.split()) == 2]
        out = f'check_{k}.csv'
        with open(out, 'w', newline='') as f:
            w = csv.writer(f); w.writerow(['t_s', 'mv'])
            for i, v in enumerate(mv):
                w.writerow([f'{i / FS_RAW:.3f}', v])
        if res is None:
            print(f'\r  check {k}: no verdict in 45 s (is the firmware running?)'); rows.append((k, None, '')); continue
        kv = dict(x.split('=', 1) for x in res.split()[1:] if '=' in x)
        print(f'\r  check {k}: {names.get(kv.get("verdict"), "?"):16s} bpm={kv.get("bpm")} beats={kv.get("beats")} '
              f'sqi={kv.get("sqi")} irr={kv.get("irr")} bsqi={kv.get("bsqi")}  raw -> {out}')
        rows.append((k, kv.get('verdict'), time.strftime('%Y-%m-%d %H:%M:%S') + f' check {k}: {res}'))
        if k < args.checks:
            time.sleep(12)                    # the verdict stays on screen for 10 s
    dev.close()
    with open('checks.log', 'a') as f:            # each line carries the time its verdict arrived
        for k, v, line in rows:
            if line:
                f.write(line + '\n')
    got = [names.get(v, 'no verdict') for _, v, _ in rows]
    print('summary:', ', '.join(got), '(appended to checks.log)')
    return [f'check_{k}.csv' for k, _, _ in rows]


def bench(args):
    dev = Device(args.port)
    dev.send('I\n'); time.sleep(0.5)
    dev.send('B\n'); time.sleep(8)
    dev.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', help='default: found automatically; e.g. /dev/cu.usbmodem101 or COM5')
    ap.add_argument('--record', default='08215')
    ap.add_argument('--rhythm', choices=['N', 'AFIB'], help='jump to the first 1+ min segment of this rhythm')
    ap.add_argument('--start', type=float, default=0, help='start time, seconds')
    ap.add_argument('--minutes', type=float, default=3)
    ap.add_argument('--speed', type=float, default=1.0, help='1 = real time; eval can use 10')
    ap.add_argument('--eval', action='store_true')
    ap.add_argument('--records', help='comma-separated records for --eval')
    ap.add_argument('--bench', action='store_true')
    ap.add_argument('--model-check', action='store_true', help='same int8 inputs on the board and on a PC')
    ap.add_argument('--checks', type=int, help='run N 30-second checks over USB and log the verdicts (A6)')
    ap.add_argument('--live', type=float, help='record the device ECG for this many seconds')
    ap.add_argument('--out', help='CSV file for --live')
    ap.add_argument('--snr', nargs='+', help='CSV files from --live')
    ap.add_argument('--review', nargs='*', help='review CSV files from --live/--checks on the laptop; '
                    'with --live or --checks and no files: review what was just recorded')
    a = ap.parse_args()
    if a.snr:
        snr(a)
        sys.exit()
    if a.review is not None and not (a.live or a.checks):
        if not a.review:
            ap.error('--review needs CSV files, or use it together with --live / --checks')
        review(a.review)
        sys.exit()
    if a.checks:
        made = checks(a)
        if a.review is not None:
            review(made)
    elif a.live:
        made = live(a)
        if a.review is not None:
            review([made])
    elif a.bench:
        bench(a)
    elif a.model_check:
        model_check(a)
    elif a.eval:
        evaluate(a)
    else:
        demo(a)
