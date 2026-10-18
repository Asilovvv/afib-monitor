# How much AF each wearing mode finds — LTAFDB (Notebook 15)

Kaggle notebook `bekturasilov/afib-wear-modes-on-ltafdb`, version 1 (18 Oct 2026). The cell loads `ml/wear_modes_ltafdb.ipynb`
from the repository (commit 24c11ad) and runs its code, sha256 prefix `5696a371bf279f29`. Rules were committed before the run.

The data is 84 recordings of about 24 h, from which the notebook took 58,806 two-minute pairs (a check plus its repeat).
83 people had AF in their recording: 17 with burden < 5 %, 26 with 5–50 % and 40 with ≥ 50 %.

**Definitions used below:**
* **Finds AF:** two irregular checks in a row while at least half of that minute is labelled AF.
* **False alarm:** two irregular checks in a row while the whole minute is labelled normal.

| Mode (replayed on the same day) | Burden < 5 % | 5–50 % | ≥ 50 % | All with AF | False alarms per day |
|---|---|---|---|---|---|
| Continuous (check every 2 min) | 70.6 % | 96.2 % | 100 % | 92.8 % | 21.2 |
| Night only, 8 h | 33.6 % | 62.6 % | 99.4 % | 74.4 % | 6.6 |
| 6 checks a day | 7.4 % | 74.5 % | 100 % | 73.0 % | 0.18 |
| 3 checks a day | 3.0 % | 48.1 % | 99.7 % | 63.7 % | 0.09 |
| 2 checks a day | 2.3 % | 33.7 % | 98.2 % | 58.4 % | 0.06 |
| 1 check a day | 1.1 % | 16.0 % | 88.0 % | 47.6 % | 0.03 |

**Decision by the rule fixed in advance.** None of the "k checks a day" modes finds AF in ≥ 90 % of people with burden ≥ 5 %.
The best one, 6 checks a day, reaches 89.96 % (19.4 + 40 of 66 people), just under the line. So no checks-a-day mode
is offered as a general cheap replacement for wearing the patch.

**What the numbers do show:**
* **High burden (≥ 50 %, usually persistent AF):** 2–3 checks a day are enough (98–100 %) with almost no false alarms.
  That suits *monitoring known AF* — rate, response to treatment — with reusable electrodes and no consumables.
* **Rare episodes (< 5 %):** only continuous wear helps (71 %); checks find almost nothing (1–7 %). *Looking for*
  paroxysmal AF needs the patch worn all the time.
* **False alarms in continuous mode:** running the 30-s check every 2 minutes gives 21 false alarms a day in these
  people, many of whom have frequent ectopic beats. The device does not alarm this way: the continuous mode uses the
  network plus the 30-s rule. The figure shows that a bare 30-s check must not run non-stop as an alarm.

**For the business plan:** two products, not one.
* **Search for AF (diagnosis):** patch worn continuously for 2–4 weeks with disposable electrodes, rented through a
  clinic like a Holter monitor.
* **Control of known AF:** 2–3 checks a day with reusable electrodes, sold with a subscription.

This needs a version with reusable electrodes (dry electrodes or finger pads). That is hardware work, and its
signal quality has to be tested again.

Limits: LTAFDB has only people with AF, so false alarms in healthy people are not measured here (CinC 2017 and
Notebook 12 cover normal rhythm). "Night 8 h" is a random 8-h block, because the clock time of the recordings is
not known.
