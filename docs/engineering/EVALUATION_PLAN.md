# Evaluation plan: users, doctors, clients

FEI Full-Stack guideline, Appendix 1 §8.2–8.3 ("real users or domain experts evaluate the system; a supervisor demo is not
user evaluation") and the Start-up track (client interviews). Index: [README.md](README.md).
Targets are fixed in [REQUIREMENTS.md](REQUIREMENTS.md) before any session: **NFR-15** — SUS ≥ 68 and ≥ 80 % task success
on the core patient tasks with ≥ 5 participants; **FR-09** — offline acceptance test. Results go to
`EVALUATION_RESULTS.md` (to be created after the sessions), failures included.

**Status: not run yet.** Nothing below may start before the supervisor (and, if the department requires it, its ethics
procedure) has approved this plan and each participant has signed the consent in §6.

## 1. Questions this evaluation answers

| ID | Question | Method | Requirement |
|---|---|---|---|
| E1 | Can people who might use the app complete the core tasks without help? | moderated usability test, think-aloud | NFR-15, FR-06–FR-14 |
| E2 | Do they understand what a result means and what to do next? | comprehension questions after T3 | FR-08, NFR-11 |
| E3 | Do doctors find the portal's outputs usable and worth their time? | expert review with tasks + questionnaire | FR-16–FR-21 |
| E4 | Does the app lose readings without internet? | acceptance test T-OFF | FR-09 |
| E5 | Is there a problem worth paying for, and who pays? | client interviews (patients, relatives, clinics) | Start-up track |

## 2. Safeguards

* Adults only (18+), voluntary, can stop at any moment without giving a reason.
* **No real health data:** participants use prepared demo accounts and the app's demo mode (simulated signal). Wearing the
  sensor is not part of this study; if it is ever added, only on battery, never connected to the mains, and only after a
  separate approval.
* No names in any file of the repository; each participant gets a code (U01, D01, C01). Notes are written on paper or an
  offline file kept by the author; only aggregated results are published.
* No audio or video unless the participant agrees separately in writing.
* The study evaluates software usability; it gives no medical advice. A participant who mentions symptoms is told to see
  their doctor.

## 3. Participants

| Group | Who | How many | Recruitment |
|---|---|---|---|
| U — patient-like users | adults, mixed ages, at least two aged 55 or older; at least one Kyrgyz-speaking; Android and iPhone owners | 5–8 | relatives and acquaintances of students, a clinic waiting room only with the clinic's permission |
| D — domain experts | cardiologist or arrhythmologist; general practitioner (family doctor) | 2–3 | the clinics already contacted (letters), the supervisor's contacts |
| C — clients (start-up) | patients with diagnosed AF or their relatives; clinic heads or purchasing decision makers | 5–10 and 2–5 clinics | same; clinics via the letters |

Small samples like this are the usual practice for finding usability problems (Nielsen and Landauer, 1993), not for
estimating rates; the report therefore gives raw counts, not percentages with false precision.

## 4. Procedures

### 4.1 Usability test — group U (40 min, one participant at a time)

Setup: the author's phone (or the participant's own with the APK), app freshly installed, server reachable, demo account
prepared, language as the participant prefers.

| Task | Instruction given to the participant | Success = |
|---|---|---|
| T1 | "Sign in with this account: …" | signed in, on the Monitor tab, unaided |
| T2 | "Start the demo and tell me your heart rate now." | demo started, number read correctly |
| T3 | "Do a 30-second rhythm check." | check completed, result reached |
| T3a | "What does this result mean? What would you do now?" | says in own words: not a diagnosis; repeat / show a doctor as the screen says; 103 if unwell |
| T4 | "You feel your heart racing, moderately. Record it with a note." | symptom saved with severity and note |
| T5 | "Your blood pressure monitor shows 135/85, pulse 72. Save it." | value saved correctly |
| T6 | "Your daughter wants to see that you did your checks. Give her access." | invite code found |
| T7 | "Where would you download all your data? And delete your account? (Do not press delete.)" | both found |

Per task: success unaided / with one hint / failed; time; errors; Single Ease Question (1–7) right after the task.
After all tasks: SUS (§6.2), then three open questions — what was hardest, what was missing, would you use it and why.

### 4.2 Expert review — group D (45 min)

Setup: the public portal or a local server with demo data, as the demo doctor.

| Task | Success = |
|---|---|
| D1 Find the patients who need attention today | names the right patients from Overview |
| D2 Open last night's irregular checks, read one strip, mark it "seen" | strip opened, mark set |
| D3 Open a patient's report and prepare it for printing | one-page report shown |
| D4 Review an AF episode: confirmed or false alarm | review saved |
| D5 Set a plan of 30-s checks for a patient | plan saved |
| D6 Lend a sensor to a patient until a date, then mark it returned | loan created and closed |

Then SUS and the expert questionnaire (§6.3); then an open interview: what would make the strips usable for a decision,
what is clinically misleading, what workload it adds, what must change before a pilot.

### 4.3 Offline acceptance test T-OFF (FR-09) — done by the author

1. Phone with the app signed in, sensor or demo mode streaming, note the time.
2. Airplane mode for 10 minutes; record one symptom and one 30-s check during that time.
3. Network back on; wait 1 minute.
4. Pass if: the server has every reading of the 10 minutes (compare the app's queued count before reconnecting with the
   readings in the export for that period), and the symptom and the check strip arrived. Record the numbers, pass or fail.

### 4.4 Client interviews — group C (20–30 min)

Problem interviews about past behaviour, not opinions about our product (the product is shown only at the end, if at all).

*Patients and relatives:* When did you last feel your heart beat unusually? What did you do then? How was AF diagnosed —
how long did it take, what did it cost, how many visits? How do you check your rhythm now? What devices or apps have you
tried; what happened to them? Who in the family follows your health; how do they find out? What did you pay for anything
heart-related in the last year?

*Clinics:* How many patients with known or suspected AF do you see a month? How is rhythm monitoring done now (Holter,
ECG at visits) and how long is the wait? Who decides on buying equipment or services, and from which budget? What would a
pilot need from us (documents, training, data protection)? Would you write a letter of interest or refusal (Start-up
track: 2–5 letters)?

Notes per interview: code, role, date, key facts (numbers they said), quotes (with permission), willingness to pilot or pay.
Existing material: willingness-to-pay survey and letter drafts (thesis artifacts), `docs/PRICING.md`, `business/`.

## 5. Analysis and reporting

* SUS per participant (standard scoring, 0–100) and the mean; task success counts per task; median time; SEQ median.
* NFR-15 is met only if mean SUS ≥ 68 **and** at least 80 % of the T1–T7 attempts succeed unaided or with one hint.
* Every problem observed becomes an issue with severity 0–4 (0 not a problem … 4 must fix before release), linked to the
  requirement it touches; fixes are re-tested with new participants where possible.
* Expert answers are reported per question (no averaging across 2–3 doctors); quotes only with permission.
* Interview findings: a table of facts (what people did, paid, waited), separate from opinions.

## 6. Forms

### 6.1 Consent (Russian working text; the Kyrgyz version is prepared by the author)

> Я, участник с кодом ____, согласен(на) принять участие в проверке удобства учебного приложения AFib Monitor
> (дипломный проект Ala-Too International University). Я понимаю, что: это не медицинское обследование и не медицинское
> изделие; используются учебные аккаунты и смоделированный сигнал, мои медицинские данные не собираются; моё имя не
> попадёт в отчёт; я могу прекратить участие в любой момент без объяснения причин; аудио и видео не записываются
> (если не отмечено ниже отдельно). Контакт автора: ____. Дата ____ Подпись ____
> ☐ Согласен(на) на аудиозапись для заметок (удаляется после расшифровки)

### 6.2 System Usability Scale (Brooke, 1996), 1 = strongly disagree … 5 = strongly agree

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Russian and Kyrgyz working translations are used in the sessions and reported as **not validated translations** (a
limitation).

### 6.3 Expert questionnaire (1–5 unless stated)

1. The ECG strip is readable enough to judge the rhythm. 2. The overview shows who needs attention first. 3. The morning
queue fits into a clinic morning (minutes per day you would accept: ____). 4. The report contains what you need for a
referral or a visit. 5. Alerts would be worth reading in a pilot (how many per day per 50 patients is acceptable: ____).
6. Anything clinically misleading on any screen? (open) 7. What must change before you would use it with patients in a
pilot? (open)

## 7. Schedule

| When | What |
|---|---|
| before the first session | supervisor approves this plan; consent forms printed in Russian and Kyrgyz |
| November 2026 | expert review D (2 doctors, during the clinic visits already planned); T-OFF; first client interviews |
| November–December 2026 | usability test U (5 people); fixes |
| before the April pre-defense | second usability round with new participants after the fixes; interviews and letters completed |
