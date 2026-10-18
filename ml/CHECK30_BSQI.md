# 30-second check v2: two-detector agreement gate (Notebook 8)

Kaggle notebook `bekturasilov/afib-30-second-check-v2-two-detector-gate` (version 1, 18 Oct 2026); the cell runs the
code of `ml/check30_bsqi.ipynb` byte for byte (sha256 prefix `99c22e99b5f808fd` in the log). Rules committed before
the run (18d95e1): v1 = Notebook 7 rule; v2 = the same, but "could not read" when the main R-peak detector and a second,
amplitude-based detector agree on fewer than 80 % of beats (bSQI < 0.8, 150 ms; Li, Mark & Clifford 2008).
v1 on clean data reproduces Notebook 7 exactly (91.4 % / 14.1 %), which checks the pipeline.

## (a) Clean CinC 2017, first 30 s (irregular / could not read / regular)

| Label | v1 | v2 |
|---|---|---|
| AF (758) | 91.4 / 4.1 / 4.5 % | 69.4 / 26.4 / 4.2 % |
| Normal (5,076) | 14.1 / 2.1 / 83.8 % | **3.3** / 44.2 / 52.5 % |
| Other rhythm (2,415) | 46.0 / 2.1 / 51.9 % | 25.9 / 36.7 / 37.4 % |
| Too noisy (279) | 72.8 / 25.8 / 1.4 % | **2.5 / 97.5** / 0 % |

## (b) AF and Normal recordings with NSTDB noise

| Noise | AF called irregular v1 → v2 | Normal called irregular v1 → v2 | Normal "could not read" v2 |
|---|---|---|---|
| electrode motion 12 dB | 91.4 → 60.7 % | 16.3 → 1.9 % | 54.7 % |
| electrode motion 6 dB | 92.5 → 40.1 % | 24.4 → 0.7 % | 78.3 % |
| electrode motion 0 dB | 95.4 → 6.5 % | 59.3 → 0.2 % | 99.5 % |
| muscle 12 dB | 93.4 → 55.8 % | 44.6 → 5.6 % | 59.3 % |
| muscle 6 dB | 94.2 → 21.8 % | 87.5 → 9.1 % | 85.8 % |
| muscle 0 dB | 81.7 → 1.5 % | 76.6 → 0.6 % | 99.3 % |

## What this means
* The gate does what it was built for: noise now gives "could not read" instead of "irregular" (97.5 % of the
  recordings labelled too noisy; false "irregular" on normal rhythm under strong motion noise 59 % → 0.2 %).
* The price is too high on clean signals: 44 % of clean normal and 26 % of clean AF checks get "could not read",
  so v2 finds 69 % of AF recordings instead of 91 %. The second detector is too simple — it disagrees with the
  main one on many clean hand-held recordings.
* Decision for the app: ship v2. A wrong "irregular" frightens a healthy person and sends them to a doctor; a
  "could not read — sit still and repeat" costs 30 seconds. False "irregular" on clean normal rhythm drops from
  one check in seven (14.1 %) to one in thirty (3.3 %).
* Next step: improve the second detector on MIT-BIH Arrhythmia (Notebook 6 style, the detector benchmark — not on
  CinC 2017), then re-test on CinC 2017 with the rule fixed in advance. The 0.8 threshold is not changed after
  seeing these results.
