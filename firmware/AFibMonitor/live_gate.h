// Candidate quality measures for the live verdict (round 4, ml/ROUND4_PREREG.md §1), computed at each live decision
// on the last 10 s of the 125-Hz filtered signal. Shared by the firmware and the PC host build
// (tools/parity/live_host.cpp). Plain C++, no Arduino headers.
#pragma once
#include "check30.h"

namespace live_gate {

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
