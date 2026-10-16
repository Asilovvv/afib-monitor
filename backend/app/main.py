"""AFib Monitor backend v2: REST API + live events for the mobile app (patients) and the web dashboard (doctors)."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import analytics
from .auth import (check_password, current_user, hash_password, make_token, new_invite_code,
                   require_role, user_from_token)
from .db import Base, SessionLocal, engine, get_db
from .events import broker
from .models import (STATE_AFIB, SYMPTOMS, Alert, EcgStrip, EpisodeReview, Note, Reading, Symptom,
                     User)

Base.metadata.create_all(engine)

if os.getenv("SEED_DEMO") == "1":          # demo doctor + patients (idempotent)
    from .seed import run as _seed_demo
    _seed_demo()

app = FastAPI(title="AFib Monitor API", version="2.0",
              description="Readings, alerts, ECG strips and symptoms from the ESP32-S3 AFib monitor.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ALERT_WINDOW = timedelta(minutes=10)
ONLINE_WINDOW = timedelta(minutes=2)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def from_unix(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None)


@app.on_event("startup")
async def _startup():
    broker.loop = asyncio.get_running_loop()
    if os.getenv("DEMO_LIVE", os.getenv("SEED_DEMO", "0")) == "1":   # keep demo patients "online"
        from .demo_live import run_forever
        asyncio.get_running_loop().create_task(run_forever(ingest))


# ---------------------------------------------------------------- schemas
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=200)
    role: str = Field(pattern="^(patient|doctor)$")
    doctor_code: str | None = None
    birth_year: int | None = Field(default=None, ge=1900, le=2030)
    sex: str | None = Field(default=None, pattern="^(m|f)$")
    clinic: str | None = Field(default=None, max_length=200)
    specialty: str | None = Field(default=None, max_length=100)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    birth_year: int | None = Field(default=None, ge=1900, le=2030)
    sex: str | None = Field(default=None, pattern="^(m|f)$")
    phone: str | None = Field(default=None, max_length=40)
    clinic: str | None = Field(default=None, max_length=200)
    specialty: str | None = Field(default=None, max_length=100)


class ReadingIn(BaseModel):
    ts: float = Field(description="Unix time, seconds")
    state: int = Field(ge=0, le=3)
    prob: float = Field(ge=0, le=1)
    bpm: float = Field(ge=0, le=300)
    battery: int | None = Field(default=None, ge=0, le=100)


class ReadingsIn(BaseModel):
    readings: list[ReadingIn] = Field(max_length=5000)


class LinkDoctorIn(BaseModel):
    doctor_code: str

    @field_validator("doctor_code")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.strip().upper()


class SymptomIn(BaseModel):
    ts: float | None = None
    kinds: list[str] = Field(min_length=1, max_length=len(SYMPTOMS))
    severity: int = Field(default=1, ge=1, le=3)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("kinds")
    @classmethod
    def known(cls, v: list[str]) -> list[str]:
        bad = [k for k in v if k not in SYMPTOMS]
        if bad:
            raise ValueError(f"unknown symptoms: {bad}")
        return v


class EcgIn(BaseModel):
    ts: float = Field(description="Unix time of the first sample, seconds")
    fs: int = Field(default=125, ge=50, le=1000)
    samples: list[float] = Field(min_length=50, max_length=125 * 60)
    state: int = Field(default=1, ge=0, le=3)
    prob: float = Field(default=0, ge=0, le=1)
    bpm: float = Field(default=0, ge=0, le=300)
    reason: str = Field(default="manual", pattern="^(afib_onset|manual|symptom)$")


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class ReviewIn(BaseModel):
    episode_start: str
    verdict: str = Field(pattern="^(confirmed|false_alarm|clear)$")


def user_out(u: User) -> dict:
    d = {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "birth_year": u.birth_year,
         "sex": u.sex, "phone": u.phone}
    if u.role == "doctor":
        d.update(invite_code=u.invite_code, clinic=u.clinic, specialty=u.specialty)
    else:
        d["doctor"] = ({"id": u.doctor.id, "name": u.doctor.name, "clinic": u.doctor.clinic,
                        "phone": u.doctor.phone} if u.doctor else None)
    return d


def own_patient(db: Session, doctor: User, patient_id: int) -> User:
    p = db.get(User, patient_id)
    if not p or p.doctor_id != doctor.id:
        raise HTTPException(404, "Patient not found")
    return p


# ---------------------------------------------------------------- auth & profile
@app.post("/api/auth/register")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    u = User(email=body.email.lower(), name=body.name.strip(), role=body.role,
             password_hash=hash_password(body.password), birth_year=body.birth_year, sex=body.sex)
    if body.role == "doctor":
        u.invite_code = new_invite_code()
        u.clinic, u.specialty = body.clinic, body.specialty
    elif body.doctor_code:
        doc = db.scalar(select(User).where(User.invite_code == body.doctor_code.strip().upper()))
        if not doc:
            raise HTTPException(404, "Doctor code not found")
        u.doctor_id = doc.id
    db.add(u)
    db.commit()
    return {"token": make_token(u), "user": user_out(u)}


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    if not u or not check_password(body.password, u.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": make_token(u), "user": user_out(u)}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@app.put("/api/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("clinic", "specialty") and user.role != "doctor":
            continue
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user_out(user)


@app.put("/api/me/doctor")
def link_doctor(body: LinkDoctorIn, user: User = Depends(require_role("patient")),
                db: Session = Depends(get_db)):
    doc = db.scalar(select(User).where(User.invite_code == body.doctor_code))
    if not doc:
        raise HTTPException(404, "Doctor code not found")
    user = db.merge(user)
    user.doctor_id = doc.id
    db.commit()
    db.refresh(user)
    broker.publish(doc.id, "patients", {"patient_id": user.id})
    return user_out(user)


@app.post("/api/me/invite")
def regenerate_invite(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    doctor = db.merge(doctor)
    doctor.invite_code = new_invite_code()
    db.commit()
    return {"invite_code": doctor.invite_code}


# ---------------------------------------------------------------- data from the mobile app
def ingest(db: Session, user: User, items: list) -> tuple[int, int]:
    """Store readings, open an alert at every AF onset and push live events. Shared by the API and demo feeder."""
    items = sorted(items, key=lambda r: r.ts)
    if not items:
        return 0, 0
    prev = db.scalar(select(Reading.state).where(Reading.patient_id == user.id,
                                                 Reading.ts < from_unix(items[0].ts))
                     .order_by(Reading.ts.desc()).limit(1))
    rows, alerts = [], []
    for r in items:
        ts = from_unix(r.ts)
        rows.append(Reading(patient_id=user.id, ts=ts, state=r.state, prob=r.prob, bpm=r.bpm, battery=r.battery))
        if r.state == STATE_AFIB and prev != STATE_AFIB:
            alerts.append(Alert(patient_id=user.id, ts=ts, prob=r.prob, bpm=r.bpm))
        if r.state in (1, 2):              # ignore 'collecting' / 'no signal' gaps
            prev = r.state
    db.add_all(rows + alerts)
    db.commit()
    last = items[-1]
    broker.publish(user.doctor_id, "reading", {"patient_id": user.id, "state": last.state, "bpm": last.bpm,
                                               "prob": last.prob, "ts": iso(from_unix(last.ts))})
    for a in alerts:
        broker.publish(user.doctor_id, "alert", {"id": a.id, "patient_id": user.id, "patient_name": user.name,
                                                 "ts": iso(a.ts), "prob": a.prob, "bpm": a.bpm})
    return len(rows), len(alerts)


@app.post("/api/readings")
def upload_readings(body: ReadingsIn, user: User = Depends(require_role("patient")),
                    db: Session = Depends(get_db)):
    saved, n_alerts = ingest(db, user, body.readings)
    return {"saved": saved, "alerts": n_alerts}


@app.post("/api/symptoms")
def add_symptom(body: SymptomIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    s = Symptom(patient_id=user.id, ts=from_unix(body.ts) if body.ts else utcnow(), kinds=",".join(body.kinds),
                severity=body.severity, note=body.note)
    db.add(s)
    db.commit()
    broker.publish(user.doctor_id, "symptom", {"patient_id": user.id, "patient_name": user.name, "id": s.id})
    return symptom_out(s)


@app.post("/api/ecg")
def add_ecg(body: EcgIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    e = EcgStrip(patient_id=user.id, ts=from_unix(body.ts), fs=body.fs,
                 samples=json.dumps([round(x, 4) for x in body.samples]),
                 state=body.state, prob=body.prob, bpm=body.bpm, reason=body.reason)
    db.add(e)
    db.commit()
    broker.publish(user.doctor_id, "ecg", {"patient_id": user.id, "patient_name": user.name, "id": e.id,
                                           "reason": e.reason})
    return ecg_meta(e)


def symptom_out(s: Symptom) -> dict:
    return {"id": s.id, "ts": iso(s.ts), "kinds": s.kinds.split(","), "severity": s.severity, "note": s.note}


def ecg_meta(e: EcgStrip) -> dict:
    n = len(json.loads(e.samples)) if e.samples else 0
    return {"id": e.id, "ts": iso(e.ts), "fs": e.fs, "duration_s": round(n / e.fs, 1), "state": e.state,
            "prob": e.prob, "bpm": e.bpm, "reason": e.reason}


@app.get("/api/ecg/{ecg_id}")
def get_ecg(ecg_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(EcgStrip, ecg_id)
    if not e:
        raise HTTPException(404, "ECG not found")
    p = db.get(User, e.patient_id)
    if not (user.id == p.id or (user.role == "doctor" and p.doctor_id == user.id)):
        raise HTTPException(404, "ECG not found")
    return {**ecg_meta(e), "samples": json.loads(e.samples)}


# ---------------------------------------------------------------- reports
def load_rows(db: Session, patient_id: int, since: datetime, until: datetime) -> list[analytics.R]:
    q = (select(Reading.ts, Reading.state, Reading.prob, Reading.bpm)
         .where(Reading.patient_id == patient_id, Reading.ts >= since, Reading.ts <= until)
         .order_by(Reading.ts))
    return [analytics.R(*r) for r in db.execute(q).all()]


def patient_report(db: Session, patient: User, hours: float) -> dict:
    until = utcnow()
    since = until - timedelta(hours=hours)
    rows = load_rows(db, patient.id, since, until)
    last = rows[-1] if rows else None
    battery = db.scalar(select(Reading.battery).where(Reading.patient_id == patient.id, Reading.battery.isnot(None))
                        .order_by(Reading.ts.desc()).limit(1))
    reviews = {r.episode_start: r.verdict for r in db.scalars(
        select(EpisodeReview).where(EpisodeReview.patient_id == patient.id, EpisodeReview.episode_start >= since))}
    ecgs = list(db.scalars(select(EcgStrip).where(EcgStrip.patient_id == patient.id, EcgStrip.ts >= since)
                           .order_by(EcgStrip.ts.desc())))
    eps = []
    for e in reversed(analytics.episodes(rows)):
        strip = next((x for x in ecgs if e["start"] - timedelta(seconds=90) <= x.ts <= e["end"]), None)
        eps.append({**e, "start": iso(e["start"]), "end": iso(e["end"]),
                    "verdict": reviews.get(e["start"]), "ecg_id": strip.id if strip else None})
    stats = analytics.summary(rows)
    stats["confirmed_episodes"] = sum(1 for e in eps if e["verdict"] == "confirmed")
    stats["false_alarms"] = sum(1 for e in eps if e["verdict"] == "false_alarm")
    symptoms = db.scalars(select(Symptom).where(Symptom.patient_id == patient.id, Symptom.ts >= since)
                          .order_by(Symptom.ts.desc()))
    return {
        "patient": user_out(patient),
        "range": {"from": iso(since), "to": iso(until), "hours": hours},
        "stats": stats,
        "last": ({"ts": iso(last.ts), "state": last.state, "prob": last.prob, "bpm": last.bpm,
                  "online": until - last.ts <= ONLINE_WINDOW} if last else None),
        "battery": battery,
        "episodes": eps,
        "series": analytics.series(rows),
        "hourly": analytics.hourly(rows, since, until),
        "symptoms": [symptom_out(s) for s in symptoms],
        "ecg": [ecg_meta(e) for e in ecgs],
    }


@app.get("/api/me/report")
def my_report(hours: float = Query(24, gt=0, le=24 * 31), user: User = Depends(require_role("patient")),
              db: Session = Depends(get_db)):
    return patient_report(db, user, hours)


# ---------------------------------------------------------------- doctor dashboard
def patient_row(db: Session, p: User, now: datetime) -> dict:
    rows = load_rows(db, p.id, now - timedelta(hours=24), now)
    last = rows[-1] if rows else None
    s = analytics.summary(rows)
    new_alerts = db.scalar(select(func.count(Alert.id)).where(Alert.patient_id == p.id, Alert.status == "new"))
    return {
        "id": p.id, "name": p.name, "email": p.email, "birth_year": p.birth_year, "sex": p.sex, "phone": p.phone,
        "last_seen": iso(last.ts) if last else None,
        "last_state": last.state if last else None,
        "last_bpm": last.bpm if last else None,
        "online": bool(last and now - last.ts <= ONLINE_WINDOW),
        "alert": any(r.state == STATE_AFIB for r in rows if now - r.ts <= ALERT_WINDOW),
        "new_alerts": new_alerts or 0,
        "af_burden_24h": s["af_burden"],
        "episodes_24h": s["episodes_count"],
        "monitored_minutes_24h": s["monitored_minutes"],
        "hr_mean_24h": s["hr_mean"],
        "spark": [p_["bpm"] for p_ in analytics.series(rows, max_points=48)],
    }


@app.get("/api/patients")
def list_patients(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    now = utcnow()
    out = [patient_row(db, p, now) for p in db.scalars(select(User).where(User.doctor_id == doctor.id))]
    out.sort(key=lambda x: (not x["alert"], -x["new_alerts"], -(x["af_burden_24h"] or 0), x["name"]))
    return out


@app.get("/api/overview")
def overview(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    now = utcnow()
    pats = list(db.scalars(select(User).where(User.doctor_id == doctor.id)))
    rows = [patient_row(db, p, now) for p in pats]
    ids = [p.id for p in pats] or [-1]
    alerts = db.scalars(select(Alert).where(Alert.patient_id.in_(ids)).order_by(Alert.ts.desc()).limit(8))
    names = {p.id: p.name for p in pats}
    day = now - timedelta(hours=24)
    return {
        "patients": len(rows),
        "online": sum(r["online"] for r in rows),
        "in_afib_now": sum(1 for r in rows if r["last_state"] == STATE_AFIB and r["online"]),
        "new_alerts": sum(r["new_alerts"] for r in rows),
        "episodes_24h": sum(r["episodes_24h"] for r in rows),
        "mean_burden_24h": round(sum(r["af_burden_24h"] for r in rows) / len(rows), 4) if rows else 0,
        "symptoms_24h": db.scalar(select(func.count(Symptom.id)).where(Symptom.patient_id.in_(ids), Symptom.ts >= day)),
        "ecg_24h": db.scalar(select(func.count(EcgStrip.id)).where(EcgStrip.patient_id.in_(ids), EcgStrip.ts >= day)),
        "burden": [{"id": r["id"], "name": r["name"], "af_burden_24h": r["af_burden_24h"]} for r in rows],
        "recent_alerts": [alert_out(a, names) for a in alerts],
    }


def alert_out(a: Alert, names: dict[int, str]) -> dict:
    return {"id": a.id, "patient_id": a.patient_id, "patient_name": names.get(a.patient_id), "ts": iso(a.ts),
            "kind": a.kind, "prob": a.prob, "bpm": a.bpm, "status": a.status, "ack_at": iso(a.ack_at)}


@app.get("/api/alerts")
def list_alerts(status: str | None = Query(None, pattern="^(new|ack)$"), limit: int = Query(100, le=500),
                doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    pats = {p.id: p.name for p in db.scalars(select(User).where(User.doctor_id == doctor.id))}
    q = select(Alert).where(Alert.patient_id.in_(list(pats) or [-1]))
    if status:
        q = q.where(Alert.status == status)
    return [alert_out(a, pats) for a in db.scalars(q.order_by(Alert.ts.desc()).limit(limit))]


@app.post("/api/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    own_patient(db, doctor, a.patient_id)
    a.status, a.ack_by, a.ack_at = "ack", doctor.id, utcnow()
    db.commit()
    return {"ok": True}


@app.post("/api/alerts/ack-all")
def ack_all(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    ids = [p.id for p in db.scalars(select(User).where(User.doctor_id == doctor.id))] or [-1]
    n = 0
    for a in db.scalars(select(Alert).where(Alert.patient_id.in_(ids), Alert.status == "new")):
        a.status, a.ack_by, a.ack_at = "ack", doctor.id, utcnow()
        n += 1
    db.commit()
    return {"acknowledged": n}


@app.get("/api/patients/{patient_id}/report")
def doctor_patient_report(patient_id: int, hours: float = Query(24, gt=0, le=24 * 31),
                          doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    p = own_patient(db, doctor, patient_id)
    rep = patient_report(db, p, hours)
    rep["notes"] = notes_of(db, p.id)
    rep["alerts"] = [alert_out(a, {p.id: p.name}) for a in db.scalars(
        select(Alert).where(Alert.patient_id == p.id).order_by(Alert.ts.desc()).limit(20))]
    return rep


def notes_of(db: Session, patient_id: int) -> list[dict]:
    authors = {}
    out = []
    for n in db.scalars(select(Note).where(Note.patient_id == patient_id).order_by(Note.ts.desc())):
        if n.author_id not in authors:
            authors[n.author_id] = db.get(User, n.author_id).name
        out.append({"id": n.id, "ts": iso(n.ts), "text": n.text, "author": authors[n.author_id]})
    return out


@app.post("/api/patients/{patient_id}/notes")
def add_note(patient_id: int, body: NoteIn, doctor: User = Depends(require_role("doctor")),
             db: Session = Depends(get_db)):
    own_patient(db, doctor, patient_id)
    db.add(Note(patient_id=patient_id, author_id=doctor.id, ts=utcnow(), text=body.text.strip()))
    db.commit()
    return notes_of(db, patient_id)


@app.delete("/api/patients/{patient_id}/notes/{note_id}")
def delete_note(patient_id: int, note_id: int, doctor: User = Depends(require_role("doctor")),
                db: Session = Depends(get_db)):
    own_patient(db, doctor, patient_id)
    db.execute(delete(Note).where(Note.id == note_id, Note.patient_id == patient_id, Note.author_id == doctor.id))
    db.commit()
    return notes_of(db, patient_id)


@app.post("/api/patients/{patient_id}/episodes/review")
def review_episode(patient_id: int, body: ReviewIn, doctor: User = Depends(require_role("doctor")),
                   db: Session = Depends(get_db)):
    own_patient(db, doctor, patient_id)
    start = datetime.fromisoformat(body.episode_start.replace("Z", "")).replace(tzinfo=None)
    db.execute(delete(EpisodeReview).where(EpisodeReview.patient_id == patient_id,
                                           EpisodeReview.episode_start == start))
    if body.verdict != "clear":
        db.add(EpisodeReview(patient_id=patient_id, episode_start=start, verdict=body.verdict,
                             reviewer_id=doctor.id, ts=utcnow()))
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- live events (Server-Sent Events)
@app.get("/api/stream")
async def stream(request: Request, token: str):
    db = SessionLocal()
    try:
        user = user_from_token(token, db)
    finally:
        db.close()
    if user.role != "doctor":
        raise HTTPException(403, "Only for doctors")
    q = broker.subscribe(user.id)

    async def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while not await request.is_disconnected():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            broker.unsubscribe(user.id, q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    return {"ok": True, "version": app.version, "users": db.scalar(select(func.count(User.id))),
            "readings": db.scalar(select(func.count(Reading.id)))}


# ---------------------------------------------------------------- web (built React app)
WEB_DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        f = WEB_DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(WEB_DIST / "index.html")
