// The device's live path on a PC, compiled from the firmware's own headers (live_path.h, live_gate.h, check30.h):
// raw mV at 250 Hz -> band-pass -> 125 Hz -> R detector -> every 4 beats a decision on the last 32 RR, with the
// int8 model inputs computed exactly as afib_main.cpp runModel() and the gate candidates on the last 10 s.
//
//   g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/live_host.cpp -o live_host
//   live_host <input_scale> <input_zero_point> <lag_samples> [bin] < stream
// text stream: "R <name>" starts a recording (all state reset), then one raw sample (mV) per line, "E" ends it.
// bin stream (faster): repeated records of int32 name length, name bytes, int32 sample count, float32 samples.
// output per decision: "D <name> <raw_index> <sd> <g1> <g2> <g3> <beats_in_10s> <lagmed> <span_raw> q0 ... q63"
//   raw_index = number of raw samples seen when the decision was taken; lagmed = median (live mark - nearest
//   second-detector peak) in samples within the 10 s (999 if none), used once to measure the lag constant;
//   span_raw = the 32 RR in raw samples (what the decision is about).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <algorithm>
#include "live_path.h"
#include "live_gate.h"

static const int N_RR = 32, RR_EVERY = 4, WIN = 1250;

struct State {
  live::BandPass bp; live::RDetector rd;
  bool tog = false; long raw = 0;
  float ring[WIN]; int head = 0, filled = 0;
  float rr[N_RR]; int rrHead = 0, rrCount = 0, since = 0; long lastBeat = -1;
  std::vector<long> beats;                  // 125-Hz indices of live beats (kept for the last 10 s)
  void reset() { *this = State(); bp.reset(); rd.reset(); }
};

static float g_scale; static int g_zp, g_lag;
static State st;
static std::string name = "-";

static void sample(float mv) {
    st.raw++;
    float y = st.bp.step(mv);
    st.tog = !st.tog;
    if (!st.tog) return;                    // keep every 2nd sample, as the firmware
    st.ring[st.head] = y; st.head = (st.head + 1) % WIN; if (st.filled < WIN) st.filled++;
    long i = st.rd.i;
    if (st.rd.step(y)) {
      if (st.lastBeat >= 0) {
        st.rr[st.rrHead] = (i - st.lastBeat) / (float)live::FS;
        st.rrHead = (st.rrHead + 1) % N_RR;
        if (st.rrCount < N_RR) st.rrCount++;
        st.since++;
      }
      st.lastBeat = i; st.beats.push_back(i);
      while (!st.beats.empty() && st.beats.front() < i - WIN) st.beats.erase(st.beats.begin());
    }
    if (!(st.rrCount >= N_RR && st.since >= RR_EVERY)) return;
    st.since = 0;
    // window and RR copy, oldest first (copyWindow)
    check30::Vec x(WIN); double sum = 0, sq = 0;
    for (int k = 0; k < WIN; k++) { float v = st.ring[(st.head + k) % WIN]; x[k] = v; sum += v; sq += (double)v * v; }
    float mean = sum / WIN; float sd = sqrt(std::max(0.0, sq / WIN - (double)mean * mean));
    long now = st.rd.i;                      // 125-Hz index after the last sample
    long w0 = now - st.filled;
    check30::Idx inWin;
    for (long b : st.beats) if (b >= w0) inWin.push_back((int)(b - w0));
    live_gate::Metrics m = live_gate::metrics(x, inWin, g_lag);
    // lag of the live mark against the second detector (for measuring the constant once)
    check30::Idx amp = check30::r_peaks_amp(x, live::FS);
    std::vector<int> d;
    for (int b : inWin) {
      int best = 1 << 30;
      for (int a : amp) if (std::abs(b - a) < std::abs(best)) best = b - a;
      if (std::abs(best) <= 20) d.push_back(best);
    }
    int lagmed = 999;
    if (!d.empty()) { std::sort(d.begin(), d.end()); lagmed = d[d.size() / 2]; }
    // model inputs exactly as runModel()
    float rrc[N_RR], mm = 0, span = 0;
    for (int k = 0; k < N_RR; k++) { float v = st.rr[(st.rrHead + k) % N_RR]; v = v < 0.2f ? 0.2f : (v > 2.0f ? 2.0f : v); rrc[k] = v; mm += v; span += v; }
    mm /= N_RR;
    printf("D %s %ld %.5f %.3f %.3f %.2f %d %d %ld", name.c_str(), st.raw, sd, m.g1, m.g2, m.g3, (int)inWin.size(), lagmed,
           (long)(span * live::FS_RAW));
    for (int k = 0; k < N_RR; k++) {
      float f0 = (rrc[k] - 0.8f) / 0.25f, f1 = (rrc[k] / mm - 1.0f) / 0.15f;
      int q0 = (int)lroundf(f0 / g_scale) + g_zp, q1 = (int)lroundf(f1 / g_scale) + g_zp;
      q0 = q0 < -128 ? -128 : (q0 > 127 ? 127 : q0); q1 = q1 < -128 ? -128 : (q1 > 127 ? 127 : q1);
      printf(" %d %d", q0, q1);
    }
    printf("\n");
}

int main(int argc, char** argv) {
  if (argc < 4) { fprintf(stderr, "usage: live_host scale zero_point lag [bin]\n"); return 2; }
  g_scale = (float)atof(argv[1]); g_zp = atoi(argv[2]); g_lag = atoi(argv[3]);
  st.reset();
  if (argc > 4 && !strcmp(argv[4], "bin")) {
    int32_t len;
    while (fread(&len, 4, 1, stdin) == 1) {
      std::string nm(len, ' ');
      if (fread(&nm[0], 1, len, stdin) != (size_t)len) return 3;
      int32_t n; if (fread(&n, 4, 1, stdin) != 1) return 3;
      std::vector<float> buf(n);
      if (fread(buf.data(), 4, n, stdin) != (size_t)n) return 3;
      st.reset(); name = nm;
      for (float v : buf) sample(v);
    }
    return 0;
  }
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    if (line[0] == 'R') { st.reset(); char nm[200]; if (sscanf(line + 1, "%199s", nm) == 1) name = nm; continue; }
    if (line[0] == 'E') continue;
    sample((float)atof(line));
  }
  return 0;
}
