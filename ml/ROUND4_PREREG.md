# Round 4 — analysis plan fixed before the data is read

Written on 29.10.2026, before the reference data (`tools/data/fetch_refdata.py`) was downloaded or opened.
The git commit of this file is the timestamp. Nothing below may be changed after the first result is seen;
if something has to change, a dated "deviation" section is added at the end and the original text stays.

Why: board day (docs/BOARD_DAY.md) found three problems on a real person —
A9: arm movement made the live screen give a rhythm verdict on artifact beats;
A6: 2 of 5 checks at rest were "irregular" (irregularity 0.101 and 0.116, threshold 0.10);
A8: bench SNR 16.1–16.4 dB with gel electrodes, below the 18 dB requirement.
The person's own recordings are **not** used to choose anything below. They may be shown afterwards as an
illustration, clearly labelled, never as the test.

Data (all public, PhysioNet): AFDB records 04015, 05121, 07879, 05261, 08215 (already on the laptop);
NSTDB noise records em / ma / bw and the 12 standard noisy records; MIT-BIH Arrhythmia 118, 119;
NSRDB (18 people; 12 segments × 10 min per record); NSR2DB (54 people, beat annotations, 24 h);
PhysioNet/CinC Challenge 2017 training set.

Code paths: the firmware's live path (band-pass biquads → every 2nd sample → envelope R detector → 32 RR →
int8 model) is run on a PC by the same C++ that the firmware compiles (a host build, as for the 30-s check
parity); the model is the firmware's file `firmware/models/afib_rr_int8_nodil.tflite`. The 30-s check is the
shipped v3 rule (`ecgtools.check`, identical to `check30.h` by CI parity).

## 1. Motion gate for the live verdict (task 2)

**What is gated.** Every live decision (every 4 beats, last 32 RR). When the gate says "bad", the device sends
state 3 (no signal or noise) instead of 1/2, and keeps doing so until 32 new beats have arrived after the last
bad window (so no artifact RR stays inside the model's input).

**Candidates (fixed list).** Computed at each decision on the last 10 s of the filtered 125-Hz signal:
* G1 — agreement between the live detector's beats in those 10 s and the second detector of the 30-s check
  (`r_peaks_amp`, v3 settings), bSQI with 150 ms tolerance; the live beats are shifted back by the detector's
  lag (a single constant measured on the tuning clean data, rounded to whole samples);
* G2 — agreement between the 30-s check's two detectors (`r_peaks`, `r_peaks_amp`) on those 10 s (bSQI);
* G3 — signal quality index of those 10 s (`quality`).
Thresholds tried: G1, G2 ∈ {0.50, 0.51, …, 0.99}; G3 ∈ {0.30, 0.31, …, 0.90}.

**Noise.** NSTDB em (electrode motion), ma (muscle), bw (baseline wander), resampled to 250 Hz. SNR is the power
ratio after the 0.5–40 Hz band-pass, as in ml/NOISE_SQI.md. The **first half** (0–15 min) of each noise record is
used for tuning, the **second half** (15–30 min) for the test; noise start offsets are drawn with a fixed seed.

**Tuning data.** AFDB 04015, 05121, 07879, full length. Noise is switched on for 2 min and off for 2 min in turn
(like the NSTDB protocol), SNR 12, 6, 0 dB, em and ma.
**Choice.** Among G1–G3 and their thresholds: the highest share of noise-induced verdict changes blocked
(pooled em+ma, SNR ≤ 6 dB) subject to ≥ 97 % of clean decisions kept; ties go to the higher clean share,
then to G1, G2, G3 in that order.

**Definitions.** A decision on the noisy signal at time T is compared with the clean-signal decision closest in
time (within 2 s; otherwise "not comparable", counted separately). A *noise-induced change* is a different
verdict (AF-like / regular) at the same time. *Blocked* = the gate said bad. *Clean kept* = share of decisions on
the clean signal that the gate lets through.

**Test (run once, after the choice is committed).**
* T1: CinC 2017 AF and Normal recordings with ≥ 33 beats by the firmware detector on the clean signal, resampled
  to 250 Hz; noise from the second halves at SNR 12, 6, 0 dB (em, ma, bw).
* T2: AFDB 05261 and 08215, full length, noise switched 2 min on / 2 min off at 6 dB (em, ma) — recovery after
  noise.

**Pass rule (fixed now).** All three on the test data:
1. clean kept ≥ 95 % (T1 clean and T2 clean, each);
2. noise-induced changes blocked ≥ 80 % for em at SNR ≤ 6 dB (T1 and T2 pooled);
3. the same ≥ 80 % for ma.
Reported as well: bw, 12 dB, false "AF-like" on Normal recordings with and without the gate (the ml/NOISE_SQI.md
protocol), the NSTDB standard records 118e*/119e* against clean 118/119 (illustration).

**Expected before the run.** G1 blocks most electrode-motion changes (artifact beats are seen by one detector
only); muscle noise is harder (ml/SNR_REQUIREMENT.md: both detectors see the same spikes), so criterion 3 may
fail. If a criterion fails, the gate is still described with its numbers; whether it ships is the owner's call.

After the run: the chosen gate goes into the firmware (state 3, screen "POOR SIGNAL"), with a host test in CI;
A9 is repeated on the board later as a separate row.

## 2. False "irregular" at rest (task 3)

**2a. Rule level, reference beats.** NSR2DB (54 people) and NSRDB (18 people): non-overlapping 30-s windows that
contain only normal beats (`N`); irregularity = mean |ΔRR| / mean RR on RR within 0.25–2.0 s, rounded as in the
device. Reported: share of windows above 0.10, overall and by heart rate (< 60, 60–69, 70–79, 80–89, 90–99,
≥ 100 /min), per person (how many people have > 10 % and > 25 % of windows above 0.10), and the share of windows
within 0.09–0.11 (verdict decided by noise in the last digit).
**2b. Signal level.** NSRDB segments resampled to 125 Hz after the firmware band-pass, 30-s windows, the full v3
check: regular / irregular / could not read, by heart rate; windows with only `N` beats vs windows with ectopic beats.
**2c. CinC 2017 Normal class**, first 30 s, v3 check (8.9 % irregular in ml/CHECK30_V3.md): by heart rate.
**2d. One outlier.** (i) Windows with exactly one non-`N` beat among `N` (NSR2DB, NSRDB): share irregular.
(ii) Clean NSRDB windows that the check calls regular: one narrow spike (3 samples, to −1.5 × the median R amplitude)
added at a random point between two beats (seeded): share that flips to irregular.
**Expected.** Rule-level false irregular is higher at lower heart rate (breathing-related sinus arrhythmia); a single
outlier flips a large share of borderline windows.

**Candidate changes (fixed now, no threshold tuning):**
* C0 — current rule.
* C1 — the same measure with the two largest |ΔRR| removed before the mean (one ectopic or artifact beat makes two
  large differences), threshold 0.10.
* C2 — current measure, threshold 0.12.
Each is computed on 2a, 2b, 2d and on CinC 2017 (AF and Normal, first 30 s, v3 gate unchanged).
**Proposal rule.** A candidate is proposed to the owner only if, on CinC 2017, AF called irregular falls by
≤ 2 percentage points **and** Normal called irregular falls by ≥ 30 % relative to C0, and it also lowers false
irregular in 2a and 2d. Nothing is changed in the device, phone or server without the owner's "yes"; if it is
changed, it is changed in all three at once with parity and guard strips green.

## 3. The live model on sinus rhythm (task 4)

NSR2DB and NSRDB reference beats: every 32-RR window with only `N` beats (stride 4 beats, as on the device) →
int8 model. Reported: share ≥ 0.5 and the distribution of the score, by heart rate and by RMSSD; the same with the
firmware detector on NSRDB signal segments. Descriptive only: written down as a limitation.
**Expected.** Scores rise with RMSSD; most windows stay below 0.5.

## 4. What the bench SNR number means (task 5)

The bench SNR (`afib_stream.py snr_of`: band-passed power vs the residual after subtracting the average beat) is
not the same quantity as the requirement's SNR (added NSTDB noise power, ml/SNR_REQUIREMENT.md), because real
beat-to-beat changes (breathing) also count as "noise". Calibration: `snr_of` on (a) clean NSRDB 30-s windows at
250 Hz, (b) clean CinC Normal first 30 s at 250 Hz, (c) the same CinC recordings with ma noise added at 24, 18 and
12 dB. Reported: median and IQR of the bench number in each case. The A8 result stays as recorded; this only says
how to read it.
