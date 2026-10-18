# 30-second check v3: second detector chosen on MIT-BIH, tested on CinC 2017 (Notebook 9)

Kaggle notebook `bekturasilov/afib-30-second-check-v3-detector-chosen-on-mit-bih` (version 1, 18 Oct 2026); the cell
runs the code of `ml/check30_v3.ipynb` byte for byte (sha256 prefix `d616728833688617`). Rules committed before the run
(1f0414b): 16 settings of the second detector, the one with the highest F1 on MIT-BIH Arrhythmia is chosen
(CinC 2017 not used for the choice); then v1 / v2 / v3 on CinC 2017 exactly as in Notebook 8. bSQI threshold 0.8 unchanged.

## 1. Choice on MIT-BIH Arrhythmia (48 records, 109,494 labelled beats, 150 ms)

| Second detector | Sensitivity | PPV | F1 |
|---|---|---|---|
| v2: no smoothing, 0.6 s baseline, 0.5 × peak, 250 ms | 98.6 % | 87.4 % | 0.927 |
| **v3: 3-sample smoothing, 0.12 s baseline, 0.5 × peak, 300 ms** | 99.2 % | 98.8 % | **0.990** |

The short baseline window acts as a crude QRS band-pass and stops the detector from counting T-waves, which is
why v2 disagreed with the main detector so often (87 % PPV).

## 2. CinC 2017, first 30 s — irregular / could not read / regular

| Label | v1 (no gate) | v2 | **v3** |
|---|---|---|---|
| AF (758) | 91.4 / 4.1 / 4.5 % | 69.4 / 26.4 / 4.2 % | **85.6 / 9.9 / 4.5 %** |
| Normal (5,076) | 14.1 / 2.1 / 83.8 % | 3.3 / 44.2 / 52.5 % | **8.9 / 11.0 / 80.1 %** |
| Other rhythm (2,415) | 46.0 / 2.1 / 51.9 % | 25.9 / 36.7 / 37.4 % | 38.4 / 11.6 / 50.0 % |
| Too noisy (279) | 72.8 / 25.8 / 1.4 % | 2.5 / 97.5 / 0 % | 11.5 / 88.2 / 0.4 % |

AF and Normal with NSTDB noise — normal rhythm called irregular (v1 → v2 → v3) and AF found (v3):

| Noise | Normal called irregular | Normal "could not read", v3 | AF found, v3 |
|---|---|---|---|
| electrode motion 12 dB | 16.3 → 1.9 → 7.4 % | 16.1 % | 82.6 % |
| electrode motion 6 dB | 24.4 → 0.7 → 5.4 % | 31.1 % | 75.7 % |
| electrode motion 0 dB | 59.3 → 0.2 → 6.7 % | 78.4 % | 40.6 % |
| muscle 12 dB | 44.6 → 5.6 → 18.1 % | 29.3 % | 75.5 % |
| muscle 6 dB | 87.5 → 9.1 → 18.1 % | 73.5 % | 33.5 % |
| muscle 0 dB | 76.6 → 0.6 → 2.5 % | 97.1 % | 4.6 % |

## Decision
v3 is the middle ground: a normal check needs a repeat in 11 % of cases instead of 44 %, AF is found in 86 % of
recordings instead of 69 %, and a false "irregular" on clean normal rhythm stays lower than without a gate
(8.9 % vs 14.1 %). The price compared with v2: noise is caught less well, muscle noise in particular (18 % false
"irregular" at 12 and 6 dB). v3 ships in the server, the phone and the device (same code, parity 40/40 in CI);
the app keeps asking to sit still and repeat after an "irregular" result before showing a doctor.
A repeat-twice rule could not be tested on CinC 2017 (one recording per person) and is not claimed.
