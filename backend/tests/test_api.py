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
                                           "role": "patient", "doctor_code": code.lower(),
                                           "consents": ["terms", "data", "research"]})
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
                                             "role": "patient", "doctor_code": code,
                                             "consents": ["terms", "data", "research"]}).json()
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
                                           "role": "patient", "doctor_code": d["user"]["invite_code"], "consents": ["terms", "data", "research"],
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
                                           "doctor_code": d["user"]["invite_code"], "consents": ["terms", "data", "research"]}).json()
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


def test_diary_factors_and_triggers():
    from datetime import datetime, timedelta
    from app import analytics
    from app.analytics import R
    from app.models import DAY_TAGS, STATE_AFIB, STATE_NORMAL
    # 8 diary days, wearing all day; AF for 2 h on the 4 "alcohol" days only
    rows, diary = [], {}
    for d in range(8):
        day = f"2026-10-{10 + d:02d}"
        a, _ = analytics.day_window(day, 6)
        alcohol = d % 2 == 0
        diary[day] = {"alcohol", "caffeine"} if alcohol else {"caffeine"}
        for i in range(0, 20 * 3600, 30):
            af = alcohol and 3600 <= i < 3 * 3600
            rows.append(R(a + timedelta(seconds=i), STATE_AFIB if af else STATE_NORMAL, 0.9 if af else 0.1, 70))
    tr = analytics.triggers(rows, diary, DAY_TAGS, 6)
    f = {x["tag"]: x for x in tr["factors"]}
    assert f["alcohol"]["days_with"] == 4 and f["alcohol"]["days_without"] == 4 and f["alcohol"]["enough"]
    assert 0.09 < f["alcohol"]["burden_with"] < 0.11 and f["alcohol"]["burden_without"] == 0
    assert f["caffeine"]["days_without"] == 0 and not f["caffeine"]["enough"]     # nothing to compare with
    assert "stress" not in f
    # API: patient fills the diary, unknown factor rejected, report carries the comparison
    r = c.post("/api/auth/register", json={"email": "diary@x.kg", "password": "secret1", "name": "D", "role": "patient"})
    tok = r.json()["token"]
    assert c.post("/api/me/day", json={"day": "2026-10-18", "tags": ["alcohol", "alcohol", "stress"]},
                  headers=auth(tok)).json() == {"day": "2026-10-18", "tags": ["alcohol", "stress"]}
    assert c.post("/api/me/day", json={"day": "2026-10-18", "tags": ["smoking"]}, headers=auth(tok)).status_code == 422
    c.post("/api/me/day", json={"day": "2026-10-18", "tags": []}, headers=auth(tok))        # overwrite: nothing special
    days = c.get("/api/me/days?days=366", headers=auth(tok)).json()
    assert days == [{"day": "2026-10-18", "tags": []}]
    assert "factors" in c.get("/api/me/report?hours=168", headers=auth(tok)).json()["triggers"]


def test_check_30_seconds():
    from app import ecgtools
    from app.ecgsynth import synth_ecg
    assert ecgtools.check(synth_ecg(30, afib=False, bpm=70, seed=1))["verdict"] == "regular"
    assert ecgtools.check(synth_ecg(30, afib=True, bpm=110, seed=2))["verdict"] == "irregular"
    assert ecgtools.check([0.0] * (30 * 125))["verdict"] == "no_verdict"
    r = c.post("/api/auth/register", json={"email": "check@x.kg", "password": "secret1", "name": "C", "role": "patient"})
    out = c.post("/api/ecg", json={"ts": time.time() - 30, "samples": synth_ecg(30, afib=False, bpm=70, seed=3),
                                   "reason": "check"}, headers=auth(r.json()["token"])).json()
    assert out["check"]["verdict"] == "regular" and 60 <= out["check"]["bpm"] <= 80


def test_medications_and_adherence():
    from datetime import datetime
    from app import analytics
    # schedule maths: 2 doses a day over 3 local days
    slots = analytics.dose_slots(["08:00", "20:00"], datetime(2026, 10, 10, 0, 0), datetime(2026, 10, 12, 23, 0), 6)
    assert slots[0] == "2026-10-10T08:00" and len(slots) == 6          # 00:00 UTC = 06:00 local; 23:00 UTC = 05:00 next day
    ad = analytics.adherence([{"id": 1, "name": "A", "dose": None, "anticoagulant": True, "times": ["08:00", "20:00"],
                               "created_at": datetime(2026, 10, 10), "ended_at": None}],
                             {(1, "2026-10-10T08:00"): "taken", (1, "2026-10-10T20:00"): "skipped"},
                             datetime(2026, 10, 10), datetime(2026, 10, 11, 18), 6)[0]
    assert (ad["due"], ad["taken"], ad["skipped"], ad["no_answer"]) == (4, 1, 1, 2) and ad["adherence"] == 0.25
    # API
    tok = c.post("/api/auth/register", json={"email": "meds@x.kg", "password": "secret1", "name": "M", "role": "patient"}).json()["token"]
    h = auth(tok)
    assert c.post("/api/me/meds", json={"name": "X", "times": ["25:00"]}, headers=h).status_code == 422
    m = c.post("/api/me/meds", json={"name": " Апиксабан ", "dose": "5 мг", "times": ["20:00", "08:00"], "anticoagulant": True}, headers=h).json()
    assert m["name"] == "Апиксабан" and m["times"] == ["08:00", "20:00"]
    today = c.get("/api/me/meds", headers=h).json()["today"]
    assert [d["slot"][-5:] for d in today] == ["08:00", "20:00"] and today[0]["status"] is None
    r = c.post(f"/api/me/meds/{m['id']}/dose", json={"slot": today[0]["slot"], "status": "taken"}, headers=h).json()
    assert r["status"] == "taken"
    c.post(f"/api/me/meds/{m['id']}/dose", json={"slot": today[0]["slot"], "status": "skipped"}, headers=h)   # changed mind
    assert c.get("/api/me/meds", headers=h).json()["today"][0]["status"] == "skipped"
    m2 = c.put(f"/api/me/meds/{m['id']}", json={"name": "Апиксабан", "times": ["09:00"], "anticoagulant": True}, headers=h).json()
    assert [x["id"] for x in c.get("/api/me/meds", headers=h).json()["meds"]] == [m2["id"]]
    assert "medications" in c.get("/api/me/report?hours=24", headers=h).json()
    other = c.post("/api/auth/register", json={"email": "meds2@x.kg", "password": "secret1", "name": "O", "role": "patient"}).json()["token"]
    assert c.delete(f"/api/me/meds/{m2['id']}", headers=auth(other)).status_code == 404
    assert c.delete(f"/api/me/meds/{m2['id']}", headers=h).json() == {"ok": True}


def test_pvc_research_estimate_doctor_only():
    import hashlib
    from app import ectopy
    from app import main as m
    from app.ecgsynth import synth_ecg
    # the committed model is exactly the one Notebook 13 printed (ml/PVC_SMALL.md)
    raw = open(ectopy._MODEL_PATH).read().rstrip("\n")
    assert hashlib.sha256(raw.encode()).hexdigest()[:16] == "f719e22616a9928d"
    assert ectopy.load_model()["kind"] == "trees" and len(ectopy.load_model()["trees"]) == 100
    dt, pt, _ = _pair("pvc")
    e = c.post("/api/ecg", json={"ts": time.time() - 40, "samples": synth_ecg(30, afib=False, bpm=75, seed=5), "state": 0,
                                 "reason": "manual"}, headers=auth(pt)).json()
    s = c.get(f"/api/ecg/{e['id']}", headers=auth(dt)).json()
    est = s["pvc_estimate"]
    assert est["beats"] > 20 and 0 <= est["pvc"] <= est["beats"] and len(est["pvc_at_s"]) == est["pvc"]
    assert "pvc_estimate" not in c.get(f"/api/ecg/{e['id']}", headers=auth(pt)).json()     # never to the patient
    m.PRODUCT_MODE = "wellness"
    try:
        assert "pvc_estimate" not in c.get(f"/api/ecg/{e['id']}", headers=auth(dt)).json()  # not in wellness mode
    finally:
        m.PRODUCT_MODE = "research"


def test_pvc_in_doctor_report_only():
    from app import main as m
    from app.ecgsynth import synth_ecg
    dt, pt, pid = _pair("pvcrep")
    now = time.time()
    for k in range(3):
        c.post("/api/ecg", json={"ts": now - 600 * (k + 1), "samples": synth_ecg(30, afib=k == 1, bpm=70, seed=20 + k),
                                 "state": 2 if k == 1 else 0, "reason": "manual"}, headers=auth(pt))
    c.post("/api/ecg", json={"ts": now - 5000, "samples": [0.0] * 3750, "state": 0, "reason": "manual"}, headers=auth(pt))
    rep = c.get(f"/api/patients/{pid}/report?hours=24", headers=auth(dt)).json()
    pv = rep["pvc"]
    assert pv["strips"] == 3 and pv["skipped"] == 1 and pv["beats"] > 60 and 0 <= pv["pvc"] <= pv["beats"]
    assert pv["share"] == round(pv["pvc"] / pv["beats"], 4)
    assert "pvc" not in c.get("/api/me/report?hours=24", headers=auth(pt)).json()           # never to the patient
    m.PRODUCT_MODE = "wellness"
    try:
        assert "pvc" not in c.get(f"/api/patients/{pid}/report?hours=24", headers=auth(dt)).json()
    finally:
        m.PRODUCT_MODE = "research"


def test_check_plan_control_mode():
    import calendar
    from datetime import timedelta
    from app import analytics, main as m
    from app.db import SessionLocal
    from app.ecgsynth import synth_ecg
    from app.models import CheckPlan
    dt, pt, pid = _pair("plan")
    assert c.get("/api/me/checkplan", headers=auth(pt)).json() is None
    assert c.put("/api/me/checkplan", json={"times": ["25:00"]}, headers=auth(pt)).status_code == 422
    r = c.put(f"/api/patients/{pid}/checkplan", json={"times": ["20:00", "08:00", "14:00"]}, headers=auth(dt)).json()
    assert r["times"] == ["08:00", "14:00", "20:00"] and r["set_by"] == "doctor" and r["active"]
    assert c.get("/api/me/checkplan", headers=auth(pt)).json()["set_by"] == "doctor"
    # the plan started 2 days ago; the patient did checks at 4 of the planned times, two of them irregular in a row
    with SessionLocal() as db:
        p = db.query(CheckPlan).filter_by(patient_id=pid).one()
        p.updated_at = m.utcnow() - timedelta(days=2)
        db.commit()
        start = p.updated_at
    slots = [m.datetime.strptime(s, "%Y-%m-%dT%H:%M") - timedelta(hours=m.TZ_HOURS)
             for s in analytics.dose_slots(["08:00", "14:00", "20:00"], start, m.utcnow(), m.TZ_HOURS)]
    assert 5 <= len(slots) <= 7
    done = slots[:4]
    for k, t in enumerate(done):
        af = k >= 2
        c.post("/api/ecg", json={"ts": calendar.timegm((t + timedelta(minutes=20)).timetuple()),
                                 "samples": synth_ecg(30, afib=af, bpm=95 if af else 70, seed=50 + k), "state": 0, "reason": "check"}, headers=auth(pt))
    last = done[3] + timedelta(minutes=25)       # the repeat 5 minutes later, also AF -> confirmed
    c.post("/api/ecg", json={"ts": calendar.timegm(last.timetuple()), "samples": synth_ecg(30, afib=True, bpm=95, seed=60),
                             "state": 0, "reason": "check"}, headers=auth(pt))
    ch = c.get(f"/api/patients/{pid}/report?hours=72", headers=auth(dt)).json()["checks"]
    assert ch["due"] == len(slots) and ch["done"] == 4 and ch["checks"] == 5
    assert ch["irregular"] >= 2 and ch["confirmed_irregular"] >= 1 and len(ch["last"]) == 5
    assert c.get("/api/me/report?hours=72", headers=auth(pt)).json()["checks"]["done"] == 4
    off = c.put("/api/me/checkplan", json={"times": []}, headers=auth(pt)).json()
    assert off["active"] is False


def test_static_files_cannot_escape_the_portal_folder():
    import os
    from app import main as m
    if not (m.WEB_DIST / "index.html").exists():
        import pytest; pytest.skip("web portal not built")
    up = "..%2F" * 12
    for p in (f"/{up}etc%2Fhostname", f"/{up}proc%2Fself%2Fenviron", "/assets/" + up + "etc%2Fpasswd"):
        r = c.get(p)
        assert r.status_code in (200, 404)
        assert b"<!doctype html>" in r.content.lower() or r.status_code == 404, p      # index.html or 404, never the file
    assert b"PATH=" not in c.get(f"/{up}proc%2Fself%2Fenviron").content       # the environment never leaks


def test_demo_doctor_code_only_for_demo_patients():
    d = c.post("/api/auth/register", json={"email": "doctor@demo.kg", "password": "demo1234", "name": "Demo",
                                           "role": "doctor"}).json()
    code = d["user"]["invite_code"]
    r = c.post("/api/auth/register", json={"email": "real@x.kg", "password": "secret1", "name": "Real",
                                           "role": "patient", "doctor_code": code})
    assert r.status_code == 400
    assert c.post("/api/auth/register", json={"email": "p5@demo.kg", "password": "secret1", "name": "P5",
                                              "role": "patient", "doctor_code": code}).status_code == 200
    p = c.post("/api/auth/register", json={"email": "real2@x.kg", "password": "secret1", "name": "Real2",
                                           "role": "patient"}).json()
    assert c.put("/api/me/doctor", json={"doctor_code": code}, headers=auth(p["token"])).status_code == 400


def test_login_is_limited_after_many_wrong_passwords():
    from app import main
    c.post("/api/auth/register", json={"email": "brute@x.kg", "password": "secret1", "name": "B", "role": "patient"})
    for _ in range(10):
        assert c.post("/api/auth/login", json={"email": "brute@x.kg", "password": "nope00"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "brute@x.kg", "password": "secret1"}).status_code == 429
    main._login_fails.clear()
    assert c.post("/api/auth/login", json={"email": "brute@x.kg", "password": "secret1"}).status_code == 200


def test_no_public_fallback_jwt_secret():
    from app import auth as a
    assert "dev-secret-change-me" not in a.SECRET and len(a.SECRET) >= 32


def test_af_verdicts_only_for_pilot_participants():
    """AF alerts and the "research" view only with research consent and a doctor; demo accounts keep the full demo."""
    d = c.post("/api/auth/register", json={"email": "dpilot@x.kg", "password": "secret1", "name": "D", "role": "doctor"}).json()
    code = d["user"]["invite_code"]
    af = [{"ts": time.time() - 60 + i, "state": 2, "prob": 0.9, "bpm": 110} for i in range(3)]
    def reg(email, consents, with_doctor=True):
        body = {"email": email, "password": "secret1", "name": "P", "role": "patient", "consents": consents}
        if with_doctor:
            body["doctor_code"] = code
        return c.post("/api/auth/register", json=body).json()
    nores = reg("nores@x.kg", ["terms", "data"])
    assert nores["user"]["mode"] == "wellness"
    assert c.post("/api/readings", json={"readings": af}, headers=auth(nores["token"])).json()["alerts"] == 0
    nodoc = reg("nodoc@x.kg", ["terms", "data", "research"], with_doctor=False)
    assert nodoc["user"]["mode"] == "wellness"
    pilot = reg("pilot@x.kg", ["terms", "data", "research"])
    assert pilot["user"]["mode"] == "research"
    assert c.post("/api/readings", json={"readings": af}, headers=auth(pilot["token"])).json()["alerts"] == 1
    c.post("/api/me/consents", json={"kind": "research", "given": False}, headers=auth(pilot["token"]))
    assert c.get("/api/me", headers=auth(pilot["token"])).json()["mode"] == "wellness"
    demo = reg("p7@demo.kg", ["terms", "data"], with_doctor=False)
    assert demo["user"]["mode"] == "research"
    rows = {r["email"]: r for r in c.get("/api/patients", headers=auth(d["token"])).json()}
    assert rows["nores@x.kg"]["mode"] == "wellness" and rows["pilot@x.kg"]["mode"] == "wellness"   # pilot withdrew
    assert rows["nores@x.kg"]["checks_today"] == {"due": 0, "done": 0, "checks": 0, "irregular": 0,
                                                "confirmed_irregular": 0, "plan": False, "last": None}


def test_vitals_diary_typed_in_home_values():
    """Blood pressure, glucose and weight typed by the patient: limits, report summary, export and delete."""
    dt, pt, pid = _pair("vit")
    H = auth(pt)
    assert c.post("/api/me/vitals", json={"kind": "bp", "systolic": 135, "diastolic": 85, "pulse": 72}, headers=H).status_code == 200
    assert c.post("/api/me/vitals", json={"kind": "bp", "systolic": 150, "diastolic": 95}, headers=H).status_code == 200
    assert c.post("/api/me/vitals", json={"kind": "bp", "systolic": 80, "diastolic": 90}, headers=H).status_code == 422   # sys <= dia
    assert c.post("/api/me/vitals", json={"kind": "bp", "systolic": 300, "diastolic": 90}, headers=H).status_code == 422  # out of range
    assert c.post("/api/me/vitals", json={"kind": "glucose", "value": 6.4}, headers=H).status_code == 200
    assert c.post("/api/me/vitals", json={"kind": "glucose", "value": 80}, headers=H).status_code == 422                 # mg/dL typed by mistake
    w = c.post("/api/me/vitals", json={"kind": "weight", "value": 82.5}, headers=H).json()
    assert c.post("/api/me/vitals", json={"kind": "weight"}, headers=H).status_code == 422
    assert c.post("/api/me/vitals", json={"kind": "bp", "systolic": 120, "diastolic": 80}, headers=auth(dt)).status_code == 403
    v = c.get("/api/me/vitals?days=7", headers=H).json()
    assert v["bp"]["n"] == 2 and v["bp"]["sys_mean"] == 142 and v["bp"]["dia_max"] == 95 and v["bp"]["last"]["systolic"] == 150
    assert v["glucose"]["last"]["value"] == 6.4 and v["weight"]["mean"] == 82.5 and len(v["items"]) == 4
    rep = c.get(f"/api/patients/{pid}/report?hours=24", headers=auth(dt)).json()
    assert rep["vitals"]["bp"]["sys_max"] == 150
    assert len(c.get("/api/me/export", headers=H).json()["vitals"]) == 4
    assert c.delete(f"/api/me/vitals/{w['id']}", headers=H).json() == {"deleted": True}
    assert c.get("/api/me/vitals", headers=H).json()["weight"] is None
    assert c.request("DELETE", "/api/me", json={"password": "secret1"}, headers=H).json() == {"deleted": True}


def test_family_mode_sees_plain_words_only():
    """A relative links with a 6-letter code, sees checks/BP/meds in plain words, never the doctor's view; revocable."""
    dt, pt, pid = _pair("fam")
    H = auth(pt)
    code = c.post("/api/me/family/invite", headers=H).json()["code"]
    assert len(code) == 6
    # relative registers with the code
    w = c.post("/api/auth/register", json={"email": "daughter@x.kg", "password": "secret1", "name": "Aigul", "role": "family",
                                           "family_code": code.lower()}).json()
    W = auth(w["token"])
    assert c.post("/api/auth/register", json={"email": "d2fam@x.kg", "password": "secret1", "name": "D2", "role": "family",
                                              "family_code": code}).status_code == 404     # one use
    # patient does a check and types blood pressure
    x = [0.0] * 125 * 30
    c.post("/api/ecg", json={"ts": time.time(), "fs": 125, "samples": x, "state": 1, "prob": 0.1, "bpm": 70, "reason": "check"}, headers=H)
    c.post("/api/me/vitals", json={"kind": "bp", "systolic": 131, "diastolic": 79}, headers=H)
    cards = c.get("/api/family/patients", headers=W).json()
    assert len(cards) == 1 and cards[0]["name"] == "Pat fam"
    assert cards[0]["bp"]["systolic"] == 131 and cards[0]["checks_today"]["checks"] == 1
    assert set(cards[0]) == {"id", "name", "checks_today", "bp", "meds_today", "last_seen"}   # nothing from the doctor's view
    # the relative cannot reach patient or doctor endpoints
    assert c.get("/api/me/report", headers=W).status_code == 403
    assert c.get(f"/api/patients/{pid}/report", headers=W).status_code == 403
    # the patient sees who watches and the access log shows the view
    fam = c.get("/api/me/family", headers=H).json()
    assert fam[0]["name"] == "Aigul"
    assert any(a["action"] == "family_view" for a in c.get("/api/me/access-log", headers=H).json())
    # revoke -> the relative sees nothing
    assert c.delete(f"/api/me/family/{fam[0]['id']}", headers=H).json() == {"revoked": True}
    assert c.get("/api/family/patients", headers=W).json() == []
    assert c.get("/api/me/family", headers=H).json() == []


def test_telegram_patient_chat_types_values_and_week_summary():
    """The bot's text handlers run without the network: a linked patient chat types blood pressure, glucose, weight."""
    from app import telegram as tg
    from app.db import SessionLocal
    from app.models import TelegramLink
    dt, pt, pid = _pair("tgp")
    chat = 990001
    with SessionLocal() as db:
        db.add(TelegramLink(chat_id=chat, kind="patient", user_id=pid, name="Pat")); db.commit()
    assert "Записал давление 135/85, пульс 72" in tg._patient_text(chat, "135 85 72")
    assert "Записал давление 128/79" in tg._patient_text(chat, "128/79")
    assert "вне обычных границ" in tg._patient_text(chat, "300 90")
    assert "больше нижнего" in tg._patient_text(chat, "80 90")
    assert "сахар 6.4" in tg._patient_text(chat, "сахар 6,4")
    assert "ммоль/л" in tg._patient_text(chat, "сахар 120")          # mg/dL by mistake -> explained, not saved
    assert "вес 82.5" in tg._patient_text(chat, "вес 82.5")
    assert tg._patient_text(chat, "привет").startswith("Не понял")
    assert tg._patient_text(123456, "135 85") is None                  # unknown chat: generic help, nothing saved
    v = c.get("/api/me/vitals", headers=auth(pt)).json()
    assert v["bp"]["n"] == 2 and v["glucose"]["n"] == 1 and v["weight"]["n"] == 1
    assert all(i["source"] == "telegram" for i in v["items"])
    week = tg._week(chat)
    assert "ваша неделя" in week and "среднее 132/82" in week
    c.post("/api/me/consents", json={"kind": "research", "given": False}, headers=auth(pt))   # not in the study
    st = tg._status(chat)
    assert "ФП" not in st and "проверок ещё не было" in st             # wellness words only for a non-participant
    assert "ФП" not in tg._status(chat)
    # Kyrgyz: /ky switches the chat; every patient-facing reply comes from the table (app/bot_texts.py)
    assert tg._set_lang(chat, "ky") == "Макул, кыргызча жазам."
    assert tg._patient_text(chat, "кант 5.1").startswith("Кантты жаздым")
    assert "сиздин аптаңыз" in tg._week(chat) and "ФП" not in tg._status(chat) and "текшерүү азырынча болгон жок" in tg._status(chat)
    assert tg._patient_text(chat, "салам").startswith("Түшүнгөн жокмун")
    assert tg._set_lang(chat, "ru").startswith("Хорошо")
    # a new patient whose Telegram is in Kyrgyz gets Kyrgyz from the first message
    from app.bot_texts import T, LANGS
    assert all(set(v) >= set(LANGS) for v in T.values())               # no key without both languages


def test_doctor_seen_and_morning_queue():
    """Irregular checks of the night land in one queue; "seen" is logged and visible to the patient; no finding is made."""
    from app import ecgsynth
    dt, pt, pid = _pair("seen")
    H, D = auth(pt), auth(dt)
    irr = ecgsynth.synth_ecg(30, afib=True, bpm=95, seed=7)
    reg = ecgsynth.synth_ecg(30, afib=False, bpm=70, seed=8)
    a = c.post("/api/ecg", json={"ts": time.time() - 3600, "fs": 125, "samples": irr, "state": 1, "prob": 0.1, "bpm": 95, "reason": "check"}, headers=H).json()
    assert a["check"]["verdict"] == "irregular"
    c.post("/api/ecg", json={"ts": time.time() - 1800, "fs": 125, "samples": reg, "state": 1, "prob": 0.1, "bpm": 70, "reason": "check"}, headers=H)
    q = c.get("/api/checks/queue?hours=24", headers=D).json()
    assert q["open"] == 1 and q["items"][0]["id"] == a["id"] and q["items"][0]["seen"] is None
    other = c.post("/api/auth/register", json={"email": "dseen2@x.kg", "password": "secret1", "name": "D2", "role": "doctor"}).json()["token"]
    assert c.post(f"/api/ecg/{a['id']}/seen", json={"action": "seen"}, headers=auth(other)).status_code == 404   # not his patient
    assert c.post(f"/api/ecg/{a['id']}/seen", json={"action": "call"}, headers=D).json()["seen"]["action"] == "call"
    q = c.get("/api/checks/queue?hours=24", headers=D).json()
    assert q["open"] == 0 and q["items"][0]["seen"]["action"] == "call"
    mine = c.get("/api/me/seen", headers=H).json()
    assert len(mine) == 1 and mine[0]["ecg_id"] == a["id"] and mine[0]["action"] == "call" and mine[0]["doctor"] == "Dr seen"
    assert any(x["action"] == "seen_call" for x in c.get("/api/me/access-log", headers=H).json())
    assert c.get("/api/checks/queue", headers=H).status_code == 403


def test_clinic_device_rental():
    """Rules committed before the code (docs/PRODUCT_PLAN.md row 8): a box cannot be out to two people at once, a patient
    holds at most one box, electrodes are counted, history and CSV exist, the patient sees "issued until"."""
    dt, pt, pid = _pair("rent")
    D, H = auth(dt), auth(pt)
    r = c.post("/api/devices", json={"chip_id": "a1b2c3", "label": "№1", "electrodes": 30}, headers=D)
    assert r.status_code == 200 and r.json()["chip_id"] == "A1B2C3" and r.json()["issue"] is None
    dev = r.json()["id"]
    assert c.post("/api/devices", json={"chip_id": "A1B2C3"}, headers=D).status_code == 409        # same serial twice
    dev2 = c.post("/api/devices", json={"chip_id": "FFEE01", "label": "№2"}, headers=D).json()["id"]
    assert c.get("/api/me/device", headers=H).json() is None
    assert c.post(f"/api/devices/{dev}/issue", json={"patient_id": pid, "days": 14, "electrodes": 45}, headers=D).status_code == 409  # not enough pads
    i = c.post(f"/api/devices/{dev}/issue", json={"patient_id": pid, "days": 14, "electrodes": 20}, headers=D)
    assert i.status_code == 200 and i.json()["overdue"] is False and i.json()["patient"] == "Pat rent"
    assert c.post(f"/api/devices/{dev}/issue", json={"patient_id": pid, "days": 7}, headers=D).status_code == 409   # already out
    assert c.post(f"/api/devices/{dev2}/issue", json={"patient_id": pid, "days": 7}, headers=D).status_code == 409  # patient has one
    assert c.request("DELETE", f"/api/devices/{dev}", headers=D).status_code == 409                                  # cannot retire while out
    me = c.get("/api/me/device", headers=H).json()
    assert me["chip_id"] == "A1B2C3" and me["label"] == "№1" and me["due_at"]
    devs = {d["id"]: d for d in c.get("/api/devices", headers=D).json()}
    assert devs[dev]["electrodes"] == 10 and devs[dev]["issue"]["patient_id"] == pid and devs[dev2]["issue"] is None
    other = c.post("/api/auth/register", json={"email": "drent2@x.kg", "password": "secret1", "name": "D2", "role": "doctor"}).json()["token"]
    assert c.get("/api/devices", headers=auth(other)).json() == []
    assert c.post(f"/api/issues/{i.json()['id']}/return", headers=auth(other)).status_code == 404                     # not his box
    assert c.post(f"/api/issues/{i.json()['id']}/return", headers=D).json()["returned_at"]
    assert c.post(f"/api/issues/{i.json()['id']}/return", headers=D).status_code == 409
    assert c.get("/api/me/device", headers=H).json() is None
    hist = c.get("/api/issues", headers=D).json()
    assert len(hist) == 1 and hist[0]["returned_at"] and c.get("/api/issues?open_only=true", headers=D).json() == []
    csv_ = c.get("/api/issues.csv", headers=D)
    assert csv_.status_code == 200 and "A1B2C3;№1;Pat rent" in csv_.text
    assert c.request("DELETE", f"/api/devices/{dev}", headers=D).json()["ok"]
    assert c.get("/api/devices", headers=H).status_code == 403
    assert any(x["action"] == "device_issue" for x in c.get("/api/me/access-log", headers=H).json())
    assert len(c.get("/api/me/export", headers=H).json()["device_loans"]) == 1


def test_plans_trial_limits_invoice_webhook(monkeypatch):
    """docs/PRICING.md rules: new patient gets 30 days of Family without a card; expired → free; free = 1 relative and
    no patient bot; doctor cabinet limit 10; clinic plan by invoice + manual activation; RevenueCat webhook verified,
    idempotent, grants/ends Family; the verdict path is never touched by plans."""
    from datetime import datetime, timedelta
    from app import main as M
    from app.db import SessionLocal
    from app.models import User
    dt, pt, pid = _pair("tariff")
    D, H = auth(dt), auth(pt)
    me = c.get("/api/me/plan", headers=H).json()
    assert me["plan"] == "family" and me["source"] == "trial" and me["until"] and me["limits"]["family_watchers"] == 5
    assert c.get("/api/me", headers=H).json()["plan"] == "family"
    # expire the trial by hand → free
    with SessionLocal() as db:
        u = db.get(User, pid); u.plan_until = datetime.utcnow() - timedelta(days=1); db.commit()
    me = c.get("/api/me/plan", headers=H).json()
    assert me["plan"] == "free" and me["limits"]["history_days"] == 30
    # free: one relative only; the second gets 402 with a feature code
    for i in range(2):
        code = c.post("/api/me/family/invite", headers=H).json()["code"]
        r = c.post("/api/auth/register", json={"email": f"fplan{i}@x.kg", "password": "secret1", "name": f"F{i}", "role": "family", "family_code": code})
        if i == 0:
            assert r.status_code == 200, r.text
        else:
            assert r.status_code == 402 and r.json()["detail"]["feature"] == "family_watchers"
    # free: patient bot link is a paid feature (503 when bot off would come first, so emulate an enabled bot)
    monkeypatch.setattr(M.telegram, "enabled", lambda: True)
    r = c.post("/api/telegram/link?kind=patient", headers=H)
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "patient_bot"
    assert c.post("/api/telegram/link?kind=family", headers=H).status_code != 402   # relatives' channel stays free
    # history clamps silently to 30 days on free
    assert c.get("/api/me/vitals?days=365", headers=H).status_code == 200
    # doctor: free cabinet is 10 patients; the 11th is refused with doctor_full
    for i in range(9):
        assert c.post("/api/auth/register", json={"email": f"pplan{i}@x.kg", "password": "secret1", "name": f"P{i}", "role": "patient",
                                                  "doctor_code": c.get("/api/me", headers=D).json()["invite_code"]}).status_code == 200
    r = c.post("/api/auth/register", json={"email": "pplan9@x.kg", "password": "secret1", "name": "P9", "role": "patient",
                                           "doctor_code": c.get("/api/me", headers=D).json()["invite_code"]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "doctor_full"
    assert c.get("/api/me/plan", headers=D).json()["usage"]["patients"] == 10
    # clinic asks for an invoice; nothing changes until admin activates
    r = c.post("/api/me/plan/request", json={"plan": "clinic50", "months": 3, "contact": "+996 700 000000"}, headers=D)
    assert r.status_code == 200 and r.json()["requested"] and c.get("/api/me/plan", headers=D).json()["plan"] == "doctor_free"
    assert c.post("/api/admin/plan", json={"email": "doctariff@x.kg", "plan": "clinic50", "days": 90}).status_code == 403  # no token
    monkeypatch.setattr(M, "ADMIN_TOKEN", "test-admin-token")
    assert c.post("/api/admin/plan", json={"email": "doctariff@x.kg", "plan": "clinic50", "days": 90}, headers={"X-Admin-Token": "wrong"}).status_code == 403
    r = c.post("/api/admin/plan", json={"email": "doctariff@x.kg", "plan": "clinic50", "days": 90, "source": "invoice"}, headers={"X-Admin-Token": "test-admin-token"})
    assert r.status_code == 200 and r.json()["plan"] == "clinic50" and r.json()["limits"]["patients"] == 50
    assert c.post("/api/auth/register", json={"email": "pplan9@x.kg", "password": "secret1", "name": "P9", "role": "patient",
                                              "doctor_code": c.get("/api/me", headers=D).json()["invite_code"]}).status_code == 200
    assert c.post("/api/admin/plan", json={"email": "doctariff@x.kg", "plan": "family"}, headers={"X-Admin-Token": "test-admin-token"}).status_code == 400  # wrong role
    # RevenueCat webhook: secret, idempotency, grant and expiration
    exp = int((datetime.utcnow() + timedelta(days=30)).timestamp() * 1000)
    ev = {"event": {"id": "ev-1", "type": "INITIAL_PURCHASE", "app_user_id": str(pid), "product_id": "family_monthly", "expiration_at_ms": exp}}
    assert c.post("/api/billing/revenuecat", json=ev).status_code == 403
    monkeypatch.setattr(M, "RC_WEBHOOK_SECRET", "rc-secret")
    assert c.post("/api/billing/revenuecat", json=ev, headers={"Authorization": "wrong"}).status_code == 403
    r = c.post("/api/billing/revenuecat", json=ev, headers={"Authorization": "rc-secret"})
    assert r.status_code == 200 and r.json()["plan"] == "family"
    assert c.post("/api/billing/revenuecat", json=ev, headers={"Authorization": "rc-secret"}).json()["duplicate"] is True
    me = c.get("/api/me/plan", headers=H).json()
    assert me["plan"] == "family" and me["source"] == "revenuecat"
    ev2 = {"event": {"id": "ev-2", "type": "EXPIRATION", "app_user_id": str(pid), "product_id": "family_monthly"}}
    assert c.post("/api/billing/revenuecat", json=ev2, headers={"Authorization": "rc-secret"}).json()["plan"] == "free"
    # unknown user: recorded, not applied
    ev3 = {"event": {"id": "ev-3", "type": "RENEWAL", "app_user_id": "999999"}}
    assert c.post("/api/billing/revenuecat", json=ev3, headers={"Authorization": "rc-secret"}).json()["applied"] is False
    # export carries the plan, account deletion removes billing rows
    assert c.get("/api/me/export", headers=H).json()["plan"]["plan"] == "free"


def test_verdict_guard_strips():
    """tools/parity/guard_strips.json: 10 strips with frozen verdicts. The phone (tools/mobile/guard_test.ts) and the chip
    (firmware workflow) check the same file. A failure here means the medical rule moved — that needs a notebook."""
    import json
    from pathlib import Path
    from app import ecgtools
    cases = json.loads((Path(__file__).resolve().parents[2] / "tools" / "parity" / "guard_strips.json").read_text())
    assert len(cases) == 10
    for c in cases:
        r = ecgtools.check(c["x"], c["fs"])
        assert (r["verdict"], r["beats"]) == (c["expected"], c["beats"]), c["name"]


def test_export_then_import_into_new_account():
    """Backup/transfer: the export of one account restores records into an empty new account; nothing is duplicated,
    links to the doctor and relatives are not carried over, a second import is refused."""
    from app import ecgsynth
    dt, pt, pid = _pair("bak")
    H = auth(pt)
    c.post("/api/ecg", json={"ts": time.time() - 100, "fs": 125, "samples": ecgsynth.synth_ecg(30, afib=False, bpm=70, seed=3), "reason": "check"}, headers=H)
    c.post("/api/me/vitals", json={"kind": "bp", "systolic": 130, "diastolic": 80, "pulse": 66}, headers=H)
    c.post("/api/symptoms", json={"kinds": ["palpitations"], "severity": 2}, headers=H)
    c.post("/api/me/meds", json={"name": "Апиксабан", "dose": "5 мг", "times": ["08:00", "20:00"], "anticoagulant": True}, headers=H)
    c.put("/api/me/checkplan", json={"times": ["08:00", "20:00"], "active": True}, headers=H)
    exp = c.get("/api/me/export", headers=H).json()
    assert exp["format"] == "afib-monitor-export/1" and len(exp["ecg"]) == 1
    new = c.post("/api/auth/register", json={"email": "bak2@x.kg", "password": "secret1", "name": "New Phone", "role": "patient", "consents": ["terms", "data"]}).json()
    H2 = auth(new["token"])
    r = c.post("/api/me/import", json=exp, headers=H2)
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == {"ecg": 1, "readings": 0, "symptoms": 1, "vitals": 1, "medications": 1, "diary_days": 0, "check_plan": 1}
    assert c.get("/api/me", headers=H2).json()["doctor"] is None                  # doctor link is not carried over
    assert c.get("/api/me/vitals", headers=H2).json()["bp"]["n"] == 1
    assert c.get("/api/me/checkplan", headers=H2).json()["times"] == ["08:00", "20:00"]
    assert c.post("/api/me/import", json=exp, headers=H2).status_code == 409        # not empty any more
    assert c.post("/api/me/import", json={"format": "other"}, headers=H2).status_code == 400
    assert any(x["action"] == "import" for x in c.get("/api/me/access-log", headers=H2).json())


def test_admin_status_counts_only(monkeypatch):
    from app import main as M
    monkeypatch.setattr(M, "ADMIN_TOKEN", "test-admin-token")
    _pair("adm")
    assert c.get("/api/admin/status").status_code == 403
    r = c.get("/api/admin/status?days=7", headers={"X-Admin-Token": "test-admin-token"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["users"]["patients"] > 0 and "share_patients_with_relative" in j["pricing_metrics"]
    assert "email" not in r.text and "name" not in j["users"]                    # counts only, never people


def test_doctor_code_lookup_is_name_and_clinic_only():
    dt, pt, pid = _pair("look")
    code = c.get("/api/me", headers=auth(dt)).json()["invite_code"]
    r = c.get(f"/api/doctor-code/{code.lower()}")
    assert r.status_code == 200 and set(r.json()) == {"name", "clinic"}
    assert c.get("/api/doctor-code/ZZZZZZ").status_code == 404


def test_delete_account_after_doctor_marked_seen():
    """Regression (found by the e2e run on PostgreSQL): a patient whose check the doctor marked "seen" could not delete
    the account — strips were deleted before the marks that reference them. Every record must go, in a valid order."""
    from app import ecgsynth
    dt, pt, pid = _pair("delseen")
    a = c.post("/api/ecg", json={"ts": time.time() - 60, "fs": 125, "samples": ecgsynth.synth_ecg(30, afib=True, bpm=95, seed=7), "reason": "check"}, headers=auth(pt)).json()
    assert c.post(f"/api/ecg/{a['id']}/seen", json={"action": "seen"}, headers=auth(dt)).status_code == 200
    r = c.request("DELETE", "/api/me", json={"password": "secret1"}, headers=auth(pt))
    assert r.status_code == 200, r.text
    assert c.get(f"/api/ecg/{a['id']}", headers=auth(dt)).status_code == 404


def test_access_log_hides_url_tokens_and_security_headers():
    """Secrets never reach the logs: uvicorn prints full URLs, and two credentials travel in URLs (live stream token,
    one-time export link). Every response carries the browser security headers; HSTS only behind HTTPS."""
    import logging
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/api/stream?token=eyJhbG.payload.sig&x=1", "1.1", 200), None)
    rec2 = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                             ("1.2.3.4:5", "GET", "/api/export/AbC-123_xyz", "1.1", 200), None)
    for f in logging.getLogger("uvicorn.access").filters:
        f.filter(rec); f.filter(rec2)
    assert "eyJhbG" not in rec.getMessage() and "token=***&x=1" in rec.getMessage()
    assert "AbC-123" not in rec2.getMessage() and "/api/export/***" in rec2.getMessage()
    r = c.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer" and "Strict-Transport-Security" not in r.headers
    assert "Strict-Transport-Security" in c.get("/api/health", headers={"X-Forwarded-Proto": "https"}).headers
