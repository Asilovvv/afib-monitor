"""ECG strip analysis on the server: R-peaks, RR intervals, Poincaré points, signal quality index, PNG image.

Pure Python (strips are short: 10 s x 125 Hz). The R-peak detector is the firmware algorithm
(derivative^2 -> 150 ms moving average -> adaptive threshold, 250 ms refractory), adapted to run offline
on a short strip: the threshold tracker is primed with the first 2 s instead of a 2-s warm-up.
"""
from __future__ import annotations

import io
import math
import statistics


def _highpass(x: list[float], fs: int) -> list[float]:
    """Remove baseline wander: subtract a 0.6-s centred moving mean."""
    w = max(3, int(0.6 * fs)) | 1
    h = w // 2
    n = len(x)
    pre = [0.0]
    for v in x:
        pre.append(pre[-1] + v)
    out = []
    for i in range(n):
        a, b = max(0, i - h), min(n, i + h + 1)
        out.append(x[i] - (pre[b] - pre[a]) / (b - a))
    return out


def r_peaks(x: list[float], fs: int = 125) -> list[int]:
    n = len(x)
    if n < fs:
        return []
    y = _highpass(x, fs)
    ma = max(3, int(0.15 * fs))
    env, buf, s, prev = [], [0.0] * ma, 0.0, y[0]
    for i, v in enumerate(y):
        e = (v - prev) ** 2
        prev = v
        s += e - buf[i % ma]
        buf[i % ma] = e
        env.append(s / ma)
    decay = 0.5 ** (1 / (2.0 * fs))
    thr, refr = 0.35, int(0.25 * fs)
    pk = max(env[: min(n, 2 * fs)]) or 1e-12
    out, last, armed = [], -10 ** 9, True
    for i in range(int(0.2 * fs), n):
        pk = max(pk * decay, env[i])
        if armed and env[i] > thr * pk and i - last > refr:
            # the envelope lags the QRS by ~MA/2: take the largest |amplitude| just before
            a, b = max(0, i - ma - 4), min(n, i + 3)
            j = max(range(a, b), key=lambda k: abs(y[k]))
            if not out or j - out[-1] > refr:
                out.append(j)
            last, armed = i, False
        elif not armed and env[i] < 0.5 * thr * pk:
            armed = True
    return out


def rr_intervals(peaks: list[int], fs: int = 125) -> list[float]:
    return [round((b - a) / fs, 3) for a, b in zip(peaks, peaks[1:])]


def poincare(rr: list[float]) -> dict:
    """Points (RRn, RRn+1) and the SD1/SD2 descriptors (SD1 = short-term, beat-to-beat variability)."""
    rr = [r for r in rr if 0.25 <= r <= 2.0]
    return poincare_points([[a, b] for a, b in zip(rr, rr[1:])])


def poincare_points(pts: list[list[float]]) -> dict:
    if len(pts) < 3:
        return {"points": pts, "sd1": None, "sd2": None, "ratio": None}
    d1 = [(b - a) / math.sqrt(2) for a, b in pts]
    d2 = [(b + a) / math.sqrt(2) for a, b in pts]
    sd1, sd2 = statistics.pstdev(d1), statistics.pstdev(d2)
    return {"points": pts, "sd1": round(sd1 * 1000, 1), "sd2": round(sd2 * 1000, 1),
            "ratio": round(sd1 / sd2, 2) if sd2 > 0 else None}


def irregularity(rr: list[float]) -> float | None:
    """Mean |successive difference| / mean RR — high (>~0.1) in AF, low in sinus rhythm."""
    rr = [r for r in rr if 0.25 <= r <= 2.0]
    if len(rr) < 4:
        return None
    return round(statistics.mean(abs(b - a) for a, b in zip(rr, rr[1:])) / statistics.mean(rr), 3)


def quality(x: list[float], fs: int = 125, peaks: list[int] | None = None) -> dict:
    """Signal quality index 0..1 from four checks a cardiologist does by eye:
    no flat line / clipping, plausible heart rate, consistent QRS shape, little high-frequency noise."""
    n = len(x)
    if n < 2 * fs:
        return {"sqi": 0.0, "level": "poor", "reasons": ["too_short"]}
    peaks = r_peaks(x, fs) if peaks is None else peaks
    y = _highpass(x, fs)
    reasons = []
    rng = max(y) - min(y)
    flat = sum(1 for a, b in zip(y, y[1:]) if abs(b - a) < 1e-4) / n
    s_flat = 0.0 if rng < 0.05 or flat > 0.5 else 1.0
    if s_flat == 0:
        reasons.append("flat")
    secs = n / fs
    bpm = len(peaks) / secs * 60
    s_rate = 1.0 if 30 <= bpm <= 200 else 0.0
    if not s_rate:
        reasons.append("rate")
    # QRS template correlation
    h = int(0.1 * fs)
    segs = [y[p - h:p + h] for p in peaks if p - h >= 0 and p + h <= n]
    if len(segs) >= 3:
        tmpl = [statistics.median(col) for col in zip(*segs)]

        def corr(a, b):
            ma, mb = statistics.mean(a), statistics.mean(b)
            num = sum((u - ma) * (v - mb) for u, v in zip(a, b))
            den = math.sqrt(sum((u - ma) ** 2 for u in a) * sum((v - mb) ** 2 for v in b)) or 1e-12
            return num / den
        s_shape = max(0.0, statistics.mean(corr(s, tmpl) for s in segs))
    else:
        s_shape = 0.0
    if s_shape < 0.7:
        reasons.append("shape")
    # high-frequency noise: energy of the second difference relative to the signal
    d2 = [y[i + 1] - 2 * y[i] + y[i - 1] for i in range(1, n - 1)]
    noise = (sum(v * v for v in d2) / len(d2)) ** 0.5 / (statistics.pstdev(y) or 1e-12)
    s_noise = max(0.0, min(1.0, 1.5 - noise))
    if s_noise < 0.5:
        reasons.append("noise")
    sqi = s_flat * s_rate * (0.6 * s_shape + 0.4 * s_noise)
    sqi = round(max(0.0, min(1.0, sqi)), 2)
    return {"sqi": sqi, "level": "good" if sqi >= 0.7 else "fair" if sqi >= 0.4 else "poor", "reasons": reasons}


PAUSE_S = 3.0   # an RR gap of 3 s or more is a pause worth showing to a doctor


def pauses(peaks: list[int], fs: int = 125) -> list[dict]:
    return [{"at_s": round(a / fs, 2), "rr_s": round((b - a) / fs, 2)}
            for a, b in zip(peaks, peaks[1:]) if (b - a) / fs >= PAUSE_S]


def analyze(x: list[float], fs: int = 125) -> dict:
    p = r_peaks(x, fs)
    rr = rr_intervals(p, fs)
    q = quality(x, fs, p)
    # a pause only counts when the rest of the strip is clean; otherwise it is more likely a lost electrode
    return {"r_peaks": p, "rr": rr, "poincare": poincare(rr), "irregularity": irregularity(rr),
            "quality": q, "pauses": pauses(p, fs) if q["sqi"] >= 0.4 else []}


def _movmean(x: list[float], w: int) -> list[float]:
    """Centred moving mean over w samples (w odd), shrinking at the edges — the same as in _highpass."""
    h, n = w // 2, len(x)
    pre = [0.0]
    for v in x:
        pre.append(pre[-1] + v)
    return [(pre[min(n, i + h + 1)] - pre[max(0, i - h)]) / (min(n, i + h + 1) - max(0, i - h)) for i in range(n)]


# second detector settings (smooth samples, baseline window s, threshold fraction, refractory s); v2 = the first
AMP_DEFAULT = (1, 0.6, 0.5, 0.25)


def r_peaks_amp(x: list[float], fs: int = 125, params: tuple = AMP_DEFAULT) -> list[int]:
    """Second, independent R-peak detector for the agreement check: amplitude of the signal after removing
    the baseline (not the slope energy the main detector uses), adaptive threshold at a fraction of the
    decaying peak, refractory period. Optional light smoothing and a short baseline window make it a crude
    QRS band-pass that ignores T-waves better."""
    w1, w2s, frac, refr_s = params
    n = len(x)
    if n < fs:
        return []
    y = _movmean(x, w1) if w1 > 1 else list(x)
    w2 = max(3, int(w2s * fs)) | 1
    base = _movmean(y, w2)
    a = [abs(u - b) for u, b in zip(y, base)]
    decay = 0.5 ** (1 / (2.0 * fs))
    refr, look = int(refr_s * fs), int(0.1 * fs)
    pk = max(a[: min(n, 2 * fs)]) or 1e-12
    out, i = [], 0
    while i < n:
        pk = max(pk * decay, a[i])
        if a[i] > frac * pk and (not out or i - out[-1] > refr):
            j = max(range(i, min(n, i + look)), key=lambda k: a[k])
            if not out or j - out[-1] > refr:
                out.append(j)
            i = j + 1
            continue
        i += 1
    return out


def bsqi(p1: list[int], p2: list[int], fs: int = 125, tol_s: float = 0.15) -> float:
    """Agreement of two detectors (Li, Mark & Clifford 2008): matched / (n1 + n2 - matched), match within 150 ms."""
    if not p1 and not p2:
        return 0.0
    tol, used, m = int(tol_s * fs), set(), 0
    j = 0
    for p in p1:
        while j < len(p2) and p2[j] < p - tol:
            j += 1
        k = j
        while k < len(p2) and p2[k] <= p + tol:
            if k not in used:
                used.add(k)
                m += 1
                break
            k += 1
    return round(m / (len(p1) + len(p2) - m), 3)


# "Check me in 30 seconds" (wellness wording), see ml/CHECK30_CINC2017.md and ml/CHECK30_BSQI.md
# v1 (CinC 2017, never tuned on it): 91.4 % of AF recordings irregular, 14.1 % of normal ones too; noise not caught.
# v2 adds the two-detector agreement gate (bSQI >= 0.8), rules fixed before Notebook 8: false "irregular" on clean
# normal rhythm 14.1 % -> 3.3 %, noise caught (97.5 % of noisy recordings -> "could not read"), but 44 % of clean
# normal checks need a repeat and AF found drops 91.4 -> 69.4 %. See ml/CHECK30_BSQI.md.
CHECK_MIN_BEATS, CHECK_MIN_SQI, CHECK_IRR, CHECK_MIN_BSQI = 16, 0.4, 0.10, 0.8


def check(x: list[float], fs: int = 125, gate: bool = True) -> dict:
    """Verdict for a 30-s spot check: "regular", "irregular" (show a doctor) or "no_verdict" (repeat)."""
    a = analyze(x, fs)
    n, sqi, irr = len(a["r_peaks"]), a["quality"]["sqi"], a["irregularity"]
    b = bsqi(a["r_peaks"], r_peaks_amp(x, fs), fs)
    if n < CHECK_MIN_BEATS or sqi < CHECK_MIN_SQI or irr is None or (gate and b < CHECK_MIN_BSQI):
        verdict = "no_verdict"
    else:
        verdict = "irregular" if irr > CHECK_IRR else "regular"
    bpm = round(len(a["r_peaks"]) / (len(x) / fs) * 60) if x else None
    return {"verdict": verdict, "beats": n, "sqi": sqi, "irregularity": irr, "bsqi": b, "bpm": bpm,
            "reasons": a["quality"]["reasons"] + (["detectors_disagree"] if gate and b < CHECK_MIN_BSQI else [])}


def png(x: list[float], fs: int = 125, peaks: list[int] | None = None, title: str = "", subtitle: str = "",
        af: bool = False) -> bytes:
    """ECG on standard paper (25 mm/s, 10 mm/mV) as a PNG, R-peaks marked, RR in ms above the beats."""
    from PIL import Image, ImageDraw, ImageFont

    mm = 5                                    # pixels per mm
    secs = len(x) / fs
    W, H, top = int(secs * 25 * mm) + 40, 360, 70
    img = Image.new("RGB", (W, H), (255, 250, 247))
    d = ImageDraw.Draw(img)
    for k in range(0, W, mm):                 # 1 mm grid / 5 mm grid
        d.line([(20 + k, top), (20 + k, H - 10)], fill=(248, 220, 214) if (k // mm) % 5 else (236, 180, 170))
    for k in range(0, H - top - 10, mm):
        d.line([(20, top + k), (W - 20, top + k)], fill=(248, 220, 214) if (k // mm) % 5 else (236, 180, 170))
    y = _highpass(x, fs)
    mid = top + (H - top - 10) * 0.6
    px = lambda i: 20 + i / fs * 25 * mm
    py = lambda v: mid - v * 10 * mm
    pts = [(px(i), max(top, min(H - 10, py(v)))) for i, v in enumerate(y)]
    d.line(pts, fill=(22, 21, 26), width=2)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        big = ImageFont.truetype("DejaVuSans-Bold.ttf", 20)
    except OSError:
        font = big = ImageFont.load_default()
    peaks = r_peaks(x, fs) if peaks is None else peaks
    for a, b in zip(peaks, peaks[1:]):
        d.text(((px(a) + px(b)) / 2 - 16, top + 4), f"{round((b - a) / fs * 1000)}", fill=(120, 110, 120), font=font)
    for p in peaks:
        cx, cy = px(p), max(top + 24, py(y[p]) - 10)
        d.polygon([(cx - 5, cy - 8), (cx + 5, cy - 8), (cx, cy)], fill=(224, 67, 63))
    d.text((20, 12), title, fill=(192, 54, 47) if af else (22, 21, 26), font=big)
    d.text((20, 40), subtitle + "   ·   25 мм/с, 10 мм/мВ, RR в мс", fill=(90, 85, 95), font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
