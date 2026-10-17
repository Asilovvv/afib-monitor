# Two improvements tested on unseen data (Notebook 5)

Kaggle notebook `bekturasilov/afib-16-beat-model-and-bsqi-gate` (version 1, 18 Oct 2026), code in
`ml/afib_improve_16beat_bsqi.ipynb`. Both models trained once on AFDB (same 21 + 2 patients as Notebooks 3–4),
tested on PhysioNet/CinC 2017 AF and Normal recordings. Rules fixed before the run.

## (a) 16-beat model for 30-second spot checks

| | 32 beats | 16 beats |
|---|---|---|
| Recordings it can classify (of 5,834 A/N) | 57.0 % | **95.7 %** |
| Same 3,328 recordings both can classify: sens / spec | 93.9 % / 95.4 % | 95.3 % / 93.8 % |
| Recordings only the 16-beat model can classify (167 AF, 2,089 N): sens / spec | — | 85.0 % / 90.1 % |
| All AF recordings found ("cannot classify" = no AF) | 66.5 % | **86.3 %** |
| All Normal recordings correctly not called AF | 97.5 % | 92.5 % |

The 16-beat model finds many more AF recordings in short spot checks but makes more false AF calls,
especially on the short recordings only it can classify. It suits a "30-second check" mode; continuous
monitoring stays on the 32-beat model.

## (b) Two-detector agreement gate (bSQI) under noise, 32-beat model

bSQI over the 10 s before each decision = matched beats / (beats₁ + beats₂ − matched), detectors: our energy
detector and `wfdb` XQRS, tolerance 150 ms, decision dropped if bSQI < 0.8 (Li, Mark, Clifford 2008).

| Noise | False AF calls on 2,791 N: no gate → bSQI gate | Spec: no gate → gated | Sens: no gate → gated | No verdict AF / N | AF found of all AF (gated) |
|---|---|---|---|---|---|
| clean | 128 → 111 | 95.4 → 95.5 % | 93.9 → 94.1 % | 4.7 / 11.3 % | 89.8 % |
| em 12 dB | 134 → 111 | 95.2 → 95.5 % | 93.5 → 94.7 % | 5.8 / 11.6 % | 89.2 % |
| em 6 dB | 175 → 111 | 93.7 → 95.2 % | 92.9 → 94.2 % | 9.9 / 17.7 % | 84.9 % |
| em 0 dB | 376 → **136** | 86.5 → 91.8 % | 91.6 → 92.3 % | 25.0 / 40.7 % | 69.3 % |
| ma 12 dB | 230 → 123 | 91.8 → 94.4 % | 90.9 → 92.3 % | 10.1 / 20.8 % | 83.1 % |
| ma 6 dB | 457 → **158** | 83.6 → 88.8 % | 83.2 → 93.8 % | 34.5 / 49.4 % | 61.5 % |
| ma 0 dB | 433 → 103 | 84.5 → 79.4 % | 48.8 → 84.8 % | 73.0 / 82.0 % | 22.9 % |

Unlike the earlier SQI (Notebook 4), the two-detector gate does catch noise: with strong electrode-motion noise
false AF calls fall by 64 % (376 → 136). The price is honesty about uncertainty: noisy stretches get "signal too
poor" instead of a verdict (on clean recordings 11 % of normal ones lose their verdict, mostly short ones).
