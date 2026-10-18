// Compares the device code (firmware/AFibMonitor/check30.h) with the server on the strips from make_cases.py.
//   g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/check30_host.cpp -o /tmp/c30 && /tmp/c30 < /tmp/cases.txt
// Input: per case one line "<python verdict> <n> <samples...>"
#include <cstdio>
#include "check30.h"
int main() {
  int pyv, n, same = 0, total = 0;
  while (scanf("%d %d", &pyv, &n) == 2) {
    check30::Vec x(n);
    for (int i = 0; i < n; i++) scanf("%lf", &x[i]);
    check30::Result r = check30::check(x, 125);
    same += (r.verdict == pyv); total++;
    if (r.verdict != pyv) printf("case %d differs: device %d server %d (beats %d sqi %.2f irr %.3f bsqi %.3f)\n", total - 1, r.verdict, pyv, r.beats, r.sqi, r.irregularity, r.bsqi);
  }
  printf("device vs server verdict same %d/%d\n", same, total);
  return same == total ? 0 : 1;
}
