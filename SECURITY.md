# Security

AFib Monitor is a diploma project, **not a medical device**. Please report a security problem privately via
GitHub → Security → "Report a vulnerability" on this repository, not in a public issue.

## Review of 20 October 2026 (before and after making the repository public)

| # | Finding | Status |
|---|---|---|
| 1 | **Path traversal in the web-portal route**: an encoded `../` could read files outside the portal build (reproduced locally: `/etc/hostname`, `/proc/self/cmdline`). | Fixed (commits 96c3d4b, 7e90226): the path is resolved and must stay inside the build folder. Test `test_static_files_cannot_escape_the_portal_folder`. On the live server Render's proxy returned 400 for the same requests, so it was probably not exploitable there, but this cannot be proven for every encoding. |
| 2 | **Public fallback JWT secret**: `auth.py` had a fixed default secret that became public with the code. | Fixed: without `JWT_SECRET` (≥ 32 characters) the server uses a random secret per run and logs a warning. Render generates `JWT_SECRET` (`render.yaml`), so production never used the fallback. Test `test_no_public_fallback_jwt_secret`. |
| 3 | **No limit on login attempts** (password guessing). | Fixed: 10 wrong passwords per account or 50 per address in 15 minutes → HTTP 429. In memory, per server process. Test `test_login_is_limited_after_many_wrong_passwords`. |
| 4 | **Public demo doctor**: the demo doctor's password is published, so a real patient who entered `DEMO42` would share their data with anyone. | Fixed: the demo code links only `@demo.kg` addresses (registration and "link doctor"). Test `test_demo_doctor_code_only_for_demo_patients`. |
| 5 | Live stream (`/api/stream?token=`) carries the login token in the URL, because the browser's EventSource cannot send headers. Such URLs can appear in proxy logs. | Accepted for the diploma: HTTPS only, doctors only. Better later: a separate short-lived stream token. |
| 6 | `pip-audit` (backend) and `npm audit` (web portal). | Clean, 0 findings. |
| 7 | `npm audit` (mobile app): 22 findings in Expo **build tools** (braces, node-forge, uuid@7). | Accepted: they run on the developer's computer during the build, are not shipped in the app, and Expo has no fixed version yet. Re-check on each Expo update. |
| 8 | CORS `*`. | Acceptable: the API uses bearer tokens, not cookies, so another site cannot act with a user's login. |

## Secrets

`JWT_SECRET`, `DATABASE_URL` (Neon), `TELEGRAM_BOT_TOKEN`, `ADMIN_TOKEN` (manual plan activation) and `REVENUECAT_WEBHOOK_SECRET` live only in Render → Environment, never in the repository. No card data ever reaches the server: the app stores hold it; we receive only webhook events
(see `docs/DEPLOYMENT.md`). Optional after going public: rotate all three. Changing `JWT_SECRET` logs everyone out once.

Not reviewed: an independent penetration test, the firmware's BLE pairing, and the hardware (IEC 60601-1 needs an engineer).
