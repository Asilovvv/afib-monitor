# Third-party components, data and reused assets

FEI Full-Stack guideline, Appendix 1 §6.2 and §10.2 ("authorship, third-party component and tool-use declarations").
Index: [README.md](README.md). Licences of the packages were read from the installed package metadata on 29.10.2026;
dataset licences from their PhysioNet pages on the same day, where marked.

The project's own code is MIT (`LICENSE`); the hardware files are CC BY-SA 4.0 (`hardware/LICENSE.md`).

## 1. Server (`backend/requirements.txt`)

| Package | Version installed | Licence | Used for |
|---|---|---|---|
| FastAPI | 0.143.0 | MIT | HTTP API, OpenAPI documentation |
| Starlette (via FastAPI) | 1.6.0 | BSD-3-Clause | ASGI toolkit, static files, SSE response |
| Pydantic (via FastAPI) | 2.13.5 | MIT | request validation |
| uvicorn | 0.53.0 | BSD-3-Clause | ASGI server |
| SQLAlchemy | 2.1.4 | MIT | ORM and SQL |
| psycopg (binary) | 3.3.6 | LGPL-3.0-only | PostgreSQL driver (used as an unmodified library) |
| PyJWT | 2.14.0 | MIT | tokens |
| bcrypt | 5.0.0 | Apache-2.0 | password hashes |
| python-multipart | 0.0.32 | Apache-2.0 | form parsing |
| email-validator | 2.3.0 | Unlicense | e-mail validation |
| httpx | 0.28.1 | BSD-3-Clause | Telegram API client, test client |
| Pillow | 12.3.0 | MIT-CMU | ECG images for Telegram |

## 2. Doctor portal (`web/package.json`, runtime dependencies)

| Package | Version | Licence |
|---|---|---|
| react, react-dom | 19.3.0 | MIT |
| react-router-dom | 7.18.4 | MIT |
| recharts | 3.10.1 | MIT |
| qrcode | 1.5.4 | MIT |
| @fontsource/ibm-plex-sans, @fontsource/jetbrains-mono, @fontsource/unbounded | 5.3.0 | OFL-1.1 (fonts) |

## 3. Phone app (`mobile/package.json`, runtime dependencies)

| Package | Version | Licence |
|---|---|---|
| expo and expo-* modules (asset, audio, build-properties, dev-client, document-picker, file-system, font, haptics, image-picker, notifications, print, sharing, speech, status-bar), @expo/metro-runtime | 57.0.x | MIT |
| react, react-dom | 19.2.3 | MIT |
| react-native | 0.86.3 | MIT |
| react-native-web | 0.21.4 | MIT |
| react-native-ble-plx | 3.5.1 | MIT |
| react-native-svg | 15.15.4 | MIT |
| react-native-safe-area-context | 5.7.0 | MIT |
| @react-native-async-storage/async-storage | 2.2.0 | MIT |
| react-native-purchases (RevenueCat SDK) | 10.15.1 | MIT |
| @react-native-ml-kit/text-recognition | 2.0.0 | MIT (the wrapper; text recognition runs on the phone with Google ML Kit under Google's terms) |
| @expo-google-fonts/ibm-plex-sans, jetbrains-mono, unbounded | 0.4.1 | MIT AND OFL-1.1 |

## 4. Firmware

| Component | Source | Note |
|---|---|---|
| Arduino core for ESP32 (3.x), including the BLE library | Espressif, `arduino-esp32` | installed by `arduino-cli core install esp32:esp32` in CI |
| TensorFlow Lite Micro with ESP-NN kernels | Espressif's port bundled with the core | the model runs through it; a kernel problem was found on the chip and worked around (TEST_REPORT D-11) |
| M5Unified | M5Stack | screen, touch, power of the CoreS3 SE |

Their licences are those of the upstream repositories; they were not re-checked from this build environment and are to
be confirmed before the final release.

## 5. Data

| Dataset | Use | Licence |
|---|---|---|
| MIT-BIH Atrial Fibrillation Database (AFDB) | training, leave-one-patient-out test, board-day playback | Open Data Commons Attribution 1.0 (checked 29.10.2026) |
| PhysioNet/CinC Challenge 2017 | external test of the model and of the 30-s check | Open Data Commons Attribution 1.0 (checked 29.10.2026) |
| MIT-BIH Normal Sinus Rhythm Database (NSRDB) | false "irregular" at rest | Open Data Commons Attribution 1.0 (checked 29.10.2026) |
| MIT-BIH Arrhythmia Database, MIT-BIH Noise Stress Test Database, Long-Term AF Database, Normal Sinus Rhythm RR Interval Database (NSR2DB) | detector choice, noise tests, two-checks rule, rest analysis | PhysioNet open access; licence to be confirmed on each page before the final release |
| MIMIC PERform AF dataset (Charlton et al., Zenodo 6807403) | PPG versus ECG comparison | ODbL 1.0 (`ml/PPG_VS_ECG.md`) |

The `ml/*.md` files name the databases each result uses; the thesis gives the full references. No dataset is
redistributed in this repository; `tools/data/fetch_refdata.py` downloads what a script needs.

## 6. Reused designs and assets

* SparkFun AD8232 Heart Rate Monitor (CC BY-SA 3.0) and Espressif KiCad libraries (CC BY-SA 4.0) in `hardware/patch_v1`
  (`hardware/LICENSE.md`).
* Fonts: IBM Plex Sans, JetBrains Mono, Unbounded (SIL Open Font Licence 1.1).
* System Usability Scale questionnaire (Brooke, 1996) in `EVALUATION_PLAN.md`.

## 7. Services

Render (hosting), Neon (PostgreSQL), GitHub (repository, Actions, Releases), Telegram Bot API, RevenueCat, Kaggle (training
and validation notebooks), Expo build tooling. Accounts and keys for these services are held by the author only.

## 8. Tools used to write the code and documents

The use of AI assistants is declared separately in the thesis (FEI guideline §11: tools, purposes, substantial generated
elements, how output was reviewed and validated); see the author's declaration.
