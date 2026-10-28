# Round 4: false "irregular" at rest, one outlier beat, the live model on sinus rhythm, the bench SNR scale

Plan fixed before the data was read: `ml/ROUND4_PREREG.md` §2–§4 (commit 845826a). Code: `ml/round4_rest.py`; numbers:
`ml/ROUND4_REST.json` (run 29.10.2026 01:18). The 30-s check is the device's code (`check30.h` via
`tools/parity/check30_detail.cpp`); on CinC 2017 it reproduces the published v3 numbers exactly (AF called irregular
85.6 %, Normal 8.9 %, ml/CHECK30_V3.md), which validates the pipeline.

## 1. How often the rule says "irregular" on healthy sinus rhythm (C0 = the shipped rule, irregularity > 0.10)

**Rule level, reference beats** (30-s windows of only normal beats, no noise marks):

| Data | Windows | People | Irregular, all | HR < 60 | 60–69 | 70–79 | ≥ 80 |
|---|---|---|---|---|---|---|---|
| NSR2DB (54 adults, 24 h) | 126,170 | 54 | 0.4 % | 0.7 % | 0.9 % | 0.4 % | ≤ 0.1 % |
| NSRDB (18 adults, 20–50 y) | 38,848 | 18 | 2.4 % | **12.3 %** | 3.8 % | 0.4 % | 0 % |

People with more than 10 % of their windows called irregular: 2 of 72; more than 25 %: none.
Windows within 0.09–0.11 (where the last digit decides): 0.6 %.

**Signal level, the full check on NSRDB ECG** (3,498 windows of only normal beats): irregular 2.0 %, regular 80.5 %,
could not read 17.5 %; by heart rate: < 60 — 9.6 %, 60–69 — 4.2 %, 70–79 — 0.6 %, ≥ 80 — ≤ 0.3 %.

**CinC 2017 Normal** (5,076 single-lead recordings, first 30 s): irregular 8.9 % overall, 7–10 % in every heart-rate
band from below 60 to 90–99/min (25 recordings above 100/min: 20 %); the CinC "Normal" class holds more noise
and short recordings than a Holter at rest.

**Reading.** On healthy people at rest the rule is mostly right, but slow heart rates are its weak spot: below
60/min a young adult's normal breathing-related rhythm variation crosses 0.10 in about one 30-s window in ten
(NSRDB, both rule level and signal level). The board-day checks (64–72/min, irregularity 0.076–0.116) sit at the
upper edge of what these databases show; with only five checks this cannot be called unusual or normal — a doctor
and a 12-lead ECG decide (docs/BOARD_DAY.md A6).

## 2. One outlier beat

| | C0 (shipped) | C1 (two largest ΔRR dropped) | C2 (threshold 0.12) |
|---|---|---|---|
| exactly one ectopic beat in a 30-s window (reference beats, 4,865 windows) | 4.3 % irregular | 1.7 % | 1.8 % |
| one narrow spike added to a regular NSRDB window (2,815 windows) | 2.0 % flip to irregular | 0.1 % | 0.4 % |

## 3. Candidate changes — none is proposed

Pre-registered proposal rule: on CinC 2017, AF called irregular may fall by ≤ 2 points and Normal called irregular must
fall by ≥ 30 %, and the candidate must also lower 2a and 2d.

| CinC 2017, first 30 s | C0 | C1 | C2 |
|---|---|---|---|
| AF called irregular (758) | 85.6 % | 81.5 % (−4.1 pt) | 81.5 % (−4.1 pt) |
| Normal called irregular (5,076) | 8.9 % | 3.7 % (−58 %) | 5.9 % (−34 %) |

Both candidates cut false "irregular" a lot and both lose 31 of 758 AF recordings (different ones), which is more
than the 2-point limit fixed in advance. **Neither is proposed; the device, phone and server keep C0.** The trade-off
is written down for the owner: C1 would remove more than half of the false "irregular" results on normal rhythm at
the price of 4 AF recordings in 100 more called "regular". Changing the rule would need a new pre-registered test.

## 4. The live model (continuous screen) on sinus rhythm

Every 32-RR window of only normal beats in NSR2DB + NSRDB (1,609,478 windows, stride 4 beats, int8 inputs exactly as
the device builds them): AF-like (≥ 0.5) on **2.9 %** (NSR2DB 2.1 %, NSRDB 5.4 %; median score 0.00, 95th percentile
0.11, 99th 0.95). With the firmware's own detector on NSRDB ECG: 5.4 % of 28,153 decisions.

The share rises steeply with beat-to-beat variability (RMSSD of the 32 RR):

| RMSSD | < 20 ms | 20–40 | 40–60 | 60–80 | ≥ 80 ms |
|---|---|---|---|---|---|
| windows called AF-like | 1.0 % | 1.8 % | 7.4 % | 11.7 % | **27.4 %** |

**Limitation (for the thesis).** The live model reads large, healthy beat-to-beat variation as AF-like: in about one
window in four when RMSSD is 80 ms or more, which is common in young people at rest. This is one more reason why the
live score is research only and the person's verdict comes from the 30-s check (round 4, task 1). On board day the
RMSSD of the resting recordings was 59–151 ms.

## 5. What the bench SNR number means

The bench estimator (`afib_stream.py snr_of`, also on the phone) on recordings without added noise and with NSTDB
muscle noise added at a known SNR (random 300 of each, seed 0, because the estimator takes about 1 s per strip):

| Recordings | Bench SNR, median (IQR) |
|---|---|
| NSRDB clean 30-s windows (Holter, chest) | 20.3 dB (15.2–23.2) |
| CinC 2017 Normal, clean | 5.3 dB (−1.4–11.2) |
| the same + muscle noise at 24 / 18 / 12 dB | 5.3 / 4.9 / 3.9 dB |

The bench number is **not** on the scale of the requirement's SNR (added noise power, ml/SNR_REQUIREMENT.md): adding
muscle noise at 18 dB barely moves it, and clean CinC recordings already read about 5 dB, because the estimator counts
every beat-to-beat change of the waveform as noise. Clean Holter chest recordings read 15–23 dB. The board-day resting gel
recordings (16.1–18.4 dB: gel 2–4 and checks 2–4) are inside the range of clean Holter recordings. The A8 row stays as recorded (❌ against the
18 dB bar fixed before the measurement); a bench bar that is comparable needs its own calibration and a new
pre-registered rule — for example, the share of clean NSRDB windows below the measured value.

Measured on the board-day files as well (hardware, not used to choose anything): the ADC noise floor
(raw spectrum at 100–125 Hz, ≈ 0.7–0.8 mV²/Hz) is about 2 % of the residual noise power, so averaging ADC samples would
add < 0.1 dB; a 50-Hz notch adds 0–1.3 dB; the R peaks reach the top of the ADC range (3,168 mV) for about
3 samples per beat.
