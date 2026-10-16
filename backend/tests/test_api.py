import os, time
os.environ["DATABASE_URL"] = "sqlite:///./test_afib.db"
if os.path.exists("test_afib.db"):
    os.remove("test_afib.db")

from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_full_flow():
    r = c.post("/api/auth/register", json={"email": "doc@x.kg", "password": "secret1", "name": "Doc", "role": "doctor"})
    assert r.status_code == 200, r.text
    doc_tok, code = r.json()["token"], r.json()["user"]["invite_code"]
    assert len(code) == 6

    r = c.post("/api/auth/register", json={"email": "pat@x.kg", "password": "secret1", "name": "Pat",
                                           "role": "patient", "doctor_code": code.lower()})
    assert r.status_code == 200, r.text
    pat_tok = r.json()["token"]
    assert r.json()["user"]["doctor"]["name"] == "Doc"

    assert c.post("/api/auth/login", json={"email": "pat@x.kg", "password": "bad"}).status_code == 401
    assert c.post("/api/auth/register", json={"email": "pat@x.kg", "password": "secret1", "name": "P",
                                              "role": "patient"}).status_code == 409

    now = time.time()
    readings = []
    for i in range(300):                      # 20 min: 10 normal, 5 AFib, 5 normal, every 4 s
        t = now - 1200 + i * 4
        af = 150 <= i < 225
        readings.append({"ts": t, "state": 2 if af else 1, "prob": 0.95 if af else 0.05, "bpm": 110 if af else 70})
    r = c.post("/api/readings", json={"readings": readings}, headers=auth(pat_tok))
    assert r.json() == {"saved": 300, "alerts": 1}

    # patients cannot see the doctor list, doctors cannot upload
    assert c.get("/api/patients", headers=auth(pat_tok)).status_code == 403
    assert c.post("/api/readings", json={"readings": []}, headers=auth(doc_tok)).status_code == 403
    assert c.get("/api/patients").status_code == 401

    lst = c.get("/api/patients", headers=auth(doc_tok)).json()
    assert len(lst) == 1 and lst[0]["name"] == "Pat"
    assert 0.2 < lst[0]["af_burden_24h"] < 0.3
    assert lst[0]["episodes_24h"] == 1

    rep = c.get(f"/api/patients/{lst[0]['id']}/report?hours=1", headers=auth(doc_tok)).json()
    assert rep["stats"]["episodes_count"] == 1
    ep = rep["episodes"][0]
    assert 290 <= ep["duration_s"] <= 300 and ep["mean_bpm"] == 110
    assert rep["stats"]["hr_max"] == 110 and rep["stats"]["hr_min"] == 70
    assert len(rep["series"]) > 10 and rep["last"]["state"] == 1

    mine = c.get("/api/me/report?hours=1", headers=auth(pat_tok)).json()
    assert mine["stats"]["episodes_count"] == 1

    # another doctor cannot open this patient
    other = c.post("/api/auth/register", json={"email": "d2@x.kg", "password": "secret1", "name": "D2", "role": "doctor"}).json()
    assert c.get(f"/api/patients/{lst[0]['id']}/report", headers=auth(other["token"])).status_code == 404


def test_short_af_is_not_an_episode():
    from datetime import datetime, timedelta
    from app.analytics import R, episodes
    t0 = datetime(2026, 1, 1)
    rows = [R(t0 + timedelta(seconds=4 * i), 2 if 10 <= i < 14 else 1, 0.9, 100) for i in range(30)]
    assert episodes(rows) == []               # 12 s of AFib < 30 s


def test_v2_features():
    doc = c.post("/api/auth/register", json={"email": "doc2@x.kg", "password": "secret1", "name": "Doc Two",
                                             "role": "doctor", "clinic": "NCC"}).json()
    dt, code = doc["token"], doc["user"]["invite_code"]
    pat = c.post("/api/auth/register", json={"email": "p2@x.kg", "password": "secret1", "name": "Pat Two",
                                             "role": "patient", "doctor_code": code}).json()
    pt, pid = pat["token"], pat["user"]["id"]
    now = time.time()
    # normal -> AFib -> no signal -> AFib : only ONE alert (signal gap is not a new onset)
    rs = [{"ts": now - 600 + i * 5, "state": s, "prob": 0.9 if s == 2 else 0.1, "bpm": 100 if s == 2 else 70, "battery": 80}
          for i, s in enumerate([1] * 20 + [2] * 20 + [3] * 5 + [2] * 20)]
    r = c.post("/api/readings", json={"readings": rs}, headers=auth(pt)).json()
    assert r == {"saved": 65, "alerts": 1}
    # second batch continuing AFib: no new alert
    r = c.post("/api/readings", json={"readings": [{"ts": now, "state": 2, "prob": 0.9, "bpm": 99}]}, headers=auth(pt)).json()
    assert r["alerts"] == 0

    assert c.post("/api/symptoms", json={"kinds": ["palpitations", "dizziness"], "severity": 2, "note": "x"}, headers=auth(pt)).status_code == 200
    assert c.post("/api/symptoms", json={"kinds": ["bogus"]}, headers=auth(pt)).status_code == 422
    e = c.post("/api/ecg", json={"ts": now - 300, "samples": [0.1] * 1250, "state": 2, "prob": 0.95, "bpm": 110,
                                 "reason": "afib_onset"}, headers=auth(pt)).json()
    assert e["duration_s"] == 10.0

    ov = c.get("/api/overview", headers=auth(dt)).json()
    assert ov["patients"] == 1 and ov["new_alerts"] == 1 and ov["symptoms_24h"] == 1 and ov["ecg_24h"] == 1

    alerts = c.get("/api/alerts?status=new", headers=auth(dt)).json()
    assert len(alerts) == 1 and alerts[0]["patient_name"] == "Pat Two"
    assert c.post(f"/api/alerts/{alerts[0]['id']}/ack", headers=auth(dt)).json() == {"ok": True}
    assert c.get("/api/alerts?status=new", headers=auth(dt)).json() == []

    notes = c.post(f"/api/patients/{pid}/notes", json={"text": "Control in 1 week"}, headers=auth(dt)).json()
    assert notes[0]["text"] == "Control in 1 week" and notes[0]["author"] == "Doc Two"

    rep = c.get(f"/api/patients/{pid}/report?hours=1", headers=auth(dt)).json()
    assert rep["battery"] == 80 and len(rep["symptoms"]) == 1 and len(rep["ecg"]) == 1 and len(rep["notes"]) == 1
    assert len(rep["episodes"]) == 2                      # signal gap splits the AFib episode
    ep = rep["episodes"][0]
    assert ep["ecg_id"] == e["id"]
    assert c.post(f"/api/patients/{pid}/episodes/review", json={"episode_start": ep["start"], "verdict": "false_alarm"},
                  headers=auth(dt)).json() == {"ok": True}
    rep = c.get(f"/api/patients/{pid}/report?hours=1", headers=auth(dt)).json()
    assert rep["episodes"][0]["verdict"] == "false_alarm" and rep["stats"]["false_alarms"] == 1
    assert len(rep["hourly"]) >= 1

    strip = c.get(f"/api/ecg/{e['id']}", headers=auth(pt)).json()
    assert len(strip["samples"]) == 1250
    assert c.get(f"/api/ecg/{e['id']}", headers=auth(doc_other())).status_code == 404

    me = c.put("/api/me", json={"phone": "+996 555", "birth_year": 1960}, headers=auth(pt)).json()
    assert me["phone"] == "+996 555" and me["birth_year"] == 1960
    new_code = c.post("/api/me/invite", headers=auth(dt)).json()["invite_code"]
    assert new_code != code and len(new_code) == 6


def doc_other():
    return c.post("/api/auth/register", json={"email": "d3@x.kg", "password": "secret1", "name": "D3", "role": "doctor"}).json()["token"]


def test_stream_requires_doctor():
    p = c.post("/api/auth/register", json={"email": "p9@x.kg", "password": "secret1", "name": "P9", "role": "patient"}).json()
    assert c.get(f"/api/stream?token={p['token']}").status_code == 403
    assert c.get("/api/stream?token=bad").status_code == 401
