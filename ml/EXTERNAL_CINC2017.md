# External validation: PhysioNet/CinC Challenge 2017

Kaggle notebook `bekturasilov/afib-external-validation-cinc-2017` (version 2, 17 Oct 2026), same code as
`ml/afib_external_cinc2017.ipynb`. The RR-interval TCN was trained **once** on all 23 MIT-BIH AFDB patients
(21 train + 2 for early stopping, 8 epochs, int8 model 27,664 bytes) and applied **unchanged** to the 8,528
CinC 2017 training recordings (AliveCor hand-held single-lead ECG, 9–61 s, 300 Hz; labels `REFERENCE-v3.csv`:
N 5,076 · A 758 · O 2,415 · ~ 279). Rules fixed before the run: decision every 4 beats, threshold 0.5,
recording = AF if ≥ 50 % of its decisions are AF.

| A vs N (recordings with ≥ 33 beats) | Majority rule | Device rule (2-of-3 alarm) |
|---|---|---|
| AF / normal recordings | 537 / 2,791 | 537 / 2,791 |
| Sensitivity | **93.9 %** (504/537) | 79.3 % |
| Specificity | **95.4 %** (2,663/2,791) | 97.2 % |
| PPV | 79.7 % | 84.7 % |
| F1 (AF) | 0.862 | 0.819 |
| ROC-AUC (mean probability) | 0.983 | — |

In-domain reference (LOPO on AFDB, int8 windows): 98.3 % / 96.5 %.

**Limitations shown by this test**
- 3,704 of 8,528 recordings (43 %) have fewer than 33 detected beats, so the 32-beat model cannot decide
  (N 2,285 · A 221 · O 1,006 · ~ 192). Counting them as "no AF", AF sensitivity is 504/758 = 66.5 %.
  Continuous monitoring always has enough beats; 30-second spot checks do not.
- Flagged as AF (majority rule): Other rhythm 16.8 %, Too noisy 51.7 %, Normal 4.6 %.
- The CinC signal is band-passed and resampled 300 → 125 Hz before the same R-peak detector; this
  resampling step is not part of the firmware.
