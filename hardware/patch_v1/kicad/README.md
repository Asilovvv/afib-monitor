# KiCad: from netlist to board

`patch_v1.net` is written by `../design.py`. It holds every part with its KiCad footprint and its LCSC number, and every net.
The ESP32-S3-MINI-1 footprint comes from Espressif's KiCad library, copied into `Espressif.pretty`
(CC-BY-SA 4.0 with the KiCad library exception). Everything else comes from the standard KiCad libraries.

**Checked before export.** For 44 of the 46 parts, every pin in the netlist exists as a pad in its footprint.
`design.py` stops with an error otherwise, and CI runs this check.

## Steps (KiCad 8 or 9)
1. Create a new project in this folder. Open the PCB Editor and use File → Import → Netlist, then choose `patch_v1.net`.
   The local library `Espressif` is registered in `fp-lib-table`.
2. Two parts have no KiCad footprint. Add them from the LCSC/EasyEDA library (for example with the `easyeda2kicad` tool), then import again:
   * **J1**, 3.5 mm jack KH-PJ-321A-SMT (C5123133). Its pads must be named TIP, RING, SLEEVE.
   * **SW1**, button HX 3x4x2-2P (C49234124). Pads 1 and 2.
3. Check before routing:
   * **U1 AD8232 exposed pad.** The footprint is LFCSP 4×4 with a 2.5 mm pad. Compare it with the package drawing (CP-20-6) in the AD8232 datasheet.
   * **ECG input:** keep traces short, guard the high-impedance nets (IN_P, IN_N, HPSENSE, REFIN), and keep them away from the ESP32 antenna.
   * **ESP32-S3-MINI-1 antenna:** no copper or parts under the antenna area (module edge over the board edge).
4. For JLCPCB, export Fabrication → Gerbers and the Component Placement (CPL) file. Use `../bom_jlcpcb.csv` as the BOM.

Routing and the safety review (IEC 60601-1, no measurement while USB is plugged in) need an electronics engineer.
