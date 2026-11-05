"""The phone resends what the server already saved (a timeout while a sleeping server wakes up): nothing is stored
twice, no second AF alert, no second ECG strip or symptom for the doctor."""
import time

from test_api import auth, c  # first (same module name as pytest uses): it points DATABASE_URL at the test database

from sqlalchemy import func, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Alert, EcgStrip, Reading, Symptom  # noqa: E402


def _patient(email):
    doc = c.post("/api/auth/register", json={"email": f"d-{email}", "password": "secret1", "name": "D", "role": "doctor"}).json()
    assert "user" in doc, doc
    pat = c.post("/api/auth/register", json={"email": email, "password": "secret1", "name": "P", "role": "patient",
                                             "doctor_code": doc["user"]["invite_code"],
                                             "consents": ["terms", "data", "research"]}).json()
    return pat["token"], pat["user"]["id"]


def _count(model, pid):
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model).where(model.patient_id == pid))


def test_a_resent_batch_is_not_stored_twice_and_gives_no_second_alert():
    tok, pid = _patient("retry1@x.kg")
    now = time.time()
    rs = [{"ts": now - 400 + i * 4, "state": 2 if i >= 50 else 1, "prob": 0.9 if i >= 50 else 0.1, "bpm": 100 if i >= 50 else 70}
          for i in range(100)]
    assert c.post("/api/readings", json={"readings": rs}, headers=auth(tok)).json() == {"saved": 100, "alerts": 1}
    assert c.post("/api/readings", json={"readings": rs}, headers=auth(tok)).json() == {"saved": 0, "alerts": 0}
    # a batch that overlaps the old one keeps only the new readings; the AF episode goes on, so no new alert
    more = rs[-10:] + [{"ts": now + i * 4, "state": 2, "prob": 0.9, "bpm": 101} for i in range(1, 6)]
    assert c.post("/api/readings", json={"readings": more}, headers=auth(tok)).json() == {"saved": 5, "alerts": 0}
    assert _count(Reading, pid) == 105 and _count(Alert, pid) == 1


def test_a_resent_ecg_and_symptom_are_not_stored_twice():
    tok, pid = _patient("retry2@x.kg")
    now = time.time()
    ecg = {"ts": now - 60, "samples": [0.1] * 1250, "state": 1, "prob": 0.1, "bpm": 70, "reason": "check"}
    a = c.post("/api/ecg", json=ecg, headers=auth(tok)).json()
    b = c.post("/api/ecg", json=ecg, headers=auth(tok)).json()
    assert a["id"] == b["id"] and a["check"] == b["check"] and _count(EcgStrip, pid) == 1
    sym = {"ts": now - 30, "kinds": ["palpitations"], "severity": 2}
    s1 = c.post("/api/symptoms", json=sym, headers=auth(tok)).json()
    s2 = c.post("/api/symptoms", json=sym, headers=auth(tok)).json()
    assert s1["id"] == s2["id"] and _count(Symptom, pid) == 1
    # a different moment is a different recording
    assert c.post("/api/ecg", json={**ecg, "ts": now - 20}, headers=auth(tok)).json()["id"] != a["id"]
    assert _count(EcgStrip, pid) == 2


def test_two_copies_at_the_same_moment_store_one():
    """A server waking up can get the timed-out request and its retry together: they run in parallel threads."""
    from concurrent.futures import ThreadPoolExecutor

    tok, pid = _patient("retry3@x.kg")
    now = time.time()
    rs = [{"ts": now - 400 + i * 4, "state": 2 if i >= 50 else 1, "prob": 0.9 if i >= 50 else 0.1, "bpm": 90}
          for i in range(100)]
    with ThreadPoolExecutor(4) as pool:
        outs = list(pool.map(lambda _: c.post("/api/readings", json={"readings": rs}, headers=auth(tok)).json(), range(4)))
    assert sorted(o["saved"] for o in outs) == [0, 0, 0, 100]
    assert _count(Reading, pid) == 100 and _count(Alert, pid) == 1
