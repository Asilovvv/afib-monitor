"""Plans and what they unlock. docs/PRICING.md is the source; the numbers here must match it.

Principles baked in (not configurable): everything about safety is free — the 30-s check and its verdict, preparation
and signal quality, SOS, reminders, sending records to the doctor, data export and deletion. The verdict is the same on
every plan. Paid plans add convenience, memory, family and service. Limits are enforced HERE (server), the apps only
show locks."""
from datetime import datetime, timedelta

PATIENT_PLANS = ("free", "family")
DOCTOR_PLANS = ("doctor_free", "clinic50", "clinic200")
TRIAL_DAYS = 30                      # "Family" for every new patient, no card, no auto-charge; falls back to free

# patient limits
LIMITS = {
    "free":   {"history_days": 30,  "family_watchers": 1, "patient_bot": False, "cuff_photo": False, "backup": False},
    "family": {"history_days": 366, "family_watchers": 5, "patient_bot": True,  "cuff_photo": True,  "backup": True},
}
# doctor limits
DOCTOR_LIMITS = {
    "doctor_free": {"patients": 10,  "csv": False, "clinic_logo": False, "multi_doctor": False},
    "clinic50":    {"patients": 50,  "csv": True,  "clinic_logo": True,  "multi_doctor": False},
    "clinic200":   {"patients": 200, "csv": True,  "clinic_logo": True,  "multi_doctor": True},
}
# som per month, from docs/PRICING.md (proposal, not final); shown by the apps, never used for charging — the stores do that
PRICES_SOM = {"family": {"month": 390, "year": 3900}, "clinic50": {"month": 4900}, "clinic200": {"month": 14900}}


def effective(role: str, plan: str | None, until: datetime | None, now: datetime) -> str:
    """The plan that applies right now: an expired paid plan is the free one. Clinic rental is open to every doctor
    plan during the pilot (decision 25 Oct 2026, see PRICING.md §2)."""
    base = "doctor_free" if role == "doctor" else "free"
    if not plan or plan == base:
        return base
    if until is not None and now > until:
        return base
    valid = DOCTOR_PLANS if role == "doctor" else PATIENT_PLANS
    return plan if plan in valid else base


def limits_for(role: str, plan: str) -> dict:
    return DOCTOR_LIMITS[plan] if role == "doctor" else LIMITS[plan]


def trial_until(created: datetime) -> datetime:
    return created + timedelta(days=TRIAL_DAYS)
