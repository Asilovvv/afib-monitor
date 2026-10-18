# Fewer false PVCs: decision threshold chosen on DS1, tested on DS2 (Notebook 14)

Kaggle notebook `bekturasilov/afib-pvc-gate-ds1-ds2`, version 1 (18 Oct 2026). The cell loads `ml/pvc_gate.ipynb` as
committed in 3c46bed (pasted from the repository file) and runs its code. The code's sha256 prefix is `ab00cb608c9e6d53`.
Kaggle ran Python 3.13.15, which has the same compensated `sum()` as the server, so the features are the same as on the server.

**Why.** Notebook 13's model called 145 beats (8.2 %) PVC in record 232. That record is sinus bradycardia with long
pauses and has no ventricular beats. The question came from looking at one DS2 record, so DS2 is not fully unseen
for it. To stay honest, everything was chosen on DS1 only.

**Rules fixed before the run** (3c46bed):
* The model is unchanged. The re-fit model was checked to be identical to the committed one: sha256 `f719e22616a9928d` → True.
* Candidates: p ≥ t, optionally with template correlation < c and pre-RR / local RR < r. That is 125 combinations,
  scored by V F1 on out-of-fold DS1 probabilities.
* A candidate is adopted only if DS1 F1 improves by ≥ 0.01. It then ships only if DS2 F1 does not fall by more than 0.01.

## Result
On DS1 (out-of-fold), plain t = 0.5 gave F1 0.830. The best candidate was **t = 0.8 with no extra conditions**: F1 0.854, +0.024, so adopted.
The template-correlation and prematurity conditions did not help on DS1.

| DS2, 22 other people | V sensitivity | V PPV | F1 | Burden Spearman | Records ≥ 10 % found | Record 232 false PVC |
|---|---|---|---|---|---|---|
| t = 0.5 (Notebook 13) | 95.4 % | 89.1 % | 0.922 | 0.82 | 5 of 5 | 145 |
| **t = 0.8 (shipped)** | **92.6 %** | **95.5 %** | **0.940** | **0.90** | 4 of 5 | **51** |

DS2 F1 rose, so by the rule it **ships**.

**Costs, stated plainly:**
* About 3 of every 100 PVCs are now missed.
* Record 214 (11.3 % labelled) is now estimated at 9.3 %, just under the 10 % line.
* Record 232 still has 51 false PVCs (2.9 %).

**What the false PVCs in 232 look like** (descriptive, after the choice): they follow a short RR (pre/loc 0.73, like
real PVCs) and come before a long pause (post/pre 2.5). Their shape, however, matches the patient's usual beat (template
correlation 0.95 vs 0.58 for real PVCs). These are most likely atrial premature beats, which this record labels as `A`.
The correlation condition was in the grid but did not win on DS1, so it was not used.

## Shipped
* `backend/app/ectopy.py`: `THRESHOLD = 0.8`. The model file is unchanged.
* `firmware/AFibMonitor/pvc_model.h`: regenerated with `PVC_THRESHOLD = 0.8`.
* Device vs server: same decision on 910 of 910 beats, bit for bit.
* The doctor's report shows an estimate for the period: PVCs out of judged beats in the strips, plus the strip with the most.

Status is unchanged: research mode, doctor only, labelled as an estimate. Strips are taken at events and on request,
so this is not a Holter PVC burden.
