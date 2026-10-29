"""Demo data: one doctor, five patients, 7 days of readings, alerts, ECG strips, symptoms, notes.

    python -m app.seed            # creates demo data if it does not exist
Doctor: doctor@demo.kg / demo1234 (invite code DEMO42)   Patients: aibek@demo.kg ... / demo1234
"""
import json
import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import insert, select

from . import analytics
from .auth import hash_password
from .db import Base, SessionLocal, engine
from .ecgsynth import synth_ecg
from .models import (DAY_TAGS, CheckPlan, Alert, DayTag, Device, DeviceIssue, MedDose, Medication, EcgStrip, EpisodeReview, Note, Reading, Symptom, User, STATE_AFIB, STATE_NORMAL,
                     STATE_NO_SIGNAL)

DAYS = 7
STEP_S = 6.0


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


PATIENTS = [  # name, email, birth year, sex, pattern
    ("Айбек Токтогулов", "aibek@demo.kg", 1958, "m", "paroxysmal"),
    ("Гульмира Асанова", "gulmira@demo.kg", 1949, "f", "persistent"),
    ("Нурлан Жумабаев", "nurlan@demo.kg", 1971, "m", "normal"),
    ("Сабина Ким", "sabina@demo.kg", 1966, "f", "recent"),
    ("Эрмек Абдыкадыров", "ermek@demo.kg", 1962, "m", "rare"),
]


def episodes_for(pattern: str, rng: random.Random) -> list[tuple[float, float]]:
    """AFib episodes as (start_h, end_h) counted back from now (0 = now)."""
    if pattern == "persistent":
        return [(DAYS * 24, 0)]
    if pattern == "normal":
        return []
    if pattern == "recent":
        return [(0.25, 0), (30.0, 29.6), (75.0, 74.8)]
    if pattern == "rare":
        return [(100.0, 99.5)]
    eps = []
    h = DAYS * 24 - 5
    while h > 3:
        d = rng.uniform(0.15, 1.5)
        eps.append((h, h - d))
        h -= rng.uniform(12, 30)
    return eps


def synth_readings(pattern: str, seed: int):
    rng = random.Random(seed)
    now = utcnow()
    eps = episodes_for(pattern, rng)
    out = []
    t = now - timedelta(days=DAYS)
    battery = 100.0
    while t < now:
        back_h = (now - t).total_seconds() / 3600
        hour = (t.hour + 6) % 24                                     # Bishkek local time
        battery -= STEP_S / 3600 * 2.2
        if battery < 15:
            battery = 100.0
        if hour == 8 and t.minute < 25:                               # shower: device off
            out.append(Reading(ts=t, state=STATE_NO_SIGNAL, prob=0, bpm=0, battery=int(battery)))
        else:
            af = any(b <= back_h < a for a, b in eps)
            circ = 7 * math.sin(2 * math.pi * (hour - 9) / 24) - (6 if hour < 6 else 0)
            if af:
                st, prob, bpm = STATE_AFIB, min(1, 0.82 + rng.random() * 0.18), 108 + circ + rng.gauss(0, 13)
            else:
                st, prob, bpm = STATE_NORMAL, rng.random() * 0.12, 68 + circ + rng.gauss(0, 3)
                if pattern == "normal" and hour == 3 and t.minute < 3:   # demo: short slow-rate stretch at night
                    bpm = 37 + rng.gauss(0, 1)
            out.append(Reading(ts=t, state=st, prob=round(prob, 3), bpm=round(max(bpm, 35), 1), battery=int(battery)))
        t += timedelta(seconds=STEP_S)
    return out


DEMO_MEDS = {  # pattern -> (name, dose, local times, anticoagulant)
    "paroxysmal": [("Апиксабан", "5 мг", "08:00,20:00", True), ("Бисопролол", "2,5 мг", "08:00", False)],
    "persistent": [("Ривароксабан", "20 мг", "20:00", True), ("Бисопролол", "5 мг", "08:00", False)],
    "recent": [("Бисопролол", "2,5 мг", "08:00", False)],
}

SYMPTOM_SETS = [(["palpitations"], 2, "Сердце колотится после подъёма по лестнице"),
                (["palpitations", "dizziness"], 2, None),
                (["fatigue"], 1, "Весь день слабость"),
                (["shortness_of_breath", "palpitations"], 3, "Пришлось сесть"),
                (["anxiety"], 1, None)]


# control mode demo: known AF checked on a schedule (separate and idempotent, so an existing demo database gets it too)
CHECK_DEMO = [("gulmira@demo.kg", "08:00,14:00,20:00", True, 0.85), ("aibek@demo.kg", "09:00,21:00", False, 0.9)]


def seed_check_plans(db):
    for email, times, afib, keep in CHECK_DEMO:
        p = db.scalar(select(User).where(User.email == email))
        if not p or db.scalar(select(CheckPlan).where(CheckPlan.patient_id == p.id)):
            continue
        rng = random.Random(email)
        start = utcnow() - timedelta(days=3)
        db.add(CheckPlan(patient_id=p.id, times=times, active=True, set_by="doctor", updated_at=start))
        for k, slot in enumerate(analytics.dose_slots(times.split(","), start, utcnow(), 6)):
            if rng.random() > keep:
                continue                                     # a missed check
            ts = datetime.strptime(slot, "%Y-%m-%dT%H:%M") - timedelta(hours=6) + timedelta(minutes=rng.uniform(-20, 40))
            if ts > utcnow():
                continue
            bpm = rng.uniform(88, 112) if afib else rng.uniform(62, 78)
            db.add(EcgStrip(patient_id=p.id, ts=ts, fs=125, reason="check", state=STATE_AFIB if afib else STATE_NORMAL,
                            prob=0.9 if afib else 0.05, bpm=bpm,
                            samples=json.dumps(synth_ecg(30, afib=afib, bpm=bpm, seed=1000 + k))))
        db.commit()


DEMO_DEVICES = [  # chip ID (made up), sticker, electrodes in the box, issued to (email), days until due (negative = overdue)
    ("3F9A21", "№1", 12, "aibek@demo.kg", 9),
    ("7C04B8", "№2", 6, "gulmira@demo.kg", -2),
    ("E15D60", "№3", 20, None, None),
]


def seed_devices(db, doc):
    """Three clinic sensors for the demo doctor: one on loan, one overdue, one free, plus one finished loan."""
    if db.scalar(select(Device).where(Device.owner_id == doc.id).limit(1)):
        return
    now = utcnow()
    for chip, label, electrodes, email, due_days in DEMO_DEVICES:
        d = Device(owner_id=doc.id, chip_id=chip, label=label, electrodes=electrodes, created_at=now - timedelta(days=40))
        db.add(d)
        db.flush()
        if chip == "E15D60":
            n = db.scalar(select(User).where(User.email == "nurlan@demo.kg"))
            if n:
                db.add(DeviceIssue(device_id=d.id, patient_id=n.id, doctor_id=doc.id, issued_at=now - timedelta(days=30),
                                   due_at=now - timedelta(days=16), returned_at=now - timedelta(days=17), electrodes_given=6))
        if email:
            pat = db.scalar(select(User).where(User.email == email))
            if pat:
                db.add(DeviceIssue(device_id=d.id, patient_id=pat.id, doctor_id=doc.id, issued_at=now - timedelta(days=14 - (due_days or 0)),
                                   due_at=now + timedelta(days=due_days), electrodes_given=6))
    db.commit()


def run():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    doc = db.scalar(select(User).where(User.email == "doctor@demo.kg"))
    if not doc:
        doc = User(email="doctor@demo.kg", name="Др. Эркебулан Садыков", role="doctor",
                   password_hash=hash_password("demo1234"), invite_code="DEMO42", clinic="Национальный центр кардиологии",
                   specialty="Кардиолог-аритмолог", phone="+996 312 000 000")
        db.add(doc)
        db.commit()
    for i, (name, email, by, sex, pattern) in enumerate(PATIENTS):
        if db.scalar(select(User).where(User.email == email)):
            continue
        p = User(email=email, name=name, role="patient", password_hash=hash_password("demo1234"),
                 doctor_id=doc.id, birth_year=by, sex=sex, phone=f"+996 700 00{i}{i} {i}{i}")
        db.add(p)
        db.commit()
        rows = synth_readings(pattern, seed=i)
        db.execute(insert(Reading), [{"patient_id": p.id, "ts": r.ts, "state": r.state, "prob": r.prob,
                                      "bpm": r.bpm, "battery": r.battery} for r in rows])
        rng = random.Random(100 + i)
        # alerts, ECG strips and reviews for each AFib onset
        prev = None
        onsets = []
        for r in rows:
            if r.state == STATE_AFIB and prev != STATE_AFIB:
                onsets.append(r)
            if r.state in (STATE_NORMAL, STATE_AFIB):
                prev = r.state
        for k, r in enumerate(onsets):
            recent = utcnow() - r.ts < timedelta(hours=6)
            db.add(Alert(patient_id=p.id, ts=r.ts, prob=r.prob, bpm=r.bpm, status="new" if recent else "ack",
                         ack_by=None if recent else doc.id, ack_at=None if recent else r.ts + timedelta(minutes=12)))
            db.add(EcgStrip(patient_id=p.id, ts=r.ts, fs=125, reason="afib_onset", state=STATE_AFIB, prob=r.prob,
                            bpm=r.bpm, samples=json.dumps(synth_ecg(10, afib=True, bpm=r.bpm, seed=k + 10 * i))))
        # one normal strip recorded by the patient
        t_norm = utcnow() - timedelta(hours=20 + i)
        db.add(EcgStrip(patient_id=p.id, ts=t_norm, fs=125, reason="manual", state=STATE_NORMAL, prob=0.04, bpm=70,
                        samples=json.dumps(synth_ecg(10, afib=False, bpm=70, seed=99 + i))))
        # symptoms
        if pattern != "normal":
            for k in range(rng.randint(3, 6)):
                kinds, sev, note = SYMPTOM_SETS[rng.randrange(len(SYMPTOM_SETS))]
                db.add(Symptom(patient_id=p.id, ts=utcnow() - timedelta(hours=rng.uniform(2, DAYS * 24)),
                               kinds=",".join(kinds), severity=sev, note=note))
        # diary: demo patients ticked random lifestyle factors on most days (random, so no built-in "link")
        for d in range(DAYS + 1):
            if rng.random() < 0.85:
                day = (utcnow() + timedelta(hours=6) - timedelta(days=d)).date().isoformat()
                db.add(DayTag(patient_id=p.id, day=day,
                              tags=",".join(t for t in DAY_TAGS if rng.random() < (0.45 if t in ("caffeine", "exercise") else 0.2))))
        db.commit()
        # demo medicines with a mostly-kept schedule (random answers, some doses left unanswered)
        for name, dose, times, ac in DEMO_MEDS.get(pattern, []):
            m = Medication(patient_id=p.id, name=name, dose=dose, times=times, anticoagulant=ac,
                           created_at=utcnow() - timedelta(days=DAYS))
            db.add(m)
            db.flush()
            for slot in analytics.dose_slots(times.split(","), m.created_at, utcnow(), 6):
                r = rng.random()
                if r < 0.9 - (0.15 if pattern == "persistent" else 0):
                    db.add(MedDose(patient_id=p.id, medication_id=m.id, slot=slot, status="taken"))
                elif r < 0.95:
                    db.add(MedDose(patient_id=p.id, medication_id=m.id, slot=slot, status="skipped"))
        db.commit()
        # reviews: doctor already reviewed older episodes
        ar = [analytics.R(r.ts, r.state, r.prob, r.bpm) for r in rows]
        for k, e in enumerate(analytics.episodes(ar)):
            if utcnow() - e["start"] > timedelta(hours=24):
                db.add(EpisodeReview(patient_id=p.id, episode_start=e["start"], reviewer_id=doc.id,
                                     verdict="false_alarm" if (pattern == "rare" or k % 5 == 3) else "confirmed"))
        db.commit()
        print(f"{p.name}: {len(rows)} readings, {len(onsets)} alerts ({pattern})")
    seed_check_plans(db)
    seed_devices(db, doc)
    if not db.scalar(select(Note).limit(1)):
        a = db.scalar(select(User).where(User.email == "aibek@demo.kg"))
        g = db.scalar(select(User).where(User.email == "gulmira@demo.kg"))
        for pat, text, h in [(a, "Пароксизмальная форма. Назначен Холтер на 7 дней, контроль через неделю.", 140),
                             (a, "Эпизоды чаще ночью. Обсудить антикоагулянтную терапию (CHA2DS2-VASc = 3).", 30),
                             (g, "Персистирующая ФП, контроль ЧСС. Пульс в целевом диапазоне.", 50)]:
            if pat:
                db.add(Note(patient_id=pat.id, author_id=doc.id, ts=utcnow() - timedelta(hours=h), text=text))
        db.commit()
    db.close()
    print("Demo ready. Doctor: doctor@demo.kg / demo1234, invite code DEMO42")


if __name__ == "__main__":
    run()
