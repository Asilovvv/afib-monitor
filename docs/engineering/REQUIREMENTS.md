# Requirements, research questions and traceability

Part of the engineering documentation for the FEI Full-Stack guideline (Appendix 1, §3–§4). Index: [README.md](README.md).
Every "Status" below points to a test or a recorded measurement; nothing is marked as met without one.
Statuses: ✅ met · ❌ not met (recorded as measured) · ⚠️ partly met · ⏳ not measured yet.

## 1. Problem, scope and constraints

**Problem.** Atrial fibrillation (AF) is often silent or comes in short episodes, so a single ECG at a clinic visit
can miss it; a Holter recording covers only a day or two and needs a clinic. The local context (access to monitoring
in Kyrgyzstan, prices of consumer rhythm devices, existing solutions) is argued with sources in the thesis, Section 1,
and in the competitor analysis; this file does not repeat those claims.

**Intended contribution.** A low-cost chest sensor (ESP32-S3 + AD8232) that checks the rhythm **on the device**, and a
full-stack system that brings the same result to the patient, the doctor and, in plain words, to relatives — in
Russian and Kyrgyz, working offline, on a free cloud tier.

**Scope.** Device firmware, patient app (Android/iOS), doctor web portal, REST + live-event server, database,
Telegram integration, clinic device rental, plans/billing hooks. **Out of scope:** diagnosis (the device is a research
prototype and not a registered medical device), electrical safety certification (IEC 60601-1 needs an engineer), the
clinical pilot itself (needs ethics approval, `docs/pilot/`).

**Constraints.**
* Regulatory: AF wording ("possible AF", alerts) only for pilot participants with research consent and a linked
  doctor; everyone else gets wellness wording (`docs/REGULATORY_BRIEF_RU.md`, `backend/app/main.py` `patient_mode`).
* Budget: free hosting (Render free web service, Neon free PostgreSQL), free CI (GitHub Actions), free ML compute
  (Kaggle) — `docs/BUDGET.md`.
* Hardware: 512 KB SRAM class microcontroller, battery powered, single lead.
* Method: every threshold or pass rule is committed to git **before** the data that tests it is read; results are
  reported as measured, including failures (`ml/*.md`, `docs/BOARD_DAY.md`).

## 2. Stakeholders

| Stakeholder | Role in the system | Main needs |
|---|---|---|
| Patient (adult with known or suspected AF, or a person who wants a rhythm check) | `patient` account, wears the sensor, uses the app | quick check, clear words, works without internet, own data under own control |
| Relative / caregiver | `family` account or Telegram chat | know that checks are done; plain words, no medical detail |
| Doctor (cardiologist or GP), acting for a clinic | `doctor` account, web portal, Telegram | alerts that are worth reading, ECG on a 25 mm/s grid, one-page report, a morning queue |
| Clinic | owns sensors, lends them | track which box is with whom and until when |
| Owner / operator (the author) | `ADMIN_TOKEN` holder | activate invoiced plans, see counts without personal data |
| Ethics committee / researchers | pilot protocol | consent, versioned texts, access log, blinded reading |
| External systems | Telegram Bot API, RevenueCat (store subscriptions), Render, Neon, GitHub Actions, Kaggle | documented, authenticated interfaces |

## 3. Research and evaluation questions

**Principal question (RQ0).** Can a low-cost sensor run AF screening *on the device* and deliver the same, explainable
result to the patient, the doctor and relatives through a full-stack system, under the constraints of a free cloud
tier and an unregistered (research) device?

| ID | Question | Kind | Evidence that answers it |
|---|---|---|---|
| RQ1 | Does the int8 RR-interval model give the same result on the microcontroller as on a PC, within the device's time and memory budget? | correctness, performance | `docs/BOARD_DAY.md` A4, A4-повтор, A5; CI job `model` |
| RQ2 | Does one rule for the 30-second check give the same verdict on the chip, the phone and the server? | architectural suitability | CI parity (40 synthetic + 10 frozen strips); A7 on hardware |
| RQ3 | How well does the 30-second check separate AF from normal rhythm on data it was not developed on, and what does noise do to it? | effectiveness | `ml/CHECK30_V3.md`, `ml/REPEAT_LTAFDB.md`, `ml/ROUND4_REST.md`, `ml/ROUND4_GATE.md` |
| RQ4 | Can patients complete the core tasks without help, and do doctors find the output useful? | usability | `EVALUATION_PLAN.md` (not run yet) |
| RQ5 | Does the server stay correct and responsive on a free cloud tier (sleep, small CPU, connection limits)? | performance, reliability | fixes 4101531, 27ff7ac, 00f6620; `TEST_REPORT.md` §4 |
| RQ6 | Are personal health data protected (authorization, consent, export, deletion) and is AF wording limited to consenting pilot participants? | security, privacy | backend tests, `SECURITY_PRIVACY.md` |

## 4. Functional requirements

Priority: **M** must, **S** should, **C** could (MoSCoW). Components are defined in
[ARCHITECTURE.md §3](ARCHITECTURE.md#3-components). Test names without a path are in `backend/tests/test_api.py`;
"e2e:" steps are in `tools/e2e_local.py`.

### Device (firmware)

| ID | P | Requirement | Acceptance criterion | Verified by | Status |
|---|---|---|---|---|---|
| FR-01 | M | The device samples one ECG lead at 250 Hz, band-pass filters it, decimates to 125 Hz and detects R peaks on the device. | Firmware beats = reference detector (XQRS) beats on recordings from the body, within ±150 ms after removing the median lag between the two detectors. | `afib_stream.py --review`; BOARD_DAY live recording 78/78, A6 checks 30/30 … 34/34, A8 31/31, 33/33, 31/31 | ✅ (rest); ❌ under motion (A9: 2 extra beats) |
| FR-02 | M | Every 4 beats the device runs the int8 RR-interval TCN on the last 32 RR intervals. | Window sensitivity/specificity on the 5 AFDB evaluation records within 1 percentage point of the same model on a PC. | A4-повтор; `--model-check` (60 inputs); CI `model` (bit-exact on 560 inputs) | ✅ 99.49/80.12 % vs 99.49/80.11 % |
| FR-03 | M | A 30-second check on the device: regular / irregular / could not read, with the two-check confirmation on screen. | Same verdict as the server rule on every shared test strip. | CI `fw_parity` 40/40, guard strips 10/10 | ✅ (code); ⏳ A7 on hardware |
| FR-04 | M | The device sends a status packet (~1/s) and the ECG (125 Hz, 20 samples per packet) over BLE. | The app decodes every packet the firmware builds; 6.25 ± 0.5 packets/s, 0 lost per minute at 1 m. | `tools/mobile/ecgbus_test.ts`; BOARD_DAY B3 | ✅ (format); ⏳ B3 |
| FR-05 | M | No rhythm result on a saturated, flat or disconnected signal: the screen says POOR SIGNAL / CHECK ELECTRODES and BLE state 3 is sent. | Saturated synthetic signals are flagged; a 30-s arm movement gives "poor signal", not a rhythm result. | CI `clip_host` (3 signals); BOARD_DAY A9 | ⚠️ saturation ✅; motion ❌ (A9). Motion gate tested on reference data (`ml/ROUND4_GATE.md`); shipping it is the owner's decision |

### Patient app

| ID | P | Requirement | Acceptance criterion | Verified by | Status |
|---|---|---|---|---|---|
| FR-06 | M | Sign up / sign in; link to a doctor with an invite code, after showing the doctor's name and clinic. | Wrong code → 404; demo code refused for real addresses; lookup returns name and clinic only. | `test_full_flow`, `test_doctor_code_lookup_is_name_and_clinic_only`, `test_demo_doctor_code_only_for_demo_patients`; e2e "patient linked to doctor" | ✅ |
| FR-07 | M | Connect to the sensor over BLE and show live ECG, heart rate and state; a demo mode works without hardware. | Connection ≤ 15 s; live ECG strip moves. | BOARD_DAY B1, B2 | ⏳ |
| FR-08 | M | "Check me in 30 seconds" with preparation steps; the phone gives the same verdict as the server and queues the strip for the doctor. | Same verdict as the server on the 10 frozen strips; refuses a recording with gaps. | `tools/mobile/guard_test.ts` 10/10; e2e "check regular_70 → regular", "check afib_95 → irregular"; BOARD_DAY B5, B6 | ✅ (code); ⏳ B5/B6 |
| FR-09 | M | Offline first: readings, ECG strips and symptoms recorded without internet are kept on the phone and uploaded every 20 s once the server is reachable. | After 10 min in airplane mode with the sensor on, every reading of that period reaches the server (up to 20,000 readings / 20 strips kept). | manual test (`EVALUATION_PLAN.md` §4, T-OFF) | ⏳ |
| FR-10 | S | Symptom diary (kinds, severity, note, optional ECG) and daily lifestyle factors. | Unknown symptom/factor → 422; factors appear in the doctor's report. | `test_v2_features`, `test_diary_factors_and_triggers` | ✅ |
| FR-11 | S | Medicine schedule with taken/skipped answers per dose; adherence in the doctor's report. | Changing a schedule keeps past adherence; bad time → 422. | `test_medications_and_adherence` | ✅ |
| FR-12 | S | Home values typed in: blood pressure, glucose, weight; the cuff photo is read on the phone and never uploaded. | Implausible values → 422; values appear in report, export, deletion. | `test_vitals_diary_typed_in_home_values`; `tools/mobile/cuffocr_test.ts`; BOARD_DAY B8 (≥ 16 of 20 photos) | ✅ (rules); ⏳ B8 |
| FR-13 | S | A plan of scheduled 30-s checks, set by the patient or the doctor, with reminders. | Plan stored, adherence counted, doctor's plan visible to the patient. | `test_check_plan_control_mode` | ✅ |
| FR-14 | M | The user can export all own data, move it into a new account, see who opened it, and delete the account with every record. | Export holds profile, consents, plan, readings, alerts, ECG, symptoms, vitals, loans, doctor marks, family links, medicines and doses, check plan, diary, doctor notes and access log; import only into an empty account; deletion leaves no row about the user (SQLite and PostgreSQL). | `test_privacy_consent_export_delete`, `test_export_then_import_into_new_account`, `test_delete_account_after_doctor_marked_seen`; e2e "export → import", "delete test account" | ✅ |
| FR-15 | M | Wellness by default: AF estimates, episodes and AF alerts only for patients with a current research consent and a linked doctor (demo accounts excepted). | Without consent or without doctor: no alert is created and the API reports `mode: wellness`. | `test_af_verdicts_only_for_pilot_participants`, `test_feedback_metrics_and_wellness_mode` | ✅ |

### Doctor portal

| ID | P | Requirement | Acceptance criterion | Verified by | Status |
|---|---|---|---|---|---|
| FR-16 | M | Patient list, overview and per-patient report: heart rate, AF episodes and burden, ECG on a 25 mm/s grid, symptoms, notes; printable one-page report. | A doctor sees only own patients (others → 404). | `test_full_flow`; `docs/screenshots/web/` | ✅ |
| FR-17 | M | Live alert at AF onset (research mode) in the portal (SSE) with "accept"; the stream is for doctors only. | Alert created once per onset; patient token on the stream → 403; invalid token → 401. | `test_full_flow`, `test_stream_requires_doctor` | ✅ |
| FR-18 | S | The doctor marks an episode as confirmed / false alarm and writes notes. | Review stored and shown in the report; notes deletable by their author only. | `test_full_flow` | ✅ |
| FR-19 | S | Morning queue of irregular checks; "seen" / "will call" is shown to the patient. No finding is recorded. | Irregular checks of the night in one list; mark reaches the patient's app. | `test_doctor_seen_and_morning_queue`; e2e "irregular check in the doctor's queue", "patient sees 'doctor will call'"; BOARD_DAY B10 | ✅ (server); ⏳ B10 |
| FR-20 | S | CHA₂DS₂-VASc / CHA₂DS₂-VA calculator stored per patient; the patient sees the result. | Score matches the published rule; only the patient's doctor can edit. | `test_cha2ds2_vasc` | ✅ |
| FR-21 | C | Clinic sensor rental: devices, loans with due date, returns, CSV history, reminders. | A box cannot be lent twice at once; a patient holds at most one. | `test_clinic_device_rental`; e2e "device issued once", "return + CSV history" | ✅ |

### Server, analytics and integrations

| ID | P | Requirement | Acceptance criterion | Verified by | Status |
|---|---|---|---|---|---|
| FR-22 | M | AF episode = consecutive AF readings with gaps ≤ 60 s lasting ≥ 30 s; AF burden; heart-rate events and pauses. | A 12-s AF run is not an episode. | `test_short_af_is_not_an_episode`, `test_heart_rate_events_and_pauses` | ✅ |
| FR-23 | S | ECG strip analysis on the server: R peaks, RR, Poincaré (SD1/SD2), irregularity, signal quality; PVC estimate for the doctor only (research). | Same 30-s verdict as the device; PVC never shown to the patient. | `test_ecg_analysis_and_poincare`, `test_check_30_seconds`, `test_verdict_guard_strips`, `test_pvc_research_estimate_doctor_only`, `test_pvc_in_doctor_report_only`; CI `fw_pvc_parity` 910/910 | ✅ |
| FR-24 | S | Telegram: AF alert with ECG image and "Accept" to the doctor and relatives; patient bot (RU/KY) for typed values, reminders and a weekly summary. | Webhook without the secret → 403; one-time link codes; every copy of an alert updates on accept. | `test_telegram_flow`, `test_telegram_patient_chat_types_values_and_week_summary` | ✅ |
| FR-25 | S | Family mode: a relative linked by a one-time code sees checks done, verdict words, typed BP and medicines — never ECG, probabilities or alerts; the patient can revoke. | Relative → ECG endpoint 403/404; after revoke → no access. | `test_family_mode_sees_plain_words_only`; e2e "relative cannot open the ECG"; BOARD_DAY B9 | ✅ (server); ⏳ B9 |
| FR-26 | C | Plans: everything safety-related free; "Family" 30-day trial without a card; clinic plans by invoice; limits enforced on the server; store webhook idempotent. | Over-limit → 402 with the feature name; duplicate webhook event ignored. | `test_plans_trial_limits_invoice_webhook` | ✅ |
| FR-27 | C | Owner tools: plan activation and a status page with counts only, behind `ADMIN_TOKEN`. | Without the token → 403 before the body is read; no personal data in the status. | `test_admin_status_counts_only`; e2e "admin endpoints closed without token" | ✅ |
| FR-28 | S | Interface in Russian, Kyrgyz and English; light and dark themes (portal and app). | Every screen has the three languages. | manual (screenshots `docs/screenshots/`) | ⚠️ not checked screen by screen |

## 5. Non-functional requirements

"Target fixed" says when the bar was written down. Targets fixed **by this document** are measured only after it is
committed; their results are in `TEST_REPORT.md`.

| ID | Quality | Target | Method | Target fixed | Status / result |
|---|---|---|---|---|---|
| NFR-01 | Correctness (device = PC) | window sensitivity and specificity on 5 AFDB records within 1 pp of the PC model | `afib_stream.py --eval` | BOARD_DAY v1, 27.10.2026 (4cd51c8) | ✅ 0.00 / 0.01 pp (A4-повтор) |
| NFR-02 | Consistency across tiers | identical 30-s verdict on chip, phone and server | CI parity 40 strips + 10 frozen strips; A7 on hardware | 0f1ea44 (guard strips), BOARD_DAY v1 (A7) | ✅ CI; ⏳ A7 |
| NFR-03 | Memory (device) | free heap ≥ 50 KB while running, including after a 30-s check | `afib_stream.py --bench`, `checks.log` | BOARD_DAY v1 | ✅ 100,692 B; 92,524 B after a check |
| NFR-04 | Time (device) | decision time recorded (no bar was fixed before the measurement) | `--bench`, 100 runs | — | 72.9 ms mean (A5); reported, not graded |
| NFR-05 | Signal quality | SNR ≥ 18 dB with gel electrodes at rest | `afib_stream.py --snr` | `ml/SNR_REQUIREMENT.md` (44ded87) | ❌ 16.1–16.4 dB (A8); the bench SNR scale differs from the requirement's (`ml/ROUND4_REST.md` §5) |
| NFR-06 | Rhythm check at rest | no "irregular" in 5 resting checks of a healthy volunteer | `--checks 5` | BOARD_DAY v1 | ❌ 2 of 5 (A6); rate on 72 healthy people: 0.4–2.4 %, ~10 % below 60/min (`ml/ROUND4_REST.md`) |
| NFR-07 | Security: authentication | bcrypt password hashes; HS256 tokens signed with a secret ≥ 32 characters (random per run if missing); 10 wrong passwords per account in 15 min → 429 | tests | 47c5f37 (20.10.2026) | ✅ `test_no_public_fallback_jwt_secret`, `test_login_is_limited_after_many_wrong_passwords` |
| NFR-08 | Security: authorization | every endpoint with personal data refuses other roles (403) and other doctors' patients (404); tokens on the live stream for doctors only | tests | 47c5f37 and earlier | ✅ 401/403/404 cases in `test_full_flow`, `test_stream_requires_doctor`, `test_family_mode_sees_plain_words_only`, `test_clinic_device_rental` |
| NFR-09 | Security: dependencies | 0 known vulnerabilities in packages shipped to users (server, portal); build-time findings reviewed | `pip-audit`, `npm audit --omit=dev` | this document | ✅ server 0, portal 0; app: 9 in Expo build tools, not in the app bundle — reviewed and accepted (`TEST_REPORT.md` §5) |
| NFR-10 | Privacy | export, transfer and deletion available to every user; deletion removes every row about the user on SQLite and PostgreSQL; consents versioned; doctor access logged | tests on both databases | 3ec912e and earlier | ✅ FR-14 tests on SQLite and PostgreSQL |
| NFR-11 | Wellness wording | no patient outside the pilot sees AF estimates, episodes or AF alerts | `test_af_verdicts_only_for_pilot_participants` | round 3 | ✅ |
| NFR-12 | Server performance | 50 concurrent clients, 2,000 requests (70 % reading uploads of 20 readings, 20 % patient reports, 10 % doctor overview) on the evaluator's machine: 0 errors and p95 ≤ 1,000 ms per request type | `tools/loadtest.py` (local server, SQLite) | this document | ❌ SQLite: 28 errors (database locked), upload p95 3.9 s; extra run on PostgreSQL: 0 errors, overview p95 1.4 s (`TEST_REPORT.md` §4) |
| NFR-13 | Availability (free tier) | `/api/health` answers without touching the database; after ≥ 20 min idle the first request answers within 60 s | `curl -w %{time_total}`, 5 times | this document | ⏳ needs a network outside this workspace (`EVALUATOR_GUIDE.md` §6) |
| NFR-14 | Accessibility (portal) | automated WCAG 2.1 A/AA rules (axe-core) on the public pages and the main portal pages: 0 critical and 0 serious violations; every portal action reachable with the keyboard | axe-core in a headless browser; manual keyboard pass | this document | ❌ first run (18 serious, keyboard gaps) → fixed → ✅ 0 violations, keyboard pass clean (`TEST_REPORT.md` §6); screen readers not tested |
| NFR-15 | Usability | SUS ≥ 68 (average benchmark) and ≥ 80 % task success on the core patient tasks, ≥ 5 participants | `EVALUATION_PLAN.md` | this document | ⏳ |
| NFR-16 | Maintainability | every push runs backend tests (SQLite + PostgreSQL), the end-to-end HTTP test, the portal build and the app's type check and unit tests; every change to the firmware or to the shared check code also runs parity, model and firmware build; every change to the app builds the Android APK; `main` stays green | GitHub Actions | ci.yml, firmware.yml, android.yml | ✅ last runs green (`TEST_REPORT.md` §2) |
| NFR-17 | Reproducibility | a fresh clone runs the server and the tests with the documented commands only | `EVALUATOR_GUIDE.md` on a clean checkout | this document | ✅ every step passed on a fresh clone of 3a502e6 (one step repeated after a stalled package download) — `TEST_REPORT.md` §7 |
| NFR-18 | Data integrity | foreign keys enforced on both databases; uniqueness where the rules need it (e-mail, one diary row per day, one answer per dose, one "seen" per strip, one device per chip per clinic, one billing event per id) | schema + regression test | 0801d2e | ✅ |
| NFR-19 | Power | current in 3 modes and battery life recorded | INA219 (A10) | BOARD_DAY v1 | ⏳ |

## 6. Traceability: requirement → component → feature → test → evaluation

| Req | Components | Feature (user-visible) | Tests | Evaluation evidence |
|---|---|---|---|---|
| FR-01 | FW-SIG | live ECG strip, heart rate | `fw_live_path` (60 frozen decisions) | BOARD_DAY 78/78 beats at rest; A9 motion ❌ |
| FR-02 | FW-NN | research score (database playback / pilot) | CI `model`, `fw_model_header` | A4 ❌ → fix → A4-повтор ✅; LOPO 98.3/96.5 % (`ml/LOPO_RESULTS.md`); CinC 2017 93.9/95.4 % (`ml/EXTERNAL_CINC2017.md`) |
| FR-03 | FW-C30, APP-CHK, ANL | "30 s check" result on device, phone, portal | `fw_parity_40_strips`, `fw_guard_strips`, `mobile_guard_test`, `test_verdict_guard_strips` | CinC 2017: AF 85.6 % / Normal 8.9 % irregular (`ml/CHECK30_V3.md`); LTAFDB twice in a row 92.3 / 8.7 % (`ml/REPEAT_LTAFDB.md`); A6 ❌ |
| FR-04 | FW-BLE, APP-BLE | live strip in the app | `mobile_ecgbus_test` | ⏳ B3 |
| FR-05 | FW-SIG, FW-UI | POOR SIGNAL / CHECK ELECTRODES | `fw_clip_guard`; live gate in `fw_live_path` | A9 ❌; gate: noise-induced changes blocked 72.9 % / 71.0 % < 80 % bar (`ml/ROUND4_GATE.md`) |
| FR-06 | APP-UI, API, AUTH, DB | sign up, doctor code | `test_full_flow`, `test_doctor_code_lookup…`, `test_demo_doctor_code…` | e2e ✅ |
| FR-07 | APP-BLE, APP-UI | Monitor tab, demo mode | — | ⏳ B1, B2 |
| FR-08 | APP-CHK, APP-STORE, API | check sheet | `mobile_guard_test`, e2e checks | ⏳ B5, B6 |
| FR-09 | APP-STORE | pending counter, sync | — | ⏳ T-OFF |
| FR-10 | APP-UI, API, ANL | symptoms, diary factors | `test_v2_features`, `test_diary_factors_and_triggers` | — |
| FR-11 | APP-UI, API, ANL | medicines | `test_medications_and_adherence` | — |
| FR-12 | APP-UI (cuff OCR), API | vitals | `test_vitals_diary…`, `mobile_cuffocr_test` | ⏳ B8 |
| FR-13 | APP-UI, API, ANL | check plan | `test_check_plan_control_mode` | — |
| FR-14 | API, DB | export, import, delete, access log | `test_privacy_consent_export_delete`, `test_export_then_import…`, `test_delete_account_after…` | e2e ✅ on PostgreSQL |
| FR-15 | API (`patient_mode`) | wellness vs research view | `test_af_verdicts_only_for_pilot_participants` | — |
| FR-16 | WEB, API, ANL | Overview, Patients, Patient, Report | `test_full_flow` | screenshots; ⏳ doctor review (EVALUATION_PLAN §3) |
| FR-17 | API, EVT, WEB | live alert toast and sound | `test_full_flow`, `test_stream_requires_doctor` | ⏳ doctor review |
| FR-18 | WEB, API | episode review, notes | `test_full_flow` | — |
| FR-19 | WEB, API, APP-UI | morning queue, "seen" notice | `test_doctor_seen_and_morning_queue`, e2e | ⏳ B10 |
| FR-20 | WEB, API, ANL (`risk.py`) | CHA₂DS₂-VASc card | `test_cha2ds2_vasc` | — |
| FR-21 | WEB, API, DB | Devices page | `test_clinic_device_rental`, e2e | — |
| FR-22 | ANL (`analytics.py`) | episodes, burden, HR events | `test_short_af_is_not_an_episode`, `test_heart_rate_events_and_pauses` | LOPO: 226/226 episodes ≥ 30 s alarmed; 30-s rule 0.91 false alarms/h (`ml/LOPO_RESULTS.md`) |
| FR-23 | ANL (`ecgtools.py`, `ectopy.py`) | ECG window: Poincaré, quality, PVC | `test_ecg_analysis_and_poincare`, `test_pvc_*`, `fw_pvc_parity` | `ml/ECTOPY_QRS_DS2.md`, `ml/PVC_GATE.md` |
| FR-24 | TG, API | Telegram alerts and patient bot | `test_telegram_flow`, `test_telegram_patient_chat…` | — |
| FR-25 | API, APP-UI, TG | family home screen | `test_family_mode_sees_plain_words_only`, e2e | ⏳ B9 |
| FR-26 | BILL, API | "What's included", plan card | `test_plans_trial_limits_invoice_webhook` | — |
| FR-27 | API, WEB (Admin) | owner status page | `test_admin_status_counts_only`, e2e | — |
| FR-28 | APP-UI, WEB | language and theme switch | — | ⚠️ manual |
| NFR-07…11, 18 | AUTH, API, DB | — | see §5 | `SECURITY_PRIVACY.md` |
| NFR-12, 13 | API, DB, deployment | — | `tools/loadtest.py`, curl | `TEST_REPORT.md` §4 |
| NFR-14 | WEB | — | axe-core run | `TEST_REPORT.md` §6 |
| NFR-15 | APP-UI, WEB | — | — | `EVALUATION_PLAN.md` |

## 7. Change control

* A change to a verdict rule or threshold (30-s check, model threshold, gates) needs a written plan committed before the
  data is read, the same change on chip, phone and server, green parity and guard strips, and the owner's approval
  (`ml/ROUND4_PREREG.md` is the latest example).
* A requirement that fails stays in this file as failed; a repeat after a fix is a new row or a new line, never an
  edited result (see A4 → A4-повтор).
