// MonoFX DelayCore — direct port of src/monofx-delay.js.
#pragma once
#include <vector>
#include "MonoFXMath.h"
#include "ParamDescriptor.h"

namespace monofx {

class DelayCore {
 public:
  static constexpr const char* NAME = "DELAY";
  static constexpr ParamDescriptor PARAMS[] = {
      {"time",  "TIME",   30.0,  1500.0,  380.0, true,  "ms", 0},
      {"fb",    "FEEDBK", 0.0,   0.95,    0.45,  false, "",   2},
      {"tone",  "TONE",   500.0, 12000.0, 4500.0,true,  "Hz", 0},
      {"width", "WIDTH",  0.0,   1.0,     0.8,   false, "",   2},
      {"mix",   "MIX",    0.0,   1.0,     0.35,  false, "",   2},
  };
  static constexpr int NUM_PARAMS = 5;

  double time = 380.0, fb = 0.45, tone = 4500.0, width = 0.8, mix = 0.35;
  bool bypass = false, mono = false;

  explicit DelayCore(double sampleRate) : sr(sampleRate) {
    int n = 1; while (n < 2.2 * sr) n <<= 1;
    len = n; mask = n - 1;
    mBuf.assign(n, 0.0); sBuf.assign(n, 0.0);
    resetStreams();
  }

  void setParam(int i, double v) {
    switch (i) {
      case 0: time = v;  break;  case 1: fb = v;    break;
      case 2: tone = v;  break;  case 3: width = v; break;
      case 4: mix = v;   break;  default: break;
    }
  }
  int latencySamples() const { return 0; }

  void resetStreams() {
    std::fill(mBuf.begin(), mBuf.end(), 0.0);
    std::fill(sBuf.begin(), sBuf.end(), 0.0);
    wp = 0; dCur = time * 0.001 * sr; lpM = 0; lpS = 0; pms = 0; pmm = 0;
    bypassMix = bypass ? 1.0 : 0.0;
    monoMix   = mono   ? 1.0 : 0.0;
  }

  template <typename S>
  void processBlock(const S* inL, const S* inR, S* outL, S* outR, int N) {
    const double stp = 1.0 / (0.010 * sr);
    // Clamp to the ring as well as to the interpolator's 4-sample minimum:
    // read() masks its index, so an out-of-range time aliases to (d mod len).
    const double dT = jsmath::min(len - 4.0, jsmath::max(4.0, time * 0.001 * sr));
    const double gl = 1.0 - math::exp(-1.0 / (0.05 * sr));
    // tone above Nyquist makes lpc exceed 1 and the one-pole diverges; fb above
    // 0.95 makes the recirculation grow without bound.
    const double toneC = jsmath::min(0.49 * sr, jsmath::max(20.0, tone));
    const double fbC   = jsmath::min(0.95, jsmath::max(0.0, fb));
    const double mixC  = jsmath::min(1.0, jsmath::max(0.0, mix));
    const double widthC= jsmath::min(1.0, jsmath::max(0.0, width));
    const double lpc = 1.0 - math::exp(-2.0 * PI * toneC / sr);
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
      dCur += (dT - dCur) * gl;                     // analog-style glide
      const double mWet = read(mBuf, dCur);
      const double sWet = read(sBuf, dCur);
      // These one-poles sit inside the recirculation, so a NaN here would latch
      // the echo train forever.
      lpM = jsmath::flush(lpM + lpc * (mWet - lpM));
      lpS = jsmath::flush(lpS + lpc * (sWet - lpS));
      // Sanitise into the rings: lpM/lpS are guarded, but a non-finite M would
      // still enter the echo train and recirculate.
      const double wM = M + fbC * lpM, wS2 = M - fbC * lpS;
      mBuf[wp] = std::isfinite(wM) ? wM : 0.0;      // echo train (M)
      sBuf[wp] = std::isfinite(wS2) ? wS2 : 0.0;    // alternating sign: ping-pong ILD
      wp = (wp + 1) & mask;
      const double mOut = M * (1.0 - mixC) + mixC * mWet;   // width-independent
      const double sW = wS * sWet;
      // Image-balance corrector. The side ring is fed from the same M as the
      // echo train, so E[m*sW] = 1/(1+fb^2) > 0 and the loudest (first) repeat
      // always landed on the same side. This removes the net bias but not the
      // alternation: the repeats still bounce.
      const double al = pmm > 1e-20 ? jsmath::min(4.0, jsmath::max(-4.0, pms / pmm)) : 0.0;
      const double sOut = Sd * (1.0 - mixC) + sW - al * mOut;
      pms += bal * (mOut * sW - pms);
      pmm += bal * (mOut * mOut - pmm);

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

  // Catmull-Rom, matching the JS reader exactly including its index wrapping:
  // JS `x & mask` is ToInt32 followed by a two's-complement AND, which is what
  // an int32_t AND does here, so negative read positions wrap identically.
  double read(const std::vector<double>& buf, double d) const {
    const double p = static_cast<double>(wp) - d;
    const double i0d = std::floor(p);
    const double fr = p - i0d;
    const int32_t i0 = jsmath::toInt32(i0d), m = mask;
    const double a = buf[(i0 - 1) & m], b = buf[i0 & m],
                 c = buf[(i0 + 1) & m], e = buf[(i0 + 2) & m];
    const double c0 = b, c1 = 0.5 * (c - a),
                 c2 = a - 2.5 * b + 2.0 * c - 0.5 * e,
                 c3 = 0.5 * (e - a) + 1.5 * (b - c);
    return ((c3 * fr + c2) * fr + c1) * fr + c0;
  }

  double sr;
  int len = 0; int32_t mask = 0;
  std::vector<double> mBuf, sBuf;
  int32_t wp = 0;
  double dCur = 0, lpM = 0, lpS = 0, pms = 0, pmm = 0;
  double bypassMix = 0, monoMix = 0;
};

}  // namespace monofx
