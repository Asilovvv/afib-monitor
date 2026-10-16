"""Live demo feeder: keeps the seeded demo patients streaming readings every few seconds, so the doctor
portal shows patients online, live heart rate and — now and then — a real AF-onset alert with its ECG strip.

Enabled with DEMO_LIVE=1 (defaults to the value of SEED_DEMO). Only touches users whose email ends in @demo.kg.
"""
import asyncio
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, insert, select

from .db import SessionLocal
from .ecgsynth import synth_ecg
from .events import broker
from .models import EcgStrip, Reading, User, STATE_AFIB, STATE_NORMAL
from .seed import PATIENTS

STEP_S = 6.0
PATTERN = {email: pattern for _, email, _, _, pattern in PATIENTS}
# chance per step (6 s) that a paroxysm starts: ~ every 15–40 min of wall time for the demo
ONSET_P = {"paroxysmal": 6 / (25 * 60), "recent": 6 / (18 * 60), "rare": 6 / (90 * 60)}


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class Item:            # same shape as the API's ReadingIn
    ts: float
    state: int
    prob: float
    bpm: float
    battery: int


class Sim:
    def __init__(self, pattern: str, seed: int):
        self.pattern, self.rng = pattern, random.Random(seed)
        self.af_left = 0.0
        self.battery = self.rng.uniform(55, 95)

    def step(self, now: datetime) -> Item:
        rng = self.rng
        hour = (now.hour + 6) % 24
        circ = 7 * math.sin(2 * math.pi * (hour - 9) / 24)
        self.battery -= STEP_S / 3600 * 2.2
        if self.battery < 15:
            self.battery = 100.0
        if self.pattern == "persistent":
            af = True
        else:
            if self.af_left <= 0 and rng.random() < ONSET_P.get(self.pattern, 0):
                self.af_left = rng.uniform(90, 300)          # seconds
            af = self.af_left > 0
            self.af_left -= STEP_S
        if af:
            return Item(now.replace(tzinfo=timezone.utc).timestamp(), STATE_AFIB,
                        round(min(1, 0.82 + rng.random() * 0.18), 3), round(108 + circ + rng.gauss(0, 13), 1),
                        int(self.battery))
        return Item(now.replace(tzinfo=timezone.utc).timestamp(), STATE_NORMAL, round(rng.random() * 0.12, 3),
                    round(68 + circ + rng.gauss(0, 3), 1), int(self.battery))


def backfill(db, patients: list[User], sims: dict[int, Sim]) -> None:
    """Fill the gap between the last stored reading and now (e.g. after the server was off)."""
    now = utcnow()
    for p in patients:
        last = db.scalar(select(func.max(Reading.ts)).where(Reading.patient_id == p.id))
        if not last or now - last < timedelta(seconds=30):
            continue
        t = max(last + timedelta(seconds=STEP_S), now - timedelta(days=7))
        rows = []
        while t < now:
            it = sims[p.id].step(t)
            rows.append(dict(patient_id=p.id, ts=t, state=it.state, prob=it.prob, bpm=it.bpm, battery=it.battery))
            t += timedelta(seconds=STEP_S)
        for i in range(0, len(rows), 5000):
            db.execute(insert(Reading), rows[i:i + 5000])
        db.commit()


async def run_forever(ingest) -> None:
    await asyncio.sleep(2)
    with SessionLocal() as db:
        patients = db.scalars(select(User).where(User.email.like("%@demo.kg"), User.role == "patient")).all()
        sims = {p.id: Sim(PATTERN.get(p.email, "normal"), p.id) for p in patients}
        await asyncio.to_thread(backfill, db, patients, sims)
    ids = [p.id for p in patients]
    while True:
        try:
            await asyncio.to_thread(_tick, ingest, ids, sims)
        except Exception as e:  # never kill the server because of the demo
            print("demo_live:", e)
        await asyncio.sleep(STEP_S)


def _tick(ingest, ids: list[int], sims: dict[int, Sim]) -> None:
    now = utcnow()
    with SessionLocal() as db:
        for pid in ids:
            p = db.get(User, pid)
            if p is None:
                continue
            it = sims[pid].step(now)
            _, n_alerts = ingest(db, p, [it])
            if n_alerts:                                 # the phone would auto-record the ECG of the onset
                e = EcgStrip(patient_id=pid, ts=now, fs=125, reason="afib_onset", state=STATE_AFIB, prob=it.prob,
                             bpm=it.bpm, samples=json.dumps(synth_ecg(10, afib=True, bpm=it.bpm,
                                                                      seed=int(now.timestamp()))))
                db.add(e)
                db.commit()
                broker.publish(p.doctor_id, "ecg", {"patient_id": pid, "patient_name": p.name, "id": e.id,
                                                    "reason": e.reason})
