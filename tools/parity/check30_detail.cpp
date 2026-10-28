// The device's 30-s check (check30.h) on many strips, with its internals, for analyses (ml/round4_rest.py).
//   g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/check30_detail.cpp -o check30_detail
// stdin (binary, repeated): int32 name length, name bytes, int32 n, n float32 samples (125 Hz, filtered).
// stdout per strip: "C <name> <verdict> <beats> <sqi> <irr> <bsqi> <bpm> <ok> <k> r1 ... rk"
//   r = the RR intervals (s, rounded to ms, within 0.25-2.0 s) that the irregularity measure uses.
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include "check30.h"

int main() {
  int32_t len;
  while (fread(&len, 4, 1, stdin) == 1) {
    std::string nm(len, ' ');
    if (fread(&nm[0], 1, len, stdin) != (size_t)len) return 3;
    int32_t n; if (fread(&n, 4, 1, stdin) != 1) return 3;
    std::vector<float> buf(n);
    if (fread(buf.data(), 4, n, stdin) != (size_t)n) return 3;
    check30::Vec x(buf.begin(), buf.end());
    check30::Result r = check30::check(x, 125);
    check30::Idx p = check30::r_peaks(x, 125);
    std::vector<double> rr;
    for (size_t i = 1; i < p.size(); i++) { double v = round((p[i] - p[i - 1]) * 1000.0 / 125) / 1000.0; if (v >= 0.25 && v <= 2.0) rr.push_back(v); }
    bool ok = rr.size() >= 4;
    printf("C %s %d %d %.2f %.3f %.3f %d %d %d", nm.c_str(), r.verdict, r.beats, r.sqi, r.irregularity, r.bsqi, r.bpm, ok ? 1 : 0, (int)rr.size());
    for (double v : rr) printf(" %.3f", v);
    printf("\n");
  }
  return 0;
}
