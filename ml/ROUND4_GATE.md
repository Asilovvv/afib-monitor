# Round 4: a noise gate for the live verdict — chosen on tuning data, tested once

Plan fixed before the data was read: `ml/ROUND4_PREREG.md` §1 (commit 845826a, 29.10.2026 00:58).
Choice made on tuning data only and committed before the test: `ml/ROUND4_GATE_CHOICE.json` (commit 0033797, 01:07).
Test run once: `ml/ROUND4_GATE_TEST.json` (01:08, after the choice commit at 01:07). Code: `ml/round4_gate.py`; the device's live path runs through
`tools/parity/live_host.cpp`, compiled from the firmware's own headers (`live_path.h`, `live_gate.h`, `check30.h`);
on the five AFDB A4 records it gives the same 2,145 decisions and probabilities as the Python emulation that matched
the chip in A4 (99.49 / 80.11 % vs 99.49 / 80.12 %).

## Choice (tuning: AFDB 04015, 05121, 07879 with NSTDB em/ma bursts from the first half of each noise record)

| Candidate (best threshold with ≥ 97 % clean kept) | Clean kept | Noise-induced changes blocked, em+ma ≤ 6 dB |
|---|---|---|
| G1: live detector vs second detector | 97.1 % | 91.9 % (8,915 / 9,704) |
| **G2: the 30-s check's two detectors, < 0.71 → noisy** | **97.1 %** | **92.6 % (8,987 / 9,704)** |
| G3: signal quality index | 97.1 % | 71.0 % (6,892 / 9,704) |

Detector lag constant: −1 sample. A noisy window blocks the verdict until 8 decisions (32 beats) pass without one.

## Test — the pass rule is NOT met

| Rule (fixed in advance) | Result | |
|---|---|---|
| clean kept ≥ 95 %, CinC 2017 (12,527 decisions; 3,325 recordings: 537 AF, 2,788 Normal) | 95.8 % | yes |
| clean kept ≥ 95 %, AFDB 05261 + 08215 (22,648 decisions) | 98.3 % | yes |
| electrode motion (em) ≤ 6 dB: changes blocked ≥ 80 % | **72.9 %** (1,905 / 2,613) | **no** |
| muscle (ma) ≤ 6 dB: changes blocked ≥ 80 % | **71.0 %** (3,487 / 4,913) | **no** |

By condition (share of noise-induced verdict changes blocked): CinC em 12 / 6 / 0 dB — 48 / 72 / 75 %;
ma 12 / 6 / 0 dB — 49 / 64 / 83 %; bw 12 / 6 / 0 dB — 35 / 48 / 62 %; AFDB bursts at 6 dB — em 23 % (21 of only 91
changes), ma 46 %. The gate generalised worse than on the tuning records (92.6 % → about 72 %).

## What it does on the ml/NOISE_SQI.md protocol (CinC 2017 AF + Normal, per recording, verdict = share of AF-like decisions ≥ 0.5)

| Noise | False AF on Normal recordings, no gate → gate | Sensitivity, no gate → gate | Normal / AF recordings left without a verdict |
|---|---|---|---|
| clean | 189 → 166 | 93.7 → 93.6 % | 2.5 / 0.7 % |
| em 6 dB | 284 → 174 | 94.0 → 94.1 % | 12.1 / 4.7 % |
| em 0 dB | 696 → 352 | 95.1 → 94.7 % | 36.7 / 18.8 % |
| ma 12 dB | 309 → 206 | 94.9 → 95.1 % | 8.2 / 4.5 % |
| ma 6 dB | 699 → 370 | 96.1 → 96.9 % | 27.9 / 23.5 % |
| ma 0 dB | 796 → 268 | 92.8 → 95.2 % | 58.4 / 57.5 % |

For comparison, the SQI gate tested on this protocol before (ml/NOISE_SQI.md) removed no false AF calls under
electrode motion (376 → 376 at 0 dB). This gate halves them and removes 12 % of false AF calls on clean signals,
without lowering sensitivity; the price is "poor signal" on about 4 % of clean decisions.

## Honest reading
* The pre-registered bar (≥ 80 % of noise-induced changes blocked for each noise type) is not met: about 72 %.
* It is still the first gate in this project that measurably reduces false AF-like verdicts in noise.
* Muscle noise at 6 dB still leaves 370 false AF-like verdicts among the 1,814 Normal recordings that keep a
  verdict (20 %): the bench requirement
  "muscle SNR ≥ 18 dB" (ml/SNR_REQUIREMENT.md) stays necessary; the gate does not replace it.
* Whether the gate ships in the firmware is the owner's decision (ml/ROUND4_PREREG.md §1). If it ships, A9 is
  repeated on the board as a separate row.
