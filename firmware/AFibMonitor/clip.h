// Saturation guard for the live screen (not part of the 30-second check, which is shared with the server).
// On 28.10.2026 an unsoldered AD8232 header gave a rail-to-rail square wave and the screen still showed
// a rhythm verdict (docs/BOARD_DAY.md). An ECG spends little time near its extremes (R peak, S wave);
// a saturated or square signal spends most of it there. Threshold chosen on MIT-BIH AFDB before use:
// 4-s raw windows of the 5 eval records have this fraction > 0.5 in under 0.1 % of windows
// (median 0.006-0.054); a square wave gives 1.0, a sine clipped at both rails 0.81.
#pragma once
namespace clip {
static const float BAND = 0.05f;   // "near an extreme" = within 5 % of the window range
static const float MAX_FRAC = 0.5f;

inline float fraction(const float* x, int n) {
  if (n <= 0) return 0;
  float lo = x[0], hi = x[0];
  for (int i = 1; i < n; i++) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
  float r = hi - lo;
  if (r <= 0) return 1.0f;
  float a = lo + BAND * r, b = hi - BAND * r;
  int k = 0;
  for (int i = 0; i < n; i++) if (x[i] <= a || x[i] >= b) k++;
  return (float)k / n;
}
inline bool saturated(const float* x, int n) { return fraction(x, n) > MAX_FRAC; }
}  // namespace clip
