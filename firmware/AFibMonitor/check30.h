// "Check me in 30 seconds" on the device — the same rule as the server (backend/app/ecgtools.py check()) and the
// phone (mobile/src/rr.ts check()). Plain C++ without Arduino headers, so the same file is compiled on a PC and
// compared with the Python code (tools/parity/check30_host.cpp).
//
// verdict: 0 = could not read (repeat), 1 = regular rhythm, 2 = irregular rhythm (show a doctor). Wellness wording only.
#pragma once
#include <math.h>
#include <stdlib.h>
#include <vector>
#include <algorithm>

namespace check30 {

static const int    MIN_BEATS = 16;
static const double MIN_SQI = 0.4, IRR = 0.10, MIN_BSQI = 0.8;
// second detector: smoothing samples, baseline window s, threshold fraction, refractory s
// (chosen on MIT-BIH Arrhythmia in Notebook 9; must match ecgtools.AMP_DEFAULT and rr.ts)
static const int    AMP_W1 = 3;
static const double AMP_W2S = 0.12, AMP_FRAC = 0.5, AMP_REFR_S = 0.30;

typedef std::vector<double> Vec;
typedef std::vector<int> Idx;

inline Vec movmean(const Vec& x, int w) {            // centred, shrinking at the edges (as _highpass)
  int n = (int)x.size(), h = w / 2;
  Vec pre(n + 1, 0.0), out(n);
  for (int i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  for (int i = 0; i < n; i++) {
    int a = std::max(0, i - h), b = std::min(n, i + h + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

inline Vec highpass(const Vec& x, int fs) {
  int w = std::max(3, (int)(0.6 * fs)) | 1;
  Vec m = movmean(x, w), y(x.size());
  for (size_t i = 0; i < x.size(); i++) y[i] = x[i] - m[i];
  return y;
}

inline Idx r_peaks(const Vec& x, int fs) {
  int n = (int)x.size();
  Idx out;
  if (n < fs) return out;
  Vec y = highpass(x, fs);
  int ma = std::max(3, (int)(0.15 * fs));
  Vec env(n), buf(ma, 0.0);
  double s = 0, prev = y[0];
  for (int i = 0; i < n; i++) {
    double e = (y[i] - prev) * (y[i] - prev); prev = y[i];
    s += e - buf[i % ma]; buf[i % ma] = e; env[i] = s / ma;
  }
  double decay = pow(0.5, 1.0 / (2.0 * fs)), thr = 0.35;
  int refr = (int)(0.25 * fs);
  double pk = 0;
  for (int i = 0; i < std::min(n, 2 * fs); i++) pk = std::max(pk, env[i]);
  if (pk == 0) pk = 1e-12;
  long last = -1000000000L; bool armed = true;
  for (int i = (int)(0.2 * fs); i < n; i++) {
    pk = std::max(pk * decay, env[i]);
    if (armed && env[i] > thr * pk && i - last > refr) {
      int a = std::max(0, i - ma - 4), b = std::min(n, i + 3), j = a;
      for (int k = a; k < b; k++) if (fabs(y[k]) > fabs(y[j])) j = k;
      if (out.empty() || j - out.back() > refr) out.push_back(j);
      last = i; armed = false;
    } else if (!armed && env[i] < 0.5 * thr * pk) armed = true;
  }
  return out;
}

inline Idx r_peaks_amp(const Vec& x, int fs) {
  int n = (int)x.size();
  Idx out;
  if (n < fs) return out;
  Vec y = AMP_W1 > 1 ? movmean(x, AMP_W1) : x;
  Vec base = movmean(y, std::max(3, (int)(AMP_W2S * fs)) | 1), a(n);
  for (int i = 0; i < n; i++) a[i] = fabs(y[i] - base[i]);
  double decay = pow(0.5, 1.0 / (2.0 * fs));
  int refr = (int)(AMP_REFR_S * fs), look = (int)(0.1 * fs);
  double pk = 0;
  for (int i = 0; i < std::min(n, 2 * fs); i++) pk = std::max(pk, a[i]);
  if (pk == 0) pk = 1e-12;
  int i = 0;
  while (i < n) {
    pk = std::max(pk * decay, a[i]);
    if (a[i] > AMP_FRAC * pk && (out.empty() || i - out.back() > refr)) {
      int j = i;
      for (int k = i; k < std::min(n, i + look); k++) if (a[k] > a[j]) j = k;
      if (out.empty() || j - out.back() > refr) out.push_back(j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

inline double bsqi(const Idx& p1, const Idx& p2, int fs) {
  if (p1.empty() && p2.empty()) return 0;
  int tol = (int)(0.15 * fs), m = 0;
  std::vector<char> used(p2.size(), 0);
  size_t j = 0;
  for (int p : p1) {
    while (j < p2.size() && p2[j] < p - tol) j++;
    for (size_t k = j; k < p2.size() && p2[k] <= p + tol; k++) if (!used[k]) { used[k] = 1; m++; break; }
  }
  return round(1000.0 * m / ((double)p1.size() + p2.size() - m)) / 1000.0;
}

inline double mean(const Vec& v) { double s = 0; for (double x : v) s += x; return s / v.size(); }
inline double pstdev(const Vec& v) { double m = mean(v), s = 0; for (double x : v) s += (x - m) * (x - m); return sqrt(s / v.size()); }

inline double quality(const Vec& x, int fs, const Idx& peaks) {
  int n = (int)x.size();
  if (n < 2 * fs) return 0;
  Vec y = highpass(x, fs);
  double mn = *std::min_element(y.begin(), y.end()), mx = *std::max_element(y.begin(), y.end());
  int flat = 0;
  for (int i = 0; i + 1 < n; i++) if (fabs(y[i + 1] - y[i]) < 1e-4) flat++;
  double s_flat = (mx - mn < 0.05 || (double)flat / n > 0.5) ? 0 : 1;
  double bpm = peaks.size() / ((double)n / fs) * 60;
  double s_rate = (bpm >= 30 && bpm <= 200) ? 1 : 0;
  int h = (int)(0.1 * fs);
  std::vector<Vec> segs;
  for (int p : peaks) if (p - h >= 0 && p + h <= n) segs.push_back(Vec(y.begin() + p - h, y.begin() + p + h));
  double s_shape = 0;
  if (segs.size() >= 3) {
    Vec tmpl(2 * h), col(segs.size());
    for (int k = 0; k < 2 * h; k++) {
      for (size_t s = 0; s < segs.size(); s++) col[s] = segs[s][k];
      std::sort(col.begin(), col.end());
      size_t m = col.size() / 2;
      tmpl[k] = col.size() % 2 ? col[m] : (col[m - 1] + col[m]) / 2;
    }
    double tm = mean(tmpl), acc = 0;
    for (const Vec& sg : segs) {
      double sm = mean(sg), num = 0, da = 0, db = 0;
      for (int k = 0; k < 2 * h; k++) { num += (sg[k] - sm) * (tmpl[k] - tm); da += (sg[k] - sm) * (sg[k] - sm); db += (tmpl[k] - tm) * (tmpl[k] - tm); }
      double den = sqrt(da * db); acc += num / (den > 0 ? den : 1e-12);
    }
    s_shape = std::max(0.0, acc / segs.size());
  }
  double d2 = 0;
  for (int i = 1; i < n - 1; i++) { double d = y[i + 1] - 2 * y[i] + y[i - 1]; d2 += d * d; }
  double sd = pstdev(y);
  double noise = sqrt(d2 / (n - 2)) / (sd > 0 ? sd : 1e-12);
  double s_noise = std::max(0.0, std::min(1.0, 1.5 - noise));
  double sqi = s_flat * s_rate * (0.6 * s_shape + 0.4 * s_noise);
  return round(std::max(0.0, std::min(1.0, sqi)) * 100) / 100;
}

inline double irregularity(const Idx& p, int fs, bool* ok) {
  Vec r;
  for (size_t i = 1; i < p.size(); i++) { double v = round((p[i] - p[i - 1]) * 1000.0 / fs) / 1000.0; if (v >= 0.25 && v <= 2.0) r.push_back(v); }
  if (r.size() < 4) { *ok = false; return 0; }
  double s = 0;
  for (size_t i = 1; i < r.size(); i++) s += fabs(r[i] - r[i - 1]);
  *ok = true;
  return round(1000.0 * (s / (r.size() - 1)) / mean(r)) / 1000.0;
}

struct Result { int verdict; int beats; double sqi, irregularity, bsqi; int bpm; };

inline Result check(const Vec& x, int fs = 125) {
  Result res{};
  Idx p = r_peaks(x, fs);
  res.beats = (int)p.size();
  res.sqi = quality(x, fs, p);
  bool ok; res.irregularity = irregularity(p, fs, &ok);
  res.bsqi = bsqi(p, r_peaks_amp(x, fs), fs);
  res.bpm = (int)lround(p.size() / ((double)x.size() / fs) * 60);
  if (res.beats < MIN_BEATS || res.sqi < MIN_SQI || !ok || res.bsqi < MIN_BSQI) res.verdict = 0;
  else res.verdict = res.irregularity > IRR ? 2 : 1;
  return res;
}

}  // namespace check30
