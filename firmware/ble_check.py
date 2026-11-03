#!/usr/bin/env python3
"""
ble_check.py — checks the board's Bluetooth from the laptop, without the phone (docs/CONNECT.md, step 5).

If the phone does not find the board, this tells which side is wrong: the board (it does not advertise, or
advertises without the AFib service) or the phone (the board is fine, the app or the phone's Bluetooth is not).

Install once (flash_m5.sh does it):  pip install bleak
    python ble_check.py                 # 10 s scan: is AFib-Monitor there, with the AFib service, how strong
    python ble_check.py --connect 20    # also connect, read the status, count ECG packets for 20 s
    python ble_check.py --self-test     # packet parsing and the scan verdict on fixed data (CI, no Bluetooth)

On macOS the first run asks for Bluetooth access for the Terminal (System Settings → Privacy & Security →
Bluetooth). Only one link at a time: close the app on the phone first, or the board will not advertise.
"""
from __future__ import annotations

import argparse
import asyncio
import struct
import sys
import time

# The same protocol as firmware/AFibMonitor/afib_main.cpp (BLE section) and mobile/src/protocol.ts.
NAME = 'AFib-Monitor'
SERVICE = '8f1e0001-4b6a-4c5e-9a0b-3a1f2e7d0001'
STATUS = '8f1e0002-4b6a-4c5e-9a0b-3a1f2e7d0001'
ECG = '8f1e0003-4b6a-4c5e-9a0b-3a1f2e7d0001'
STATES = {0: 'collecting', 1: 'regular', 2: 'possible AF (research)', 3: 'no signal / check electrodes'}
ECG_PER_SECOND = 125 / 20            # 125 Hz, 20 samples a packet = 6.25 packets/s (docs/BOARD_DAY.md B3)


def parse_status(b: bytes) -> dict | None:
    """13 bytes: u8 version | u8 state | u16 prob*1000 | u16 bpm*10 | u32 t_ms | u16 infer_us | u8 battery %."""
    if len(b) < 13 or b[0] != 1:
        return None
    _, state, prob, bpm, t_ms, infer_us, battery = struct.unpack('<BBHHIHB', b[:13])
    # infer_us is a u16: the firmware sends 65535 for 65.5 ms or more (the model takes about 73 ms, BOARD_DAY A5)
    return {'state': STATES.get(state, f'unknown {state}'), 'prob': prob / 1000, 'bpm': bpm / 10, 'uptime_s': t_ms / 1000,
            'infer_ms': '>= 65.5' if infer_us == 65535 else infer_us / 1000, 'battery': None if battery == 255 else battery}


def parse_ecg(b: bytes) -> tuple[int, list[float]] | None:
    """46 bytes: u16 seq | f32 scale | 20 x i16 (mV = value * scale)."""
    if len(b) != 46:
        return None
    seq, scale = struct.unpack('<Hf', b[:6])
    return seq, [v * scale for v in struct.unpack('<20h', b[6:])]


def verdict(seen: list[dict]) -> tuple[str, dict | None]:
    """seen: [{'name', 'uuids', 'rssi', 'address'}]. Same cases as the app (mobile/src/blediag.ts)."""
    ours = [d for d in seen if SERVICE in [u.lower() for u in d.get('uuids') or []]]
    if ours:
        best = max(ours, key=lambda d: d.get('rssi') or -999)
        return 'found', best
    named = [d for d in seen if (d.get('name') or '').lower().startswith('afib')]
    if named:
        return 'old_firmware', named[0]
    return ('others_only' if seen else 'nothing_nearby'), None


ADVICE = {
    'found': 'The board advertises correctly. If the phone still does not find it: the phone side '
             '(Bluetooth permission, app version, the 7-day iPhone signature).',
    'old_firmware': 'A board named AFib… is there, but without the AFib service: flash the current firmware (step 1).',
    'others_only': 'Other Bluetooth devices are seen, the board is not: is its screen on (the power bank may have switched '
                   'itself off)? Does the top line say BT PHONE (linked to another phone or laptop: disconnect there or '
                   'press reset once)? Old firmware without BT on the screen: flash (step 1).',
    'nothing_nearby': 'No Bluetooth device at all: the laptop\'s Bluetooth is off or Terminal has no Bluetooth access.',
}


async def scan(seconds: float) -> list[dict]:
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    return [{'address': dev.address, 'name': adv.local_name or dev.name, 'uuids': adv.service_uuids, 'rssi': adv.rssi}
            for dev, adv in found.values()]


async def connect(address: str, seconds: float) -> int:
    from bleak import BleakClient
    packets, lost, last = 0, 0, None

    def on_ecg(_, data: bytearray):
        nonlocal packets, lost, last
        p = parse_ecg(bytes(data))
        if p is None:
            return
        seq = p[0]
        if last is not None:
            lost += (seq - last - 1) % 65536
        last, packets = seq, packets + 1

    async with BleakClient(address, timeout=15) as client:
        status = parse_status(bytes(await client.read_gatt_char(STATUS)))
        print('status:', status if status else 'unreadable (old firmware?)')
        await client.start_notify(ECG, on_ecg)
        t0 = time.monotonic()
        await asyncio.sleep(seconds)
        await client.stop_notify(ECG)
        took = time.monotonic() - t0
    rate = packets / took if took else 0
    print(f'ECG: {packets} packets in {took:.0f} s = {rate:.2f}/s (expected {ECG_PER_SECOND:.2f} ± 0.5), lost {lost}')
    return 0 if packets and abs(rate - ECG_PER_SECOND) <= 0.5 and lost == 0 else 1


def self_test() -> int:
    status = struct.pack('<BBHHIHB', 1, 1, 30, 723, 61_000, 65_535, 255)
    assert parse_status(status) == {'state': 'regular', 'prob': 0.03, 'bpm': 72.3, 'uptime_s': 61.0, 'infer_ms': '>= 65.5',
                                    'battery': None}
    assert parse_status(struct.pack('<BBHHIHB', 1, 0, 0, 0, 5, 6_020, 80))['infer_ms'] == 6.02
    assert parse_status(b'\x02' + status[1:]) is None and parse_status(status[:12]) is None
    seq, mv = parse_ecg(struct.pack('<Hf20h', 7, 0.01, *range(-10, 10)))
    assert seq == 7 and len(mv) == 20 and abs(mv[0] + 0.1) < 1e-6
    board = {'address': 'A', 'name': NAME, 'uuids': [SERVICE.upper()], 'rssi': -60}
    watch = {'address': 'W', 'name': 'Mi Band 8', 'uuids': [], 'rssi': -50}
    assert verdict([watch, board]) == ('found', board)
    assert verdict([watch, {'address': 'O', 'name': 'AFib Monitor', 'uuids': None, 'rssi': -70}])[0] == 'old_firmware'
    assert verdict([watch])[0] == 'others_only' and verdict([])[0] == 'nothing_nearby'
    print('ble_check self-test OK')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scan', type=float, default=10, help='seconds to scan (default 10)')
    ap.add_argument('--connect', type=float, help='connect and count ECG packets for this many seconds')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    try:
        import bleak  # noqa: F401
    except ImportError:
        print('Needs bleak: pip install bleak (or run tools/flash_m5.sh again)')
        return 2
    print(f'Scanning {args.scan:.0f} s for {NAME}…')
    seen = asyncio.run(scan(args.scan))
    what, dev = verdict(seen)
    print(f'{len(seen)} Bluetooth devices nearby.')
    if dev:
        print(f'{dev["name"]} at {dev["address"]}, RSSI {dev["rssi"]} dBm, AFib service: {"yes" if what == "found" else "no"}')
    print(ADVICE[what])
    if what != 'found':
        return 1
    if args.connect:
        return asyncio.run(connect(dev['address'], args.connect))
    return 0


if __name__ == '__main__':
    sys.exit(main())
