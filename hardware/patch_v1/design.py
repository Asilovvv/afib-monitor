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
# LCSC numbers and unit prices (USD, 100+ tier or nearest), each checked on lcsc.com on 20 Oct 2026
LCSC = {'0.1uF': 'C1525', '10k': 'C25744', '1k': 'C11702', '100k': 'C25741', '5.1k': 'C25905', '1M': 'C26083',
        '10nF': 'C15195', '1uF': 'C52923', '1nF': 'C1523', '1.5nF': 'C23967', '4.7uF': 'C19666', '22uF': 'C45783',
        '0.33uF': 'C159798', '180k': 'C25760', '360k': 'C45956', '1.4M': 'C270644', '10M': 'C26086',
        'LED charging': 'C2286', 'BOOT button': 'C49234124'}
PRICE = {'C1525': 0.004, 'C25744': 0.0016, 'C11702': 0.0013, 'C25741': 0.0015, 'C25905': 0.0023, 'C26083': 0.0024,
         'C15195': 0.0041, 'C52923': 0.0068, 'C1523': 0.0039, 'C23967': 0.0092, 'C19666': 0.0163, 'C45783': 0.1959,
         'C159798': 0.0208, 'C25760': 0.0017, 'C45956': 0.0019, 'C270644': 0.0008, 'C26086': 0.0028, 'C2286': 0.0077,
         'C49234124': 0.0254,
         'C43216': 5.6441, 'C2913206': 3.3787, 'C424093': 0.4483, 'C82942': 0.0503, 'C165948': 0.1368, 'C5123133': 0.0819,
         'C131337': 0.0358}
def part(ref, value, fp, lcsc, pins): P[ref] = (value, fp, lcsc or LCSC.get(value, ''), pins)

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
    lc = LCSC.get(v, '')
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
part('J2', 'USB-C receptacle 16P', 'TYPE-C-31-M-12', 'C165948', {     # pad names = KiCad footprint HRO TYPE-C-31-M-12
    'A4': 'VBUS', 'A9': 'VBUS', 'B4': 'VBUS', 'B9': 'VBUS', 'A1': 'GND', 'A12': 'GND', 'B1': 'GND', 'B12': 'GND',
    'A5': 'CC1', 'B5': 'CC2', 'A6': 'USB_DP', 'B6': 'USB_DP', 'A7': 'USB_DN', 'B7': 'USB_DN', 'S1': 'GND', 'A8': None, 'B8': None})
part('R17', '5.1k', '0402', '', {1: 'CC1', 2: 'GND'}); part('R18', '5.1k', '0402', '', {1: 'CC2', 2: 'GND'})   # sink: Rd 5.1k

# ---- Charger MCP73831 (SOT-23-5: 1 STAT, 2 VSS, 3 VBAT, 4 VDD, 5 PROG) ------------------------------------------------
part('U3', 'MCP73831T-2ACI/OT', 'SOT-23-5', 'C424093', {1: 'CHG_STAT', 2: 'GND', 3: 'VBAT', 4: 'VBUS', 5: 'PROG'})
part('R19', '10k', '0402', 'C25744', {1: 'PROG', 2: 'GND'})          # 10 k -> 100 mA typ (DC table), 150 mAh cell
part('R20', '1k', '0402', '', {1: 'VBUS', 2: 'LED_K'}); part('D1', 'LED charging', '0603', '', {'A': 'LED_K', 'K': 'CHG_STAT'})
part('C11', '4.7uF', '0603', '', {1: 'VBUS', 2: 'GND'}); part('C12', '4.7uF', '0603', '', {1: 'VBAT', 2: 'GND'})
part('J3', 'Battery connector JST PH 2P', 'JST PH 2P', 'C131337', {1: 'VBAT', 2: 'GND'})

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
    w = csv.writer(f); w.writerow(['Comment', 'Designator', 'Footprint', 'LCSC Part #', 'Qty', 'Unit USD', 'Line USD'])
    total = small = 0.0
    for (v, fp, lc), refs in sorted(groups.items(), key=lambda x: x[1][0]):
        pr = PRICE.get(lc)
        line = pr * len(refs) if pr is not None else None
        if line is not None:
            total += line
            if lc not in ('C43216', 'C2913206'): small += line
        w.writerow([v, ','.join(sorted(refs, key=lambda r: (r.rstrip('0123456789'), int(''.join(c for c in r if c.isdigit()) or 0)))), fp,
                    lc or 'TO CHOOSE', len(refs), pr if pr is not None else '', round(line, 4) if line is not None else ''])
# ---------------------------------------------------------------------------- KiCad netlist (Pcbnew: Import Netlist)
KICAD_FP = {'0402': ('R_0402_1005Metric', 'C_0402_1005Metric'), '0603': ('R_0603_1608Metric', 'C_0603_1608Metric'),
            '0805': ('R_0805_2012Metric', 'C_0805_2012Metric')}
def kicad_fp(ref, fp):
    if ref.startswith(('R', 'C')) and fp in KICAD_FP:
        return ('Resistor_SMD:' if ref[0] == 'R' else 'Capacitor_SMD:') + KICAD_FP[fp][ref[0] == 'C']
    return {'U1': 'Package_CSP:LFCSP-20-1EP_4x4mm_P0.5mm_EP2.5x2.5mm', 'U2': 'Espressif:ESP32-S3-MINI-1',
            'U3': 'Package_TO_SOT_SMD:SOT-23-5', 'U4': 'Package_TO_SOT_SMD:SOT-23-5', 'D1': 'LED_SMD:LED_0603_1608Metric',
            'J2': 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', 'J3': 'Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical',
            'J1': '', 'SW1': ''}.get(ref, '')                      # J1, SW1: no KiCad footprint - import from LCSC/EasyEDA
PAD = {('U1', 'EP'): '21', ('D1', 'K'): '1', ('D1', 'A'): '2'}
pad = lambda ref, pin: PAD.get((ref, pin), str(pin))
def q(x): return '"' + str(x).replace('"', "'") + '"'
kn = ['(export (version "E")', '  (design (source "hardware/patch_v1/design.py") (tool "design.py"))', '  (components']
for ref, (v, fp, lc, pins) in sorted(P.items()):
    kn.append(f'    (comp (ref {q(ref)}) (value {q(v)}) (footprint {q(kicad_fp(ref, fp))}) (fields (field (name "LCSC") {q(lc)})))')
kn.append('  )'); kn.append('  (nets')
for i, n in enumerate(sorted(nets), 1):
    nodes = ' '.join(f'(node (ref {q(m.split(".")[0])}) (pin {q(pad(*m.split(".", 1)))}))' for m in sorted(nets[n]))
    kn.append(f'    (net (code "{i}") (name {q(n)}) {nodes})')
kn.append('  )'); kn.append(')')
os.makedirs(os.path.join(HERE, 'kicad'), exist_ok=True)
open(os.path.join(HERE, 'kicad', 'patch_v1.net'), 'w').write('\n'.join(kn) + '\n')
# every netlist pin must exist as a pad in its footprint (libraries checked out next to the repo, if present)
LIBS = {'Espressif': os.path.join(HERE, 'kicad', 'Espressif.pretty')}
KICAD_FP_DIR = os.environ.get('KICAD_FOOTPRINTS')        # a checkout of kicad-footprints, optional
import re as _re
checked = 0
for ref, (v, fp, lc, pins) in P.items():
    f = kicad_fp(ref, fp)
    if not f: continue
    lib, name = f.split(':')
    d = LIBS.get(lib) or (os.path.join(KICAD_FP_DIR, lib + '.pretty') if KICAD_FP_DIR else None)
    path = os.path.join(d, name + '.kicad_mod') if d else None
    if not path or not os.path.exists(path): continue
    pads = set(_re.findall(r'\(pad "?([A-Za-z0-9]+)"? ', open(path).read()))
    for pin, net in pins.items():
        if net is not None and pad(ref, pin) not in pads: errors.append(f'{ref}: pin {pin} -> pad {pad(ref, pin)} not in {f}')
    checked += 1
print(f'KiCad netlist written; footprints checked against libraries: {checked}')
print(f'BOM parts on the board: ${total:.4f}; without ESP32 and AD8232: ${small:.4f}')
missing = [k for k in groups if not k[2]]
if missing: errors.append(f'{len(missing)} BOM lines without an LCSC number: {missing}')
# firmware/AFibMonitor/board.h must use the same ESP32 pins
import re
bh = open(os.path.join(HERE, '..', '..', 'firmware', 'AFibMonitor', 'board.h')).read().split('#else')[0]
fw = {k: int(v) for k, v in re.findall(r'static const int (PIN_\w+) = (\d+);', bh)}
IO = {'PIN_ECG': 'ECG_OUT', 'PIN_LO_PLUS': 'LO_P', 'PIN_LO_MINUS': 'LO_N', 'PIN_SDN': 'ECG_SDN', 'PIN_VBAT': 'VBAT_SENSE', 'PIN_BUTTON': 'BOOT'}
GPIO_OF_PIN = {4: 0, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6}          # module pin -> IO number (datasheet Table 3-1)
for name, net in IO.items():
    mod_pins = [p for p, n in P['U2'][3].items() if n == net]
    io = GPIO_OF_PIN.get(mod_pins[0]) if mod_pins else None
    if fw.get(name) != io: errors.append(f'firmware {name}={fw.get(name)} but schematic puts {net} on IO{io}')
print(f'parts: {len(P)}, nets: {len(nets)}, BOM lines: {len(groups)}, LCSC chosen: {sum(1 for k in groups if k[2])}')
print('ERC:', 'OK' if not errors else f'{len(errors)} problems'); [print(' -', e) for e in errors]
sys.exit(1 if errors else 0)
