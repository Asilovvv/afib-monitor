# AFib patch v1 — schematic (as code), netlist and JLCPCB BOM

`python design.py` writes `netlist.csv` (every net and the pins on it) and `bom_jlcpcb.csv` (JLCPCB BOM format).
It also runs a rules check: no net with a single pin, every power pin connected, no required net missing.
The current result is **ERC OK, 46 parts, 35 nets**.

## Blocks
| Block | Part | Connections |
|---|---|---|
| ECG front end | AD8232 (U1) + 7 C, 14 R | Copied net for net from the SparkFun AD8232 board (CC BY-SA 3.0). Its values are exactly the datasheet "cardiac monitor" set: 0.5 Hz two-pole high-pass, 40 Hz two-pole low-pass, system gain 1100, driven right leg. FR → 3V3, AC/DC → GND (3-electrode DC leads-off), SDN pulled up and driven by the MCU. |
| Electrodes | 3.5 mm jack J1 | Tip RL, ring LA, sleeve RA (as SparkFun). |
| MCU | ESP32-S3-MINI-1-N8 (U2) | ECG_OUT → IO2, LO+ → IO4, LO− → IO5, SDN ← IO6, battery → IO1 (ADC1 pins). Native USB D−/D+ on IO19/IO20 (pins 23/24). EN RC 10 kΩ / 1 µF (datasheet §9). BOOT button on IO0. |
| USB-C | TYPE-C-31-M-12 (J2) | 5.1 kΩ on CC1 and CC2 (power sink). |
| Charger | MCP73831 (U3) | RPROG 10 kΩ → 100 mA typical (datasheet DC table); LED on STAT. |
| 3.3 V | ME6211C33 (U4) | From VBAT, CE tied to VIN, 1 µF in/out (datasheet typical circuit). |
| Battery sense | 100 k / 100 k + 100 nF | VBAT/2 to IO1; draws about 21 µA all the time. |

## Not done yet (needs KiCad and a person)
* **Layout and routing.** The KiCad netlist is ready (`kicad/`, steps in `kicad/README.md`), but the parts are not placed. The CPL (placement) file for JLCPCB needs the layout, so it does not exist yet.
* **BOM:** all 26 lines have LCSC numbers checked on lcsc.com (20 Oct 2026); parts on the board $10.18, of which small parts $1.16.
  The 10 MΩ resistors are ±5 % (the ±1 % ones were out of stock); this shifts the 0.5 Hz high-pass corner by up to about 5 %.
* **Values from secondary sources, to check before ordering:**
  * 4.7 µF on the charger (the Microchip datasheet could not be fetched);
  * ESP32 3V3 decoupling (22 µF + 0.1 µF; the datasheet extract did not tie them to 3V3).
* **Firmware:** `firmware/AFibMonitor/board.h` already has these pins (build with `-DBOARD_PATCH_V1`); CI checks they match this schematic.
* **Medical device safety.** An ECG device on a patient needs the safety standard IEC 60601-1, which covers leakage current and isolation. USB-powered measurement while charging must be blocked or isolated. **An electronics engineer has to review this before anything is worn.**

## Sources
* SparkFun AD8232 Heart Rate Monitor, `Hardware/AD8232_Heart_Rate_Monitor.sch`: https://github.com/sparkfun/AD8232_Heart_Rate_Monitor
* AD8232 datasheet (pin table, cardiac monitor configuration): https://www.analog.com/media/en/technical-documentation/data-sheets/ad8232.pdf
* ESP32-S3-MINI-1 datasheet, Table 3-1 and §9: https://documentation.espressif.com/esp32-s3-mini-1_mini-1u_datasheet_en.pdf
* ME6211 datasheet (LCSC copy): https://atta.szlcsc.com/upload/public/pdf/source/20250530/60CE153C45E33CC3B9EA78DF6714D2EA.pdf
* MCP73831 pinout and RPROG table (summary of the Microchip datasheet): https://components101.com/ics/mcp73831t-battery-charge-management-controller-ic
