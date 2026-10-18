# Noise the 30-second check tolerates — requirement for reusable electrodes (Notebook 16)

Kaggle notebook `bekturasilov/afib-check-noise-requirement`, version 1 (18 Oct 2026). The cell loads `ml/snr_requirement.ipynb`
from the repository (commit 44ded87), sha256 prefix `7367bca29c566b56`. Rules were committed before the run.

**Data:** CinC 2017, first 30 s. All 758 AF recordings plus 1,500 Normal ones (seed 0). NSTDB noise was added at 7 levels, 33,870 checks in total.
The server check v3 is unchanged. Clean result on this set: AF called irregular 85.6 %, Normal called irregular 9.8 %, Normal "could not read" 11.2 %.

**Pass rule fixed in advance**, compared with clean on the same recordings:
* AF found falls by ≤ 10 points;
* Normal called irregular rises by ≤ 3 points;
* Normal "could not read" rises by ≤ 15 points.

| SNR, dB | Motion (em): AF found / Normal irregular / Normal unreadable | Passes | Muscle (ma): AF / Normal irr. / unreadable | Passes |
|---|---|---|---|---|
| 24 | 86.2 / 9.8 / 11.1 % | yes | 86.0 / 9.8 / 11.5 % | yes |
| 18 | 85.1 / 9.7 / 11.9 % | yes | 83.3 / 10.7 / 15.7 % | yes |
| 12 | 82.6 / 7.7 / 17.0 % | yes | 75.5 / **17.9** / 29.1 % | no |
| 9 | 80.3 / 6.7 / 21.3 % | yes | 60.2 / 23.3 / 49.8 % | no |
| 6 | 75.7 / 5.1 / 31.1 % | no | 33.5 / 18.1 / 72.8 % | no |
| 3 | 62.7 / 4.5 / 49.3 % | no | 12.5 / 6.5 / 91.5 % | no |
| 0 | 40.6 / 5.8 / 78.8 % | no | 4.6 / 2.4 / 96.9 % | no |

## Requirement
* **Electrode-motion noise: SNR ≥ 9 dB.** Below that the check mostly says "could not read" — safe, but useless.
* **Muscle noise: SNR ≥ 18 dB.** This is the stricter bar and the dangerous one. At 12 dB, normal rhythm is called
  irregular in 17.9 % of checks, nearly double the clean rate. Muscle noise passes the two-detector gate, because
  both detectors see the same spikes.

**What it means for the product.** Finger-pad or dry electrodes put muscle tension in the signal, so a reusable
electrode is acceptable only if it keeps muscle noise ≥ 18 dB below the ECG at rest. The app's instruction "sit
still, hands on knees" matters more than any algorithm change. Measure it on the bench before switching electrodes
(BENCH_TEST.md §6): record 30 s with gel and with the reusable electrode on the same person.

Limits: NSTDB noise is from 1980s Holter recordings, and our electrodes are not measured here. This is the target
they must meet, not a claim that they meet it.
