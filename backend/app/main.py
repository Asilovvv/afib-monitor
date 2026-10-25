"""AFib Monitor backend v2: REST API + live events for the mobile app (patients) and the web dashboard (doctors)."""
import asyncio
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text, delete, func, select
from sqlalchemy.orm import Session

from . import analytics, ecgtools, ectopy, risk, telegram
from .auth import (check_password, current_user, hash_password, make_token, new_invite_code,
                   require_role, user_from_token)
from .db import Base, SessionLocal, engine, get_db
from .events import broker
from . import activity
from .models import (DAY_TAGS, STATE_AFIB, STATE_NORMAL, SYMPTOMS, CheckPlan, DayTag, MedDose, Medication, AccessLog, Alert, AlertAck, Consent, EcgStrip, EpisodeReview, ExportToken, Note,
                     Feedback, Reading, RiskProfile, Symptom, TelegramCode, TelegramLink, TelegramMessage, User, VITAL_KINDS, Vital, FamilyInvite, FamilyLink, StripSeen)

Base.metadata.create_all(engine)

_DEMO = os.getenv("SEED_DEMO") == "1"      # demo doctor + patients (idempotent); seeded after the port is open

app = FastAPI(title="AFib Monitor API", version="2.1",
              description="Readings, alerts, ECG strips and symptoms from the ESP32-S3 AFib monitor.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def _track_activity(request: Request, call_next):
    """Remember when a person last used the API (not Render's health pings): the demo simulator pauses when
    nobody is looking, so a free serverless database (Neon) can sleep instead of burning its monthly hours."""
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        activity.touch()
    return await call_next(request)

ALERT_WINDOW = timedelta(minutes=10)
CONSENT_KINDS = ("terms", "data", "research")
# "research": AF detection, alerts, Telegram (pilot under a research protocol) · "wellness": no rhythm verdicts,
# no AF alerts — the version that can ship before the AF function is registered as a medical device.
PRODUCT_MODE = os.getenv("PRODUCT_MODE", "research").strip().lower()
if PRODUCT_MODE not in ("research", "wellness"):
    PRODUCT_MODE = "research"
CONSENT_VERSION = "2026-10b"         # bump when the privacy policy / terms text changes (b: who sees AF estimates)


def log_access(db: Session, patient_id: int, actor: User, action: str):
    db.add(AccessLog(patient_id=patient_id, actor_id=actor.id, action=action, ts=utcnow()))
    db.commit()
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
        asyncio.get_running_loop().create_task(run_forever(ingest, seed=_DEMO))
    elif _DEMO:
        from .seed import run as _seed_demo
        asyncio.get_running_loop().run_in_executor(None, _seed_demo)
    asyncio.get_running_loop().create_task(telegram._guard(telegram.start()))
    asyncio.get_running_loop().create_task(telegram.family_nudges())


# ---------------------------------------------------------------- schemas
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=200)
    role: str = Field(pattern="^(patient|doctor|family)$")
    doctor_code: str | None = None
    family_code: str | None = None          # role "family": the code the patient gave
    birth_year: int | None = Field(default=None, ge=1900, le=2030)
    sex: str | None = Field(default=None, pattern="^(m|f)$")
    clinic: str | None = Field(default=None, max_length=200)
    specialty: str | None = Field(default=None, max_length=100)
    consents: list[str] = Field(default_factory=list, description="terms, data, research")


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


class VitalIn(BaseModel):
    """Home-device value typed by the patient. Limits are physiological plausibility, not clinical thresholds."""
    ts: float | None = None
    kind: str = Field(pattern="^(bp|glucose|weight)$")
    systolic: int | None = Field(default=None, ge=60, le=260)
    diastolic: int | None = Field(default=None, ge=30, le=160)
    pulse: int | None = Field(default=None, ge=20, le=250)
    value: float | None = None
    source: str = Field(default="manual", pattern="^(manual|photo)$")
    note: str | None = Field(default=None, max_length=200)

    @field_validator("value")
    @classmethod
    def plausible(cls, v, info):
        k = info.data.get("kind")
        if k == "glucose" and v is not None and not 1 <= v <= 40:
            raise ValueError("glucose must be 1-40 mmol/L")
        if k == "weight" and v is not None and not 20 <= v <= 300:
            raise ValueError("weight must be 20-300 kg")
        return v

    def check(self):
        if self.kind == "bp":
            if self.systolic is None or self.diastolic is None:
                raise HTTPException(422, "blood pressure needs systolic and diastolic")
            if self.systolic <= self.diastolic:
                raise HTTPException(422, "systolic must be above diastolic")
        elif self.value is None:
            raise HTTPException(422, f"{self.kind} needs a value")


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
    reason: str = Field(default="manual", pattern="^(afib_onset|manual|symptom|check)$")


class MedIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    dose: str | None = Field(default=None, max_length=50)
    times: list[str] = Field(min_length=1, max_length=8)
    anticoagulant: bool = False

    @field_validator("times")
    @classmethod
    def hhmm(cls, v: list[str]) -> list[str]:
        import re
        for t in v:
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t):
                raise ValueError(f"bad time: {t}")
        return sorted(set(v))


class CheckPlanIn(BaseModel):
    times: list[str] = Field(default_factory=list, max_length=6)    # empty = no plan
    active: bool = True

    @field_validator("times")
    @classmethod
    def hhmm(cls, v: list[str]) -> list[str]:
        return MedIn.hhmm(v) if v else []


class DoseIn(BaseModel):
    slot: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
    status: str = Field(pattern="^(taken|skipped)$")


class DayIn(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$", description="patient's local date")
    tags: list[str] = Field(default_factory=list, max_length=len(DAY_TAGS))

    @field_validator("tags")
    @classmethod
    def known(cls, v: list[str]) -> list[str]:
        bad = [k for k in v if k not in DAY_TAGS]
        if bad:
            raise ValueError(f"unknown factors: {bad}")
        return sorted(set(v))


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class ReviewIn(BaseModel):
    episode_start: str
    verdict: str = Field(pattern="^(confirmed|false_alarm|clear)$")


def patient_mode(db: Session, u: User) -> str:
    """What this patient may see. AF verdicts, episodes and AF alerts ("research") are shown only to pilot participants:
    research consent given and not withdrawn, and linked to a doctor. Everyone else gets "wellness" (rhythm check
    without a diagnosis), because the AF function is not registered as a medical device. The public demo accounts
    (@demo.kg) keep "research" so the demonstration shows the whole system."""
    if PRODUCT_MODE != "research" or u.role != "patient":
        return PRODUCT_MODE if u.role == "patient" else "research"
    if u.email.endswith("@demo.kg"):
        return "research"
    if not u.doctor_id:
        return "wellness"
    # consent must be to the current text: older consents only covered data use, not seeing AF estimates
    ok = db.scalar(select(Consent.id).where(Consent.user_id == u.id, Consent.kind == "research",
                                            Consent.version == CONSENT_VERSION, Consent.withdrawn_at.is_(None)).limit(1))
    return "research" if ok else "wellness"


def user_out(u: User, db: Session | None = None) -> dict:
    d = {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "birth_year": u.birth_year,
         "sex": u.sex, "phone": u.phone}
    if db is not None and u.role == "patient":
        d["mode"] = patient_mode(db, u)
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
        demo_guard(doc, u.email)
        u.doctor_id = doc.id
    db.add(u)
    db.commit()
    if body.role == "family" and body.family_code:
        use_family_code(db, u, body.family_code)
    for k in set(body.consents) & set(CONSENT_KINDS):
        db.add(Consent(user_id=u.id, kind=k, version=CONSENT_VERSION, ts=utcnow()))
    db.commit()
    return {"token": make_token(u), "user": user_out(u, db)}


LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_MAX_FAILS = {"e": 10, "ip": 50}      # per account; per address (a clinic may share one address)
_login_fails: dict[str, list[datetime]] = {}


def _too_many(key: str) -> bool:
    now = utcnow()
    recent = [t for t in _login_fails.get(key, []) if now - t < LOGIN_WINDOW]
    _login_fails[key] = recent
    return len(recent) >= LOGIN_MAX_FAILS[key.split(":", 1)[0]]


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    # 10 wrong passwords for one account (50 from one address) in 15 minutes -> wait (password guessing)
    keys = ["e:" + body.email.lower(), "ip:" + (request.client.host if request.client else "?")]
    if any(_too_many(k) for k in keys):
        raise HTTPException(429, "Too many attempts, try again in 15 minutes")
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    if not u or not check_password(body.password, u.password_hash):
        for k in keys:
            _login_fails.setdefault(k, []).append(utcnow())
        raise HTTPException(401, "Wrong email or password")
    _login_fails.pop(keys[0], None)
    return {"token": make_token(u), "user": user_out(u, db)}


DEMO_DOCTOR_EMAIL = "doctor@demo.kg"


def demo_guard(doc: User, patient_email: str):
    """The demo doctor's password is public, so a real patient must not be linked to that account."""
    if doc.email == DEMO_DOCTOR_EMAIL and not patient_email.lower().endswith("@demo.kg"):
        raise HTTPException(400, "The demo doctor code is for viewing only. Ask your own doctor for a code.")


@app.get("/api/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(user, db)


@app.put("/api/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("clinic", "specialty") and user.role != "doctor":
            continue
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user_out(user, db)


@app.put("/api/me/doctor")
def link_doctor(body: LinkDoctorIn, user: User = Depends(require_role("patient")),
                db: Session = Depends(get_db)):
    doc = db.scalar(select(User).where(User.invite_code == body.doctor_code))
    if not doc:
        raise HTTPException(404, "Doctor code not found")
    demo_guard(doc, user.email)
    user = db.merge(user)
    user.doctor_id = doc.id
    db.commit()
    db.refresh(user)
    broker.publish(doc.id, "patients", {"patient_id": user.id})
    return user_out(user, db)


@app.post("/api/me/invite")
def regenerate_invite(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    doctor = db.merge(doctor)
    doctor.invite_code = new_invite_code()
    db.commit()
    return {"invite_code": doctor.invite_code}


# ---------------------------------------------------------------- family (relatives who watch)
FAMILY_CODE_TTL = timedelta(days=7)


def use_family_code(db: Session, watcher: User, code: str) -> FamilyLink:
    inv = db.get(FamilyInvite, code.strip().upper())
    if not inv or inv.used_at or utcnow() - inv.created_at > FAMILY_CODE_TTL:
        raise HTTPException(404, "Family code not found or expired")
    if inv.patient_id == watcher.id:
        raise HTTPException(400, "This is your own code")
    link = db.scalar(select(FamilyLink).where(FamilyLink.patient_id == inv.patient_id, FamilyLink.watcher_id == watcher.id,
                                              FamilyLink.revoked_at.is_(None)))
    if not link:
        link = FamilyLink(patient_id=inv.patient_id, watcher_id=watcher.id, created_at=utcnow())
        db.add(link)
    inv.used_at = utcnow()
    db.commit()
    log_access(db, inv.patient_id, watcher, "family_link")
    return link


def family_watchers(db: Session, patient_id: int) -> list[FamilyLink]:
    return list(db.scalars(select(FamilyLink).where(FamilyLink.patient_id == patient_id, FamilyLink.revoked_at.is_(None))))


def family_card(db: Session, p: User, now: datetime) -> dict:
    """What a relative may see: plain words only, nothing from the doctor's view."""
    day0 = datetime.combine((now + timedelta(hours=TZ_HOURS)).date(), datetime.min.time()) - timedelta(hours=TZ_HOURS)
    ck = checks_summary(db, p.id, day0, now)
    last = ck["last"][0] if ck["last"] else None
    bp = db.scalar(select(Vital).where(Vital.patient_id == p.id, Vital.kind == "bp").order_by(Vital.ts.desc()).limit(1))
    today = (now + timedelta(hours=TZ_HOURS)).date().isoformat()
    meds = list(db.scalars(select(Medication).where(Medication.patient_id == p.id, Medication.active.is_(True))))
    slots = [(m.id, f"{today}T{t}") for m in meds for t in m.times.split(",")]
    taken = {(d.medication_id, d.slot) for d in db.scalars(select(MedDose).where(MedDose.patient_id == p.id, MedDose.slot >= today,
                                                                                  MedDose.status == "taken"))}
    local_now = f"{today}T{(now + timedelta(hours=TZ_HOURS)):%H:%M}"
    due_so_far = [sl for sl in slots if sl[1] <= local_now]
    last_seen = db.scalar(select(Reading.ts).where(Reading.patient_id == p.id).order_by(Reading.ts.desc()).limit(1))
    return {
        "id": p.id, "name": p.name,
        "checks_today": {"done": ck["done"], "due": ck["due"], "checks": ck["checks"], "plan": bool(ck["plan"] and ck["plan"]["active"]),
                         "last": last},                        # last = {"ts", "verdict"}: regular / irregular / no_verdict
        "bp": ({"systolic": bp.systolic, "diastolic": bp.diastolic, "ts": iso(bp.ts)} if bp else None),
        "meds_today": {"due": len(due_so_far), "taken": sum(1 for sl in due_so_far if sl in taken), "total": len(slots)},
        "last_seen": iso(last_seen) if last_seen else None,
    }


@app.post("/api/me/family/invite")
def family_invite(user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    import secrets
    db.execute(delete(FamilyInvite).where(FamilyInvite.created_at < utcnow() - FAMILY_CODE_TTL))
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"     # no 0/O/1/I: it is read out over the phone
    code = "".join(secrets.choice(alphabet) for _ in range(6))
    db.add(FamilyInvite(code=code, patient_id=user.id, created_at=utcnow()))
    db.commit()
    return {"code": code, "expires_days": 7}


@app.get("/api/me/family")
def my_family(user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    out = []
    for l in family_watchers(db, user.id):
        w = db.get(User, l.watcher_id)
        out.append({"id": l.id, "name": w.name if w else "?", "email": w.email if w else None, "since": iso(l.created_at)})
    return out


@app.delete("/api/me/family/{link_id}")
def revoke_family(link_id: int, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    l = db.get(FamilyLink, link_id)
    if not l or l.patient_id != user.id:
        raise HTTPException(404, "Not found")
    l.revoked_at = utcnow()
    db.commit()
    return {"revoked": True}


class FamilyCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


@app.post("/api/family/link")
def family_link(body: FamilyCodeIn, user: User = Depends(require_role("family")), db: Session = Depends(get_db)):
    use_family_code(db, user, body.code)
    return family_patients(user, db)


@app.get("/api/family/patients")
def family_patients(user: User = Depends(require_role("family")), db: Session = Depends(get_db)):
    now = utcnow()
    out = []
    for l in db.scalars(select(FamilyLink).where(FamilyLink.watcher_id == user.id, FamilyLink.revoked_at.is_(None))):
        p = db.get(User, l.patient_id)
        if p:
            log_access(db, p.id, user, "family_view")
            out.append(family_card(db, p, now))
    return out


@app.delete("/api/family/patients/{patient_id}")
def family_leave(patient_id: int, user: User = Depends(require_role("family")), db: Session = Depends(get_db)):
    for l in db.scalars(select(FamilyLink).where(FamilyLink.watcher_id == user.id, FamilyLink.patient_id == patient_id,
                                                 FamilyLink.revoked_at.is_(None))):
        l.revoked_at = utcnow()
    db.commit()
    return {"left": True}


# ---------------------------------------------------------------- doctor: "seen" on check strips, morning queue
class SeenIn(BaseModel):
    action: str = Field(default="seen", pattern="^(seen|call)$")


@app.get("/api/checks/queue")
def checks_queue(hours: float = Query(24, gt=0, le=24 * 14), doctor: User = Depends(require_role("doctor")),
                 db: Session = Depends(get_db)):
    """30-s checks of my patients in the last N hours that came out "irregular" and nobody has marked yet,
    newest first. One screen to clear in the morning."""
    pats = {p.id: p.name for p in db.scalars(select(User).where(User.doctor_id == doctor.id))}
    since = utcnow() - timedelta(hours=hours)
    strips = list(db.scalars(select(EcgStrip).where(EcgStrip.patient_id.in_(list(pats) or [-1]), EcgStrip.reason == "check",
                                                    EcgStrip.ts >= since).order_by(EcgStrip.ts.desc())))
    seen = {x.ecg_id: x for x in db.scalars(select(StripSeen).where(StripSeen.ecg_id.in_([e.id for e in strips] or [-1])))}
    out = []
    for e, (ts, v) in zip(strips, check_verdicts(strips)):
        if v != "irregular":
            continue
        sx = seen.get(e.id)
        out.append({"id": e.id, "patient_id": e.patient_id, "patient_name": pats.get(e.patient_id), "ts": iso(e.ts),
                    "bpm": e.bpm, "verdict": v, "seen": ({"action": sx.action, "ts": iso(sx.ts)} if sx else None)})
    return {"items": out, "open": sum(1 for x in out if not x["seen"])}


@app.post("/api/ecg/{ecg_id}/seen")
def mark_seen(ecg_id: int, body: SeenIn, doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    e = db.get(EcgStrip, ecg_id)
    if not e:
        raise HTTPException(404, "ECG not found")
    p = own_patient(db, doctor, e.patient_id)
    x = db.scalar(select(StripSeen).where(StripSeen.ecg_id == ecg_id))
    if x:
        x.action, x.ts, x.doctor_id = body.action, utcnow(), doctor.id
    else:
        x = StripSeen(ecg_id=ecg_id, patient_id=p.id, doctor_id=doctor.id, action=body.action, ts=utcnow())
        db.add(x)
    db.commit()
    log_access(db, p.id, doctor, "seen_" + body.action)
    telegram.notify_patient_seen(p.id, doctor.name, body.action, e.ts)
    return {"id": ecg_id, "seen": {"action": x.action, "ts": iso(x.ts)}}


@app.get("/api/me/seen")
def my_seen(days: int = Query(7, ge=1, le=60), user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    """For the patient's app: which of my check strips a doctor looked at (last N days), newest first."""
    since = utcnow() - timedelta(days=days)
    rows = db.execute(select(StripSeen, EcgStrip.ts, User.name).join(EcgStrip, EcgStrip.id == StripSeen.ecg_id)
                      .join(User, User.id == StripSeen.doctor_id)
                      .where(StripSeen.patient_id == user.id, StripSeen.ts >= since).order_by(StripSeen.ts.desc())).all()
    return [{"id": x.id, "ecg_id": x.ecg_id, "action": x.action, "ts": iso(x.ts), "strip_ts": iso(sts), "doctor": name}
            for x, sts, name in rows]


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
    mode = patient_mode(db, user)          # AF alerts only for pilot participants
    for r in items:
        ts = from_unix(r.ts)
        rows.append(Reading(patient_id=user.id, ts=ts, state=r.state, prob=r.prob, bpm=r.bpm, battery=r.battery))
        if r.state == STATE_AFIB and prev != STATE_AFIB and mode == "research":
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
        telegram.notify_alert(a.id)
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


TZ_HOURS = float(os.getenv("TZ_OFFSET_HOURS", "6"))     # Asia/Bishkek


def vital_out(v: Vital) -> dict:
    return {"id": v.id, "ts": iso(v.ts), "kind": v.kind, "systolic": v.systolic, "diastolic": v.diastolic,
            "pulse": v.pulse, "value": v.value, "source": v.source, "note": v.note}


def vitals_summary(db: Session, patient_id: int, since: datetime, until: datetime) -> dict:
    """Typed-in home values for the report: blood pressure stats, latest glucose and weight, the series."""
    rows = list(db.scalars(select(Vital).where(Vital.patient_id == patient_id, Vital.ts >= since, Vital.ts <= until)
                           .order_by(Vital.ts)))
    bp = [v for v in rows if v.kind == "bp"]
    out = {"bp": None, "glucose": None, "weight": None, "items": [vital_out(v) for v in rows]}
    if bp:
        sy, di = [v.systolic for v in bp], [v.diastolic for v in bp]
        out["bp"] = {"n": len(bp), "sys_mean": round(sum(sy) / len(sy)), "dia_mean": round(sum(di) / len(di)),
                     "sys_max": max(sy), "dia_max": max(di), "sys_min": min(sy), "dia_min": min(di),
                     "last": vital_out(bp[-1])}
    for k in ("glucose", "weight"):
        xs = [v for v in rows if v.kind == k]
        if xs:
            vals = [v.value for v in xs]
            out[k] = {"n": len(xs), "mean": round(sum(vals) / len(vals), 1), "min": min(vals), "max": max(vals),
                      "last": vital_out(xs[-1])}
    return out


@app.post("/api/me/vitals")
def add_vital(body: VitalIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    body.check()
    v = Vital(patient_id=user.id, ts=from_unix(body.ts) if body.ts else utcnow(), kind=body.kind,
              systolic=body.systolic, diastolic=body.diastolic, pulse=body.pulse, value=body.value,
              source=body.source, note=body.note)
    db.add(v)
    db.commit()
    broker.publish(user.doctor_id, "vital", {"patient_id": user.id, "patient_name": user.name, "id": v.id, "kind": v.kind})
    return vital_out(v)


@app.get("/api/me/vitals")
def my_vitals(days: int = Query(14, ge=1, le=366), user: User = Depends(require_role("patient")),
              db: Session = Depends(get_db)):
    now = utcnow()
    return vitals_summary(db, user.id, now - timedelta(days=days), now)


@app.delete("/api/me/vitals/{vital_id}")
def delete_vital(vital_id: int, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    v = db.get(Vital, vital_id)
    if not v or v.patient_id != user.id:
        raise HTTPException(404, "Not found")
    db.delete(v)
    db.commit()
    return {"deleted": True}


@app.post("/api/me/day")
def set_day(body: DayIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    d = db.scalar(select(DayTag).where(DayTag.patient_id == user.id, DayTag.day == body.day))
    if not d:
        d = DayTag(patient_id=user.id, day=body.day)
        db.add(d)
    d.tags = ",".join(body.tags)
    db.commit()
    return {"day": d.day, "tags": body.tags}


@app.get("/api/me/days")
def my_days(days: int = Query(31, ge=1, le=366), user: User = Depends(require_role("patient")),
            db: Session = Depends(get_db)):
    since = (utcnow() + timedelta(hours=TZ_HOURS) - timedelta(days=days)).date().isoformat()
    return [{"day": d.day, "tags": [t for t in d.tags.split(",") if t]} for d in db.scalars(
        select(DayTag).where(DayTag.patient_id == user.id, DayTag.day >= since).order_by(DayTag.day.desc()))]


def med_out(m: Medication) -> dict:
    return {"id": m.id, "name": m.name, "dose": m.dose, "times": m.times.split(","), "anticoagulant": m.anticoagulant,
            "active": m.active, "created_at": iso(m.created_at)}


def meds_adherence(db: Session, patient_id: int, since: datetime, until: datetime) -> list[dict]:
    meds = list(db.scalars(select(Medication).where(Medication.patient_id == patient_id, Medication.created_at <= until,
                                                    (Medication.ended_at.is_(None)) | (Medication.ended_at >= since))))
    if not meds:
        return []
    a = (since + timedelta(hours=TZ_HOURS)).strftime("%Y-%m-%dT%H:%M")
    answers = {(d.medication_id, d.slot): d.status for d in db.scalars(
        select(MedDose).where(MedDose.patient_id == patient_id, MedDose.slot >= a))}
    return analytics.adherence([{"id": m.id, "name": m.name, "dose": m.dose, "anticoagulant": m.anticoagulant,
                                 "times": m.times.split(","), "created_at": m.created_at, "ended_at": m.ended_at}
                                for m in meds], answers, since, until, TZ_HOURS)


# ---------------------------------------------------------------- 30-s check plan ("control" mode)
_CHECK_CACHE: dict[int, str] = {}      # strip id -> verdict (strips never change after upload)


def check_verdicts(strips: list[EcgStrip]) -> list[tuple[datetime, str]]:
    out = []
    for e in strips:
        if e.id not in _CHECK_CACHE:
            _CHECK_CACHE[e.id] = ecgtools.check(json.loads(e.samples), e.fs)["verdict"]
        out.append((e.ts, _CHECK_CACHE[e.id]))
    return out


def plan_out(p: CheckPlan | None) -> dict | None:
    return {"times": p.times.split(",") if p.times else [], "active": p.active, "set_by": p.set_by,
            "updated_at": iso(p.updated_at)} if p else None


def set_plan(db: Session, patient_id: int, body: CheckPlanIn, role: str) -> dict:
    p = db.scalar(select(CheckPlan).where(CheckPlan.patient_id == patient_id))
    if not p:
        p = CheckPlan(patient_id=patient_id)
        db.add(p)
    p.times, p.active, p.set_by, p.updated_at = ",".join(body.times), body.active and bool(body.times), role, utcnow()
    db.commit()
    return plan_out(p)


def checks_summary(db: Session, patient_id: int, since: datetime, until: datetime) -> dict:
    p = db.scalar(select(CheckPlan).where(CheckPlan.patient_id == patient_id))
    strips = list(db.scalars(select(EcgStrip).where(EcgStrip.patient_id == patient_id, EcgStrip.reason == "check",
                                                    EcgStrip.ts >= since, EcgStrip.ts <= until).order_by(EcgStrip.ts)))
    checks = check_verdicts(strips)
    times = p.times.split(",") if p and p.active and p.times else []
    s = analytics.check_adherence(times, max(since, p.updated_at) if p else until, until, checks, TZ_HOURS)
    return {"plan": plan_out(p), **s, "last": [{"ts": iso(t), "verdict": v} for t, v in checks[-6:][::-1]]}


@app.get("/api/me/checkplan")
def my_checkplan(user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    return plan_out(db.scalar(select(CheckPlan).where(CheckPlan.patient_id == user.id)))


@app.put("/api/me/checkplan")
def put_my_checkplan(body: CheckPlanIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    return set_plan(db, user.id, body, "patient")


@app.put("/api/patients/{patient_id}/checkplan")
def put_patient_checkplan(patient_id: int, body: CheckPlanIn, doctor: User = Depends(require_role("doctor")),
                          db: Session = Depends(get_db)):
    p = own_patient(db, doctor, patient_id)
    log_access(db, p.id, doctor, "checkplan")
    return set_plan(db, p.id, body, "doctor")


@app.get("/api/me/meds")
def my_meds(user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    """Active medicines and today's doses with the patient's answers (local day)."""
    now = utcnow()
    today = (now + timedelta(hours=TZ_HOURS)).date().isoformat()
    meds = list(db.scalars(select(Medication).where(Medication.patient_id == user.id, Medication.active.is_(True))
                           .order_by(Medication.id)))
    answers = {(d.medication_id, d.slot): d.status for d in db.scalars(
        select(MedDose).where(MedDose.patient_id == user.id, MedDose.slot >= today))}
    doses = [{"medication_id": m.id, "name": m.name, "dose": m.dose, "anticoagulant": m.anticoagulant,
              "slot": f"{today}T{t}", "status": answers.get((m.id, f"{today}T{t}"))}
             for m in meds for t in m.times.split(",")]
    return {"meds": [med_out(m) for m in meds], "today": sorted(doses, key=lambda d: d["slot"])}


@app.post("/api/me/meds")
def add_med(body: MedIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    m = Medication(patient_id=user.id, name=body.name.strip(), dose=(body.dose or "").strip() or None,
                   times=",".join(body.times), anticoagulant=body.anticoagulant, created_at=utcnow())
    db.add(m)
    db.commit()
    return med_out(m)


def own_med(db: Session, user: User, med_id: int) -> Medication:
    m = db.get(Medication, med_id)
    if not m or m.patient_id != user.id:
        raise HTTPException(404, "Medication not found")
    return m


@app.put("/api/me/meds/{med_id}")
def edit_med(med_id: int, body: MedIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    """A changed schedule is stored as a new medicine from now on, so past adherence keeps its old schedule."""
    old = own_med(db, user, med_id)
    old.active, old.ended_at = False, utcnow()
    db.flush()
    return add_med(body, user, db)


@app.delete("/api/me/meds/{med_id}")
def stop_med(med_id: int, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    m = own_med(db, user, med_id)
    m.active, m.ended_at = False, utcnow()
    db.commit()
    return {"ok": True}


@app.post("/api/me/meds/{med_id}/dose")
def answer_dose(med_id: int, body: DoseIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    m = own_med(db, user, med_id)
    d = db.scalar(select(MedDose).where(MedDose.medication_id == m.id, MedDose.slot == body.slot))
    if not d:
        d = MedDose(patient_id=user.id, medication_id=m.id, slot=body.slot)
        db.add(d)
    d.status, d.ts = body.status, utcnow()
    db.commit()
    return {"medication_id": m.id, "slot": d.slot, "status": d.status}


def diary_of(db: Session, patient_id: int, since: datetime, until: datetime) -> dict[str, set[str]]:
    a = (since + timedelta(hours=TZ_HOURS) - timedelta(days=1)).date().isoformat()
    b = (until + timedelta(hours=TZ_HOURS)).date().isoformat()
    return {d.day: {t for t in d.tags.split(",") if t} for d in db.scalars(
        select(DayTag).where(DayTag.patient_id == patient_id, DayTag.day >= a, DayTag.day <= b))}


@app.post("/api/ecg")
def add_ecg(body: EcgIn, user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    e = EcgStrip(patient_id=user.id, ts=from_unix(body.ts), fs=body.fs,
                 samples=json.dumps([round(x, 4) for x in body.samples]),
                 state=body.state, prob=body.prob, bpm=body.bpm, reason=body.reason)
    db.add(e)
    db.commit()
    broker.publish(user.doctor_id, "ecg", {"patient_id": user.id, "patient_name": user.name, "id": e.id,
                                           "reason": e.reason})
    telegram.notify_ecg(e.id)
    out = ecg_meta(e)
    if body.reason == "check":                   # "check me in 30 s": wellness verdict, see ml/CHECK30_CINC2017.md
        out["check"] = ecgtools.check(body.samples, body.fs)
        telegram.notify_family_check(user.id, out["check"]["verdict"])
    return out


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
    if user.id != p.id:
        log_access(db, p.id, user, "ecg")
    x = json.loads(e.samples)
    a = ecgtools.analyze(x, e.fs)
    out = {**ecg_meta(e), "samples": x, **a}
    # research estimate of early ventricular beats, for the doctor only (a PVC count is a medical-device claim)
    if user.role == "doctor" and PRODUCT_MODE == "research" and a["quality"]["sqi"] >= 0.4:
        out["pvc_estimate"] = ectopy.count_pvc(x, a["r_peaks"], e.fs)
    return out


def strips_poincare(strips: list[EcgStrip]) -> dict:
    """Poincaré points from the recorded ECG strips of the period, split by the rhythm the device reported."""
    out = {"af": [], "normal": []}
    q = []
    for e in strips[:60]:
        a = ecgtools.analyze(json.loads(e.samples), e.fs)
        key = "af" if e.state == STATE_AFIB else "normal"
        out[key] += a["poincare"]["points"]
        q.append(a["quality"]["sqi"])
    for key in ("af", "normal"):
        st = ecgtools.poincare_points(out[key])
        st.pop("points")
        out[key + "_stats"] = st
    out["strips"] = min(len(strips), 60)
    out["mean_sqi"] = round(sum(q) / len(q), 2) if q else None
    return out


_PVC_CACHE: dict[int, dict | None] = {}     # strip id -> estimate (strips never change after upload)
PVC_MAX_STRIPS = 200


def strips_pvc(strips: list[EcgStrip]) -> dict | None:
    """Research estimate of early ventricular beats over the ECG strips of the period (doctor only, research mode).
    Strips are recorded at events or on request, not continuously, so this is not a Holter PVC burden."""
    if not ectopy.load_model():
        return None
    used, low, beats, pvc, worst = 0, 0, 0, 0, None
    for e in strips[:PVC_MAX_STRIPS]:
        if e.id not in _PVC_CACHE:
            x = json.loads(e.samples)
            a = ecgtools.analyze(x, e.fs)
            _PVC_CACHE[e.id] = ectopy.count_pvc(x, a["r_peaks"], e.fs) if a["quality"]["sqi"] >= 0.4 else None
        est = _PVC_CACHE[e.id]
        if not est or not est["beats"]:
            low += 1
            continue
        used += 1
        beats += est["beats"]
        pvc += est["pvc"]
        if est["pvc"] and (worst is None or est["pvc"] / est["beats"] > worst["pvc"] / worst["beats"]):
            worst = {"ecg_id": e.id, "ts": iso(e.ts), "beats": est["beats"], "pvc": est["pvc"]}
    return {"strips": used, "skipped": low, "beats": beats, "pvc": pvc,
            "share": round(pvc / beats, 4) if beats else None, "worst": worst}


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
        "patient": user_out(patient, db),
        "range": {"from": iso(since), "to": iso(until), "hours": hours},
        "stats": stats,
        "last": ({"ts": iso(last.ts), "state": last.state, "prob": last.prob, "bpm": last.bpm,
                  "online": until - last.ts <= ONLINE_WINDOW} if last else None),
        "battery": battery,
        "episodes": eps,
        "hr_events": [{**e, "start": iso(e["start"]), "end": iso(e["end"])} for e in analytics.hr_events(rows)],
        "medications": meds_adherence(db, patient.id, since, until),
        "checks": checks_summary(db, patient.id, since, until),
        "vitals": vitals_summary(db, patient.id, since, until),
        "triggers": analytics.triggers(rows, diary_of(db, patient.id, since, until), DAY_TAGS, TZ_HOURS),
        "series": analytics.series(rows),
        "hourly": analytics.hourly(rows, since, until),
        "symptoms": [symptom_out(s) for s in symptoms],
        "ecg": [ecg_meta(e) for e in ecgs],
        "poincare": strips_poincare(ecgs),
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
    day0 = datetime.combine((now + timedelta(hours=TZ_HOURS)).date(), datetime.min.time()) - timedelta(hours=TZ_HOURS)
    ck = checks_summary(db, p.id, day0, now)                      # control mode: today's planned 30-s checks
    return {
        "mode": patient_mode(db, p),
        "checks_today": {"due": ck["due"], "done": ck["done"], "checks": ck["checks"], "irregular": ck["irregular"],
                         "confirmed_irregular": ck["confirmed_irregular"], "plan": bool(ck["plan"] and ck["plan"]["active"]),
                         "last": ck["last"][0] if ck["last"] else None},
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
    telegram.record_ack(db, a, doctor.name, "doctor", None, doctor.id)
    telegram.notify_ack(a.id)
    return {"ok": True}


@app.post("/api/alerts/ack-all")
def ack_all(doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    ids = [p.id for p in db.scalars(select(User).where(User.doctor_id == doctor.id))] or [-1]
    n = 0
    for a in list(db.scalars(select(Alert).where(Alert.patient_id.in_(ids), Alert.status == "new"))):
        telegram.record_ack(db, a, doctor.name, "doctor", None, doctor.id)
        telegram.notify_ack(a.id)
        n += 1
    return {"acknowledged": n}


@app.get("/api/patients/{patient_id}/report")
def doctor_patient_report(patient_id: int, hours: float = Query(24, gt=0, le=24 * 31),
                          doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    p = own_patient(db, doctor, patient_id)
    log_access(db, p.id, doctor, "report")
    rep = patient_report(db, p, hours)
    if PRODUCT_MODE == "research":           # PVC count = medical-device claim: research estimate, doctor only
        rep["pvc"] = strips_pvc(list(db.scalars(select(EcgStrip).where(EcgStrip.patient_id == p.id,
                                                                     EcgStrip.ts >= utcnow() - timedelta(hours=hours))
                                              .order_by(EcgStrip.ts.desc()))))
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


# ---------------------------------------------------------------- privacy: consents, access log, export, deletion
class ConsentIn(BaseModel):
    kind: str = Field(pattern="^(terms|data|research)$")
    given: bool = True


class DeleteIn(BaseModel):
    password: str


def consents_of(db: Session, u: User) -> list[dict]:
    return [{"kind": c.kind, "version": c.version, "ts": iso(c.ts), "withdrawn_at": iso(c.withdrawn_at)}
            for c in db.scalars(select(Consent).where(Consent.user_id == u.id).order_by(Consent.ts))]


@app.get("/api/me/consents")
def my_consents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"version": CONSENT_VERSION, "consents": consents_of(db, user)}


@app.post("/api/me/consents")
def set_consent(body: ConsentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.given:
        db.add(Consent(user_id=user.id, kind=body.kind, version=CONSENT_VERSION, ts=utcnow()))
    else:
        for c in db.scalars(select(Consent).where(Consent.user_id == user.id, Consent.kind == body.kind,
                                                  Consent.withdrawn_at.is_(None))):
            c.withdrawn_at = utcnow()
    db.commit()
    return {"version": CONSENT_VERSION, "consents": consents_of(db, user)}


@app.get("/api/me/access-log")
def my_access_log(limit: int = Query(100, le=500), user: User = Depends(require_role("patient")),
                  db: Session = Depends(get_db)):
    names: dict[int, str] = {}
    out = []
    for a in db.scalars(select(AccessLog).where(AccessLog.patient_id == user.id).order_by(AccessLog.ts.desc()).limit(limit)):
        if a.actor_id not in names:
            actor = db.get(User, a.actor_id)
            names[a.actor_id] = actor.name if actor else "—"
        out.append({"ts": iso(a.ts), "who": names[a.actor_id], "action": a.action})
    return out


def export_data(db: Session, u: User) -> dict:
    q = lambda m, col: db.scalars(select(m).where(col == u.id))
    return {
        "exported_at": iso(utcnow()), "format": "afib-monitor-export/1",
        "profile": user_out(u), "consents": consents_of(db, u),
        "readings": [[iso(r.ts), r.state, r.prob, r.bpm, r.battery] for r in q(Reading, Reading.patient_id)],
        "readings_columns": ["ts", "state(0 collecting,1 normal,2 AF,3 no signal)", "af_probability", "bpm", "battery"],
        "alerts": [{"ts": iso(a.ts), "prob": a.prob, "bpm": a.bpm, "status": a.status} for a in q(Alert, Alert.patient_id)],
        "ecg": [{**ecg_meta(e), "samples": json.loads(e.samples)} for e in q(EcgStrip, EcgStrip.patient_id)],
        "symptoms": [symptom_out(s) for s in q(Symptom, Symptom.patient_id)],
        "vitals": [vital_out(v) for v in q(Vital, Vital.patient_id)],
        "doctor_seen": [{"ecg_id": x.ecg_id, "action": x.action, "ts": iso(x.ts)} for x in q(StripSeen, StripSeen.patient_id)],
        "family": [{"watcher_id": l.watcher_id, "since": iso(l.created_at), "revoked_at": iso(l.revoked_at)} for l in q(FamilyLink, FamilyLink.patient_id)],
        "medications": [med_out(m) for m in q(Medication, Medication.patient_id)],
        "medication_doses": [{"medication_id": d.medication_id, "slot": d.slot, "status": d.status} for d in q(MedDose, MedDose.patient_id)],
        "check_plan": plan_out(db.scalar(select(CheckPlan).where(CheckPlan.patient_id == u.id))),
        "diary_days": [{"day": d.day, "tags": [t for t in d.tags.split(",") if t]} for d in q(DayTag, DayTag.patient_id)],
        "doctor_notes": notes_of(db, u.id) if u.role == "patient" else [],
        "access_log": [{"ts": iso(a.ts), "actor_id": a.actor_id, "action": a.action} for a in q(AccessLog, AccessLog.patient_id)],
    }


@app.post("/api/me/export-link")
def export_link(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    import secrets
    db.execute(delete(ExportToken).where(ExportToken.created_at < utcnow() - timedelta(minutes=10)))
    t = secrets.token_urlsafe(32)
    db.add(ExportToken(token=t, user_id=user.id, created_at=utcnow()))
    db.commit()
    base = os.getenv("PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url).rstrip("/")
    return {"url": f"{base.rstrip('/')}/api/export/{t}", "expires_min": 10}


@app.get("/api/export/{token}", include_in_schema=False)
def export_download(token: str, db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse
    et = db.get(ExportToken, token)
    if et is None or utcnow() - et.created_at > timedelta(minutes=10):
        raise HTTPException(404, "Link expired")
    u = db.get(User, et.user_id)
    db.delete(et)                                         # one-time link
    db.commit()
    return JSONResponse(export_data(db, u), headers={
        "Content-Disposition": f'attachment; filename="afib-monitor-{u.id}-{utcnow():%Y%m%d}.json"'})


@app.get("/api/me/export")
def export_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return export_data(db, user)


@app.delete("/api/me")
def delete_me(body: DeleteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Delete the account and every record about the user (App Store rule 5.1.1(v)). Irreversible."""
    if not check_password(body.password, user.password_hash):
        raise HTTPException(403, "Wrong password")
    uid = user.id
    alert_ids = select(Alert.id).where(Alert.patient_id == uid)
    for stmt in (
        delete(TelegramMessage).where(TelegramMessage.alert_id.in_(alert_ids)),
        delete(AlertAck).where(AlertAck.alert_id.in_(alert_ids)),
        delete(Alert).where(Alert.patient_id == uid),
        delete(Reading).where(Reading.patient_id == uid),
        delete(EcgStrip).where(EcgStrip.patient_id == uid),
        delete(Symptom).where(Symptom.patient_id == uid),
        delete(Vital).where(Vital.patient_id == uid),
        delete(FamilyLink).where((FamilyLink.patient_id == uid) | (FamilyLink.watcher_id == uid)),
        delete(StripSeen).where((StripSeen.patient_id == uid) | (StripSeen.doctor_id == uid)),
        delete(FamilyInvite).where(FamilyInvite.patient_id == uid),
        delete(DayTag).where(DayTag.patient_id == uid),
        delete(MedDose).where(MedDose.patient_id == uid),
        delete(CheckPlan).where(CheckPlan.patient_id == uid),
        delete(Medication).where(Medication.patient_id == uid),
        delete(Note).where((Note.patient_id == uid) | (Note.author_id == uid)),
        delete(EpisodeReview).where((EpisodeReview.patient_id == uid) | (EpisodeReview.reviewer_id == uid)),
        delete(RiskProfile).where(RiskProfile.patient_id == uid),
        delete(TelegramLink).where(TelegramLink.user_id == uid),
        delete(TelegramCode).where(TelegramCode.user_id == uid),
        delete(Consent).where(Consent.user_id == uid),
        delete(AccessLog).where((AccessLog.patient_id == uid) | (AccessLog.actor_id == uid)),
        delete(ExportToken).where(ExportToken.user_id == uid),
        delete(Feedback).where(Feedback.user_id == uid),
    ):
        db.execute(stmt)
    db.execute(Alert.__table__.update().where(Alert.ack_by == uid).values(ack_by=None))
    db.execute(RiskProfile.__table__.update().where(RiskProfile.updated_by == uid).values(updated_by=None))
    db.execute(User.__table__.update().where(User.doctor_id == uid).values(doctor_id=None))
    db.execute(delete(User).where(User.id == uid))
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------- stroke risk (CHA2DS2-VASc)
class RiskIn(BaseModel):
    chf: bool = False
    hypertension: bool = False
    diabetes: bool = False
    stroke: bool = False
    vascular: bool = False
    birth_year: int | None = Field(default=None, ge=1900, le=2030)
    sex: str | None = Field(default=None, pattern="^(m|f)$")


def risk_of(db: Session, p: User) -> dict:
    r = db.get(RiskProfile, p.id)
    f = {k: getattr(r, k) for k in ("chf", "hypertension", "diabetes", "stroke", "vascular")} if r else {}
    out = risk.score(p.birth_year, p.sex, f)
    out["updated_at"] = iso(r.updated_at) if r else None
    return out


@app.get("/api/patients/{patient_id}/risk")
def get_risk(patient_id: int, doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    return risk_of(db, own_patient(db, doctor, patient_id))


@app.put("/api/patients/{patient_id}/risk")
def put_risk(patient_id: int, body: RiskIn, doctor: User = Depends(require_role("doctor")),
             db: Session = Depends(get_db)):
    p = own_patient(db, doctor, patient_id)
    log_access(db, p.id, doctor, "risk_edit")
    r = db.get(RiskProfile, p.id) or RiskProfile(patient_id=p.id)
    for k in ("chf", "hypertension", "diabetes", "stroke", "vascular"):
        setattr(r, k, int(getattr(body, k)))
    if body.birth_year is not None:
        p.birth_year = body.birth_year
    if body.sex is not None:
        p.sex = body.sex
    r.updated_by, r.updated_at = doctor.id, utcnow()
    db.add(r)
    db.commit()
    return risk_of(db, p)


@app.get("/api/me/risk")
def my_risk(user: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    return risk_of(db, user)


# ---------------------------------------------------------------- Telegram
@app.get("/api/telegram")
def telegram_info(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"enabled": telegram.enabled(), "bot": telegram.bot_username, "links": telegram.links_of(db, user)}


@app.post("/api/telegram/link")
def telegram_link(kind: str | None = Query(None, pattern="^(patient|family)$"), user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    """kind=patient: the patient's own chat (reminders, typed values, weekly summary); default: relatives' channel."""
    if not telegram.enabled():
        raise HTTPException(503, "Telegram bot is not configured on this server")
    code = telegram.new_code(db, user, kind)
    return {"code": code, "url": telegram.link_url(code), "bot": telegram.bot_username, "expires_h": 24}


@app.delete("/api/telegram/links/{link_id}")
def telegram_unlink(link_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(TelegramLink).where(TelegramLink.id == link_id, TelegramLink.user_id == user.id))
    db.commit()
    return telegram.links_of(db, user)


@app.post("/api/telegram/webhook", include_in_schema=False)
async def telegram_webhook(request: Request):
    if not telegram.enabled() or request.headers.get("X-Telegram-Bot-Api-Secret-Token") != telegram.SECRET:
        raise HTTPException(403, "Forbidden")
    asyncio.get_running_loop().create_task(telegram._guard(telegram.handle_update(await request.json())))
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


@app.get("/api/config")
def config():
    """Public app configuration, read by the mobile app and the portal at start."""
    return {"mode": PRODUCT_MODE, "version": app.version, "telegram_bot": telegram.bot_username,
            "consent_version": CONSENT_VERSION}


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=2000)
    platform: str | None = Field(default=None, max_length=20)
    app_version: str | None = Field(default=None, max_length=20)


@app.post("/api/feedback")
def add_feedback(body: FeedbackIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = Feedback(user_id=user.id, ts=utcnow(), rating=body.rating, text=(body.text or "").strip() or None,
                 platform=body.platform, app_version=body.app_version)
    db.add(f)
    db.commit()
    return {"ok": True}



def monitored_seconds_sql(db: Session, ids: list[int], since: datetime, until: datetime) -> float:
    """Same rule as analytics.monitored_seconds (gaps <= 60 s after a normal/AF reading), but summed inside
    the database: loading every reading into Python froze the small server for tens of seconds."""
    if not ids:
        return 0.0
    if db.bind.dialect.name == "sqlite":
        diff = "(julianday(nts) - julianday(ts)) * 86400.0"
    else:
        diff = "EXTRACT(EPOCH FROM (nts - ts))"
    sql = text(f"""
        SELECT COALESCE(SUM(d), 0) FROM (
          SELECT {diff} AS d, state FROM (
            SELECT ts, state, LEAD(ts) OVER (PARTITION BY patient_id ORDER BY ts) AS nts
            FROM readings WHERE patient_id IN ({",".join(str(int(i)) for i in ids)})
              AND ts >= :since AND ts <= :until) w
          WHERE nts IS NOT NULL) x
        WHERE state IN ({STATE_NORMAL}, {STATE_AFIB}) AND d <= {analytics.GAP.total_seconds()}""")
    return float(db.scalar(sql, {"since": since, "until": until}) or 0.0)

_METRICS_CACHE: dict[tuple[int, int], tuple[datetime, dict]] = {}
METRICS_TTL = timedelta(minutes=30)  # sums every reading of the period: heavy on a small server, so cache it
_METRICS_LOCK = threading.Lock()     # one computation at a time; concurrent callers then read the cache


@app.get("/api/metrics")
def product_metrics(days: int = Query(30, ge=1, le=365), fresh: bool = False,
                    doctor: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    """Product quality for this doctor's patients: alert load, how many alerts were real, how fast they were seen."""
    db.rollback()                    # hand the connection back to the pool while waiting for the lock
    with _METRICS_LOCK:
        hit = _METRICS_CACHE.get((doctor.id, days))
        if hit and not fresh and utcnow() - hit[0] < METRICS_TTL:
            return hit[1]
        return _compute_metrics(db, doctor, days)


def _compute_metrics(db: Session, doctor: User, days: int) -> dict:
    now = utcnow()
    since = now - timedelta(days=days)
    pats = list(db.scalars(select(User).where(User.doctor_id == doctor.id)))
    ids = [p.id for p in pats] or [-1]
    patient_days = monitored_seconds_sql(db, [p.id for p in pats], since, now) / 86400
    alerts = list(db.scalars(select(Alert).where(Alert.patient_id.in_(ids), Alert.ts >= since)))
    acked = [a for a in alerts if a.ack_at]
    delays = sorted((a.ack_at - a.ts).total_seconds() / 60 for a in acked if a.ack_at >= a.ts)
    reviews = list(db.scalars(select(EpisodeReview).where(EpisodeReview.patient_id.in_(ids), EpisodeReview.ts >= since)))
    conf = sum(r.verdict == "confirmed" for r in reviews)
    false = sum(r.verdict == "false_alarm" for r in reviews)
    fam_acks = db.scalar(select(func.count(AlertAck.id)).where(AlertAck.alert_id.in_([a.id for a in alerts] or [-1]),
                                                               AlertAck.kind == "family"))
    fb = list(db.scalars(select(Feedback).where(Feedback.user_id.in_(ids + [doctor.id]), Feedback.ts >= since)
                         .order_by(Feedback.ts.desc())))
    names = {p.id: p.name for p in pats}
    names[doctor.id] = doctor.name
    med = lambda v: (v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2) if v else None
    out = {
        "days": days, "mode": PRODUCT_MODE, "patients": len(pats), "computed_at": iso(now),
        "patient_days": round(patient_days, 2),
        "alerts": len(alerts),
        "alerts_per_patient_day": round(len(alerts) / patient_days, 2) if patient_days else None,
        "reviewed": conf + false, "confirmed": conf, "false_alarms": false,
        "ppv": round(conf / (conf + false), 3) if conf + false else None,
        "false_alarms_per_patient_day": round(false / patient_days, 2) if patient_days else None,
        "acked": len(acked), "ack_median_min": round(med(delays), 1) if delays else None,
        "ack_within_15_min": round(sum(d <= 15 for d in delays) / len(alerts), 3) if alerts else None,
        "family_acks": fam_acks or 0,
        "feedback_count": len(fb),
        "feedback_avg": round(sum(f.rating for f in fb) / len(fb), 2) if fb else None,
        "feedback": [{"ts": iso(f.ts), "rating": f.rating, "text": f.text, "who": names.get(f.user_id, "—"),
                      "platform": f.platform} for f in fb[:20]],
    }
    _METRICS_CACHE[(doctor.id, days)] = (now, out)
    return out


@app.get("/api/health")
def health(deep: bool = False):
    """Render calls this every few seconds, so by default it does not touch the database at all
    (a COUNT over all readings once took seconds and piled up; a free Neon database must be allowed to sleep).
    ?deep=1 also checks the database."""
    out = {"ok": True, "version": app.version, "mode": PRODUCT_MODE,
           "db": engine.dialect.name, "db_pool": engine.pool.status() if hasattr(engine.pool, "status") else None,
           "idle_s": round(activity.idle_s())}
    if deep:
        with SessionLocal() as db:
            out["users"] = db.scalar(select(func.max(User.id))) or 0
            out["readings"] = db.scalar(select(func.max(Reading.id))) or 0
    return out


# ---------------------------------------------------------------- web (built React app)
WEB_DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        f = (WEB_DIST / path).resolve()            # resolve ".." and refuse anything outside the portal build
        if path and f.is_relative_to(WEB_DIST.resolve()) and f.is_file():
            return FileResponse(f)
        return FileResponse(WEB_DIST / "index.html")
