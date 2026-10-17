# Leave-one-patient-out results (MIT-BIH AFDB, 23 patients)

Kaggle notebook `bekturasilov/afib-lopo-evaluation`, version 2 (17 Oct 2026), same code as `ml/afib_lopo.ipynb`.
Each of the 23 models is trained on 22 patients and tested on the one left out. Threshold fixed at 0.5. Nothing tuned on test data.
Version 1 and version 2 gave identical numbers for every metric they share.

| Metric | Value |
|---|---|
| Window sensitivity / specificity, float32 | 98.28 % / 96.62 % (ROC-AUC 0.9924) |
| Window sensitivity / specificity, int8 | 98.34 % / 96.49 % (ROC-AUC 0.9921, F1 0.971) |
| Continuous timeline, 2-of-3 smoothing | 97.52 % / 95.75 % |
| Per-patient sensitivity | mean 97.8 %, median 99.6 %, min 75.7 % (06453) |
| AF episodes >= 30 s with an alarm (2-of-3) | 226 / 226, median delay 13.6 s |
| False alarm onsets, 2-of-3 | 642 in 139.2 h of normal rhythm = 4.61 / h |
| **Alert only after 30 s of sustained AF** | **205 / 226 episodes (90.7 %), median delay 44.4 s** |
| **False alarms with the 30 s rule** | **126 = 0.91 / h (~22 per day of normal rhythm)** |
| AF burden error | mean 2.2 pp, median 1.39 pp |

The 30-second rule is the trade-off used for **Telegram messages only**; the app and the doctor's portal still show every detected episode immediately.
One record (05091) has a single episode that never reaches 30 s of confirmed alarm.

Per record, 30 s rule (episodes with alert / episodes, false alarms 2-of-3 -> with rule):

| Record | Episodes | FA | Record | Episodes | FA |
|---|---|---|---|---|---|
| 04015 | 2/2 | 40 -> 20 | 06453 | 2/3 | 13 -> 3 |
| 04043 | 64/71 | 43 -> 15 | 06995 | 3/4 | 156 -> 22 |
| 04048 | 2/3 | 1 -> 0 | 07162 | 1/1 | 0 -> 0 |
| 04126 | 5/5 | 62 -> 5 | 07859 | 1/1 | 0 -> 0 |
| 04746 | 2/2 | 10 -> 0 | 07879 | 1/1 | 12 -> 0 |
| 04908 | 7/7 | 15 -> 0 | 07910 | 3/3 | 8 -> 2 |
| 04936 | 26/29 | 4 -> 5 | 08215 | 2/2 | 7 -> 1 |
| 05091 | 0/1 | 14 -> 6 | 08219 | 36/38 | 105 -> 11 |
| 05121 | 16/17 | 12 -> 5 | 08378 | 4/5 | 11 -> 3 |
| 05261 | 2/2 | 63 -> 13 | 08405 | 1/1 | 60 -> 10 |
| 06426 | 20/23 | 3 -> 5 | 08434 | 3/3 | 3 -> 0 |
| | | | 08455 | 2/2 | 0 -> 0 |

In 04936 and 06426 the rule gives slightly *more* alarm onsets: a long alarm broken by a short gap can count as two sustained alarms.
These are retrospective results on 1980s Holter data, not on our AD8232 sensor; see the clinical validation protocol.
