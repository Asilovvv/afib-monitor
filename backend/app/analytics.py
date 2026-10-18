"""Turns raw readings into what a doctor needs: AFib episodes, AFib burden, heart-rate series."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

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


LOW_BPM, HIGH_BPM = 40, 150          # wellness thresholds: "show this to your doctor", not a diagnosis
MIN_HR_EVENT = timedelta(seconds=60)


def hr_events(rows: list[R]) -> list[dict]:
    """Runs of at least 60 s with heart rate < 40 or > 150 bpm while the signal was valid (normal or AF rhythm)."""
    out = []
    for kind, test in (("low", lambda b: 0 < b < LOW_BPM), ("high", lambda b: b > HIGH_BPM)):
        start = last = None
        vals: list[float] = []

        def close():
            if start is not None and last - start >= MIN_HR_EVENT:
                out.append({"kind": kind, "start": start, "end": last,
                            "duration_s": round((last - start).total_seconds()),
                            "bpm": round(min(vals) if kind == "low" else max(vals))})

        for r in rows:
            ok = r.state in (STATE_NORMAL, STATE_AFIB) and test(r.bpm)
            if ok and start is not None and r.ts - last <= GAP:
                last = r.ts; vals.append(r.bpm)
            elif ok:
                close(); start = last = r.ts; vals = [r.bpm]
            else:
                close(); start = None
        close()
    return sorted(out, key=lambda e: e["start"])


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


TRIGGER_MIN_DAYS = 3                 # fewer days on either side -> no comparison is shown
TRIGGER_MIN_MONITORED_H = 4          # a diary day counts only if the device was worn at least this long


def day_window(day: str, tz_hours: float) -> tuple[datetime, datetime]:
    """The diary day and the following night: 06:00 local of `day` to 06:00 local of the next day, in UTC."""
    d = date.fromisoformat(day)
    start = datetime(d.year, d.month, d.day, 6) - timedelta(hours=tz_hours)
    return start, start + timedelta(days=1)


def triggers(rows: list[R], diary: dict[str, set[str]], tags: tuple[str, ...], tz_hours: float = 6) -> dict:
    """AF burden on diary days with a factor vs diary days without it (only days the patient filled in).
    Descriptive only: an association in one person's diary, not a cause."""
    days = []
    for day, present in sorted(diary.items()):
        a, b = day_window(day, tz_hours)
        win = [r for r in rows if a <= r.ts < b]
        mon, af = monitored_seconds(win), af_seconds(win)
        if mon >= TRIGGER_MIN_MONITORED_H * 3600:
            days.append({"day": day, "tags": sorted(present), "monitored_h": round(mon / 3600, 1),
                         "af_burden": round(af / mon, 4), "episodes": len(episodes(win))})
    out = []
    for t in tags:
        w = [d for d in days if t in d["tags"]]
        wo = [d for d in days if t not in d["tags"]]
        if not w:
            continue
        mean = lambda xs: round(sum(x["af_burden"] for x in xs) / len(xs), 4) if xs else None
        out.append({"tag": t, "days_with": len(w), "days_without": len(wo),
                    "burden_with": mean(w), "burden_without": mean(wo),
                    "episodes_per_day_with": round(sum(x["episodes"] for x in w) / len(w), 2),
                    "episodes_per_day_without": round(sum(x["episodes"] for x in wo) / len(wo), 2) if wo else None,
                    "enough": len(w) >= TRIGGER_MIN_DAYS and len(wo) >= TRIGGER_MIN_DAYS})
    return {"days": days, "factors": out, "min_days": TRIGGER_MIN_DAYS, "min_monitored_h": TRIGGER_MIN_MONITORED_H}


def dose_slots(times: list[str], start: datetime, end: datetime, tz_hours: float) -> list[str]:
    """Local "YYYY-MM-DDTHH:MM" slots of a daily schedule that fall between two UTC moments."""
    out = []
    lo, hi = start + timedelta(hours=tz_hours), end + timedelta(hours=tz_hours)
    d = lo.date()
    while d <= hi.date():
        for t in times:
            hh, mm = map(int, t.split(":"))
            at = datetime(d.year, d.month, d.day, hh, mm)
            if lo <= at <= hi:
                out.append(at.strftime("%Y-%m-%dT%H:%M"))
        d += timedelta(days=1)
    return out


def adherence(meds: list[dict], answers: dict[tuple[int, str], str], since: datetime, until: datetime,
              tz_hours: float) -> list[dict]:
    """Per medicine: doses due in the period (from when it was added until it was stopped), taken, skipped, no answer."""
    out = []
    for m in meds:
        a = max(since, m["created_at"])
        b = min(until, m["ended_at"] or until)
        slots = dose_slots(m["times"], a, b, tz_hours) if a < b else []
        st = [answers.get((m["id"], s)) for s in slots]
        taken, skipped = st.count("taken"), st.count("skipped")
        out.append({"id": m["id"], "name": m["name"], "dose": m["dose"], "anticoagulant": m["anticoagulant"],
                    "times": m["times"], "due": len(slots), "taken": taken, "skipped": skipped,
                    "no_answer": len(slots) - taken - skipped,
                    "adherence": round(taken / len(slots), 3) if slots else None,
                    "missed_slots": [s for s, x in zip(slots, st) if x != "taken"][-10:]})
    return out
