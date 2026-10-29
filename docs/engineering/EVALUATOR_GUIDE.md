# Evaluator guide: clone, configure, run, test, verify

FEI Full-Stack guideline, Appendix 1 §9 and §10.2. Index: [README.md](README.md). Every command below was run on a fresh
clone on 29.10.2026 (Linux, Python 3.13, Node 22); the results are in `TEST_REPORT.md` §7. macOS works the same way.

## 0. What you need

| For | Tools |
|---|---|
| server, portal, all automated tests | git, Python ≥ 3.12, Node 22 with npm |
| tests on PostgreSQL (optional) | PostgreSQL 16 |
| firmware logic on a PC (optional) | g++ with C++17 |
| phone app on a device (optional) | Android phone (APK) or a Mac with Xcode for an iPhone |
| the sensor (optional) | M5Stack CoreS3 SE + AD8232, USB-C data cable |

## 1. Get the code

```bash
git clone https://github.com/Asilovvv/afib-monitor.git
cd afib-monitor
git tag --list            # the final release tag, once made, is listed here and under GitHub → Releases
# git checkout <tag>      # until then, evaluate main
```

## 2. Run the server and the doctor portal

```bash
# 2.1 build the portal (the server serves it)
cd web && npm ci && npm run build && cd ..

# 2.2 server
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
cp .env.example .env            # optional: edit; nothing in it is required for a local run
set -a && . ./.env && set +a
uvicorn app.main:app --port 8000
```

* Portal: <http://localhost:8000> → "Кабинет врача" → demo doctor `doctor@demo.kg` / `demo1234` (created because `.env` has
  `SEED_DEMO=1`). The language switch (RU / KY / EN) is in the top bar.
* API documentation (OpenAPI): <http://localhost:8000/docs>.
* Health: `curl localhost:8000/api/health` → `{"ok":true,"version":"2.2","mode":"research","db":"sqlite",…}`;
  `curl 'localhost:8000/api/health?deep=1'` also touches the database.
* Database: SQLite file `backend/afib.db`, created with all tables at start-up. For PostgreSQL set
  `DATABASE_URL=postgresql://user:password@host:5432/db` before starting; the same start-up code creates the schema
  (`ARCHITECTURE.md` §10.4). Delete `afib.db` to start from zero.
* Live demo: `DEMO_LIVE=1` makes the five demo patients send readings every few seconds, with an AF episode from time to
  time, so alerts arrive in the portal while you watch.

## 3. Run the automated tests

From the repository root, with the virtual environment of step 2 active. Expected results are what the run of 29.10.2026
printed.

| Suite | Command | Expected |
|---|---|---|
| Server, SQLite | `cd backend && python -m pytest -q tests && cd ..` | `33 passed` |
| Server, PostgreSQL | `cd backend && TEST_DATABASE_URL=postgresql://postgres@localhost:5432/afib python -m pytest -q tests && cd ..` (use a throw-away database: its tables are dropped and re-created) | `33 passed` |
| End-to-end over HTTP | terminal A: `cd backend && SEED_DEMO=0 ADMIN_TOKEN=e2e-admin DATABASE_URL=sqlite:///e2e.db uvicorn app.main:app --port 8099`; terminal B: `python tools/e2e_local.py http://localhost:8099 e2e-admin` | `20/20 passed` (refuses non-local addresses) |
| Portal build (TypeScript + Vite) | `cd web && npm ci && npm run build && cd ..` | `✓ built` |
| App type check and unit tests | `cd mobile && npm ci && npx tsc --noEmit && for t in ecgbus cuffocr snr guard joinlink; do npx -y tsx@4.19.2 ../tools/mobile/${t}_test.ts; done && cd ..` | no errors; `verdict guard ok (phone)`, `SNR parity ok`, … |
| Device code on a PC: 30-s check = server | `PYTHONPATH=backend python tools/parity/make_cases.py /tmp/parity.json /tmp/parity.txt && g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/check30_host.cpp -o /tmp/c30 && /tmp/c30 < /tmp/parity.txt && /tmp/c30 < tools/parity/guard_strips.txt` | `same 40/40`, `same 10/10` |
| Device code on a PC: live path | `pip install numpy && g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/live_host.cpp -o /tmp/live_host && python tools/parity/live_cases.py /tmp/live_host` | `live path OK: 60 decisions identical …` |
| Device code on a PC: saturation guard, PVC parity | see `.github/workflows/firmware.yml`, job `parity` | `clip guard OK`, `same PVC decision 910/910` |
| Pilot analysis pipeline | `pip install numpy scipy matplotlib && python tools/pilot_selftest.py` (needs `pdftoppm` from poppler-utils) | `pilot selftest ok` |
| Load test (NFR-12) | server on port 8098 with `SEED_DEMO=0`, then `python tools/loadtest.py http://localhost:8098` | table of p50/p95 per request type; the target and its result are in `TEST_REPORT.md` §4 |
| Accessibility (NFR-14) | server with `SEED_DEMO=1` on port 8096; in any folder `npm i --no-save axe-core@4.14.0 playwright && npx playwright install chromium`; then `AXE=node_modules/axe-core/axe.min.js node <repo>/tools/a11y_audit.mjs http://localhost:8096` | `NFR-14 (axe part): PASS` |

Continuous integration runs the same suites on every push (GitHub → Actions: **CI**, **Firmware**, **Android APK**).

## 4. The phone app

* **Android:** install the APK from GitHub → Releases → `android-latest` (built by CI from `main`, debug-signed).
* **iPhone:** `docs/IPHONE_INSTALL.md` (Xcode, free Apple account; the install has to be repeated every 7 days).
* **Without a phone:** `cd mobile && npx expo start --web` shows the screens in a browser (no Bluetooth).
* First screen: server address (`http://<your computer's IP>:8000` on the same Wi-Fi, or the public address below), then
  "Демо-пациент" (`aibek@demo.kg` / `demo1234`). Monitor → "Демо-режим без устройства" streams simulated sensor data, so every screen
  works without the sensor.

## 5. The sensor

`curl -fsSL https://raw.githubusercontent.com/Asilovvv/afib-monitor/main/tools/flash_m5.sh | bash` downloads
`firmware-latest` and flashes a CoreS3 SE over USB (port found automatically). Wiring, bench steps and the board-day
checklist: `firmware/README.md`, `firmware/BENCH_TEST.md`, `docs/BOARD_DAY.md`. **Safety:** while electrodes are on a body,
nothing in the circuit may be plugged into the mains.

## 6. The public deployment

* Address: <https://afib-monitor.onrender.com> (portal, API, `/docs`, `/api/health`). Demo accounts as above.
* The free plan stops the service after 15 minutes without traffic; the first request afterwards waits for it to start.
  How long that takes is NFR-13, not measured yet (it needs a network outside this build environment):
  `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" https://afib-monitor.onrender.com/api/health; sleep 1500; done`.

### 6.1 Deploying your own copy

1. Render → **New → Blueprint** → this repository. `render.yaml` builds the `Dockerfile` (portal + API in one container),
   generates `JWT_SECRET`, sets the health check `/api/health` and `SEED_DEMO=1`.
2. Render → Environment: `DATABASE_URL` (Neon PostgreSQL connection string); optional `TELEGRAM_BOT_TOKEN`,
   `ADMIN_TOKEN`, `REVENUECAT_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_CHAT`; `SEED_DEMO=0` for real patients. The full list with
   explanations is `backend/.env.example`. Secrets never go into the repository.
3. TLS is provided by Render on the `onrender.com` address; the server sends HSTS when the request came over HTTPS.
4. Every push to `main` redeploys. Logs: Render → Logs (standard output of uvicorn; tokens in URLs are masked).

### 6.2 Backup and rollback

| What | How |
|---|---|
| Whole database | `pg_dump "$DATABASE_URL" -Fc -f afib-$(date +%F).dump`; restore into an empty database with `pg_restore --no-owner -d "$NEW_DATABASE_URL" afib-YYYY-MM-DD.dump` (pg_dump at least the server's major version). Neon can also restore a branch to an earlier moment within its history window — 6 hours on the Free plan ([Neon: history window](https://neon.com/docs/introduction/history-window)). |
| One person's data | the app or portal exports a JSON file (`/api/me/export`); it imports into an empty account (`/api/me/import`). |
| Code | Render → service → Deploys → **Rollback** on an earlier successful deploy (this turns auto-deploy off until re-enabled in Settings; [Render: rollbacks](https://render.com/docs/rollbacks)); or `git revert` and push. Schema changes are additive (`ARCHITECTURE.md` §10.4), so an older build runs on a newer database. |
| Secrets | change the value in Render → Environment and redeploy; a new `JWT_SECRET` logs everyone out. |

## 7. A structured demonstration (about 10 minutes)

1. Portal as the demo doctor: Overview — patients needing attention, irregular checks of the night, AF burden.
2. Open Гульмира Асанова → ECG on 25 mm/s paper, R peaks and RR, Poincaré plot, signal quality; mark a check "Видел".
3. Report → one page for printing.
4. Phone app (demo mode or the sensor) as `aibek@demo.kg`: Monitor → live ECG and heart rate.
5. "Проверь меня" → preparation → 30 s → result; the strip appears in the doctor's morning queue.
6. Diary: a symptom; blood pressure typed in.
7. Profile → relatives: invite code → a second phone or browser as the relative sees "checks done" in words, no ECG.
8. Portal → Devices: issue the box to a patient, return it, CSV.
9. Privacy: export my data; the access log shows the doctor's views.
10. Sensor (if present): tap → 30-s check on the device's own screen; the same strip gives the same verdict on the server.
