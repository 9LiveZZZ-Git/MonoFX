// MonoFX ChorusCore — direct port of src/monofx-chorus.js.
#pragma once
#include <algorithm>
#include <vector>
#include "MonoFXMath.h"
#include "ParamDescriptor.h"

namespace monofx {

class ChorusCore {
 public:
  static constexpr const char* NAME = "CHORUS";
  static constexpr ParamDescriptor PARAMS[] = {
      {"rate",   "RATE",   0.05, 3.0, 0.5, true,  "Hz", 2},
      {"depth",  "DEPTH",  0.0,  1.0, 0.5, false, "",   2},
      {"voxmix", "VOICES", 0.0,  1.0, 0.8, false, "",   2},
      {"width",  "WIDTH",  0.0,  1.0, 0.8, false, "",   2},
      {"mix",    "MIX",    0.0,  1.0, 0.5, false, "",   2},
  };
  static constexpr int NUM_PARAMS = 5;

  double rate = 0.5, depth = 0.5, voxmix = 0.8, width = 0.8, mix = 0.5;
  bool bypass = false, mono = false;

  explicit ChorusCore(double sampleRate) : sr(sampleRate) {
    int n = 1; while (n < 0.06 * sr) n <<= 1;
    len = n; mask = n - 1;
    buf.assign(n, 0.0);
    resetStreams();
  }

  void setParam(int i, double v) {
    switch (i) {
      case 0: rate = v;   break;  case 1: depth = v; break;
      case 2: voxmix = v; break;  case 3: width = v; break;
      case 4: mix = v;    break;  default: break;
    }
  }
  int latencySamples() const { return 0; }

  void resetStreams() {
    std::fill(buf.begin(), buf.end(), 0.0);
    wp = 0; pms = 0; pmm = 0;
    ph[0] = 0.0; ph[1] = 2.094; ph[2] = 4.189;
    bypassMix = bypass ? 1.0 : 0.0;
    monoMix   = mono   ? 1.0 : 0.0;
  }

  template <typename S>
  void processBlock(const S* inL, const S* inR, S* outL, S* outR, int N) {
    const double stp = 1.0 / (0.010 * sr);
    const double rateC  = jsmath::min(20.0, jsmath::max(0.0, rate));
    const double depthC = jsmath::min(1.0,  jsmath::max(0.0, depth));
    const double mixC   = jsmath::min(1.0,  jsmath::max(0.0, mix));
    const double widthC = jsmath::min(1.0,  jsmath::max(0.0, width));
    const double vx     = jsmath::min(1.0,  jsmath::max(0.0, voxmix));
    const double modS = (0.0005 + depthC * 0.004) * sr;   // 0.5-4.5 ms sweep
    const double wS = widthC * mixC * 0.5;
    const double bal = 1.0 - math::exp(-1.0 / (0.500 * sr));
    // 500 ms, NOT 50 ms. `al` is a ratio of two smoothed products, so it ripples
    // at twice the signal frequency, and multiplying mOut by a rippling gain is
    // intermodulation. At 50 ms that cost 30-35 dB of THD in the phaser and
    // chorus. 500 ms is strictly better on both axes: ~20 dB less distortion
    // AND slightly better image balance.

    for (int i = 0; i < N; ++i) {
      const double L = static_cast<double>(inL[i]), R = static_cast<double>(inR[i]);
      const double M = 0.5 * (L + R), Sd = 0.5 * (L - R);
      buf[wp] = std::isfinite(M) ? M : 0.0;   // no poison into the delay line
      double v[3];
      for (int j = 0; j < 3; ++j) {
        const double d = jsmath::min(len - 4.0,
            jsmath::max(4.0, base[j] * sr + modS * math::sin(ph[j])));
        ph[j] += 2.0 * PI * rateC * rMul[j] / sr;
        if (ph[j] > 2.0 * PI) ph[j] -= 2.0 * PI;
        v[j] = read(d);
      }
      wp = (wp + 1) & mask;
      const double ens = (v[0] + v[1] * vx + v[2]) / (2.0 + vx);
      const double mOut = M * (1.0 - mixC) + mixC * 0.5 * (M + ens) * 1.4142;
      const double sW = wS * (v[0] - v[2]);          // voice 1 minus voice 3
      // Voices 1 and 3 are also in the mid ensemble and their base delays differ
      // (8 vs 22 ms), so E[m*sW] is non-zero and WIDTH panned the image.
      const double al = pmm > 1e-20 ? jsmath::min(4.0, jsmath::max(-4.0, pms / pmm)) : 0.0;
      const double sOut = Sd * (1.0 - mixC) + sW - al * mOut;
      // Guard the accumulators too: one NaN otherwise latches pms/pmm forever.
      // The output survives (NaN > 1e-20 is false, so al falls back to 0) but the
      // image-balance corrector is then silently dead for the rest of the session.
      const double npms = pms + bal * (mOut * sW - pms);
      const double npmm = pmm + bal * (mOut * mOut - pmm);
      pms = std::isfinite(npms) ? npms : 0.0;
      pmm = std::isfinite(npmm) ? npmm : 0.0;

      const double bT = bypass ? 1.0 : 0.0, mT = mono ? 1.0 : 0.0;
      bypassMix += jsmath::max(-stp, jsmath::min(stp, bT - bypassMix));
      monoMix   += jsmath::max(-stp, jsmath::min(stp, mT - monoMix));
      const double m = mOut * (1.0 - bypassMix) + M * bypassMix;
      const double s = (sOut * (1.0 - bypassMix) + Sd * bypassMix) * (1.0 - monoMix);
      outL[i] = static_cast<S>(m + s);
      outR[i] = static_cast<S>(m - s);
    }
  }

 private:
  static constexpr double PI = 3.141592653589793;

  double read(double d) const {
    const double p = static_cast<double>(wp) - d;
    const double i0d = std::floor(p);
    const double fr = p - i0d;
    const int32_t i0 = jsmath::toInt32(i0d), m = mask;
    const double a = buf[(i0 - 1) & m], c0 = buf[i0 & m],
                 c = buf[(i0 + 1) & m], e = buf[(i0 + 2) & m];
    const double k1 = 0.5 * (c - a), k2 = a - 2.5 * c0 + 2.0 * c - 0.5 * e,
                 k3 = 0.5 * (e - a) + 1.5 * (c0 - c);
    return ((k3 * fr + k2) * fr + k1) * fr + c0;
  }

  double sr;
  int len = 0; int32_t mask = 0, wp = 0;
  std::vector<double> buf;
  double ph[3] = {0.0, 2.094, 4.189};
  static constexpr double rMul[3] = {1.0, 0.87, 1.13};
  static constexpr double base[3] = {0.008, 0.014, 0.022};
  double pms = 0, pmm = 0, bypassMix = 0, monoMix = 0;
};

}  // namespace monofx
