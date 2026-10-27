"""End-to-end scenario against a RUNNING server, over real HTTP (not the test client): every feature of the three product
rounds in the order a clinic would use them, then all test accounts are deleted.

    cd backend && SEED_DEMO=0 ADMIN_TOKEN=e2e-admin DATABASE_URL=sqlite:///e2e.db uvicorn app.main:app --port 8099 &
    python tools/e2e_local.py http://localhost:8099 e2e-admin

It creates accounts, so it refuses any address that is not localhost unless --allow-remote is given (use that only on
your own test server, never on the production database)."""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8099"
ADMIN = sys.argv[2] if len(sys.argv) > 2 else ""
if not any(h in BASE for h in ("://localhost", "://127.0.0.1")) and "--allow-remote" not in sys.argv:
    sys.exit("refusing to create accounts on a non-local server (add --allow-remote for your own test server)")

STRIPS = {c["name"]: c for c in json.loads((Path(__file__).parent / "parity" / "guard_strips.json").read_text())}
TAG = str(int(time.time()))
PW = "e2e-" + TAG + "-pass"
results: list[tuple[str, bool, str]] = []


def call(method, path, body=None, tok=None, headers=None, raw=False):
    h = {"Content-Type": "application/json", **(headers or {})}
    if tok:
        h["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data.decode() if raw else (json.loads(data) if data else None))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def check(name, cond, info=""):
    results.append((name, bool(cond), info))
    print(("ok   " if cond else "FAIL ") + name + (f"  — {info}" if info and not cond else ""))


def reg(email, name, role, **kw):
    s, j = call("POST", "/api/auth/register", {"email": email, "password": PW, "name": name, "role": role, **kw})
    assert s == 200, (s, j)
    return j["token"], j["user"]


toks: list[str] = []
try:
    # 1. clinic: doctor account, code lookup, invitation page
    dtok, doc = reg(f"e2e-doc-{TAG}@test.kg", "E2E Doctor", "doctor", clinic="E2E Clinic"); toks.append(dtok)
    code = doc["invite_code"]
    s, j = call("GET", f"/api/doctor-code/{code}")
    check("doctor code → name and clinic only", s == 200 and set(j) == {"name", "clinic"} and j["clinic"] == "E2E Clinic")
    s, page = call("GET", f"/join?doctor={code}", raw=True)
    if s == 404:
        print("skip public /join page (portal not built on this server)")
    else:
        check("public /join page", s == 200 and "<div id=\"root\">" in page)

    # 2. patient joins by code; 30-day Family trial
    ptok, pat = reg(f"e2e-pat-{TAG}@test.kg", "E2E Patient", "patient", doctor_code=code, consents=["terms", "data"]); toks.append(ptok)
    check("patient linked to doctor", pat["doctor"] and pat["doctor"]["name"] == "E2E Doctor")
    s, plan = call("GET", "/api/me/plan", tok=ptok)
    check("new patient gets Family trial", plan["plan"] == "family" and plan["source"] == "trial")

    # 3. two 30-s checks (frozen guard strips), verdicts as in CI
    now = time.time()
    for i, name in enumerate(("regular_70", "afib_95")):
        st = STRIPS[name]
        s, j = call("POST", "/api/ecg", {"ts": now - 600 + i * 120, "fs": 125, "samples": st["x"], "reason": "check"}, tok=ptok)
        check(f"check {name} → {st['expected']}", s == 200 and j["check"]["verdict"] == st["expected"], f"{s} {j}")
        if name == "afib_95":
            irregular_id = j["id"]

    # 4. diary: blood pressure (typed), glucose
    s, _ = call("POST", "/api/me/vitals", {"kind": "bp", "systolic": 138, "diastolic": 86, "pulse": 74}, tok=ptok)
    s2, _ = call("POST", "/api/me/vitals", {"kind": "glucose", "value": 6.1}, tok=ptok)
    s3, bad = call("POST", "/api/me/vitals", {"kind": "bp", "systolic": 80, "diastolic": 90}, tok=ptok)
    check("vitals saved, implausible refused", s == 200 and s2 == 200 and s3 == 422)

    # 5. relative joins by family code and sees the plain-word card, never the ECG
    s, inv = call("POST", "/api/me/family/invite", tok=ptok)
    ftok, fam = reg(f"e2e-fam-{TAG}@test.kg", "E2E Relative", "family", family_code=inv["code"]); toks.append(ftok)
    s, cards = call("GET", "/api/family/patients", tok=ftok)
    card = cards[0] if cards else {}
    check("relative sees today's checks and BP", card.get("checks_today", {}).get("checks") == 2 and card.get("bp", {}).get("systolic") == 138, json.dumps(card)[:200])
    s, _ = call("GET", f"/api/ecg/{irregular_id}", tok=ftok)
    check("relative cannot open the ECG", s in (403, 404))

    # 6. doctor: morning queue, "will call", patient sees it
    s, q = call("GET", "/api/checks/queue?hours=24", tok=dtok)
    check("irregular check in the doctor's queue", s == 200 and any(i["id"] == irregular_id for i in q["items"]))
    s, _ = call("POST", f"/api/ecg/{irregular_id}/seen", {"action": "call"}, tok=dtok)
    s, seen = call("GET", "/api/me/seen", tok=ptok)
    check("patient sees 'doctor will call'", s == 200 and seen and seen[0]["action"] == "call")

    # 7. rental: device, issue, patient sees it, double issue refused, return, CSV
    s, dev = call("POST", "/api/devices", {"chip_id": "E2E" + TAG[-3:], "label": "№E2E", "electrodes": 30}, tok=dtok)
    s, iss = call("POST", f"/api/devices/{dev['id']}/issue", {"patient_id": pat["id"], "days": 14, "electrodes": 10}, tok=dtok)
    s2, _ = call("POST", f"/api/devices/{dev['id']}/issue", {"patient_id": pat["id"], "days": 7}, tok=dtok)
    s3, mine = call("GET", "/api/me/device", tok=ptok)
    check("device issued once, patient sees due date", s == 200 and s2 == 409 and mine and mine["due_at"])
    s, _ = call("POST", f"/api/issues/{iss['id']}/return", tok=dtok)
    s2, csv = call("GET", "/api/issues.csv", tok=dtok, raw=True)
    check("return + CSV history", s == 200 and s2 == 200 and "№E2E" in csv)

    # 8. backup: export → import into a new empty account
    s, exp = call("GET", "/api/me/export", tok=ptok)
    ntok, _ = reg(f"e2e-new-{TAG}@test.kg", "E2E New Phone", "patient", consents=["terms", "data"]); toks.append(ntok)
    s, imp = call("POST", "/api/me/import", exp, tok=ntok)
    check("export → import into a new account", s == 200 and imp["imported"]["ecg"] == 2 and imp["imported"]["vitals"] == 2, f"{s} {imp}")

    # 9. owner's status: counts only
    if ADMIN:
        s, stt = call("GET", "/api/admin/status?days=1", headers={"X-Admin-Token": ADMIN})
        check("admin status (counts only)", s == 200 and "E2E" not in json.dumps(stt) and stt["users"]["patients"] >= 2)
    s, _ = call("POST", "/api/admin/plan", {"email": "x@y.kg", "plan": "family"})
    check("admin endpoints closed without token", s == 403, f"got {s}")
finally:
    # 10. clean up: delete every account this run made (relative first, doctor last)
    for t in reversed(toks):
        s, _ = call("DELETE", "/api/me", {"password": PW}, tok=t)
        check("delete test account", s == 200, f"status {s}")

bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
