"""Load test for NFR-12 (docs/engineering/REQUIREMENTS.md) against a RUNNING local server, over real HTTP.

    cd backend && SEED_DEMO=0 DATABASE_URL=sqlite:///loadtest.db uvicorn app.main:app --port 8098 &
    python tools/loadtest.py http://localhost:8098            # 50 clients, 2,000 requests
    python tools/loadtest.py http://localhost:8098 --clients 50 --requests 2000 --json out.json

Target fixed before the first run (commit ae5da83): 0 errors and p95 <= 1,000 ms for each request type, with a mix of
70 % reading uploads (20 readings, what the phone sends every 20 s), 20 % patient reports (24 h) and 10 % doctor
overview. Setup creates one patient per client and one doctor per 10 patients; every test account is deleted at the end.
Refuses any address that is not localhost (it creates accounts)."""
import argparse, json, random, statistics, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("base", nargs="?", default="http://localhost:8098")
ap.add_argument("--clients", type=int, default=50)
ap.add_argument("--requests", type=int, default=2000)
ap.add_argument("--json", default="")
ap.add_argument("--seed", type=int, default=0)
a = ap.parse_args()
BASE = a.base.rstrip("/")
if not any(h in BASE for h in ("://localhost", "://127.0.0.1")):
    sys.exit("refusing to create accounts on a non-local server")
TAG = str(int(time.time()))
PW = "load-" + TAG + "-pass"
MIX = [("upload", 0.7), ("report", 0.2), ("overview", 0.1)]
TARGET_P95_MS = 1000


def call(method, path, body=None, tok=None, timeout=60):
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(BASE + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
            return r.status, (json.loads(data) if data else None)
    except urllib.error.HTTPError as e:
        return e.code, None


def reg(email, name, role, **kw):
    s, j = call("POST", "/api/auth/register", {"email": email, "password": PW, "name": name, "role": role, **kw})
    if s != 200:
        sys.exit(f"setup failed: register {email} -> {s}")
    return j["token"], j["user"]


PER_DOCTOR = 10                                      # a free doctor account holds 10 patients (backend/app/plans.py)
n_doc = (a.clients + PER_DOCTOR - 1) // PER_DOCTOR
print(f"setup: {n_doc} doctors + {a.clients} patients ...", flush=True)
doctors = [reg(f"load-doc-{TAG}-{d}@test.kg", f"Load Doctor {d}", "doctor", clinic="Load Clinic") for d in range(n_doc)]
with ThreadPoolExecutor(8) as ex:
    patients = list(ex.map(lambda i: reg(f"load-pat-{TAG}-{i}@test.kg", f"Load {i}", "patient",
                                         doctor_code=doctors[i // PER_DOCTOR][1]["invite_code"],
                                         consents=["terms", "data", "research"])[0], range(a.clients)))
print(f"setup done ({len(patients)} patients)", flush=True)

rng = random.Random(a.seed)
plan = [rng.choices([k for k, _ in MIX], [w for _, w in MIX])[0] for _ in range(a.requests)]
lat: dict[str, list[float]] = {k: [] for k, _ in MIX}
errors: dict[str, int] = {k: 0 for k, _ in MIX}
codes: dict[str, dict[int, int]] = {k: {} for k, _ in MIX}
lock = threading.Lock()
clock = {i: time.time() - 3600 for i in range(a.clients)}      # each patient's readings move forward in time


def one(i_req):
    i, kind = i_req
    c = i % a.clients
    tok = patients[c]
    if kind == "upload":
        with lock:
            t0 = clock[c]; clock[c] += 20
        body = {"readings": [{"ts": t0 + k, "state": 1, "prob": 0.02, "bpm": 72, "battery": 80} for k in range(20)]}
        args = ("POST", "/api/readings", body, tok)
    elif kind == "report":
        args = ("GET", "/api/me/report?hours=24", None, tok)
    else:
        args = ("GET", "/api/overview", None, doctors[c // PER_DOCTOR][0])
    t = time.perf_counter()
    try:
        s, _ = call(*args)
    except Exception:                                   # timeout, connection reset
        s = -1
    ms = (time.perf_counter() - t) * 1000
    with lock:
        lat[kind].append(ms)
        codes[kind][s] = codes[kind].get(s, 0) + 1
        if s != 200:
            errors[kind] += 1


t_all = time.perf_counter()
with ThreadPoolExecutor(a.clients) as ex:
    list(ex.map(one, enumerate(plan)))
wall = time.perf_counter() - t_all


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


rows, ok = [], True
for k, _ in MIX:
    xs = lat[k]
    r = {"type": k, "n": len(xs), "errors": errors[k], "codes": codes[k], "p50_ms": round(pct(xs, 50), 1),
         "p95_ms": round(pct(xs, 95), 1), "max_ms": round(max(xs), 1) if xs else None,
         "mean_ms": round(statistics.mean(xs), 1) if xs else None}
    r["pass"] = r["errors"] == 0 and r["p95_ms"] <= TARGET_P95_MS
    ok &= r["pass"]
    rows.append(r)
print(f"\n{a.requests} requests, {a.clients} concurrent clients, {wall:.1f} s wall, {a.requests / wall:.0f} req/s")
print(f"{'type':10s} {'n':>5s} {'errors':>6s} {'p50 ms':>8s} {'p95 ms':>8s} {'max ms':>8s}  pass (0 errors, p95 <= {TARGET_P95_MS} ms)")
for r in rows:
    print(f"{r['type']:10s} {r['n']:5d} {r['errors']:6d} {r['p50_ms']:8.1f} {r['p95_ms']:8.1f} {r['max_ms']:8.1f}  {'yes' if r['pass'] else 'NO'}")

# cleanup: delete every test account
for tok in patients + [t for t, _ in doctors]:
    call("DELETE", "/api/me", {"password": PW}, tok)
print("test accounts deleted")
if a.json:
    with open(a.json, "w") as f:
        json.dump({"base": BASE, "clients": a.clients, "requests": a.requests, "wall_s": round(wall, 2),
                   "rows": rows, "pass": ok}, f, indent=1)
print("NFR-12", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
