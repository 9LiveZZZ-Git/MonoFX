// MonoFX ReverbCore — direct port of src/monofx-reverb.js.
#pragma once
#include <algorithm>
#include <vector>
#include "MonoFXMath.h"
#include "ParamDescriptor.h"

namespace monofx {

class ReverbCore {
 public:
  static constexpr const char* NAME = "REVERB";
  static constexpr ParamDescriptor PARAMS[] = {
      {"size",  "SIZE",   0.4,    2.0,     1.0,    false, "",   2},
      {"decay", "DECAY",  0.3,    12.0,    2.2,    true,  "s",  1},
      {"damp",  "DAMP",   1000.0, 16000.0, 6000.0, true,  "Hz", 0},
      {"pre",   "PREDLY", 0.0,    120.0,   20.0,   false, "ms", 0},
      {"width", "WIDTH",  0.0,    1.0,     1.0,    false, "",   2},
      {"mix",   "MIX",    0.0,    1.0,     0.3,    false, "",   2},
  };
  static constexpr int NUM_PARAMS = 6;

  double size = 1.0, decay = 2.2, damp = 6000.0, pre = 20.0, width = 1.0, mix = 0.3;
  bool bypass = false, mono = false;

  explicit ReverbCore(double sampleRate) : sr(sampleRate) {
    alloc();
    refresh();
    bypassMix = 0.0; monoMix = 0.0;
  }

  void setParam(int i, double v) {
    switch (i) {
      case 0: size = v;  break;  case 1: decay = v; break;
      case 2: damp = v;  break;  case 3: pre = v;   break;
      case 4: width = v; break;  case 5: mix = v;   break;
      default: break;
    }
  }
  int latencySamples() const { return 0; }

  // Sized from sr, so a rate change must re-run it. In a plugin this happens in
  // prepareToPlay, never on the audio thread.
  void alloc() {
    const int need = static_cast<int>(std::ceil(0.080 * 2.2 * sr));
    if (bufs.empty() || static_cast<int>(bufs[0].size()) < need) {
      bufs.assign(8, std::vector<double>(need, 0.0));
      for (int i = 0; i < 8; ++i) { lens[i] = 0; ptrs[i] = 0; lp[i] = 0.0; }
    }
    int pl = 1; while (pl < 0.15 * sr) pl <<= 1;
    if (static_cast<int>(preBuf.size()) < pl) {
      preBuf.assign(pl, 0.0); preMask = pl - 1; preW = 0;
    }
  }

  void refresh() {
    if (cSize == size && cDecay == decay && cSr == sr) return;
    if (cSr != sr) alloc();
    cSize = size; cDecay = decay; cSr = sr;
    for (int i = 0; i < 8; ++i) {
      // Clamp to the allocation: without it, size > 2.55 walks the pointer past
      // the end of the line.
      const int L = static_cast<int>(jsmath::min(
          static_cast<double>(bufs[i].size()),
          jsmath::max(64.0, jsmath::round(baseMs[i] * 0.001 * size * sr))));
      // Do NOT zero the line on a length change: SIZE is a normally-automated
      // parameter, and wiping the buffer dropped the whole tail to silence.
      if (L != lens[i]) { lens[i] = L; if (ptrs[i] >= L) ptrs[i] = 0; }
      g[i] = math::pow(10.0, -3.0 * L / (jsmath::max(1e-3, decay) * sr));
    }
  }

  void resetStreams() {
    for (int i = 0; i < 8; ++i) {
      std::fill(bufs[i].begin(), bufs[i].end(), 0.0);
      ptrs[i] = 0; lp[i] = 0.0;
    }
    std::fill(preBuf.begin(), preBuf.end(), 0.0);
    preW = 0; pms = 0; pmm = 0;
    bypassMix = bypass ? 1.0 : 0.0;
    monoMix   = mono   ? 1.0 : 0.0;
  }

  template <typename S>
  void processBlock(const S* inL, const S* inR, S* outL, S* outR, int N) {
    refresh();
    const double stp = 1.0 / (0.010 * sr);
    // A negative damp makes lpc negative and the one-pole diverges.
    const double dampC = jsmath::min(0.49 * sr, jsmath::max(20.0, damp));
    const double mixC  = jsmath::min(1.0, jsmath::max(0.0, mix));
    const double widthC= jsmath::min(1.0, jsmath::max(0.0, width));
    const double lpc = 1.0 - math::exp(-2.0 * PI * dampC / sr);
    const int preD = static_cast<int>(jsmath::min(
        static_cast<double>(preMask),
        jsmath::max(1.0, jsmath::round(jsmath::max(0.0, pre) * 0.001 * sr))));
    const double wS = widthC * mixC * 1.5;
    const double bal = 1.0 - math::exp(-1.0 / (0.050 * sr));

    for (int i = 0; i < N; ++i) {
      const double L = static_cast<double>(inL[i]), R = static_cast<double>(inR[i]);
      const double M = 0.5 * (L + R), Sd = 0.5 * (L - R);
      preBuf[preW] = M;
      const double x = preBuf[(preW - preD) & preMask];
      preW = (preW + 1) & preMask;

      double sum = 0.0;
      for (int j = 0; j < 8; ++j) { l[j] = bufs[j][ptrs[j]]; sum += l[j]; }
      const double h = 0.25 * sum;          // Householder: A = I - (2/8)*J
      double mT = 0.0, sT = 0.0;
      for (int j = 0; j < 8; ++j) {
        const double f = l[(j + 3) & 7] - h;
        lp[j] += lpc * (g[j] * f - lp[j]);
        const double w = math::fabs(lp[j]) < 1e-24 ? 0.0 : lp[j];
        bufs[j][ptrs[j]] = x * 0.35 + w;
        ptrs[j] = (ptrs[j] + 1) % lens[j];
        mT += l[j];
        sT += (j & 1) ? -l[j] : l[j];
      }
      mT *= 0.185; sT *= 0.185;
      const double mOut = M * (1.0 - mixC) + mixC * mT * 1.5;  // width-independent
      const double sW = wS * sT;
      // The all-plus and alternating-sign taps are orthogonal by construction,
      // so the corrector stays small here; it is applied for consistency and to
      // hold the image steady as the line lengths change.
      const double al = pmm > 1e-20 ? jsmath::min(4.0, jsmath::max(-4.0, pms / pmm)) : 0.0;
      const double sOut = Sd * (1.0 - mixC) + sW - al * mOut;
      pms += bal * (mOut * sW - pms);
      pmm += bal * (mOut * mOut - pmm);

      const double bT = bypass ? 1.0 : 0.0, mTn = mono ? 1.0 : 0.0;
      bypassMix += jsmath::max(-stp, jsmath::min(stp, bT - bypassMix));
      monoMix   += jsmath::max(-stp, jsmath::min(stp, mTn - monoMix));
      const double m = mOut * (1.0 - bypassMix) + M * bypassMix;
      const double s = (sOut * (1.0 - bypassMix) + Sd * bypassMix) * (1.0 - monoMix);
      outL[i] = static_cast<S>(m + s);
      outR[i] = static_cast<S>(m - s);
    }
  }

 private:
  static constexpr double PI = 3.141592653589793;
  static constexpr double baseMs[8] = {29.7, 37.1, 41.1, 43.7, 53.3, 59.5, 61.3, 68.9};
  double sr;
  std::vector<std::vector<double>> bufs;
  std::vector<double> preBuf;
  int32_t preMask = 0, preW = 0;
  int lens[8] = {}, ptrs[8] = {};
  double lp[8] = {}, g[8] = {}, l[8] = {};
  double pms = 0, pmm = 0, bypassMix = 0, monoMix = 0;
  double cSize = -1, cDecay = -1, cSr = -1;
};

}  // namespace monofx
