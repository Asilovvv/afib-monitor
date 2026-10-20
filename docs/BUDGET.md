# Budget and unit economics (summary)

All figures come from `business/afib_unit_economics.xlsx`, where every input has its source. Prices exclude VAT and
customs. Exchange rate: 87.45 som per USD (NBKR, 17 Oct 2026).

## One device (batch of 100)
| Item | USD | Source |
|---|---|---|
| ESP32-S3-MINI-1-N8 | 3.38 | LCSC C2913206 |
| AD8232 ECG front end | 5.64 | LCSC C43216 |
| LiPo 150 mAh battery | 5.95 | Adafruit #1317, retail (upper bound) |
| All other parts, PCB and assembly | 2.22 | BOM `hardware/patch_v1/bom_jlcpcb.csv` (LCSC) + JLCPCB Economic PCBA rates |
| **Device without enclosure** | **17.20** (≈ 1,504 som) | |

Not included yet: enclosure, electrode cable, packaging, delivery, customs, and the PCB price for 100 boards (the $2 for 5 boards offer is used).

## Running the service
| Item | Cost | Source |
|---|---|---|
| Render web service | $7 / month | render.com/pricing |
| Render PostgreSQL (or Neon, free tier) | $6 / month | render.com/pricing, neon.com/pricing |
| Apple Developer Program | $99 / year | developer.apple.com |
| Google Play registration | $25 once | support.google.com |
| App store commission on subscriptions | 15 % | Apple Small Business Program |
| **Fixed service cost** | **≈ 1,858 som / month** | |

## Proposed prices (to be checked by the survey)
| | Value |
|---|---|
| Device | 6,900 som → gross margin before enclosure 78 % |
| Subscription | 390 som / month → 332 som left per subscriber after store commission |
| Subscribers to cover the fixed service cost | 6 |
| Contribution per year at 50 / 200 / 1,000 subscribers | 176,600 / 773,300 / 3,955,700 som |

## Electrodes: the main running cost
With continuous wear (assumed 45 electrodes a month at $0.22 each), electrodes cost about 866 som per patient per month,
2.2 times the subscription. Notebook 15 (`ml/WEAR_MODES.md`) shows why two products make sense:
* **search for paroxysmal AF:** continuous wear for 2–4 weeks, rented through a clinic like a Holter monitor;
* **control of known, frequent AF:** 2–3 checks a day with reusable electrodes and no consumables. These electrodes must
  meet the noise requirement from Notebook 16 (`ml/SNR_REQUIREMENT.md`).

## What a patient pays in the first year
| Option | Som | % of average annual salary |
|---|---|---|
| AFib Monitor, worn continuously (device + subscription + electrodes) | 24,047 | 3.9 % |
| AFib Monitor, checks only | 11,580 | 1.9 % |
| 24-h Holter four times a year (MC HUMAN / kardiocentr.kg) | 6,000 / 7,200 | 1.0 / 1.2 % |
| KardiaMobile 6L Max + KardiaCare Plus (US prices) | 30,433 | 4.9 % |

Average salary: 51,888 som a month (Nacstatkom, January–May 2026).
