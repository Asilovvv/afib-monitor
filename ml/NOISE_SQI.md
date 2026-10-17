# Robustness to noise and signal-quality gating

Kaggle notebook `bekturasilov/afib-noise-robustness-and-sqi-gating` (version 2, 18 Oct 2026), same code as
`ml/afib_noise_sqi.ipynb`. Model: trained once on all 23 AFDB patients (identical to Notebook 3; the clean row
reproduces Notebook 3 exactly). Test signals: the 3,328 PhysioNet/CinC 2017 recordings (537 AF, 2,791 Normal) with
≥ 33 beats, plus real noise from the MIT-BIH Noise Stress Test Database (em = electrode motion, ma = muscle,
bw = baseline wander) at SNR 24/12/6/0 dB (power ratio after the 0.5–40 Hz band-pass). Gating: a decision is dropped
when the app's signal-quality index of the 10 s before it is < 0.4 (`backend/app/ecgtools.py: quality`, numpy port
verified identical on 30 test signals). Threshold and rules fixed before the run.

| Noise | SNR, dB | Sens | Spec | Sens, gated | Spec, gated | No verdict: AF / N | False AF calls on N (no gating → gated) |
|---|---|---|---|---|---|---|---|
| clean | — | 93.9 % | 95.4 % | 93.9 % | 95.4 % | 0 / 0 % | 128 → 128 |
| bw | 24 · 12 · 6 · 0 | 93.9 · 93.5 · 93.9 · 91.8 % | 95.3 · 95.3 · 94.9 · 93.0 % | ≈ same | ≈ same | ≤ 2.2 / 4.9 % | 130 · 132 · 141 · 194 |
| em | 24 | 93.9 % | 95.3 % | 93.9 % | 95.3 % | 0 / 0.1 % | 130 → 130 |
| em | 12 | 93.5 % | 95.2 % | 93.7 % | 95.2 % | 0.2 / 0.3 % | 134 → 134 |
| em | 6 | 92.9 % | 93.7 % | 93.1 % | 93.7 % | 0.4 / 0.1 % | 175 → 175 |
| em | 0 | 91.6 % | 86.5 % | 91.6 % | 86.5 % | 0 / 0.2 % | 376 → 376 |
| ma | 24 | 93.7 % | 95.4 % | 93.7 % | 95.4 % | 0 / 0.1 % | 128 → 128 |
| ma | 12 | 90.9 % | 91.8 % | 91.9 % | 91.5 % | 1.3 / 3.2 % | 230 → 230 |
| ma | 6 | 83.2 % | 83.6 % | 90.1 % | 80.8 % | 7.6 / 15.8 % | 457 → 452 |
| ma | 0 | 48.8 % | 84.5 % | 78.3 % | 69.6 % | 39.1 / 52.6 % | 433 → 403 |

Recordings without any decision count as "not AF" in the ungated columns; gated metrics are computed on recordings
that still have a verdict.

**What this shows (honest reading)**
- Baseline wander is removed by the band-pass: no effect down to 6 dB.
- Electrode motion is the dangerous noise: at 0 dB false AF calls on normal recordings triple (128 → 376,
  specificity 95.4 → 86.5 %).
- **The current SQI does not help as an AF gate.** It almost never flags electrode-motion noise (≤ 0.4 % of
  recordings), and for muscle noise it removes decisions without reducing false AF calls (spec. 83.6 → 80.8 % at 6 dB).
  It is still useful as a display ("signal poor") but not as protection against false alarms.
- Next step: a gate built for this purpose, e.g. agreement between two independent beat detectors (bSQI) or
  RR-plausibility checks, chosen on AFDB/NSTDB and then tested once on this same protocol.
