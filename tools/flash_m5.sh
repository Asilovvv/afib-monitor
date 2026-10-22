#!/bin/bash
# One command for the day the M5Stack CoreS3 SE arrives (macOS):
#   curl -fsSL https://raw.githubusercontent.com/Asilovvv/afib-monitor/main/tools/flash_m5.sh | bash
# 1) installs the tools once into ~/afib-flash (Python venv: esptool, pyserial, numpy, scipy, wfdb),
# 2) downloads the newest firmware built by GitHub Actions and checks its SHA-256,
# 3) writes it to the board over USB-C. Nothing else on the computer is changed.
set -euo pipefail
REPO=Asilovvv/afib-monitor
DIR="$HOME/afib-flash"
REL="https://github.com/$REPO/releases/download/firmware-latest"
mkdir -p "$DIR"; cd "$DIR"

if [ ! -x venv/bin/python ]; then
  echo "== installing tools into $DIR (once)"
  python3 -m venv venv
  venv/bin/pip install -q --upgrade pip
  venv/bin/pip install -q esptool pyserial numpy scipy wfdb
fi

echo "== downloading the newest firmware"
curl -fsSL -o afib-m5-cores3se.bin "$REL/afib-m5-cores3se.bin"
curl -fsSL -o SHA256SUMS "$REL/SHA256SUMS"
grep afib-m5-cores3se.bin SHA256SUMS | shasum -a 256 -c -
curl -fsSL -o afib_stream.py "https://raw.githubusercontent.com/$REPO/main/firmware/afib_stream.py"

PORT="${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1 || true)}"
if [ -z "$PORT" ]; then
  echo "Board not found. Connect CoreS3 SE with a USB-C DATA cable. If it still does not show up:"
  echo "hold the reset button (side) for 3 s until the green LED is on (download mode), then run this again."
  exit 1
fi
echo "== flashing $PORT"
venv/bin/python -m esptool --chip esp32s3 --port "$PORT" --baud 921600 write_flash 0x0 afib-m5-cores3se.bin
echo
echo "Done. Press reset once. Next steps (firmware/BENCH_TEST.md):"
echo "  cd $DIR && venv/bin/python afib_stream.py --port $PORT --bench"
echo "  cd $DIR && venv/bin/python afib_stream.py --port $PORT --live 30 --out gel_1.csv   # laptop on battery!"
echo "  cd $DIR && venv/bin/python afib_stream.py --snr gel_1.csv"
