# Early (ectopic) beats from RR intervals — MIT-BIH Arrhythmia (Notebook 10)

Kaggle notebook `bekturasilov/afib-early-beats-from-rr-on-mit-bih` (version 1, 18 Oct 2026); the cell runs the code of
`ml/ectopy_mitdb.ipynb` byte for byte (sha256 prefix `19ddd48d7c3a77c1`). Rule committed before the run (1f0414b):
beat early if its RR < 0.80 × median of the 8 previous RR and the next RR > 1.15 × its RR; not judged while those
8 RR are irregular (> 0.10). 44 records (4 paced excluded), 100,733 beats, 7,009 ventricular and 2,781
supraventricular ectopic beats labelled by cardiologists.

| | Result |
|---|---|
| Ventricular ectopic beats (V, E) found | **7.5 %** |
| Supraventricular ectopic beats (A, a, J, S) found | **8.6 %** |
| Flagged beats that really are ectopic (PPV) | 89.1 % (861 flagged) |
| Per-record burden, detected vs labelled | Spearman 0.45, mean error 8.7 percentage points |
| Records with burden ≥ 10 %: found | **0 of 14** |

**Negative result.** When the device flags an early beat it is usually right, but it misses more than nine of ten
ectopic beats, and it misses every record with frequent ectopy. The reasons are visible per record: with frequent
ectopy (bigeminy, records 119, 200, 208, 233) the "reference" RR already contains early beats, and the irregularity
guard that protects against AF also switches the rule off exactly where ectopy is frequent. RR intervals alone
cannot tell ventricular from atrial beats either.

**Decision.** No ectopic-beat feature in the app or on the device for now. Counting ectopy needs QRS shape (width,
template correlation) from the raw ECG — a separate model, trained and tested on different records (e.g. the
standard de Chazal DS1/DS2 split of MIT-BIH), with the rule fixed before the test. A claim such as "counts PVCs"
would make the product a medical device (arrhythmia detection); until registered, only wellness wording.
