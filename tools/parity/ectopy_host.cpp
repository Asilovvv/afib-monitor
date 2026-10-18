// Device PVC code (firmware/AFibMonitor/ectopy.h + pvc_model.h) vs the server on the same strips.
//   g++ -O2 -std=c++17 -I firmware/AFibMonitor tools/parity/ectopy_host.cpp -o /tmp/ecto && /tmp/ecto < /tmp/ecto.txt
#include <cstdio>
#include "pvc_model.h"
int main() {
  int n, np, nb, cases = 0, beatsSame = 0, beatsAll = 0; double maxF = 0, maxP = 0;
  while (scanf("%d %d %d", &n, &np, &nb) == 3) {
    ectopy::Vec x(n); ectopy::Idx p(np);
    for (auto& v : x) if (scanf("%lf", &v) != 1) return 2;
    for (auto& v : p) if (scanf("%d", &v) != 1) return 2;
    auto fe = ectopy::beat_features(x, p, 125);
    if ((int)fe.size() != nb) { printf("case %d: %zu beats vs %d\n", cases, fe.size(), nb); return 1; }
    for (int b = 0; b < nb; b++) {
      double f[39], ps;
      for (double& v : f) if (scanf("%lf", &v) != 1) return 2;
      if (scanf("%lf", &ps) != 1) return 2;
      for (int k = 0; k < 39; k++) maxF = std::max(maxF, fabs(f[k] - fe[b].f[k]));
      double pd = ectopy::tree_score(fe[b].f, PVC_NODES, PVC_TREE_START, PVC_N_TREES, PVC_BASELINE);
      maxP = std::max(maxP, fabs(pd - ps));
      beatsSame += ((pd >= PVC_THRESHOLD) == (ps >= PVC_THRESHOLD)); beatsAll++;
    }
    cases++;
  }
  printf("device vs server: %d strips, %d beats, same PVC decision %d/%d, max |feature diff| %.2e, max |p diff| %.2e\n",
         cases, beatsAll, beatsSame, beatsAll, maxF, maxP);
  return beatsSame == beatsAll && maxF == 0 && maxP == 0 ? 0 : 1;   // bit-exact: needs Python 3.12+ sum() on the server side
}
