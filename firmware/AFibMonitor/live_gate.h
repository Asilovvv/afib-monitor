// Candidate quality measures for the live verdict (round 4, ml/ROUND4_PREREG.md §1), computed at each live decision
// on the last 10 s of the 125-Hz filtered signal. Shared by the firmware and the PC host build
// (tools/parity/live_host.cpp). Plain C++, no Arduino headers.
#pragma once
#include "check30.h"

namespace live_gate {

// The gate that ships (ml/ROUND4_GATE_CHOICE.json, chosen on tuning data only; test: ml/ROUND4_GATE.md):
// a live decision is "noisy" when the 30-s check's two beat detectors agree on less than 71 % of the beats of the
// last 10 s; then no verdict is shown until 8 decisions (32 beats) in a row have passed without a noisy window,
// so that no RR interval measured during the noise stays in the model's input.
static const double MIN_AGREE = 0.71;
static const int HOLD = 8;

inline double two_detectors(const check30::Vec& x) {
  return check30::bsqi(check30::r_peaks(x, 125), check30::r_peaks_amp(x, 125), 125);
}

struct Metrics { double g1, g2, g3; };

// x: the last 10 s at 125 Hz, oldest first; beats: positions of the live detector's beats inside x (samples);
// lag: how many samples the live detector's mark lies after the R peak (a constant, ml/ROUND4_PREREG.md §1).
inline Metrics metrics(const check30::Vec& x, const check30::Idx& beats, int lag) {
  const int fs = 125;
  check30::Idx amp = check30::r_peaks_amp(x, fs), rp = check30::r_peaks(x, fs), lb;
  for (int b : beats) if (b - lag >= 0) lb.push_back(b - lag);
  Metrics m;
  m.g1 = check30::bsqi(lb, amp, fs);     // live detector vs the 30-s check's second detector
  m.g2 = check30::bsqi(rp, amp, fs);     // the 30-s check's two detectors
  m.g3 = check30::quality(x, fs, rp);    // signal quality index
  return m;
}

}  // namespace live_gate
