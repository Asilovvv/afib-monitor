// Host test of firmware/AFibMonitor/clip.h: ECG-like signals pass, saturated / square signals are caught.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include "clip.h"

static const int N = 1000;  // 4 s at 250 Hz
static float x[N];

static int expect(const char* name, bool want) {
  bool got = clip::saturated(x, N);
  std::printf("%-28s frac=%.3f saturated=%d %s\n", name, clip::fraction(x, N), got, got == want ? "ok" : "FAIL");
  return got == want ? 0 : 1;
}

int main() {
  int bad = 0;
  std::srand(1);
  auto noise = [] { return ((std::rand() % 2001) - 1000) / 1000.0f; };
  // ECG-like: baseline + narrow R peak every 0.8 s + small T wave + noise (mV around a 1.6 V mid-rail)
  for (int i = 0; i < N; i++) {
    float t = i / 250.0f, ph = std::fmod(t, 0.8f);
    x[i] = 1600 + 900 * std::exp(-std::pow((ph - 0.2f) / 0.012f, 2)) - 150 * std::exp(-std::pow((ph - 0.23f) / 0.01f, 2))
           + 120 * std::exp(-std::pow((ph - 0.45f) / 0.05f, 2)) + 8 * noise();
  }
  bad += expect("ecg-like", false);
  for (int i = 0; i < N; i++) x[i] = 1600 + 300 * std::sin(2 * M_PI * 0.3 * i / 250.0f) + 8 * noise();
  bad += expect("baseline wander", false);
  for (int i = 0; i < N; i++) x[i] = (std::sin(2 * M_PI * 1.5 * i / 250.0f) > 0 ? 3300 : 0) + 5 * noise();
  bad += expect("square rail-to-rail", true);
  for (int i = 0; i < N; i++) { float v = 1650 + 5000 * std::sin(2 * M_PI * 1.2 * i / 250.0f); x[i] = v < 0 ? 0 : (v > 3300 ? 3300 : v); }
  bad += expect("sine clipped at rails", true);
  for (int i = 0; i < N; i++) x[i] = 3300;
  bad += expect("stuck at rail", true);
  if (bad) { std::printf("%d FAILED\n", bad); return 1; }
  std::printf("clip guard OK\n");
  return 0;
}
