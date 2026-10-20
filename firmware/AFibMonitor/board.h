// Which hardware the firmware is built for. Default: the M5Stack CoreS3 SE prototype with an AD8232 module.
// Build with -DBOARD_PATCH_V1 for our own patch (hardware/patch_v1: ESP32-S3-MINI-1 + AD8232, no screen).
// Pins of the patch come from hardware/patch_v1/design.py — keep the two in step.
#pragma once
#include <Arduino.h>

#if defined(BOARD_PATCH_V1)
  #define HAS_DISPLAY 0
  #define BOARD_NAME "patch v1"
  static const int PIN_ECG = 2;        // AD8232 OUT  -> IO2 (ADC1)
  static const int PIN_LO_PLUS = 4;    // AD8232 LO+  -> IO4
  static const int PIN_LO_MINUS = 5;   // AD8232 LO-  -> IO5
  static const int PIN_SDN = 6;        // AD8232 SDN  <- IO6 (high = on; 10 k pull-up on the board)
  static const int PIN_VBAT = 1;       // VBAT / 2    -> IO1 (100 k / 100 k divider)
  static const int PIN_BUTTON = 0;     // BOOT button -> IO0, pressed = low: starts the 30-s check
#else
  #define HAS_DISPLAY 1
  #define BOARD_NAME "M5Stack CoreS3 SE"
  #include <M5Unified.h>
  static const int PIN_ECG = 10;       // AD8232 module OUTPUT -> G10 (ADC1)
  static const int PIN_LO_PLUS = -1;   // not wired on the prototype
  static const int PIN_LO_MINUS = -1;
  static const int PIN_SDN = -1;
  static const int PIN_VBAT = -1;
  static const int PIN_BUTTON = -1;    // the prototype starts the check from the touch screen
#endif

inline void boardBegin() {
#if HAS_DISPLAY
  auto cfg = M5.config();
  M5.begin(cfg);
#endif
  if (PIN_SDN >= 0) { pinMode(PIN_SDN, OUTPUT); digitalWrite(PIN_SDN, HIGH); }   // AD8232 on
  if (PIN_VBAT >= 0) analogSetPinAttenuation(PIN_VBAT, ADC_11db);
  if (PIN_BUTTON >= 0) pinMode(PIN_BUTTON, INPUT_PULLUP);
}

// Battery 0-100 %. On the patch: a straight line from 3.3 V (0 %) to 4.2 V (100 %) - approximate, a LiPo is not linear.
inline int boardBattery() {
#if HAS_DISPLAY
  return M5.Power.getBatteryLevel();
#else
  int mv = 2 * analogReadMilliVolts(PIN_VBAT);
  return constrain((mv - 3300) * 100 / (4200 - 3300), 0, 100);
#endif
}

// True once per press of the patch button (debounced, 50 ms).
inline bool boardButtonPressed() {
  if (PIN_BUTTON < 0) return false;
  static bool last = true; static uint32_t t = 0;
  bool now = digitalRead(PIN_BUTTON);
  if (now != last && millis() - t > 50) { t = millis(); last = now; return !now; }
  return false;
}

inline void boardUpdate() {
#if HAS_DISPLAY
  M5.update();
#endif
}
