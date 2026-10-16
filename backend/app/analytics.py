"""Turns raw readings into what a doctor needs: AFib episodes, AFib burden, heart-rate series."""
from dataclasses import dataclass
from datetime import datetime, timedelta

from .models import STATE_AFIB, STATE_NORMAL

GAP = timedelta(seconds=60)          # readings further apart = monitoring was interrupted
MIN_EPISODE = timedelta(seconds=30)  # clinical convention: AF episode lasts >= 30 s


@dataclass
class R:
    ts: datetime
    state: int
    prob: float
    bpm: float


def episodes(rows: list[R]) -> list[dict]:
    out, start, last, probs, bpms = [], None, None, [], []

    def close():
        if start is not None and last - start >= MIN_EPISODE:
            out.append({"start": start, "end": last,
                        "duration_s": round((last - start).total_seconds()),
                        "max_prob": round(max(probs), 3),
                        "mean_bpm": round(sum(bpms) / len(bpms), 1) if bpms else None})

    for r in rows:
        if r.state == STATE_AFIB:
            if start is None or r.ts - last > GAP:
                close()
                start, probs, bpms = r.ts, [], []
            last = r.ts
            probs.append(r.prob)
            if r.bpm > 0:
                bpms.append(r.bpm)
        elif start is not None:
            close()
            start = None
    close()
    return out


def monitored_seconds(rows: list[R]) -> float:
    total = 0.0
    for a, b in zip(rows, rows[1:]):
        if a.state in (STATE_NORMAL, STATE_AFIB) and b.ts - a.ts <= GAP:
            total += (b.ts - a.ts).total_seconds()
    return total


def af_seconds(rows: list[R]) -> float:
    total = 0.0
    for a, b in zip(rows, rows[1:]):
        if a.state == STATE_AFIB and b.ts - a.ts <= GAP:
            total += (b.ts - a.ts).total_seconds()
    return total


def series(rows: list[R], max_points: int = 400) -> list[dict]:
    """Downsample to <= max_points buckets: mean BPM, max AFib probability, dominant state."""
    rows = [r for r in rows if r.state in (STATE_NORMAL, STATE_AFIB)]
    if not rows:
        return []
    t0, t1 = rows[0].ts, rows[-1].ts
    span = max((t1 - t0).total_seconds(), 1.0)
    width = max(span / max_points, 1.0)
    buckets: dict[int, list[R]] = {}
    for r in rows:
        buckets.setdefault(int((r.ts - t0).total_seconds() // width), []).append(r)
    out = []
    for k in sorted(buckets):
        b = buckets[k]
        bpm = [x.bpm for x in b if x.bpm > 0]
        af = sum(x.state == STATE_AFIB for x in b)
        out.append({"t": (t0 + timedelta(seconds=k * width)).isoformat() + "Z",
                    "bpm": round(sum(bpm) / len(bpm), 1) if bpm else None,
                    "prob": round(max(x.prob for x in b), 3),
                    "afib": af * 2 >= len(b)})
    return out


def summary(rows: list[R]) -> dict:
    valid = [r for r in rows if r.state in (STATE_NORMAL, STATE_AFIB) and r.bpm > 0]
    mon = monitored_seconds(rows)
    af = af_seconds(rows)
    eps = episodes(rows)
    return {
        "monitored_minutes": round(mon / 60, 1),
        "af_burden": round(af / mon, 4) if mon else 0.0,
        "episodes_count": len(eps),
        "longest_episode_s": max((e["duration_s"] for e in eps), default=0),
        "hr_mean": round(sum(r.bpm for r in valid) / len(valid), 1) if valid else None,
        "hr_min": round(min(r.bpm for r in valid), 1) if valid else None,
        "hr_max": round(max(r.bpm for r in valid), 1) if valid else None,
        "readings": len(rows),
    }


def hourly(rows: list[R], since: datetime, until: datetime) -> list[dict]:
    """Per-hour: minutes monitored, minutes in AFib, mean heart rate (for the 24 h / 7 d bar charts)."""
    step = 3600 if (until - since) <= timedelta(hours=48) else 86400
    n = max(1, int((until - since).total_seconds() // step) + 1)
    mon = [0.0] * n
    af = [0.0] * n
    hr: list[list[float]] = [[] for _ in range(n)]
    for a, b in zip(rows, rows[1:]):
        k = int((a.ts - since).total_seconds() // step)
        if not 0 <= k < n:
            continue
        if a.state in (STATE_NORMAL, STATE_AFIB) and b.ts - a.ts <= GAP:
            d = (b.ts - a.ts).total_seconds()
            mon[k] += d
            if a.state == STATE_AFIB:
                af[k] += d
        if a.bpm > 0 and a.state in (STATE_NORMAL, STATE_AFIB):
            hr[k].append(a.bpm)
    return [{"t": (since + timedelta(seconds=k * step)).isoformat() + "Z",
             "monitored_min": round(mon[k] / 60, 1), "af_min": round(af[k] / 60, 1),
             "bpm": round(sum(hr[k]) / len(hr[k]), 1) if hr[k] else None} for k in range(n)]
