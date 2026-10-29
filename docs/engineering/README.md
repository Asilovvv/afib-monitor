# Engineering documentation (FEI Full-Stack guideline, Appendix 1)

Where each requirement of the Faculty's Full-Stack Software Development guideline (academic year 2026–2027) is answered
in this repository, and what is still missing. Status: ✅ in the repository · ⏳ planned or waiting for the author ·
❌ measured and not met (kept as measured).

| Document | Contents |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | problem, stakeholders, research questions, 28 functional and 19 non-functional requirements with priorities and acceptance criteria, traceability |
| [ARCHITECTURE.md](ARCHITECTURE.md) | context, container, component, sequence, data-flow, state and deployment diagrams; technology selection; data model; API and BLE interfaces; user interface |
| [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | threats and controls, findings, personal data, ethics, accessibility |
| [TEST_REPORT.md](TEST_REPORT.md) | test strategy, suites and results, hardware tests, performance, security, accessibility, reproducibility, defect log |
| [EVALUATION_PLAN.md](EVALUATION_PLAN.md) | usability test, expert review, offline acceptance test, client interviews |
| [EVALUATOR_GUIDE.md](EVALUATOR_GUIDE.md) | clone, configure, run, test, deploy, back up, roll back, demonstrate |
| [THIRD_PARTY.md](THIRD_PARTY.md) | libraries, licences, datasets, reused designs, services |

## Checklist against the guideline

| Guideline item | Answer | Status |
|---|---|---|
| §2 Required elements: client, server, persistent storage, documented interfaces, reproducible deployment; auth, validation, errors, logging, monitoring, configuration | phone app + portal; FastAPI; PostgreSQL/SQLite; OpenAPI `/docs` + BLE protocol; Dockerfile + `render.yaml`; JWT roles; Pydantic; health checks; `.env.example` — ARCHITECTURE §3, §8, §11 | ✅ |
| §2 Evidence of complexity | role-based access (patient, doctor, relative, owner) with a consent-based research mode; on-device neural network with the same 30-s rule on three tiers; real-time alerts (SSE, Telegram); offline sync; analytics; idempotent webhooks; measurable quality targets; free-tier deployment | ✅ |
| §3 Problem, objectives, research questions | REQUIREMENTS §1, §3 (principal question RQ0 and RQ1–RQ6) | ✅ (literature review is in the thesis) |
| §4 Stakeholders, FR, NFR, traceability | REQUIREMENTS §2, §4, §5, §6 | ✅ |
| §5 Architecture and models, technology selection, data and interfaces, UI | ARCHITECTURE | ✅ |
| §6.1 Version control, final release | public repository, 157 commits since 16.10.2026 under the author's GitHub account; release tag | ⏳ final tag before the May upload |
| §6.2 Individual contribution | thesis section with the author's declaration (initial state, reused work, AI use) | ⏳ author |
| §7 Security, privacy and ethics, accessibility | SECURITY_PRIVACY; root `SECURITY.md` | ✅ analysis; ⏳ open findings F-01, F-04, F-06, F-10 |
| §8.1 Testing | TEST_REPORT §1–§6, §9 | ✅ (NFR-12 ❌ as measured) |
| §8.2–8.3 Evaluation with real users or experts | EVALUATION_PLAN | ⏳ needs the supervisor's approval, then sessions |
| §9 Deployment and reproducibility | EVALUATOR_GUIDE; public server; clean-clone run in TEST_REPORT §7 | ✅ (cold start NFR-13 ⏳) |
| §10.2 DB setup, secret-free config, tests and instructions, docs | `backend/.env.example`, EVALUATOR_GUIDE §2–§3, these files | ✅ |
| §10.2 Presentation and structured demonstration | EVALUATOR_GUIDE §7 (10-minute script); slides are a separate artifact | ✅ script; ⏳ slides update |
| §10.2 Authorship, third-party and tool-use declarations | THIRD_PARTY; AI-use declaration drafted for the author | ⏳ author approves the AI declaration |
| §11 Use of AI tools | declaration in the thesis; AI prompt records for the whole project (general deliverable 3) | ⏳ author: export of the chat history |
| §12.1 Pass conditions | working end-to-end system (demo + public server); tests; evaluation; authorship | ⏳ evaluation and declarations |

## Hardware and research documents elsewhere in the repository

`docs/BOARD_DAY.md` (sensor tests with criteria fixed in advance), `ml/*.md` (every model and rule result, with the plan
committed before the data was read), `docs/DEPLOYMENT.md`, `docs/BUDGET.md`, `docs/PRICING.md`, `docs/pilot/` (clinical
pilot protocol, consent forms, analysis plan), `docs/REGULATORY_BRIEF_RU.md`, `SECURITY.md`.
