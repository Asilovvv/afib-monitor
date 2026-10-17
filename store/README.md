# Store listing (App Store / Google Play)

Texts for the **wellness** build (`PRODUCT_MODE=wellness`): no claims about detecting or diagnosing AF.
The AF-detection wording may appear only after the software is registered as a medical device.

| Folder | Store | Note |
|---|---|---|
| `ru/` | App Store (ru), Google Play (ru-RU) | main language for Kyrgyzstan |
| `en-US/` | App Store, Google Play | |
| `ky/` | Google Play (ky-KG) | as far as I know the App Store has no Kyrgyz localization — check the language list in App Store Connect; if absent, KY lives only inside the app |

Limits checked by script: name ≤ 30, subtitle ≤ 30, promo ≤ 170 characters, keywords ≤ 100 bytes (Cyrillic = 2 bytes), description ≤ 4000.

Before submitting:
- App Store Review Guideline 1.4.1 (medical apps): state clearly what the app does and does not do; the text says "not a medical device" and "does not replace a doctor".
- Privacy nutrition labels: health data, contact info (email), identifiers; linked to the user; not used for tracking.
- Google Play: Health apps declaration + Data safety form.
- Screenshots: take from the wellness build (Monitor, ECG recording, diary, doctor report, privacy screen).
