# Development plan: a wrist version (v2) and smartwatch data

This is not built. It is the plan for after the diploma, based on Notebook 17 (`ml/PPG_VS_ECG.md`).

## Where we stand vs a smartwatch
* **Same as a watch:** a 30-s single-lead ECG check with three answers. Bluetooth link to the phone, then the
  cloud, then the doctor.
* **Not yet:** background rhythm watching by light (PPG) without electrodes, and a wrist form factor.
* **Proven so far (Notebook 17, fingertip PPG, people lying still):**
  * PPG finds AF as well as our ECG check: 92 % vs 91 % of AF windows.
  * PPG raises false "irregular" more often: 10.5 % vs 4.4 % of non-AF windows.
  * By the rule fixed in advance, PPG is therefore not yet good enough to give a verdict on its own.

## v2 design (proposal)
1. **Two sensors in one bracelet:**
   * an optical pulse sensor on the back (for example MAX30102, an I²C sensor that works with the ESP32-S3);
   * one ECG electrode on the back and one on the top, touched by a finger of the other hand for the 30-s check.
2. **Two-step logic, as on the Apple Watch:** PPG looks for an irregular pulse in the background, at rest only, gated
   by the accelerometer. If it repeats, the phone asks the person for a 30-s ECG check, and only the ECG check is
   shown to the doctor as a result.
3. **Algorithm work before hardware:**
   * a PPG quality gate (pulse shape + motion);
   * a detector that handles small pulses in AF;
   * tuning on public wrist PPG data, then a fresh test on data not used for tuning, with rules committed first as
     in all our notebooks.
4. **Own measurements:** wear the bracelet next to the current ECG patch (the reference) during daily life. Report
   how often PPG raises an alarm, and how often the ECG check confirms it.

## Data from watches people already have (separate track)
The phone app could read ECG recordings and irregular-rhythm notifications that a person's smartwatch has saved
(Apple Health on iPhone) and show them to the doctor next to our data. Needs:
* a separate iOS build of the app with HealthKit permission;
* an Apple developer account;
* the person's explicit consent for each data type.

Watch ECGs would be shown as the watch reported them. Our software would not re-interpret them.

## Not decided
* Who does the bracelet hardware and its electrical safety (IEC 60601-1): needs an engineer.
* Whether PPG alarms are a medical function in the EAEU/KR rules: needs a lawyer. Until registration, all wording
  stays "wellness".
