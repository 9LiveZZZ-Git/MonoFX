// MonoFX PhaserCore — direct port of src/monofx-phaser.js.
// Keep this file a line-for-line translation of the JS reference: the
// differential harness compares them per sample, so any "improvement" here
// shows up as a failure rather than as a better plugin.
#pragma once
#include "MonoFXMath.h"
#include "ParamDescriptor.h"

namespace monofx {

class PhaserCore {
 public:
  static constexpr const char* NAME = "PHASER";
  static constexpr ParamDescriptor PARAMS[] = {
      {"rate",  "RATE",   0.05, 8.0, 0.4, true,  "Hz", 2},
      {"depth", "DEPTH",  0.0,  1.0, 0.7, false, "",   2},
      {"fb",    "FEEDBK", 0.0,  0.9, 0.4, false, "",   2},
      {"width", "WIDTH",  0.0,  1.0, 0.7, false, "",   2},
      {"mix",   "MIX",    0.0,  1.0, 0.5, false, "",   2},
  };
  static constexpr int NUM_PARAMS = 5;

  double rate = 0.4, depth = 0.7, fb = 0.4, width = 0.7, mix = 0.5;
  bool bypass = false, mono = false;

  explicit PhaserCore(double sampleRate) : sr(sampleRate) { resetStreams(); }

  void setParam(int i, double v) {
    switch (i) {
      case 0: rate = v; break;  case 1: depth = v; break;
      case 2: fb = v;   break;  case 3: width = v; break;
      case 4: mix = v;  break;  default: break;
    }
  }
  // Zero-latency, like every MonoFX core. Report this from setLatencySamples().
  int latencySamples() const { return 0; }

  void resetStreams() {
    for (int i = 0; i < 6; ++i) { x1[i] = 0.0; y1[i] = 0.0; }
    ph = 0.0; fbS = 0.0; dcX = 0.0; dcY = 0.0; pms = 0.0; pmm = 0.0;
    bypassMix = bypass ? 1.0 : 0.0;
    monoMix   = mono   ? 1.0 : 0.0;
  }

  template <typename S>
  void processBlock(const S* inL, const S* inR, S* outL, S* outR, int N) {
    const double stp = 1.0 / (0.010 * sr);
    // Parameters arrive unvalidated (postMessage in JS, an automation curve in
    // a host), so clamp before use rather than trusting the range.
    const double rateC  = jsmath::min(20.0, jsmath::max(0.0, rate));
    const double depthC = jsmath::min(1.0,  jsmath::max(0.0, depth));
    const double fbC    = jsmath::min(0.9,  jsmath::max(0.0, fb));
    const double mixC   = jsmath::min(1.0,  jsmath::max(0.0, mix));
    const double widthC = jsmath::min(1.0,  jsmath::max(0.0, width));
    const double phInc = 2.0 * PI * rateC / sr;
    const double wS = widthC * mixC * 0.5;
    const double dcR = 1.0 - 2.0 * PI * 20.0 / sr;   // 20 Hz DC blocker
    const double bal = 1.0 - math::exp(-1.0 / (0.050 * sr));  // 50 ms estimator

    for (int i = 0; i < N; ++i) {
      const double L = static_cast<double>(inL[i]), R = static_cast<double>(inR[i]);
      const double M = 0.5 * (L + R), Sd = 0.5 * (L - R);
      // Swept coefficient, shared by both channels: identical notches, so the
      // sweep cannot comb the mono sum.
      const double fc = jsmath::min(0.45 * sr,
          150.0 * math::pow(2.0, depthC * 4.0 * (0.5 + 0.5 * math::sin(ph))));
      ph += phInc; if (ph > 2.0 * PI) ph -= 2.0 * PI;
      const double t = math::tan(PI * fc / sr), g = (t - 1.0) / (t + 1.0);
      // A 1st-order allpass has H(1)=+1 for any coefficient, so the cascade is
      // unity-gain and zero-phase at DC wherever the LFO sits: raw feedback
      // would boost DC by 1/(1-fb). Block it before it recirculates.
      dcY = fbS - dcX + dcR * dcY; dcX = fbS;
      if (dcY > -1e-24 && dcY < 1e-24) dcY = 0.0;
      // Attenuating the chain input by (1-fb) pins the resonant peak at unity;
      // undamped it reaches 1/(1-fb) = 10x at fb=0.9.
      double x = M * (1.0 - fbC) + dcY * fbC, yA = 0.0, yB = 0.0;
      for (int st = 0; st < 6; ++st) {
        const double y = g * x + x1[st] - g * y1[st];
        x1[st] = jsmath::flush(x);
        y1[st] = jsmath::flush(y);
        if (st == 0) yA = y; else if (st == 3) yB = y;
        x = y;
      }
      fbS = jsmath::flush(x);
      const double wet = 0.5 * (M + x);
      const double mOut = M * (1.0 - mixC) + wet * mixC;   // width-independent
      const double sW = wS * (yA - yB);                    // stages 1 minus 4
      // Image-balance corrector: removing the projection of the wet side term
      // onto the mid drives E[m*s] to zero, so WIDTH widens instead of panning.
      // It cannot disturb the mono sum (2m either way) and is identically zero
      // at mix=0, where sW is zero — so mix=0 stays bit-transparent.
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
  double sr;
  double x1[6] = {}, y1[6] = {};
  double ph = 0, fbS = 0, dcX = 0, dcY = 0, pms = 0, pmm = 0;
  double bypassMix = 0, monoMix = 0;
};

}  // namespace monofx
