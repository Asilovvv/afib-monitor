# Beat detector, heart rate and pauses on MIT-BIH Arrhythmia (Notebook 6)

Kaggle notebook `bekturasilov/afib-beat-detector-on-mit-bih-arrhythmia` (version 1, 18 Oct 2026), code in
`ml/beat_detector_mitdb.ipynb`. Our R-peak detector (same algorithm as firmware, server and app; never tuned on this
database) against the cardiologist beat annotations of all 48 records (30 min each, MLII, resampled 360 → 125 Hz).
Match tolerance 150 ms, no delay correction, full 30 min scored. Rules fixed before the run.

| Metric | Result |
|---|---|
| Reference beats | 109,494 |
| Beat sensitivity / positive predictive value | **98.7 % / 99.4 %** |
| Records with sensitivity < 95 % | 108, 203, 223, 228 (known hard records: noise, ventricular arrhythmias, low QRS) |
| Heart rate per 10 s, mean absolute error | **1.1 bpm**; 89.5 % of 8,640 windows within 5 bpm |
| 10-s windows with reference rate < 40 bpm | 89, of which we flag 76; 24 false "slow" windows (0.3 %) |
| 10-s windows with reference rate > 150 bpm | 5, all 5 flagged; 0 false |
| Pauses (reference RR ≥ 3 s) | 42, of which we find 34; we report 59 in total, so 25 are false (missed beats) |

Reading: the detector is accurate enough for heart rate and slow/fast-rate events. Pauses are the weak spot —
missed beats look like pauses — which is why the server only reports a pause when the strip's signal quality is
acceptable, and why pauses are shown to the doctor as "check the ECG", not as a finding.
