# Ectopic beats from QRS shape — trained on MIT-BIH DS1, tested on DS2 (Notebook 11)

Kaggle notebook `bekturasilov/afib-ectopic-beats-from-qrs-shape-ds1-ds2` (version 1, 18 Oct 2026); the cell runs the
code of `ml/ectopy_qrs_ds1ds2.ipynb` byte for byte (sha256 prefix `0a9b1aa41cc34042`). Rules committed before the run
(e714e84): inter-patient split of de Chazal et al. (2004) — 22 training records (DS1), 22 test records of other people
(DS2), paced records excluded; beats found by our firmware detector; features = RR timing + QRS shape;
`HistGradientBoostingClassifier(class_weight='balanced', max_iter=300, random_state=42)`; nothing tuned on DS2.

| DS2, 48,531 beats of 22 people | Sensitivity | PPV |
|---|---|---|
| **Ventricular ectopic (V)** | **94.7 %** | **91.8 %** |
| Supraventricular ectopic (S) | 17.2 % | 26.4 % |
| Normal beats kept normal | 97.7 % | — |

* Compared with the RR-only rule of Notebook 10 on the same DS2 records: ventricular ectopic beats found
  ≈ 7 % → 95 %.
* Per record, the ectopic burden detected vs labelled: Spearman 0.88, mean error 5.3 percentage points;
  5 of 6 records with burden ≥ 10 % found, 2 false (219 and 222, records with AF / flutter, where irregular
  normal beats are taken for supraventricular ones).
* Supraventricular ectopy is not usable: record 232 (1,374 S beats) is almost entirely missed. Atrial early beats
  look like normal beats; RR timing is their main sign and the model, trained on only 882 S beats, does not learn it
  well enough. This matches what the literature reports as the hard class in the inter-patient setting.

**Decision.** Ventricular ectopy (PVC) counting is feasible from our single lead and our detector; atrial is not yet.
Next step: a small model the device can run (only N vs V, tree size fixed in advance), tested again on DS2.
Counting PVCs is arrhythmia detection — a medical-device claim. Until registration it may appear only in the
research mode for the doctor, labelled as an estimate, never as a message to the patient.
