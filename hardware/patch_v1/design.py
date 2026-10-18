"""AFib patch v1 — schematic as code: parts, values, every pin's net, and an electrical-rules check.

Front end: copied net for net from the SparkFun AD8232 Heart Rate Monitor (CC BY-SA 3.0,
github.com/sparkfun/AD8232_Heart_Rate_Monitor, Hardware/AD8232_Heart_Rate_Monitor.sch); the heartbeat LED is left out
and the two 0-ohm links are replaced by copper. Pinouts: AD8232 datasheet Table 3 (analog.com), ESP32-S3-MINI-1
datasheet Table 3-1 (espressif), ME6211 datasheet (LCSC copy), MCP73831 SOT-23-5 pinout (components101 summary of
the Microchip datasheet). Run: python design.py  ->  netlist.csv, bom_jlcpcb.csv, ERC report on stdout.
Not done here: footprints placed and routed (KiCad layout), the CPL file, and a review by an engineer.
"""
import csv, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
# ref: (value, footprint, LCSC part or "" when not chosen yet, {pin: net})
P = {}
def part(ref, value, fp, lcsc, pins): P[ref] = (value, fp, lcsc, pins)

# ---- ECG front end: AD8232 (pin numbers = datasheet Table 3) --------------------------------------------------
part('U1', 'AD8232ACPZ-R7', 'LFCSP-20 4x4', 'C43216', {
    1: 'HPDRIVE', 2: 'IN_P', 3: 'IN_N', 4: 'RLDFB', 5: 'RLD', 6: 'SW', 7: 'OPAMP_P', 8: 'REFOUT', 9: 'OPAMP_N',
    10: 'ECG_OUT', 11: 'LO_N', 12: 'LO_P', 13: 'ECG_SDN', 14: 'GND', 15: '3V3', 16: 'GND', 17: '3V3', 18: 'REFIN',
    19: 'IAOUT', 20: 'HPSENSE', 'EP': 'GND'})
# SparkFun: FR -> 3.3V, AC/DC -> GND (via 0 ohm R19), SDN pulled up by R15 10k; same here (pin 14 AC/DC, 15 FR).
part('J1', '3.5 mm jack, electrode cable', 'KH-PJ-321A-SMT', 'C5123133', {'TIP': 'RL', 'RING': 'LA', 'SLEEVE': 'RA'})
fe = [  # ref, value, net a, net b   (SparkFun names: C1..C7, R1..R15)
    ('C1', '1.5nF', 'ECG_OUT', 'N9'), ('C2', '1nF', 'RLDFB', 'RLD'), ('C3', '10nF', 'REFOUT', 'OPAMP_P'),
    ('C4', '0.33uF', 'HPDRIVE', 'HPSENSE'), ('C5', '0.1uF', '3V3', 'GND'), ('C6', '0.33uF', 'SW', 'REFOUT'),
    ('C7', '0.1uF', 'REFIN', 'GND'),
    ('R1', '10M', 'LA', 'BIAS'), ('R2', '10M', 'RA', 'BIAS'), ('R3', '180k', 'LA', 'IN_P'), ('R4', '180k', 'RA', 'IN_N'),
    ('R5', '360k', 'RLD', 'RL'), ('R6', '1M', 'N9', 'IAOUT'), ('R7', '1M', 'N9', 'OPAMP_P'), ('R8', '100k', 'OPAMP_N', 'REFOUT'),
    ('R9', '1M', 'ECG_OUT', 'OPAMP_N'), ('R10', '10M', '3V3', 'REFIN'), ('R11', '10M', 'HPSENSE', 'N14'),
    ('R12', '1.4M', 'N14', 'SW'), ('R13', '10M', 'IAOUT', 'N14'), ('R14', '10M', 'REFIN', 'GND'), ('R15', '10k', 'ECG_SDN', '3V3'),
]
for ref, v, a, b in fe:
    lc = {'0.1uF': 'C1525', '10k': 'C25744'}.get(v, '')
    part(ref, v, '0402' if ref.startswith('R') or v in ('1nF', '1.5nF', '10nF', '0.1uF') else '0603', lc, {1: a, 2: b})
P['_bias_tie'] = None   # SparkFun R17 (0 ohm) BIAS -> 3.3V: copper link
ALIASES = {'BIAS': '3V3'}

# ---- MCU: ESP32-S3-MINI-1-N8 (pin numbers = datasheet Table 3-1) -------------------------------------------------
esp = {3: '3V3', 45: 'EN', 4: 'BOOT', 23: 'USB_DN', 24: 'USB_DP', 6: 'ECG_OUT', 8: 'LO_P', 9: 'LO_N', 10: 'ECG_SDN', 5: 'VBAT_SENSE'}
for g in [1, 2, 42, 43] + list(range(46, 66)): esp[g] = 'GND'
part('U2', 'ESP32-S3-MINI-1-N8', 'ESP32-S3-MINI-1', 'C2913206', esp)
part('R16', '10k', '0402', 'C25744', {1: '3V3', 2: 'EN'}); part('C8', '1uF', '0402', '', {1: 'EN', 2: 'GND'})   # EN RC: datasheet §9
part('C9', '22uF', '0805', '', {1: '3V3', 2: 'GND'}); part('C10', '0.1uF', '0402', 'C1525', {1: '3V3', 2: 'GND'})
part('SW1', 'BOOT button', 'SMD 3x4 mm', '', {1: 'BOOT', 2: 'GND'})

# ---- USB-C (power + programming over native USB) -----------------------------------------------------------------
part('J2', 'USB-C receptacle 16P', 'TYPE-C-31-M-12', 'C165948', {
    'A4B9': 'VBUS', 'B4A9': 'VBUS', 'A1B12': 'GND', 'B1A12': 'GND', 'A5': 'CC1', 'B5': 'CC2',
    'A6': 'USB_DP', 'B6': 'USB_DP', 'A7': 'USB_DN', 'B7': 'USB_DN', 'SHELL': 'GND'})
part('R17', '5.1k', '0402', '', {1: 'CC1', 2: 'GND'}); part('R18', '5.1k', '0402', '', {1: 'CC2', 2: 'GND'})   # sink: Rd 5.1k

# ---- Charger MCP73831 (SOT-23-5: 1 STAT, 2 VSS, 3 VBAT, 4 VDD, 5 PROG) ------------------------------------------------
part('U3', 'MCP73831T-2ACI/OT', 'SOT-23-5', 'C424093', {1: 'CHG_STAT', 2: 'GND', 3: 'VBAT', 4: 'VBUS', 5: 'PROG'})
part('R19', '10k', '0402', 'C25744', {1: 'PROG', 2: 'GND'})          # 10 k -> 100 mA typ (DC table), 150 mAh cell
part('R20', '1k', '0402', '', {1: 'VBUS', 2: 'LED_K'}); part('D1', 'LED charging', '0603', '', {'A': 'LED_K', 'K': 'CHG_STAT'})
part('C11', '4.7uF', '0603', '', {1: 'VBUS', 2: 'GND'}); part('C12', '4.7uF', '0603', '', {1: 'VBAT', 2: 'GND'})
part('J3', 'LiPo 3.7 V 150 mAh', 'JST PH 2P', 'C131337', {1: 'VBAT', 2: 'GND'})

# ---- LDO ME6211C33 (SOT-23-5: 1 VIN, 2 VSS, 3 CE, 4 NC, 5 VOUT) -----------------------------------------------------
part('U4', 'ME6211C33M5G-N', 'SOT-23-5', 'C82942', {1: 'VBAT', 2: 'GND', 3: 'VBAT', 4: None, 5: '3V3'})
part('C13', '1uF', '0402', '', {1: 'VBAT', 2: 'GND'}); part('C14', '1uF', '0402', '', {1: '3V3', 2: 'GND'})

# ---- Battery voltage to ADC ------------------------------------------------------------------------------------------
part('R21', '100k', '0402', '', {1: 'VBAT', 2: 'VBAT_SENSE'}); part('R22', '100k', '0402', '', {1: 'VBAT_SENSE', 2: 'GND'})
part('C15', '0.1uF', '0402', 'C1525', {1: 'VBAT_SENSE', 2: 'GND'})
del P['_bias_tie']

# ---------------------------------------------------------------------------------------------------- netlist + ERC
nets = defaultdict(list)
for ref, (v, fp, lc, pins) in P.items():
    for pin, net in pins.items():
        if net is None: continue
        nets[ALIASES.get(net, net)].append(f'{ref}.{pin}')
errors = []
for n, members in nets.items():
    if len(members) < 2: errors.append(f'net {n} has one connection: {members}')
POWER = {'U1': [15, 17, 14, 16], 'U2': [3, 1], 'U3': [4, 2], 'U4': [1, 2, 5]}
for ref, pins in POWER.items():
    for p in pins:
        if P[ref][3].get(p) is None: errors.append(f'{ref} pin {p} unconnected')
must = {'GND', '3V3', 'VBAT', 'VBUS', 'ECG_OUT', 'USB_DP', 'USB_DN', 'EN', 'LO_P', 'LO_N', 'ECG_SDN', 'VBAT_SENSE', 'RL', 'LA', 'RA'}
for n in must - set(nets): errors.append(f'missing net {n}')
with open(os.path.join(HERE, 'netlist.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['net', 'connections'])
    for n in sorted(nets): w.writerow([n, ' '.join(sorted(nets[n]))])
groups = defaultdict(list)
for ref, (v, fp, lc, pins) in P.items(): groups[(v, fp, lc)].append(ref)
with open(os.path.join(HERE, 'bom_jlcpcb.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['Comment', 'Designator', 'Footprint', 'LCSC Part #'])
    for (v, fp, lc), refs in sorted(groups.items(), key=lambda x: x[1][0]):
        w.writerow([v, ','.join(sorted(refs, key=lambda r: (r.rstrip('0123456789'), int(''.join(c for c in r if c.isdigit()) or 0)))), fp, lc or 'TO CHOOSE'])
print(f'parts: {len(P)}, nets: {len(nets)}, BOM lines: {len(groups)}, LCSC chosen: {sum(1 for k in groups if k[2])}')
print('ERC:', 'OK' if not errors else f'{len(errors)} problems'); [print(' -', e) for e in errors]
sys.exit(1 if errors else 0)
