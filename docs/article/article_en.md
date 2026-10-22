# A low-cost open system for scheduled 30-second ECG rhythm checks in patients with known atrial fibrillation: design and pre-registered retrospective evaluation

**Draft v0.1, 22 October 2026. Not submitted.**
To settle before submission: the target journal's format (docs/article/VENUES.md), the author list, the AI-assistance
statement, and a check of every reference against the original.

Bektur Asilov¹, [cardiologist co-author — to be invited], Erustan Erkebulanov¹ (supervisor; authorship to be agreed)

¹ Department of Computer Engineering, Ala-Too International University, Bishkek, Kyrgyzstan

---

## Abstract

**Objective.** People with known atrial fibrillation (AF) need their rhythm followed between clinic visits, but
continuous Holter or patch monitoring is costly and rarely available outside large centres. We built an open,
low-cost single-lead ECG system for scheduled 30-second rhythm checks reviewed by the treating doctor. We evaluated
every medical function on public data, with the evaluation rules fixed before each run.

**Methods.**
- *System.* An AD8232 analogue front-end with an ESP32-S3 microcontroller (component cost US$17.20 without
  enclosure), a mobile application and a web portal for doctors.
- *Check rule.* The 30-second check flags a strip as irregular when the mean absolute successive RR difference
  exceeds 10 % of the mean RR. It refuses a verdict when there are fewer than 16 beats, signal quality is low, or
  two independent beat detectors disagree. The same rule is implemented in C++ (device), TypeScript (phone) and
  Python (server).
- *Evaluation.* Each experiment's rules were committed to a public repository before it was run, on five public
  databases: MIT-BIH Arrhythmia, PhysioNet/CinC Challenge 2017, MIT-BIH Noise Stress Test, the Long-Term AF Database
  and MIMIC PERform AF.

**Results.**
- *Agreement between implementations.* The device, phone and server gave identical verdicts on 40 of 40 test strips.
- *Beat detector* (MIT-BIH Arrhythmia, 109,494 beats): sensitivity 98.7 %, positive predictive value 99.4 %.
- *Single check, CinC 2017* (8,528 hand-held recordings, never used for tuning):
  - AF recordings called irregular 85.6 %;
  - normal-rhythm recordings called irregular 8.9 %;
  - normal-rhythm recordings asking for a repeat 11.0 %.
- *Two irregular checks in a row, Long-Term AF Database* (84 people):
  - AF minutes called irregular 92.3 % (one check: 93.6 %);
  - normal minutes called irregular 8.7 % (one check: 13.2 %).
- *Checks two or three times a day* (replayed on the same recordings):
  - burden ≥ 50 %: AF found on 98–100 % of people;
  - burden < 5 %: AF found on only 2–3 %, against 70.6 % with continuous wear.
- *Noise tolerance.* The check holds its accuracy down to a signal-to-noise ratio of 9 dB for electrode-motion
  noise and 18 dB for muscle noise.
- *Fingertip photoplethysmography (PPG) with the same rule,* recorded at rest at the same time as the ECG:
  - AF windows called irregular as often as by ECG (92.4 vs 91.2 %);
  - non-AF windows called irregular more often (10.5 vs 4.4 %).

**Conclusion.**
- Scheduled 30-second single-lead checks are a reasonable, inexpensive way to follow people whose AF is already
  known and frequent. They are not a way to search for rare paroxysmal episodes.
- PPG could act as a first alarm but should be confirmed by ECG.
- A prospective study with our own hardware is the next step.

**Keywords:** atrial fibrillation; single-lead ECG; wearable; remote monitoring; RR irregularity; signal quality;
open source; low-resource settings.

---

## 1. Introduction

Atrial fibrillation is the most common sustained arrhythmia and a major cause of stroke and heart failure [1, 2].
Current guidelines stress follow-up of rhythm and rate, symptoms and treatment response in people with diagnosed AF,
not only its detection [2].

Two families of devices dominate ambulatory ECG today:
- **Holter and patch monitors.** They record continuously for days or weeks, but each recording is an episode of
  care that needs a clinic visit and analysis.
- **Consumer devices.** A single-lead ECG in a watch, or a hand-held recorder, puts a 30-second check in the
  patient's hands [3, 4]. However, it is expensive, often requires a specific phone, and leaves the doctor outside
  the loop unless the patient sends a report.

In Kyrgyzstan and much of Central Asia both families are hard to scale. Devices are imported and costly. Recorders
and patient applications are rarely available in Kyrgyz. Specialist cardiology is concentrated in the capital.

We therefore asked a narrow, practical question. **Can a low-cost device, built from widely available parts, give the
treating doctor a reliable picture of a known AF patient's rhythm from short scheduled checks?** And where exactly
does such an approach stop working?

This paper describes the system and its retrospective evaluation. Two features of the evaluation matter for how the
numbers should be read:
1. **Rules fixed in advance.** Every rule (thresholds, datasets, decision criteria) was committed to a public
   repository before the corresponding experiment was run. The published notebook printed a hash of the exact code
   that produced each number.
2. **No tuning on the test data.** No threshold was tuned on the dataset used to report it. Two results that went
   against us are reported as they came out:
   - a quality gate that cost too many verdicts on clean signals;
   - a PPG comparison that failed our pre-set criterion.

## 2. Methods

### 2.1 System overview

**Device.** The device uses the AD8232 single-lead ECG front-end in its cardiac-monitor configuration [5]: 0.5–40 Hz
analogue band, gain about 1,100. An ESP32-S3 microcontroller samples it at 250 Hz, applies a digital band-pass of
0.5–40 Hz, and downsamples to 125 Hz.

Two hardware versions share one firmware:
- a prototype built on a commercial development board with a touch screen (M5Stack CoreS3 SE);
- our own patch circuit (ESP32-S3-MINI-1, Li-ion charging, USB-C).

Component cost of the patch without enclosure is US$17.20, at LCSC prices checked in October 2026.

**Software.** The device streams the ECG to an Expo/React Native application over Bluetooth Low Energy. The
application uploads strips to a FastAPI server with a PostgreSQL database. Doctors see patients, check results and
ECG strips in a web portal.

**Interface languages.** Russian, English and Kyrgyz throughout.

**Regulatory status.** The system is not registered as a medical device. Patients outside a research protocol see
only a rhythm check without a diagnosis.

**Two modes of use:**
- **Continuous mode.** A small temporal convolutional network (TCN) [6] on RR intervals runs on the device. It is
  quantised to int8 (27,664 bytes) and makes a decision every four beats over a 32-beat window.
- **Check mode** ("check me in 30 seconds"). The person sits still for 30 s, and a transparent rule gives one of
  three answers: *regular*, *irregular — show your doctor*, or *could not read — repeat*. The doctor can set a
  schedule of checks, for example at 08:00, 14:00 and 20:00, and sees which planned checks were done.

This paper concentrates on check mode, which we consider the realistic product for known AF.
Continuous-mode results are summarised in section 3.6.

### 2.2 The 30-second check

**Beat detection.** R peaks are found by a detector of the Pan–Tompkins family [7]:
1. high-pass by subtracting a 0.6-s moving mean;
2. squared first difference;
3. 150-ms moving average;
4. an adaptive threshold at 35 % of a decaying peak;
5. a 250-ms refractory period.

**Irregularity.** Irregularity is defined as the mean absolute difference between successive RR intervals divided by
the mean RR interval. RR intervals outside 0.25–2.0 s are excluded. A strip is *irregular* if this index exceeds 0.10.

**No verdict.** The check refuses a verdict ("could not read") when any of the following holds:
- fewer than 16 beats are found;
- a signal-quality index is below 0.4. The index combines flat-line detection, plausible heart rate, QRS template
  correlation and high-frequency noise.
- the main detector and a second, amplitude-based detector agree on fewer than 80 % of beats (bSQI < 0.8 with
  150-ms tolerance [8]).

**Choice of the second detector.** It was selected among 16 settings by F1 on MIT-BIH Arrhythmia, a database not
used to report the check's accuracy.

**Confirmation rule.** An *irregular* result is shown as "irregular — show your doctor" only after two irregular
checks within 10 minutes. After the first one the application asks the person to sit still and repeat.

**One rule, three implementations.** The same rule exists in Python on the server, TypeScript on the phone and C++
on the device. The phone and device versions copy the server's integer rounding. On a set of 40 synthetic strips covering regular, irregular, noisy and short cases, all three gave
identical verdicts. The device-versus-server comparison runs automatically whenever the check code changes.

### 2.3 Data

All data are public and de-identified (Table 1). None was used to train or tune a rule that is then reported on the
same data, except where the purpose is stated (section 3.6, leave-one-patient-out).

**Table 1. Databases used.**

| Database | Content | Used for |
|---|---|---|
| MIT-BIH Arrhythmia [9, 10] | 48 half-hour two-lead Holter records, beat annotations | beat detector accuracy; choice of the second detector |
| PhysioNet/CinC Challenge 2017 [11] | 8,528 single-lead hand-held recordings, 9–61 s (N 5,076, AF 758, other 2,415, noisy 279) | external test of the 30-s check |
| MIT-BIH Noise Stress Test [12] | electrode-motion, muscle and baseline-wander noise | noise added to CinC 2017 at fixed SNR |
| Long-Term AF Database [13] | 84 recordings of about 24 h | confirmation rule; schedules of checks |
| MIT-BIH AF Database [14] | 23 recordings of about 10 h | training and leave-one-patient-out test of the continuous model |
| MIMIC PERform AF [15, 16] | 35 intensive-care patients, 20 min of simultaneous fingertip PPG and ECG (19 AF, 16 non-AF) | PPG vs ECG with the same rule |

**Preprocessing.** Signals were resampled to 125 Hz where needed. The first 30 s of each CinC 2017 recording were
used.

### 2.4 Pre-registration and reproducibility

**How every experiment was run:**
1. A rules file was written: datasets, thresholds, metrics and a decision criterion, for example "AF found falls by
   no more than 10 points and false irregular rises by no more than 3 points".
2. The rules file was committed to the public repository before the experiment.
3. The experiment ran as a Kaggle notebook that downloaded the code at that exact commit and printed its SHA-256
   prefix.
4. Results were added to the rules file afterwards, without changing the rules.

**Repository.** The repository contains all rules files, notebooks, the firmware, the server and the application,
under the MIT licence; the hardware is under CC BY-SA 4.0.

**Statistics.**
- Proportions are reported with counts.
- Where people contribute many windows, 95 % intervals come from 2,000 bootstrap resamples of people, not windows.
- Per-person medians are given where windows of one person are not independent.

### 2.5 Ethics

Only public, de-identified databases were used. No person was recorded for this study and no intervention took
place, so ethics committee approval was not required for this analysis.

A prospective pilot with our hardware will be submitted to an ethics committee before any participant is enrolled.

## 3. Results

### 3.1 Beat detector

On all 48 MIT-BIH Arrhythmia records (109,494 reference beats, 150-ms tolerance), our detector was never tuned on
this database. Results:
- **Beats:** sensitivity 98.7 %, positive predictive value 99.4 %.
- **Heart rate per 10-s window:** mean absolute error 1.1 beats/min; 89.5 % of windows within 5 beats/min.
- **Hard records:** four records known to be hard (108, 203, 223, 228) had a sensitivity below 95 %.
- **Pauses (RR ≥ 3 s):** the weak point. 34 of 42 true pauses were found, but 25 of the 59 reported pauses were
  false, caused by missed beats. In the system, pauses are therefore shown to the doctor only as "check the ECG" and
  only on strips of acceptable quality.

### 3.2 Single 30-second check on CinC 2017

Table 2 shows the three versions of the check, each fixed before its run:
- **v1:** the irregularity rule alone;
- **v2:** v1 plus the two-detector gate with a simple second detector;
- **v3:** v2 with the second detector chosen on MIT-BIH.

**Table 2. First 30 s of CinC 2017 recordings: irregular / could not read / regular (%).**

| Label (n) | v1 | v2 | v3 (deployed) |
|---|---|---|---|
| AF (758) | 91.4 / 4.1 / 4.5 | 69.4 / 26.4 / 4.2 | **85.6 / 9.9 / 4.5** |
| Normal (5,076) | 14.1 / 2.1 / 83.8 | 3.3 / 44.2 / 52.5 | **8.9 / 11.0 / 80.1** |
| Other rhythm (2,415) | 46.0 / 2.1 / 51.9 | 25.9 / 36.7 / 37.4 | 38.4 / 11.6 / 50.0 |
| Too noisy (279) | 72.8 / 25.8 / 1.4 | 2.5 / 97.5 / 0 | 11.5 / 88.2 / 0.4 |

**What each version taught us:**
- **v1** found most AF but called one normal check in seven irregular. It almost never recognised noise.
- **v2** removed most false irregular calls and recognised noise. But it refused a verdict on 44 % of clean normal
  recordings, which would make the check useless in practice.
- **v3** is the deployed compromise:
  - normal rhythm is called irregular in 8.9 %;
  - a repeat is needed in 11 %;
  - 85.6 % of AF recordings are flagged.

**Other rhythms.** Rhythms labelled *other* (many with ectopic beats) are called irregular in 38 %. For a known-AF
patient this is acceptable, because the strip goes to the doctor. For screening it would not be.

### 3.3 Two checks in a row on the Long-Term AF Database

The Long-Term AF Database was not used for any development. From 84 recordings we took 50,356 pairs of consecutive
30-s checks (Table 3).

**Table 3. One check versus "irregular twice in a row".**

| | AF minutes called irregular | Normal minutes called irregular | Normal minutes: repeat |
|---|---|---|---|
| One check | 93.6 % | 13.2 % | 11.7 % |
| Twice in a row | **92.3 %** | **8.7 %** | 19.5 % |
| Per person, median (one → twice) | 98.4 → 98.1 % | 8.7 → 3.8 % | — |

**Effect of the confirmation rule:**
- AF found: −1.3 points.
- False irregular on normal rhythm: down by a third overall, and by more than half for the median person.

**Note on the normal minutes.** They belong to people who also have AF, often with frequent ectopy. This is why one
check gives more false irregular calls here than on CinC 2017.

### 3.4 How often to check

We replayed six wearing modes on the same Long-Term AF Database recordings.
- **AF found** means two irregular checks in a row while at least half of that minute is labelled AF.
- **False alarm** means two irregular checks in a row in a fully normal minute.

**Table 4. Share of people whose AF was found, by burden, and false alarms per day.**

| Mode | Burden < 5 % (n = 17) | 5–50 % (n = 26) | ≥ 50 % (n = 40) | False alarms / day |
|---|---|---|---|---|
| Continuous (check every 2 min) | 70.6 % | 96.2 % | 100 % | 21.2 |
| Night only, 8 h | 33.6 % | 62.6 % | 99.4 % | 6.6 |
| 6 checks a day | 7.4 % | 74.5 % | 100 % | 0.18 |
| 3 checks a day | 3.0 % | 48.1 % | 99.7 % | 0.09 |
| 2 checks a day | 2.3 % | 33.7 % | 98.2 % | 0.06 |
| 1 check a day | 1.1 % | 16.0 % | 88.0 % | 0.03 |

**Pre-set criterion.** Before the run we required ≥ 90 % of people with burden ≥ 5 % to be found. No checks-a-day
mode met it; the best, 6 checks a day, reached 89.96 %.

**What the replay shows:**
- **High burden.** Two or three checks a day find AF in 98–100 % of people with burden ≥ 50 %, with almost no false
  alarms.
- **Rare episodes.** Checks almost never find AF when the burden is below 5 %.

**The resulting split of the product:**
- *Following known, frequent AF:* scheduled checks.
- *Searching for paroxysmal AF:* continuous wear, rented like a Holter monitor.

### 3.5 Tolerance to noise

**Setup.** We added NSTDB electrode-motion and muscle noise to 758 AF and 1,500 normal CinC 2017 recordings at
seven signal-to-noise ratios from 24 to 0 dB (33,870 checks).

**Pre-set pass rule,** compared with the same recordings without noise:
- AF found falls by at most 10 points;
- false irregular on normal rhythm rises by at most 3 points;
- "could not read" rises by at most 15 points.

**Result:**
- **Electrode-motion noise** passed down to 9 dB.
- **Muscle noise** passed only at 18 dB and above. At 12 dB, normal rhythm was called irregular in 17.9 % of
  checks, against 9.8 % without noise.

Muscle noise is the dangerous case, because both beat detectors see the same spikes and the agreement gate does not
catch it.

**Consequence for hardware.** These figures set a measurable requirement for any reusable or dry electrode: muscle
noise must stay at least 18 dB below the ECG at rest.

### 3.6 Continuous model (summary)

**Leave-one-patient-out on the MIT-BIH AF Database** (23 people; threshold fixed at 0.5):
- int8 model, per 32-beat window: sensitivity 98.3 %, specificity 96.5 %;
- all 226 AF episodes of at least 30 s raised an alarm, with a median delay of 13.6 s;
- false alarms: 4.61 per hour of normal rhythm. A rule requiring 30 s of sustained AF reduced them to 0.91 per hour,
  while 90.7 % of episodes were still alerted.

**External test on CinC 2017**, model trained once on all AF Database patients and applied unchanged, on recordings
with at least 33 beats:
- sensitivity 93.9 %, specificity 95.4 %.

**Limitation for short strips.** 43 % of CinC 2017 recordings were too short for the 32-beat model. This is one
reason the 30-s check uses a rule that needs only 16 beats.

### 3.7 PPG compared with ECG on the same people

**Question.** Could a wrist version with a photoplethysmographic (PPG) sensor work like the background rhythm check of
smartwatches [3]?

**Setup.**
- Data: MIMIC PERform AF [15], fingertip PPG and ECG recorded at the same time.
- Both signals were cut into the same 1,400 non-overlapping 30-s windows.
- The ECG was checked with the deployed rule.
- The PPG was checked with the same irregularity rule and threshold applied to pulse peaks, with the analogous
  two-detector gate.
- Nothing was tuned on this dataset.

**Table 5. Share of 30-s windows called irregular (95 % interval, resampling people).**

| | AF windows (19 people) | Non-AF windows (16 people) | Could not read: AF / non-AF |
|---|---|---|---|
| ECG, 30-s check | 91.2 % (84.3–97.0) | 4.4 % (0.6–9.7) | 7.5 / 4.5 % |
| PPG, same rule with gate | 92.4 % (87.8–96.6) | 10.5 % (3.9–20.3) | 7.1 / 9.4 % |

**Per person.** ECG classified all 19 people with AF and 15 of 16 without AF correctly. PPG classified all 19 with AF
and 14 of 16 without AF; one more was unreadable.

**Agreement.** On the windows both signals could read, the two agreed in 94.4 % (Cohen's κ 0.89).

**Pre-set criterion and result.** The criterion required PPG to stay within 5 points of ECG on both measures. It
failed on false irregular calls: +6.1 points. The confidence intervals are wide and overlap, so the true size of the
difference is uncertain.

## 4. Discussion

**Main finding.** A transparent irregularity rule, gated by two-detector agreement and confirmed by a second check,
gives a usable 30-second answer from a single-lead ECG. On data never used for its development it flags about 86 %
of AF recordings in one check and over 92 % of AF minutes with confirmation. False irregular calls on normal rhythm
stay below one in ten, and below one in twenty-five for the median person once confirmed.

**Comparison with commercial devices.** These figures are lower than those reported for commercial single-lead
devices in their validation studies [3, 4]. Those studies, however, used other populations and other reference
standards, so the numbers are not directly comparable.

**What the simulation of check schedules says.** It is, in our view, the most useful result for practice, because it
states plainly what the approach cannot do:
- *Rare episodes.* Scheduled checks will not find rare paroxysmal AF; that needs continuous recording.
- *Known AF with high burden.* For people whose AF is known and frequent, the usual situation when a doctor follows
  rate and treatment response, two or three checks a day capture the arrhythmia on almost every day with almost no
  false alarms.

**Design consequences in the system:**
- the doctor sets the schedule;
- the portal shows planned versus done checks;
- AF estimates are shown to patients only inside a research protocol.

**Transparency.** We chose a transparent rule over the neural network for the check. The rule needs fewer beats,
anyone can verify it, and it behaves identically on three platforms. Identical behaviour matters in practice: a
patient who sees "regular" on the device and the doctor who opens the same strip in the portal must see the same
verdict. An automated parity test checks this whenever the check code changes.

**PPG result.** PPG carried the AF signal as well as ECG. However, it produced more false irregular calls, even in
patients lying still. A wrist sensor during daily life would be worse.

This supports the design used by consumer watches: PPG raises a suspicion, and a 30-s ECG gives the answer. We
therefore plan PPG only as a trigger for an ECG check.

**Cost and access.** At about US$17 in components, the device costs several times less than commercial
single-lead recorders. It does not need a particular phone brand. Open firmware and hardware files allow local
assembly and repair. The interface is in Kyrgyz and Russian.

### Limitations

1. **No measurements on our own hardware yet.** All accuracy figures are retrospective, on public databases recorded
   with other equipment, mostly decades ago. The firmware compiles, and its check logic gives the same verdicts as
   the server on all test strips. Measurements on our own hardware (signal-to-noise ratio of our electrodes, on-chip
   timing, power) were pending at the time of writing.
2. **Single-lead recordings only.** Many CinC 2017 *other* rhythms and the ectopy in LTAFDB are called irregular. The
   check cannot distinguish AF from other irregular rhythms. It is a reason to show the doctor a strip, not a
   diagnosis.
3. **The schedule simulation uses patients from one database.** All LTAFDB patients have AF, so false alarms in
   people without AF are not measured there. CinC 2017 covers that partly.
4. **Small, special PPG dataset.** Only 35 people, all in intensive care, lying still.
5. **Regulation.** The system is not a registered medical device. Clinical use requires a prospective study with
   ethics approval and, eventually, registration.

## 5. Conclusion

An open, low-cost single-lead ECG system with a transparent 30-second rule can give doctors a reliable record of
rhythm in people with known, frequent AF, using two or three scheduled checks a day.

It is not suited to searching for rare episodes, and PPG should only trigger an ECG check, not replace it. Fixing
the rules before each experiment exposed these limits clearly, and we recommend the practice for similar projects.

The next step is a prospective pilot with our hardware in patients with known AF, under ethics approval.

---

## Data and code availability

All code, rules files with results, notebooks, firmware and hardware design files are public:
https://github.com/Asilovvv/afib-monitor (MIT licence; hardware CC BY-SA 4.0).

All databases are public: PhysioNet; Zenodo for MIMIC PERform AF.

## Conflicts of interest

None. [To confirm by each author.]

## Funding

None. [To confirm.]

## Use of AI tools

[To agree with the supervisor and follow the journal's policy. The draft should state which parts were assisted —
for example, code and text drafting — and that the authors take full responsibility for the content.]

## References

[To verify every entry against the original before submission.]

1. Van Gelder IC, Rienstra M, Bunting KV, et al. 2024 ESC Guidelines for the management of atrial fibrillation.
   Eur Heart J. 2024;45(36):3314–3414.
2. Hindricks G, Potpara T, Dagres N, et al. 2020 ESC Guidelines for the diagnosis and management of atrial
   fibrillation. Eur Heart J. 2021;42(5):373–498.
3. Perez MV, Mahaffey KW, Hedlin H, et al. Large-scale assessment of a smartwatch to identify atrial fibrillation.
   N Engl J Med. 2019;381(20):1909–1917.
4. Bumgarner JM, Lambert CT, Hussein AA, et al. Smartwatch algorithm for automated detection of atrial fibrillation.
   J Am Coll Cardiol. 2018;71(21):2381–2388.
5. Analog Devices. AD8232 Single-Lead, Heart Rate Monitor Front End. Data sheet.
6. Bai S, Kolter JZ, Koltun V. An empirical evaluation of generic convolutional and recurrent networks for sequence
   modeling. arXiv:1803.01271; 2018.
7. Pan J, Tompkins WJ. A real-time QRS detection algorithm. IEEE Trans Biomed Eng. 1985;32(3):230–236.
8. Li Q, Mark RG, Clifford GD. Robust heart rate estimation from multiple asynchronous noisy sources using signal
   quality indices and a Kalman filter. Physiol Meas. 2008;29(1):15–32.
9. Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database. IEEE Eng Med Biol Mag. 2001;20(3):45–50.
10. Goldberger AL, Amaral LAN, Glass L, et al. PhysioBank, PhysioToolkit, and PhysioNet: components of a new
    research resource for complex physiologic signals. Circulation. 2000;101(23):e215–e220.
11. Clifford GD, Liu C, Moody B, et al. AF classification from a short single lead ECG recording: the
    PhysioNet/Computing in Cardiology Challenge 2017. Comput Cardiol. 2017;44.
12. Moody GB, Muldrow WK, Mark RG. A noise stress test for arrhythmia detectors. Comput Cardiol. 1984;11:381–384.
13. Petrutiu S, Sahakian AV, Swiryn S. Abrupt changes in fibrillatory wave characteristics at the termination of
    paroxysmal atrial fibrillation in humans. Europace. 2007;9(7):466–470.
14. Moody GB, Mark RG. A new method for detecting atrial fibrillation using R-R intervals. Comput Cardiol.
    1983;10:227–230.
15. Charlton PH, Kotzen K, Mejía-Mejía E, et al. Detecting beats in the photoplethysmogram: benchmarking
    open-source algorithms. Physiol Meas. 2022;43(8):085007.
16. Bashar SK, Ding E, Walkey AJ, McManus DD, Chon KH. Noise detection in electrocardiogram signals for intensive
    care unit patients. IEEE Access. 2019;7:88357–88368.
