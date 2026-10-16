"""Tables: users, readings from the device, alerts, ECG strips, symptoms, doctor notes, episode reviews."""
from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Index, Text
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
