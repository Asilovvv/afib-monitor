import os, time
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "sqlite:///./test_afib.db")
if os.path.exists("test_afib.db"):
    os.remove("test_afib.db")
if os.environ["DATABASE_URL"].startswith("postgres"):      # CI: start from an empty PostgreSQL database
    from app.db import Base, engine
    import app.models  # noqa: F401
    Base.metadata.drop_all(engine)

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


def _pair(tag):
    d = c.post("/api/auth/register", json={"email": f"doc{tag}@x.kg", "password": "secret1", "name": f"Dr {tag}",
                                           "role": "doctor"}).json()
    p = c.post("/api/auth/register", json={"email": f"pat{tag}@x.kg", "password": "secret1", "name": f"Pat {tag}",
                                           "role": "patient", "doctor_code": d["user"]["invite_code"],
                                           "birth_year": 1950, "sex": "f"}).json()
    return d["token"], p["token"], p["user"]["id"]


def test_ecg_analysis_and_poincare():
    from app.ecgsynth import synth_ecg
    from app import ecgtools
    for af in (False, True):
        a = ecgtools.analyze(synth_ecg(10, afib=af, bpm=75, seed=1))
        assert 10 <= len(a["r_peaks"]) <= 16
        assert a["quality"]["level"] == "good"
        assert (a["irregularity"] > 0.1) == af            # AF is irregularly irregular
    assert ecgtools.quality([0.0] * 1250)["level"] == "poor"
    assert ecgtools.png(synth_ecg(10, seed=2))[:4] == b"\x89PNG"

    dt, pt, pid = _pair("e")
    now = time.time()
    e = c.post("/api/ecg", json={"ts": now - 60, "samples": synth_ecg(10, afib=True, seed=4), "state": 2,
                                 "prob": 0.9, "bpm": 100, "reason": "manual"}, headers=auth(pt)).json()
    s = c.get(f"/api/ecg/{e['id']}", headers=auth(dt)).json()
    assert len(s["rr"]) == len(s["r_peaks"]) - 1 and s["poincare"]["sd1"] > 50
    rep = c.get(f"/api/patients/{pid}/report?hours=1", headers=auth(dt)).json()
    assert rep["poincare"]["strips"] == 1 and len(rep["poincare"]["af"]) >= 8 and rep["poincare"]["normal"] == []


def test_cha2ds2_vasc():
    from app.risk import score
    assert score(None, "m", {})["cha2ds2_vasc"] == 0
    r = score(1950, "f", {"hypertension": 1, "diabetes": 1})       # 76 y: age 2 + female 1 + H + D
    assert r["cha2ds2_vasc"] == 5 and r["cha2ds2_va"] == 4 and r["level"] == "high"
    dt, pt, pid = _pair("r")
    r = c.put(f"/api/patients/{pid}/risk", json={"stroke": True}, headers=auth(dt)).json()
    assert r["points"]["stroke"] == 2 and r["points"]["age75"] == 2 and r["cha2ds2_vasc"] == 5
    assert c.get("/api/me/risk", headers=auth(pt)).json()["cha2ds2_vasc"] == 5
    assert c.put(f"/api/patients/{pid}/risk", json={}, headers=auth(_pair("r2")[0])).status_code == 404


def test_telegram_flow():
    import asyncio
    from app import telegram
    from app.ecgsynth import synth_ecg
    sent = []

    async def fake(method, data=None, files=None):
        sent.append((method, data or {}, bool(files)))
        return {"ok": True, "result": {"message_id": len(sent), "username": "afib_test_bot"}}

    telegram._call, telegram.TOKEN, telegram.ECG_WAIT_S, telegram.CONFIRM_S = fake, "123:abc", 0, 30
    telegram.bot_username = "afib_test_bot"
    run = lambda coro: asyncio.run(coro)
    dt, pt, pid = _pair("t")
    assert c.get("/api/telegram", headers=auth(dt)).json()["enabled"] is True
    link = c.post("/api/telegram/link", headers=auth(dt)).json()
    assert link["url"].startswith("https://t.me/afib_test_bot?start=")
    fam = c.post("/api/telegram/link", headers=auth(pt)).json()
    msg = lambda chat, text: {"message": {"chat": {"id": chat}, "from": {"first_name": "Aida"}, "text": text}}
    run(telegram.handle_update(msg(111, "/start " + link["code"])))
    run(telegram.handle_update(msg(222, "/start " + fam["code"])))
    run(telegram.handle_update(msg(333, "/start " + fam["code"])))           # one-time code
    assert "Готово" in sent[0][1]["text"] and "Готово" in sent[1][1]["text"] and "устарела" in sent[2][1]["text"]
    assert len(c.get("/api/telegram", headers=auth(pt)).json()["links"]) == 1

    now = time.time()
    c.post("/api/readings", json={"readings": [{"ts": now - 20 + i * 4, "state": 2, "prob": 0.97, "bpm": 120}
                                               for i in range(5)]}, headers=auth(pt))
    c.post("/api/ecg", json={"ts": now - 15, "samples": synth_ecg(10, afib=True, seed=9), "state": 2,
                             "prob": 0.97, "bpm": 120, "reason": "afib_onset"}, headers=auth(pt))
    c.post("/api/readings", json={"readings": [{"ts": now + i * 4, "state": 2, "prob": 0.97, "bpm": 120}
                                               for i in range(1, 6)]}, headers=auth(pt))   # AF lasts 40 s
    aid = c.get("/api/alerts?status=new", headers=auth(dt)).json()[0]["id"]
    sent.clear()
    run(telegram._send_alert(aid))
    photos = [s for s in sent if s[0] == "sendPhoto"]
    assert len(photos) == 2 and all(s[2] for s in photos)                    # doctor + relative, with the ECG
    assert "ack:" in photos[0][1]["reply_markup"] and "Фибрилляция" in photos[0][1]["caption"]

    sent.clear()
    run(telegram.handle_update({"callback_query": {"id": "q1", "data": f"ack:{aid}", "from": {"first_name": "Aida"},
                                                   "message": {"chat": {"id": 222}}}}))
    assert sent[0][1]["text"].startswith("Принято")
    assert any(s[0] == "editMessageCaption" and "Aida (близкий)" in s[1]["caption"] for s in sent)
    assert c.get("/api/alerts?status=new", headers=auth(dt)).json()[0]["id"] == aid  # family does not close it
    run(telegram.handle_update({"callback_query": {"id": "q2", "data": f"ack:{aid}", "from": {"first_name": "X"},
                                                   "message": {"chat": {"id": 999}}}}))
    assert any(s[1].get("text") == "Нет доступа к этому пациенту" for s in sent)
    run(telegram.handle_update({"callback_query": {"id": "q3", "data": f"ack:{aid}", "from": {"first_name": "D"},
                                                   "message": {"chat": {"id": 111}}}}))
    assert c.get("/api/alerts?status=new", headers=auth(dt)).json() == []      # doctor closes it

    # a 12-s run of AF that goes back to normal is not an episode: nobody is paged
    pt2 = c.post("/api/auth/login", json={"email": "patt@x.kg", "password": "secret1"}).json()["token"]
    t1 = time.time() + 600
    c.post("/api/readings", json={"readings": [{"ts": t1 + i * 4, "state": s, "prob": .9, "bpm": 110}
                                               for i, s in enumerate([1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1])]}, headers=auth(pt2))
    short = [a for a in c.get("/api/alerts?status=new", headers=auth(dt)).json() if a["id"] != aid][0]["id"]
    sent.clear()
    telegram._last_sent.clear()
    run(telegram._send_alert(short))
    assert sent == []

    sent.clear()
    run(telegram.handle_update(msg(111, "/status")))
    assert "Pat t" in sent[0][1]["text"] and "уд/мин" in sent[0][1]["text"]
    run(telegram.handle_update(msg(222, "/stop")))
    assert c.get("/api/telegram", headers=auth(pt)).json()["links"] == []
    assert c.post("/api/telegram/webhook", json={}).status_code == 403
    telegram.TOKEN = ""


def test_privacy_consent_export_delete():
    d = c.post("/api/auth/register", json={"email": "docp@x.kg", "password": "secret1", "name": "Dr P", "role": "doctor"}).json()
    p = c.post("/api/auth/register", json={"email": "patp@x.kg", "password": "secret1", "name": "Pat P", "role": "patient",
                                           "doctor_code": d["user"]["invite_code"], "consents": ["terms", "data", "research", "bogus"]}).json()
    dt, pt, pid = d["token"], p["token"], p["user"]["id"]
    cons = c.get("/api/me/consents", headers=auth(pt)).json()
    assert sorted(x["kind"] for x in cons["consents"]) == ["data", "research", "terms"]
    cons = c.post("/api/me/consents", json={"kind": "research", "given": False}, headers=auth(pt)).json()
    assert [x for x in cons["consents"] if x["kind"] == "research"][0]["withdrawn_at"]

    now = time.time()
    c.post("/api/readings", json={"readings": [{"ts": now - 60 + i * 4, "state": 2, "prob": .9, "bpm": 100} for i in range(10)]}, headers=auth(pt))
    c.post("/api/ecg", json={"ts": now - 30, "samples": [0.1] * 1250, "state": 2, "reason": "manual"}, headers=auth(pt))
    c.post("/api/symptoms", json={"kinds": ["fatigue"]}, headers=auth(pt))
    c.get(f"/api/patients/{pid}/report", headers=auth(dt))
    log = c.get("/api/me/access-log", headers=auth(pt)).json()
    assert log[0]["who"] == "Dr P" and log[0]["action"] == "report"

    link = c.post("/api/me/export-link", headers=auth(pt)).json()["url"]
    path = link[link.index("/api/export/"):]
    ex = c.get(path)
    assert ex.status_code == 200 and "attachment" in ex.headers["content-disposition"]
    data = ex.json()
    assert len(data["readings"]) == 10 and len(data["ecg"]) == 1 and len(data["symptoms"]) == 1
    assert c.get(path).status_code == 404                                    # one-time link

    assert c.request("DELETE", "/api/me", json={"password": "bad"}, headers=auth(pt)).status_code == 403
    assert c.request("DELETE", "/api/me", json={"password": "secret1"}, headers=auth(pt)).json() == {"deleted": True}
    assert c.get("/api/me", headers=auth(pt)).status_code == 401
    assert c.get("/api/patients", headers=auth(dt)).json() == []
    assert c.post("/api/auth/login", json={"email": "patp@x.kg", "password": "secret1"}).status_code == 401
    # the doctor can delete their account too; patients stay, just unlinked
    assert c.request("DELETE", "/api/me", json={"password": "secret1"}, headers=auth(dt)).json() == {"deleted": True}


def test_feedback_metrics_and_wellness_mode():
    from app import main as m
    d = c.post("/api/auth/register", json={"email": "docm@x.kg", "password": "secret1", "name": "Dr M", "role": "doctor"}).json()
    p = c.post("/api/auth/register", json={"email": "patm@x.kg", "password": "secret1", "name": "Pat M", "role": "patient",
                                           "doctor_code": d["user"]["invite_code"]}).json()
    dt, pt, pid = d["token"], p["token"], p["user"]["id"]
    assert c.get("/api/config").json()["mode"] == "research"
    assert c.post("/api/feedback", json={"rating": 5, "text": "  Удобно  ", "platform": "ios"}, headers=auth(pt)).json() == {"ok": True}
    assert c.post("/api/feedback", json={"rating": 9}, headers=auth(pt)).status_code == 422
    now = time.time()
    rs = [{"ts": now - 3000 + i * 5, "state": 2 if 100 <= i < 140 or 400 <= i < 440 else 1, "prob": .9, "bpm": 90} for i in range(600)]
    assert c.post("/api/readings", json={"readings": rs}, headers=auth(pt)).json()["alerts"] == 2
    al = c.get("/api/alerts?status=new", headers=auth(dt)).json()
    c.post(f"/api/alerts/{al[0]['id']}/ack", headers=auth(dt))
    eps = c.get(f"/api/patients/{pid}/report?hours=2", headers=auth(dt)).json()["episodes"]
    c.post(f"/api/patients/{pid}/episodes/review", json={"episode_start": eps[0]["start"], "verdict": "confirmed"}, headers=auth(dt))
    c.post(f"/api/patients/{pid}/episodes/review", json={"episode_start": eps[1]["start"], "verdict": "false_alarm"}, headers=auth(dt))
    mt = c.get("/api/metrics?days=1", headers=auth(dt)).json()
    assert mt["alerts"] == 2 and mt["acked"] == 1 and mt["ppv"] == 0.5 and mt["false_alarms"] == 1
    assert mt["feedback_avg"] == 5 and mt["feedback"][0]["text"] == "Удобно" and mt["patient_days"] > 0
    assert c.get("/api/metrics", headers=auth(pt)).status_code == 403
    # wellness mode: rhythm is stored, but no AF alert is raised
    m.PRODUCT_MODE = "wellness"
    try:
        assert c.get("/api/config").json()["mode"] == "wellness"
        rs = [{"ts": now + 10 + i * 5, "state": 2 if i > 5 else 1, "prob": .9, "bpm": 100} for i in range(20)]
        assert c.post("/api/readings", json={"readings": rs}, headers=auth(pt)).json() == {"saved": 20, "alerts": 0}
    finally:
        m.PRODUCT_MODE = "research"


def test_heart_rate_events_and_pauses():
    from datetime import datetime, timedelta
    from app import analytics, ecgtools
    from app.analytics import R
    from app.models import STATE_NORMAL, STATE_NO_SIGNAL
    t0 = datetime(2026, 10, 18, 8, 0, 0)
    rows = [R(t0 + timedelta(seconds=6 * i), STATE_NORMAL, 0.05, 70) for i in range(10)]          # 1 min normal
    rows += [R(t0 + timedelta(seconds=60 + 6 * i), STATE_NORMAL, 0.05, 36) for i in range(15)]    # 90 s at 36 bpm
    rows += [R(t0 + timedelta(seconds=150 + 6 * i), STATE_NORMAL, 0.05, 165) for i in range(5)]   # 30 s at 165: too short
    rows += [R(t0 + timedelta(seconds=180 + 6 * i), STATE_NO_SIGNAL, 0, 20) for i in range(20)]   # no signal: ignored
    ev = analytics.hr_events(rows)
    assert [(e["kind"], e["bpm"]) for e in ev] == [("low", 36)]
    assert ev[0]["duration_s"] == 84
    # a 3.6 s gap between beats on an otherwise clean strip is reported as a pause
    fs = 125
    beat = [0.0] * 6 + [0.4, 1.0, 0.4] + [0.0] * 6
    x, t = [0.0] * (10 * fs), 0
    for at in [0.5, 1.3, 2.1, 2.9, 6.5, 7.3, 8.1, 8.9]:
        i = int(at * fs)
        for k, v in enumerate(beat):
            x[i + k] += v
    p = ecgtools.r_peaks(x, fs)
    assert any(abs(q["rr_s"] - 3.6) < 0.1 for q in ecgtools.pauses(p, fs))
