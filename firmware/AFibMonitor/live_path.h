// The live path of the device, shared by the firmware (afib_main.cpp) and the PC host build
// (tools/parity/live_host.cpp), so that what is measured on a PC is what the chip runs:
//   ADC 250 Hz -> band-pass 0.5-40 Hz (2nd-order Butterworth, 2 biquads, transposed direct form II, float)
//   -> keep every 2nd sample (125 Hz) -> envelope R-peak detector (derivative^2 -> 150 ms moving average ->
//   35 % of a peak tracker that halves every 2 s -> 250 ms refractory, 2 s warm-up).
// Exactly the algorithm of detect_r() in the Kaggle notebooks. Plain C++, no Arduino headers.
#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>

namespace live {

static const int FS_RAW = 250;              // ADC rate, Hz
static const int FS = 125;                  // model rate, Hz

// butter(2, [0.5, 40], 'band', fs=250, output='sos'): b0 b1 b2 a1 a2
static const float SOS[2][5] = {
  {0.1424442454f, 0.2848884908f, 0.1424442454f, -0.6856000535f, 0.2606960323f},
  {1.0000000000f, -2.0000000000f, 1.0000000000f, -1.9822347504f, 0.9823948463f},
};

struct BandPass {
  float z1[2] = {0, 0}, z2[2] = {0, 0};
  float step(float x) {
    for (int s = 0; s < 2; s++) {
      const float* c = SOS[s];
      float y = c[0] * x + z1[s];
      z1[s] = c[1] * x - c[3] * y + z2[s];
      z2[s] = c[2] * x - c[4] * y;
      x = y;
    }
    return x;
  }
  void reset() { memset(z1, 0, sizeof z1); memset(z2, 0, sizeof z2); }
};

static const int   MA_N   = 19;             // 150 ms at 125 Hz
static const float R_THR  = 0.35f;
static const int   R_REFR = 31;             // 250 ms
static const int   R_WARM = 250;            // 2 s warm-up

struct RDetector {
  float buf[MA_N]; float sum; float prev; float pk; float decay;
  int32_t i; int32_t last; bool armed;
  RDetector() { reset(); }
  void reset() {
    memset(buf, 0, sizeof buf); sum = 0; prev = 0; pk = 0;
    decay = powf(0.5f, 1.0f / (2.0f * FS));
    i = 0; last = -1000000; armed = true;
  }
  // One 125-Hz sample. Returns true when a beat is detected at this sample (its index is i before the call).
  bool step(float x) {
    bool beat = false;
    float d = x - prev; prev = x;
    float e = d * d;
    int k = i % MA_N;
    sum += e - buf[k]; buf[k] = e;
    float env = sum / MA_N;
    float decayed = pk * decay;
    pk = decayed > env ? decayed : env;
    if (i >= R_WARM) {
      if (armed && env > R_THR * pk && i - last > R_REFR) {
        beat = true; last = i; armed = false;
      } else if (!armed && env < 0.5f * R_THR * pk) {
        armed = true;
      }
    }
    i++;
    return beat;
  }
};

}  // namespace live
