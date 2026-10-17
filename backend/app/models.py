"""Tables: users, readings from the device, alerts, ECG strips, symptoms, doctor notes, episode reviews."""
from datetime import datetime
from sqlalchemy import BigInteger, String, Integer, Float, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

# Rhythm states, same codes as the BLE packet of the device
STATE_COLLECTING, STATE_NORMAL, STATE_AFIB, STATE_NO_SIGNAL = 0, 1, 2, 3

SYMPTOMS = ("palpitations", "dizziness", "shortness_of_breath", "chest_pain", "fatigue", "anxiety", "other")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10))            # "patient" | "doctor"
    password_hash: Mapped[str] = mapped_column(String(200))
    invite_code: Mapped[str | None] = mapped_column(String(12), unique=True, nullable=True)  # doctors only
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)    # patients only
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(1), nullable=True)                       # "m" | "f"
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    specialty: Mapped[str | None] = mapped_column(String(100), nullable=True)               # doctors
    clinic: Mapped[str | None] = mapped_column(String(200), nullable=True)                  # doctors
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    doctor = relationship("User", remote_side=[id])


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)   # UTC
    state: Mapped[int] = mapped_column(Integer)                 # see STATE_* above
    prob: Mapped[float] = mapped_column(Float)                  # AFib probability 0..1
    bpm: Mapped[float] = mapped_column(Float)
    battery: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (Index("ix_readings_patient_ts", "patient_id", "ts"),)


class Alert(Base):
    """Created automatically when a patient's rhythm turns into AFib."""
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    kind: Mapped[str] = mapped_column(String(30), default="afib_onset")
    prob: Mapped[float] = mapped_column(Float, default=0)
    bpm: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(10), default="new")   # "new" | "ack"
    ack_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    ack_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class EcgStrip(Base):
    """A short ECG recording sent by the phone (automatically at AFib onset or by the patient)."""
    __tablename__ = "ecg_strips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)       # start of the strip, UTC
    fs: Mapped[int] = mapped_column(Integer, default=125)
    samples: Mapped[str] = mapped_column(Text)                       # JSON list of floats
    state: Mapped[int] = mapped_column(Integer, default=STATE_NORMAL)
    prob: Mapped[float] = mapped_column(Float, default=0)
    bpm: Mapped[float] = mapped_column(Float, default=0)
    reason: Mapped[str] = mapped_column(String(20), default="manual")  # "afib_onset" | "manual" | "symptom"


class Symptom(Base):
    __tablename__ = "symptoms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    kinds: Mapped[str] = mapped_column(String(300))                  # comma-separated SYMPTOMS
    severity: Mapped[int] = mapped_column(Integer, default=1)        # 1 mild .. 3 severe
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    text: Mapped[str] = mapped_column(Text)


class EpisodeReview(Base):
    """Doctor's verdict on an AFib episode detected by the device."""
    __tablename__ = "episode_reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    episode_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    verdict: Mapped[str] = mapped_column(String(20))                 # "confirmed" | "false_alarm"
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TelegramLink(Base):
    """A Telegram chat that receives AF alerts: the doctor (all his patients) or a relative (one patient)."""
    __tablename__ = "telegram_links"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    kind: Mapped[str] = mapped_column(String(10))                    # "doctor" | "family"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)   # doctor, or the patient for family
    name: Mapped[str] = mapped_column(String(200), default="")       # Telegram display name
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TelegramCode(Base):
    """One-time code for t.me/<bot>?start=<code>; valid for 24 h."""
    __tablename__ = "telegram_codes"
    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TelegramMessage(Base):
    """Alert messages sent, so the "Accept" button can update every copy."""
    __tablename__ = "telegram_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), index=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    message_id: Mapped[int] = mapped_column(Integer)
    has_photo: Mapped[int] = mapped_column(Integer, default=0)


class RiskProfile(Base):
    """CHA2DS2-VASc inputs that are not in the user profile (age and sex come from the profile)."""
    __tablename__ = "risk_profiles"
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    chf: Mapped[int] = mapped_column(Integer, default=0)             # congestive heart failure / LV dysfunction
    hypertension: Mapped[int] = mapped_column(Integer, default=0)
    diabetes: Mapped[int] = mapped_column(Integer, default=0)
    stroke: Mapped[int] = mapped_column(Integer, default=0)          # stroke / TIA / thromboembolism
    vascular: Mapped[int] = mapped_column(Integer, default=0)        # MI, PAD, aortic plaque
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AlertAck(Base):
    """Who pressed "Accept" on an alert (doctor in the portal or in Telegram, or a relative in Telegram)."""
    __tablename__ = "alert_acks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), index=True)
    who: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(10))                    # "doctor" | "family"
    chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Consent(Base):
    """What the user agreed to and which version of the text (terms, data processing, research participation)."""
    __tablename__ = "consents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))                    # "terms" | "data" | "research"
    version: Mapped[str] = mapped_column(String(20))
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AccessLog(Base):
    """Every time a doctor opens a patient's data — the patient can see who and when."""
    __tablename__ = "access_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(20))                  # "report" | "ecg" | "risk" | "risk_edit"
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ExportToken(Base):
    """One-time, 10-minute link to download all of a user's data (opened in the phone's browser)."""
    __tablename__ = "export_tokens"
    token: Mapped[str] = mapped_column(String(48), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
