// Early ventricular beats (PVC) — research estimate, same features and model as backend/app/ectopy.py.
// Plain C++ so the same file is compiled on a PC and compared with the Python code (tools/parity/ectopy_host.cpp).
// The model numbers are generated from backend/app/pvc_model.json by tools/pvc_export.py into pvc_model.h.
#pragma once
#include <stdint.h>
#include "check30.h"     // highpass(), Vec, Idx

namespace ectopy {
using check30::Vec;
using check30::Idx;

static const double HALF_S = 0.25;
static const int N_PREV_SHAPES = 20, N_PREV_RR = 10, N_FEAT = 39;

inline double median(Vec v) {                       // copy on purpose: sorts its own buffer
  std::sort(v.begin(), v.end());
  size_t m = v.size() / 2;
  return v.size() % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Python 3.12+ sum() of floats: Neumaier-compensated (CPython Python/bltinmodule.c). Plain "+=" differs in the last bit,
// and a feature lying exactly on a tree threshold then takes the other branch (found by the parity test).
struct PySum {
  double s = 0, c = 0;
  void add(double x) { double t = s + x; c += fabs(s) >= fabs(x) ? (s - t) + x : (x - t) + s; s = t; }
  double get() const { return c != 0 && std::isfinite(c) ? s + c : s; }
};

inline double pearson(const Vec& a, const Vec& b) {
  PySum sa_, sb_;
  for (size_t i = 0; i < a.size(); i++) { sa_.add(a[i]); sb_.add(b[i]); }
  double ma = sa_.get() / a.size(), mb = sb_.get() / b.size();
  Vec da(a.size()), db(b.size());
  for (size_t i = 0; i < a.size(); i++) { da[i] = a[i] - ma; db[i] = b[i] - mb; }
  PySum saa, sbb, sab;
  for (size_t i = 0; i < a.size(); i++) saa.add(da[i] * da[i]);
  for (size_t i = 0; i < b.size(); i++) sbb.add(db[i] * db[i]);
  double sa = sqrt(saa.get()), sb = sqrt(sbb.get());
  if (sa == 0 || sb == 0) return 0;
  for (size_t i = 0; i < a.size(); i++) sab.add(da[i] * db[i]);
  return sab.get() / (sa * sb);
}

struct Beat { int peak; double f[N_FEAT]; };

// Features for every beat with 11 beats before it and one after it (same order as the Python list).
inline std::vector<Beat> beat_features(const Vec& x, const Idx& peaks, int fs = 125) {
  Vec y = check30::highpass(x, fs);
  int half = (int)(HALF_S * fs), n = (int)y.size();
  std::vector<Vec> shapes;
  std::vector<Beat> out;
  for (int i = N_PREV_RR + 1; i + 1 < (int)peaks.size(); i++) {
    int p = peaks[i], a = p - half, b = p + half + 1;
    if (a < 0 || b > n) continue;
    Vec w(y.begin() + a, y.begin() + b);
    double med = median(w);
    Vec prevAmp;
    for (int q = std::max(0, i - N_PREV_SHAPES); q < i; q++) prevAmp.push_back(fabs(y[peaks[q]]));
    double amp = prevAmp.empty() ? 0.0 : median(prevAmp);
    if (!(amp > 1e-6)) amp = 1e-6;
    Vec seg(w.size());
    for (size_t k = 0; k < w.size(); k++) seg[k] = (w[k] - med) / amp;
    Vec tmpl = seg;
    size_t np = std::min(shapes.size(), (size_t)N_PREV_SHAPES);
    if (np >= 5) {
      Vec col(np);
      for (size_t k = 0; k < seg.size(); k++) {
        for (size_t s = 0; s < np; s++) col[s] = shapes[shapes.size() - np + s][k];
        tmpl[k] = median(col);
      }
    }
    Beat bt; bt.peak = p;
    double hm = 0;
    for (int k = half - 12; k < half + 13; k++) hm = std::max(hm, fabs(seg[k]));
    int cnt = 0;
    for (int k = half - 12; k < half + 13; k++) if (fabs(seg[k]) >= 0.5 * hm) cnt++;
    double pre = (double)(peaks[i] - peaks[i - 1]) / fs, post = (double)(peaks[i + 1] - peaks[i]) / fs;
    PySum ls;
    for (int k = i - N_PREV_RR; k < i; k++) ls.add((double)(peaks[k] - peaks[k - 1]) / fs);
    double loc = ls.get() / N_PREV_RR;
    bt.f[0] = pre; bt.f[1] = post; bt.f[2] = loc; bt.f[3] = pre / loc; bt.f[4] = post / pre;
    bt.f[5] = pearson(seg, tmpl); bt.f[6] = hm > 0 ? (double)cnt / fs : 0.0;
    for (int k = 0; k < 32; k++) bt.f[7 + k] = seg[2 * k];
    out.push_back(bt);
    shapes.push_back(seg);
  }
  return out;
}

// Tree ensemble: nodes of all trees in one table; tree t starts at TREE_START[t].
struct Node { int16_t feature; double threshold; int16_t left, right; double value; uint8_t leaf; };   // double: same comparisons as Python

inline double tree_score(const double* f, const Node* nodes, const int* starts, int nTrees, double baseline) {
  double z = baseline;
  for (int t = 0; t < nTrees; t++) {
    const Node* nd = nodes + starts[t];
    int k = 0;
    while (!nd[k].leaf) k = f[nd[k].feature] <= nd[k].threshold ? nd[k].left : nd[k].right;
    z += nd[k].value;
  }
  return 1.0 / (1.0 + exp(-z));
}

}  // namespace ectopy
