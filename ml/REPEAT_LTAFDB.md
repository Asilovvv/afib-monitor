# "Irregular twice in a row" — 30-second check v3 on the Long-Term AF Database (Notebook 12)

Kaggle notebook `bekturasilov/afib-check-twice-in-a-row-on-ltafdb` (version 1, 18 Oct 2026); the cell runs the code of
`ml/repeat_ltafdb.ipynb` byte for byte (sha256 prefix `35a372400af59991`). Rules committed before the run (e714e84).
LTAFDB was never used for development, so this is also the third external test of the check (after CinC 2017 and
NSTDB noise). 84 people, 50,356 one-minute pairs (two consecutive 30-s checks): 29,394 AF minutes (76 people),
20,962 normal-rhythm minutes (50 people).

| | AF minutes called irregular | Normal minutes called irregular | Normal minutes "repeat" |
|---|---|---|---|
| One check | 93.6 % | 13.2 % | 11.7 % |
| **Irregular twice in a row** | **92.3 %** | **8.7 %** | 19.5 % |
| Per person (median), one check → twice | 98.4 → 98.1 % | 8.7 → 3.8 % | — |

* Requiring two irregular checks in a row costs 1.3 points of AF found and cuts false "irregular" on normal rhythm
  by a third overall (13.2 → 8.7 %) and by more than half for the typical person (8.7 → 3.8 %).
* The normal minutes here belong to people who also have AF, often with many ectopic beats, which is why one check
  gives more false "irregular" (13.2 %) than on CinC 2017 (8.9 %).
* Minutes of one person are not independent; the per-person medians are given for that reason.

**Decision.** The app and the device now say "irregular — show your doctor" only after two irregular checks in a
row; after the first one they ask to sit still and check again. One irregular and one regular check → "repeat".
