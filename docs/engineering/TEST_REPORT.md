# Test report

FEI Full-Stack guideline, Appendix 1 §8.1 (testing) and §9 (deployment and reproducibility). Index: [README.md](README.md).
Requirements and targets: [REQUIREMENTS.md](REQUIREMENTS.md). Results are reported as measured, including failures. Raw outputs of the new measurements are in [`evidence/`](evidence/).

## 1. Strategy and environment

Tests are derived from the risks of this system, in this order:

1. **A wrong verdict** (the device, the phone and the server disagree, or the model on the chip computes differently):
   parity tests on shared strips, frozen guard strips, bit-exact model checks, known-input checks on the board.
2. **Personal data reaching the wrong person:** authorization tests for every role, family restrictions, research-mode gate.
3. **Lost or corrupted records:** the same API tests on SQLite and PostgreSQL, deletion order, import/export round trip,
   end-to-end over HTTP.
4. **A server that stops answering on the free tier:** load test, health check without database access.
5. **People who cannot use it:** accessibility audit; usability and expert evaluation (`EVALUATION_PLAN.md`).

| Item | Local run, 29.10.2026 | CI (GitHub Actions) |
|---|---|---|
| Commit | 38a4af6: first full local run of all 18 suites (all passed); 3a502e6: the same suites again on a clean clone (§7); load, accessibility and audits in between | every push |
| OS / CPU | Linux 6.18, 2 vCPU Xeon 2.1 GHz, 8 GB RAM | ubuntu-latest |
| Python / Node / C++ | 3.13.16 / 22.22.0 / g++ 13.3 | 3.12 / 22 / g++ (runner) |
| Databases | SQLite 3; PostgreSQL 16 (local cluster) | SQLite; PostgreSQL 16 service container |

## 2. Automated suites and results

| Suite | What it covers | Size | Local result | In CI |
|---|---|---|---|---|
| Server API tests (`backend/tests/test_api.py`) on **SQLite** | every route group through the real app and a real database: roles, validation, business rules, analytics, privacy, plans, Telegram handlers (network faked) | 33 tests, 279 assertions | 33 passed (34 s) | `CI / backend` |
| The same tests on **PostgreSQL 16** | persistence on the production database type | 33 tests | 33 passed (36 s) | `CI / backend-postgres` |
| End-to-end over HTTP (`tools/e2e_local.py`) | a clinic's day over real HTTP against a running server: doctor code, join page, patient link, trial, two 30-s checks, vitals, relative's view and refusal, morning queue, "will call", device loan and return, CSV, export → import, admin closed and open, deletion of every test account | 20 checks | 20/20 on PostgreSQL | `CI / backend-postgres` |
| Pilot analysis self-test (`tools/pilot_selftest.py`) | blinding, refusal without labels, endpoints on synthetic participants | 93 strips | ok (63 s) | `CI / pilot-tools` |
| Portal build | TypeScript type check + production build | — | built | `CI / web` |
| App type check | TypeScript, whole app | — | 0 errors | `CI / mobile` |
| App unit tests (`tools/mobile/*_test.ts`) | BLE packet decoding (`ecgbus`), cuff-photo number parser (`cuffocr`), SNR = Python ±1 dB (`snr`), verdict guard strips on the phone (`guard`), invitation links (`joinlink`) | 5 files | all passed | `CI / mobile` |
| 30-s check: device code = server | `check30.h` compiled on a PC against the server's verdicts | 40 synthetic strips + 10 frozen | 40/40, 10/10 | `Firmware / parity` |
| Live path on a PC | `live_path.h` + `live_gate.h` = 60 frozen decisions; the gate blocks artifact bursts | 60 decisions | identical | `Firmware / parity` |
| Saturation guard | `clip.h` on synthetic rail-to-rail, clipped and stuck signals | 3 signals | ok | `Firmware / parity` |
| PVC estimate: device = server | features and tree model, bit for bit | 40 strips, 910 beats | 910/910, max diff 0 | `Firmware / parity` |
| Model on the chip = trained model | dilated-convolution rewrite bit-exact on 560 inputs; header bytes = model file | 560 inputs | header OK, 28,072 B | `Firmware / model` |
| Firmware build | prototype (CoreS3) and patch v1 targets | 2 builds | — (needs arduino-cli) | `Firmware / build` |
| Android APK | release build of the app | — | — | `Android APK` |

**CI history** (29.10.2026): CI 96 of the last 100 runs successful, 1 running; the 3 failures were the new end-to-end
run on PostgreSQL finding D-09 (fixed in 0801d2e) and the pilot job failing to install poppler (D-23, fixed in 1dd9d4e).
Firmware 32 of 32. Android APK 21 of 25: two builds on 25.10 broken by an Expo dependency drift (D-08), and two runs on
27.10, four minutes apart, whose build step passed but whose "Publish" step (updating the same pre-release) failed.

### 2.1 Negative-path and authorization tests

58 assertions in the server tests check a refusal: 400 × 4, 401 × 6, 402 × 2, 403 × 16, 404 × 11, 409 × 9, 422 × 9,
429 × 1. Examples, expected = actual in every case:

| Case | Expected | Test |
|---|---|---|
| a patient opens the live stream | 403 | `test_stream_requires_doctor` |
| a doctor opens another doctor's patient | 404 | `test_full_flow` |
| a relative opens the patient's ECG or the doctor's report | 403 / 404 | `test_family_mode_sees_plain_words_only`, e2e |
| the family code is used twice | 404 | `test_family_mode_sees_plain_words_only` |
| `../` in the portal path | 404, no file outside `web/dist` | `test_static_files_cannot_escape_the_portal_folder` |
| an 11th login within 15 min after 10 wrong passwords, even with the right one | 429 | `test_login_is_limited_after_many_wrong_passwords` |
| the public demo doctor code for a real e-mail | 400 | `test_demo_doctor_code_only_for_demo_patients` |
| a device lent twice / to a patient who has one | 409 | `test_clinic_device_rental` |
| a paid feature on the free plan | 402 + feature name | `test_plans_trial_limits_invoice_webhook` |
| systolic ≤ diastolic (80/90), glucose 80 (mg/dL typed by mistake), unknown symptom, time "25:00" | 422 | vitals, symptom, medicine and check-plan tests |
| import into an account that has records | 409 | `test_export_then_import_into_new_account` |
| admin route without the token | 403 | `test_admin_status_counts_only`, e2e |
| account deletion with a wrong password | 403 | `test_privacy_consent_export_delete` |

## 3. Hardware and signal tests (board day, 27–29.10.2026)

Criteria were written before each measurement (`docs/BOARD_DAY.md` v1, 27.10.2026); failures stay in the table.

| # | Test | Criterion | Result |
|---|---|---|---|
| A1 | flash with one command | port found, hash verified, screen runs | ✅ 16 MB in 27.7 s, hash verified |
| A2 | AD8232 wiring | 3.3 V on the module, no short | ⚠️ soldered cleanly; voltage not measured (no multimeter) |
| A3 | heart rate vs blood-pressure monitor | ± 5 /min | ⏳ |
| A4 | AFDB playback on the chip vs PC | ≤ 1 pp | ❌ sensitivity 0 % — the chip's int8 kernels were wrong for AF-like inputs (D-11) |
| A4-повтор | same after the fix | ≤ 1 pp | ✅ 99.49 / 80.12 % vs 99.49 / 80.11 % |
| A5 | decision time, free memory | free heap ≥ 50 KB | ✅ 72.9 ms; 100,692 B; 92,524 B after a check |
| A6 | 5 resting 30-s checks | no "irregular" | ❌ 2 of 5 (0.101 and 0.116, threshold 0.10); the screen showed "check again", never "see a doctor" |
| A7 | chip = server on identical samples | all equal | ⏳ tool ready (`afib_stream.py --parity`) |
| A8 | SNR, gel electrodes | ≥ 18 dB | ❌ 16.1–16.4 dB (10.6 dB without skin preparation) |
| A9 | 30 s of arm movement | "poor signal", no verdict | ❌ AF-like result on motion artefacts (D-20) |
| A10 | current and battery life | 3 numbers | ⏳ |
| B1–B10 | phone with the sensor | see `docs/BOARD_DAY.md` | ⏳ |

## 4. Performance (NFR-12) — not met

Target committed before the first run (ae5da83): 50 concurrent clients, 2,000 requests (70 % uploads of 20 readings,
20 % patient reports, 10 % doctor overview), **0 errors and p95 ≤ 1,000 ms for each request type**, server and load
generator on the same machine (2 vCPU), one uvicorn process. Tool: `tools/loadtest.py`.

| Run | Database | Request | n | Errors | p50 ms | p95 ms | max ms | Pass |
|---|---|---|---|---|---|---|---|---|
| 1 (the test fixed in advance) | SQLite | upload | 1,393 | **28** | 407 | **3,875** | 5,480 | ❌ |
| | | report | 397 | 0 | 282 | 507 | 709 | ✅ |
| | | overview | 210 | 0 | 587 | **1,159** | 1,466 | ❌ |
| 2 (extra, production database type) | PostgreSQL 16 | upload | 1,393 | 0 | 704 | 923 | 1,253 | ✅ |
| | | report | 397 | 0 | 701 | 959 | 1,243 | ✅ |
| | | overview | 210 | 0 | 975 | **1,442** | 1,791 | ❌ |

Throughput 62 and 67 requests/s. The 28 errors of run 1 are all `sqlite3.OperationalError: database is locked`: with 50
writers SQLite's 5-second lock wait runs out (D-17). The phone keeps a reading in its queue until the server accepts it, so
such an error delays data rather than losing it — but the error is real. **Reading:** SQLite is fine for a local run and the
demo, not for concurrent patients; production uses PostgreSQL, where uploads and reports met the bar and the doctor's
overview did not (D-18). For scale: 50 phones produce about 2.5 uploads per second, the test sent about 44 per second.

Earlier performance work (all on the free Render instance): the health check stopped scanning all readings (27ff7ac),
product metrics moved into a database window function and a cache (00f6620), the connection pool was sized to the worker
threads and SQLite switched to WAL (4101531; that commit's own load test: 60 concurrent requests × 3 rounds, 0 errors).

## 5. Security tests and dependency audit (NFR-07–09)

| Check | Result |
|---|---|
| Security regression tests | path traversal, no public JWT secret, login limit, demo code guard, admin closed, family refusals, access-log masking and security headers — all pass (33 tests above) |
| Access log on a running server (29.10.2026) | `GET /api/stream?token=…` and `GET /api/export/…` logged as `token=***` and `/api/export/***`; 0 occurrences of the test secrets in the log |
| Secret scan of all 169 commits (bot tokens, cloud keys, private keys, database URLs with passwords, store keys, GitHub tokens) | 0 findings |
| `pip-audit 2.10.1` on `backend/requirements.txt` | **0** known vulnerabilities |
| `npm audit` portal (all dependencies) | **0** |
| `npm audit` app | 9 (4 high, 5 low), all inside Expo's build tools: `@expo/cli`, `@expo/config`, `@expo/metro-config`, `@expo/prebuild-config`, `@expo/local-build-cache-provider`, `node-forge`, `zod`, `deepmerge` |
| Are they shipped? | Production Android bundle exported with source maps (`expo export --platform android --source-maps`): 936 source files from 49 packages; `node-forge`, `zod`, `deepmerge`, `@expo/config`: **0 files**; `@expo/cli`: 1 file, Metro's module loader (`metro-require/require.js`). Accepted until after the phone tests (SECURITY_PRIVACY F-14) |

Findings of the review and their status: [SECURITY_PRIVACY.md §1.3](SECURITY_PRIVACY.md#13-findings-of-the-29102026-review).

## 6. Accessibility (NFR-14) — met after fixes

Target committed before the first run (ae5da83): axe-core WCAG 2.1 A/AA rules, 0 critical and 0 serious violations; every
portal action reachable with the keyboard. Tool: `tools/a11y_audit.mjs` (axe-core 4.14.0, headless Chromium, 13 pages ×
light and dark theme = 26 page views; keyboard pass: up to 60 Tab presses per page, checks that each stop changes
outline, shadow, border or background of the element or its two nearest parents, and lists elements with a pointer
cursor that the Tab order cannot reach).

| Run | Build | Critical | Serious (page views) | Tab stops without visible focus | Clickable but not reachable |
|---|---|---|---|---|---|
| 1 | ae5da83 | 0 | 18 (all colour contrast) | 1–2 per portal page (search box) | 1 per portal page (account menu with "Log out") |
| 2 (focus check refined, same old build) | ae5da83 | 0 | 18 | 1–2 per portal page | 1 per portal page |
| 3 | first fixes | 0 | 7 | 0 | 0 |
| 4 | more fixes | 0 | 2 (grey footnote and footer of the printed report) | 0 | 0 |
| 5 | 92da4cb (committed) | **0** | **0** | **0** | **0** |

What was wrong: secondary text 3.4:1 (light) and 4.3:1 (dark); green, amber and red text below 4.5:1; the printed report's
grey text 3.5:1; retired devices drawn at 55 % opacity; the brand name dark-on-dark on the legal pages in the light theme;
the search box removed its focus ring; the account menu was a `div` with a click handler; `<html lang>` stayed `ru` in
English and Kyrgyz. Run 2 repeated run 1 with the refined focus check on the unchanged build, so the drop to 0 comes from
the fixes, not from the tool. Not tested: real screen readers; the phone app (see SECURITY_PRIVACY §4).

## 7. Reproducibility (NFR-17)

`EVALUATOR_GUIDE.md` §1–§3 followed command by command on a fresh clone from GitHub (commit 3a502e6):

| Step (guide section) | Result | Time |
|---|---|---|
| clone (§1) | ok, commit 3a502e6 | 2 s |
| portal: `npm ci && npm run build` (§2.1) | built | 15 s |
| server: virtual environment, `pip install -r requirements.txt pytest` (§2.2) | ok | 28 s |
| `cp .env.example .env`, load it, `uvicorn …` (§2.2) | `/api/health` ok; `?deep=1` ok; demo doctor login returns a token; portal page and `/docs` served | 8 s |
| server tests, SQLite (§3) | 33 passed | 35 s |
| server tests, PostgreSQL 16 (§3) | 33 passed | 37 s |
| end-to-end over HTTP (§3) | 20/20 passed | 4 s |
| app: `npm ci`, type check, 5 unit tests (§3) | all passed | 31 s |
| device code on a PC: 30-s check (§3) | 40/40 and 10/10 | 2 s |
| device code on a PC: live path (§3) | first attempt stopped after 294 s: `pip install numpy` stalled on a download in this build environment; repeated once numpy was installed → `live path OK: 60 decisions identical` | 2 s |
| pilot analysis self-test (§3) | ok (93 strips) | 73 s |

Total about 9 minutes. The run found one problem in the guide itself before it was published: sourcing the configuration
example with empty values stopped the server at start-up (D-16, fixed in 3a502e6 before this run). Not covered by this
run: the Docker image (no access to Docker Hub from this environment; Render builds the same `Dockerfile` on every deploy),
deployment to Render, the phone and the sensor.

## 8. Operations observations

* **Keep-awake schedule.** `keepalive.yml` asks GitHub to call `/api/health` every 10 minutes. GitHub ran it 41 times in
  the 7 days to 29.10.2026, median gap 244 minutes (102–437), and 6 of 71 runs since 17.10 failed; so the free service does
  sleep between calls and the first request after a pause waits for a cold start (NFR-13, not measured yet). The README now
  says this instead of "every 10 minutes".
* **Health check.** `/api/health` answers without touching the database by design (27ff7ac); `?deep=1` checks it.

## 9. Defect log

Found by: T = automated test, R = review, B = board day, E = end-to-end run, A = audit or measurement, U = use.

| ID | Date | Found by | Defect | Fix | Regression check |
|---|---|---|---|---|---|
| D-01 | 17.10 | U | server failed under load: `/api/metrics` scanned 30 days of readings every 20 s and exhausted the connection pool | 4101531 (cache, one computation at a time, WAL, pool size) | load test in the commit |
| D-02 | 17.10 | U | health check counted every reading; Render restarted the service | 27ff7ac | — |
| D-03 | 17.10 | U | metrics froze the 0.1-CPU server (Python loop over readings) | 00f6620 (window function in SQL, cache 30 min) | tests on SQLite and PostgreSQL |
| D-04 | 20.10 | R | path traversal in the portal file route (`..%2F`) | 96c3d4b, 7e90226 | `test_static_files_cannot_escape_the_portal_folder` |
| D-05 | 20.10 | R | fixed JWT fallback secret published with the code | 47c5f37 | `test_no_public_fallback_jwt_secret` |
| D-06 | 20.10 | R | no limit on login attempts | 47c5f37 | `test_login_is_limited_after_many_wrong_passwords` |
| D-07 | 20.10 | R | a real patient could join the public demo doctor | 47c5f37 | `test_demo_doctor_code_only_for_demo_patients` |
| D-08 | 25.10 | T (CI) | Android build broken by a dependency pulled from the next Expo SDK | 8be3a09 (pin to SDK 57) | `Android APK` workflow |
| D-09 | 27.10 | E (CI, PostgreSQL) | account deletion failed after a doctor marked a check "seen" (row order); SQLite did not enforce foreign keys | 0801d2e (order; `PRAGMA foreign_keys=ON`) | `test_delete_account_after_doctor_marked_seen` |
| D-10 | 27.10 | R | invitation link linked a doctor without confirmation; admin/webhook secret compared in variable time; no import size cap; duplicate diary days | b36a6bf | tests updated |
| D-11 | 27.10 | B (A4) | int8 inference on the chip wrong for AF-like inputs (TFLM/ESP-NN kernels around SPACE_TO_BATCH_ND): sensitivity 0 % | c3a2f56 (dilated convolutions rewritten, weights unchanged, bit-exact) | `--model-check` on the board; CI `model` |
| D-12 | 28.10 | B | saturated AD8232 signal still produced rhythm results on the live screen | 6459ffb (`clip.h`, POOR SIGNAL) | CI `clip_host` |
| D-13 | 29.10 | R | BLE status field `infer_us` is 16-bit and saturates at 65.5 ms since D-11's fix (true 72.9 ms): the app's device screen shows 65.5 ms | **open** — needs a protocol version 2 (firmware + app) | — |
| D-14 | 29.10 | A | accessibility: contrast, search focus, account menu not reachable by keyboard, brand invisible on legal pages, page language | 92da4cb | `tools/a11y_audit.mjs` (runs 4–5) |
| D-15 | 29.10 | R | live-stream and export tokens written to the server log | 4ea1d72 | `test_access_log_hides_url_tokens_and_security_headers` |
| D-16 | 29.10 | R | sourcing the configuration example with empty values made the server fail at start-up | 3a502e6 | clean-clone run (§7) |
| D-17 | 29.10 | A (NFR-12) | SQLite: "database is locked" with 50 concurrent writers | **open** — documented: PostgreSQL for anything beyond a demo | `tools/loadtest.py` |
| D-18 | 29.10 | A (NFR-12) | doctor overview p95 1.44 s at 50 clients on PostgreSQL | **open** | `tools/loadtest.py` |
| D-19 | 29.10 | A | keep-awake runs about every 4 h, not every 10 min | **open** (documented; an external monitor would need an account — owner) | — |
| D-20 | 29.10 | B (A9) | arm movement gives an AF-like live result | **open** — gate tested on reference data (`ml/ROUND4_GATE.md`, 72 % < 80 % bar); shipping is the owner's decision | CI live path test |
| D-21 | 29.10 | B (A6) | 2 of 5 resting checks "irregular" for a healthy volunteer | **analysed, rule unchanged** (`ml/ROUND4_REST.md`); doctor + 12-lead ECG to follow | — |
| D-22 | 29.10 | R | per-address login limit sees the proxy's address on Render | **open** (SECURITY_PRIVACY F-01) | — |
| D-23 | 27.10 | T (CI) | the pilot self-test job could not install poppler (stale package index on the runner) | 1dd9d4e (`apt-get update` first) | `CI / pilot-tools` |

## 10. Not tested yet

Phone with the sensor (B1–B10), heart rate against a cuff (A3), chip = server on the board (A7), power (A10), cold start on
the public server (NFR-13), the offline acceptance test (FR-09, `EVALUATION_PLAN.md` T-OFF), usability and expert
evaluation (NFR-15), real screen readers, an independent penetration test, electrical safety.
