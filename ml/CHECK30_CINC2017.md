# "Check me in 30 seconds" on PhysioNet/CinC 2017 (Notebook 7)

Kaggle notebook `bekturasilov/afib-30-second-check-on-cinc-2017` (version 1, 18 Oct 2026). The Kaggle cell runs the
code of `ml/check30_cinc2017.ipynb` byte for byte (sha256 prefix `8a42a12e76939521` printed in the log); the verdict is
the server function `ecgtools.check()` itself, and the phone (`mobile/src/rr.ts`) gives identical verdicts
(`tools/parity`, 40/40). Rules were committed before the run (commit fdc35b1): first 30 s of each recording,
no verdict if < 16 beats or SQI < 0.4, "irregular" if mean|ΔRR| / mean RR > 0.10. The rule was never tuned on CinC 2017.

| Label (8,528 recordings) | Irregular | No verdict | Regular |
|---|---|---|---|
| AF (A, 758) | **91.4 %** | 4.1 % | 4.5 % |
| Normal (N, 5,076) | 14.1 % | 2.1 % | **83.8 %** |
| Other rhythm (O, 2,415) | 46.0 % | 2.1 % | 51.9 % |
| Too noisy (~, 279) | 72.8 % | 25.8 % | 1.4 % |

* With a verdict: sensitivity 95.3 %, specificity 85.6 %. ROC-AUC of the irregularity index (A vs N) 0.954.
* Compared with the 16-beat neural model (Notebook 5): the rule finds more AF (91.4 vs 86.3 % of all AF recordings)
  but calls more normal recordings irregular (14.1 vs 7.5 %).
* For information only (not used): the best threshold on this data would be 0.117 (92.6 % / 88.4 %) — changing
  the rule after seeing the test data would not be a fair test, so the app keeps 0.10.

**Weak points, written down honestly**
1. One normal 30-s check in seven says "irregular". Ectopic beats and other arrhythmias (O) are called irregular
   half of the time — useful to show a doctor, but not AF.
2. The quality gate does not catch noise: 73 % of the recordings the organisers marked "too noisy" get "irregular"
   instead of "could not read" (same finding as Notebook 4 for the SQI).

**What changed in the app because of this**
* "Irregular rhythm" now says that movement or a loose electrode can cause it too, and asks to sit still and repeat
  before showing the recording to a doctor (RU/EN/KY). Wording stays wellness-only.
* Next step: add the two-detector agreement gate (bSQI, Notebook 5: false AF calls under strong motion noise
  376 → 136) to the check on the phone and server, then re-run this notebook with the rule fixed beforehand.
