# PPG vs ECG for AF: same people, same 30 seconds (Notebook 17)

**Status: rules fixed, not run yet.** This file is committed before the Kaggle run; results will be added below
without changing the rules.

## Question
Could a wrist version (v2) that measures the pulse with light (PPG, like the Apple Watch's background rhythm check)
find AF as well as our 30-s ECG check? First step: compare PPG and ECG **recorded at the same time on the same people**,
with the same irregularity rule, so the only difference is the sensor.

## Data
MIMIC PERform AF dataset (Charlton et al., Zenodo record 6807403, ODC-ODbL 1.0; the notebook resolves the latest
version through the Zenodo API and prints the record id and file checksums). 35 adults in intensive care, 20 minutes
each, fingertip PPG and ECG from the bedside monitor at 125 Hz: 19 people in AF, 16 not in AF. AF labels come from
Bashar et al. 2019/2020 and apply to the whole 20-min recording. Files used: `mimic_perform_af_csv.zip`,
`mimic_perform_non_af_csv.zip` (columns PPG, ECG).

## Method (fixed in advance, nothing tuned on this data)
* Non-overlapping 30-s windows, 40 per person; ECG and PPG cut at exactly the same samples.
* **ECG arm:** our deployed check `ecgtools.check()` v3 unchanged (16 beats, SQI 0.4, irregularity > 0.10, bSQI ≥ 0.8).
* **PPG arm:** pulse peaks, then the **same** `irregularity()` and the same 0.10 threshold and 16-beat minimum.
  * Detector 1: Butterworth band-pass 0.5–8 Hz (order 2, zero phase), peaks at least 0.33 s apart with prominence
    ≥ 0.3 × (95th − 5th percentile) of the window.
  * Detector 2 (for the quality gate): band-pass 0.5–3 Hz, local maxima at least 0.33 s apart that are above a
    1.5-s moving mean.
  * Gate: the two detectors agree (bSQI ≥ 0.8, 150 ms), the same rule as for ECG. Also reported without the gate.
* A window with missing values or a flat line in a signal is "could not read" for that arm.

## What is reported
1. Share of windows irregular / could not read / regular, per group and per arm (ECG, PPG, PPG without gate),
   with 95 % intervals from 2,000 bootstrap resamples **of people** (seed 42).
2. Per person: AF if at least half of the readable windows are irregular (at least 5 readable windows, otherwise
   "unreadable").
3. Windows readable by both arms: agreement and Cohen's kappa.
4. Descriptive only: AUC of the irregularity value alone (not used for any choice).

## Decision rule
"PPG comparable to ECG at rest" if **both**:
* AF windows called irregular by PPG ≥ ECG − 5 percentage points, and
* non-AF windows called irregular by PPG ≤ ECG + 5 percentage points.

Otherwise: "PPG worse than ECG even at rest", and a wrist PPG version needs a better algorithm before any hardware.

## Limits known in advance
* Fingertip PPG on a hospital monitor with the patient lying still. A wrist sensor during daily life will be
  **worse** (movement, weaker signal). A good result here is an upper bound, not proof for a bracelet.
* Only 35 people, all in intensive care. The non-AF group may include other arrhythmias and ectopic beats.
* In AF some beats produce almost no pulse (pulse deficit), so PPG can count fewer beats than ECG. That is a real
  property of PPG and is part of what is measured.

## Results
_Not run yet._
