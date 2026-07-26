// Differential test: run the C++ cores against the JS reference vectors.
//
// This is the harness that makes the port trustworthy. It compares EVERY
// SAMPLE, which is what catches a transposed coefficient at sample 40 000;
// re-checking that a summary correlation is still 0.83 does not.
//
// It reports three things separately, because they have different meanings:
//
//   * STRUCTURAL invariants (mono-sum width invariance, mix=0 transparency)
//     are algebraic and must hold EXACTLY regardless of which libm was linked.
//     A failure here is a real porting bug.
//
//   * SAMPLE agreement with the JS reference is limited by the transcendental
//     library. ECMAScript defines sin/cos/tan/exp/pow/log/atan2 as
//     implementation-approximated, so exact equality is not achievable unless
//     both sides call the same routines (see MONOFX_USE_BUNDLED_LIBM).
//
//   * The MATH PROBE measures that libm gap directly, for the argument ranges
//     these cores actually use — so the decision to vendor a libm can be made
//     from data rather than from folklore.
//
// No test framework, deliberately: this must build and run before any plugin
// framework is chosen. Port it to Catch2 when the JUCE/iPlug2 target exists.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "../monofx_core/ChorusCore.h"
#include "../monofx_core/DelayCore.h"
#include "../monofx_core/PhaserCore.h"
#include "../monofx_core/ReverbCore.h"

using namespace monofx;

// ---- minimal JSON reader (manifest only; no dependency worth adding) -------
namespace mini {

static std::string slurp(const std::string& p) {
  std::ifstream f(p, std::ios::binary);
  if (!f) return {};
  return std::string((std::istreambuf_iterator<char>(f)),
                     std::istreambuf_iterator<char>());
}

// Finds "key": <value> starting at `from`, returns the raw value text.
static std::string field(const std::string& s, const std::string& key, size_t from,
                         size_t* end = nullptr) {
  const std::string k = "\"" + key + "\"";
  size_t p = s.find(k, from);
  if (p == std::string::npos) return {};
  p = s.find(':', p + k.size());
  if (p == std::string::npos) return {};
  ++p;
  while (p < s.size() && isspace((unsigned char)s[p])) ++p;
  size_t q = p;
  if (s[p] == '"') {
    q = s.find('"', p + 1);
    if (end) *end = q + 1;
    return s.substr(p + 1, q - p - 1);
  }
  if (s[p] == '{') {  // brace-matched object
    int d = 0;
    for (q = p; q < s.size(); ++q) {
      if (s[q] == '{') ++d;
      else if (s[q] == '}') { if (--d == 0) { ++q; break; } }
    }
    if (end) *end = q;
    return s.substr(p, q - p);
  }
  while (q < s.size() && s[q] != ',' && s[q] != '}' && s[q] != ']') ++q;
  if (end) *end = q;
  std::string v = s.substr(p, q - p);
  while (!v.empty() && isspace((unsigned char)v.back())) v.pop_back();
  return v;
}

}  // namespace mini

static std::vector<double> readF64(const std::string& path) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) return {};
  const std::streamsize n = f.tellg();
  f.seekg(0);
  std::vector<double> v(static_cast<size_t>(n) / 8);
  f.read(reinterpret_cast<char*>(v.data()), n);
  return v;
}

struct Case {
  std::string id, core, signal, input, expected, paramsJson;
  int sr = 0, n = 0, block = 0;
};

// ---- the four cores behind one interface, so the runner stays generic ------
struct Runner {
  virtual ~Runner() = default;
  virtual void configure(const std::string& paramsJson) = 0;
  virtual void run(const double* iL, const double* iR, double* oL, double* oR,
                   int n, int block) = 0;
};

template <typename Core>
struct TypedRunner : Runner {
  double sr;
  Core core;
  explicit TypedRunner(double rate) : sr(rate), core(rate) {}

  void configure(const std::string& pj) override {
    core = Core(sr);
    for (int i = 0; i < Core::NUM_PARAMS; ++i) {
      const std::string v = mini::field(pj, Core::PARAMS[i].id, 0);
      if (!v.empty()) core.setParam(i, strtod(v.c_str(), nullptr));
    }
    // The JS generator calls refresh() after assigning parameters; the reverb
    // derives its line lengths there, so the order matters.
    if constexpr (requires { core.refresh(); }) core.refresh();
    core.resetStreams();
    // resetStreams() re-seeds the delay glide from `time`, matching JS where
    // the constructor does the same after defaults are applied.
  }

  void run(const double* iL, const double* iR, double* oL, double* oR, int n,
           int block) override {
    if (block <= 0) {
      core.processBlock(iL, iR, oL, oR, n);
      return;
    }
    std::vector<double> tL(block), tR(block), aL(block), aR(block);
    for (int off = 0; off < n; off += block) {
      const int k = std::min(block, n - off);
      for (int i = 0; i < k; ++i) { tL[i] = iL[off + i]; tR[i] = iR[off + i]; }
      core.processBlock(tL.data(), tR.data(), aL.data(), aR.data(), k);
      for (int i = 0; i < k; ++i) { oL[off + i] = aL[i]; oR[off + i] = aR[i]; }
    }
  }
};

static Runner* makeRunner(const std::string& core, double sr) {
  if (core == "PHASER") return new TypedRunner<PhaserCore>(sr);
  if (core == "DELAY")  return new TypedRunner<DelayCore>(sr);
  if (core == "REVERB") return new TypedRunner<ReverbCore>(sr);
  if (core == "CHORUS") return new TypedRunner<ChorusCore>(sr);
  return nullptr;
}

int main(int argc, char** argv) {
  const std::string dir = argc > 1 ? argv[1] : "vectors";
  // Relative tolerance for sample agreement. Far tighter than audible and far
  // looser than the measured libm-driven divergence (~1e-14), so it fails on a
  // real DSP difference and not on which platform built it.
  const double TOL = argc > 2 ? strtod(argv[2], nullptr) : 1e-9;

  const std::string mf = mini::slurp(dir + "/manifest.json");
  if (mf.empty()) {
    fprintf(stderr, "cannot read %s/manifest.json — run `npm run vectors` first\n",
            dir.c_str());
    return 2;
  }

  // ---- 1. math probe: quantify the libm gap for our argument ranges --------
  printf("MonoFX differential harness  ·  vectors=%s  ·  tol=%.0e\n\n", dir.c_str(), TOL);
  {
    const std::vector<double> m = readF64(dir + "/math.f64");
    const char* seq[] = {"sin", "cos", "tan", "exp", "pow", "pow", "log", "atan2", "hypot"};
    const int NS = 9;
    std::map<std::string, std::pair<double, long>> worst;  // fn -> {max ulp, count differing}
    std::map<std::string, long> total;
    for (size_t r = 0; r * 3 + 2 < m.size(); ++r) {
      const double a = m[r * 3], b = m[r * 3 + 1], yjs = m[r * 3 + 2];
      const std::string fn = seq[r % NS];
      double ycpp;
      if (fn == "sin") ycpp = math::sin(a);
      else if (fn == "cos") ycpp = math::cos(a);
      else if (fn == "tan") ycpp = math::tan(a);
      else if (fn == "exp") ycpp = math::exp(a);
      else if (fn == "pow") ycpp = math::pow(a, b);
      else if (fn == "log") ycpp = math::log(a);
      else if (fn == "atan2") ycpp = math::atan2(a, b);
      else ycpp = std::hypot(a, b);
      total[fn]++;
      if (ycpp != yjs) {
        // distance in ULP, via the monotonic ordering of IEEE-754 bit patterns
        int64_t ia, ib;
        memcpy(&ia, &yjs, 8);
        memcpy(&ib, &ycpp, 8);
        if (ia < 0) ia = INT64_MIN - ia;
        if (ib < 0) ib = INT64_MIN - ib;
        const double ulp = static_cast<double>(ia > ib ? ia - ib : ib - ia);
        worst[fn].first = std::max(worst[fn].first, ulp);
        worst[fn].second++;
      }
    }
    printf("libm parity vs the JS reference (V8/fdlibm), over the ranges these cores use:\n");
    printf("  %-8s %10s %12s %10s\n", "fn", "differing", "of", "max ULP");
    for (auto& kv : total) {
      const auto w = worst.count(kv.first) ? worst[kv.first] : std::make_pair(0.0, 0L);
      printf("  %-8s %10ld %12ld %10.0f%s\n", kv.first.c_str(), w.second, kv.second,
             w.first, w.second == 0 ? "   (bit-identical)" : "");
    }
    printf("\n");
  }

  // ---- 2. per-case differential -------------------------------------------
  std::map<std::string, std::vector<double>> inputCache;
  size_t p = mf.find("\"cases\"");
  int nPass = 0, nFail = 0;
  double worstRel = 0.0;
  std::string worstCase;
  std::vector<std::string> failures;

  while (true) {
    const size_t c = mf.find("\"id\"", p);
    if (c == std::string::npos) break;
    Case k;
    k.id = mini::field(mf, "id", c);
    k.core = mini::field(mf, "core", c);
    size_t pe = 0;
    k.paramsJson = mini::field(mf, "params", c, &pe);
    k.signal = mini::field(mf, "signal", pe);
    k.sr = atoi(mini::field(mf, "sr", pe).c_str());
    k.n = atoi(mini::field(mf, "n", pe).c_str());
    k.block = atoi(mini::field(mf, "block", pe).c_str());
    k.input = mini::field(mf, "input", pe);
    k.expected = mini::field(mf, "expected", pe);
    p = c + 4;
    if (k.id.empty() || k.core.empty()) continue;

    if (!inputCache.count(k.input)) inputCache[k.input] = readF64(dir + "/" + k.input);
    const std::vector<double>& in = inputCache[k.input];
    const std::vector<double> exp_ = readF64(dir + "/" + k.expected);
    if (in.empty() || exp_.empty()) {
      failures.push_back(k.id + ": missing vector file");
      ++nFail;
      continue;
    }

    std::vector<double> iL(k.n), iR(k.n), oL(k.n), oR(k.n);
    for (int i = 0; i < k.n; ++i) { iL[i] = in[i * 2]; iR[i] = in[i * 2 + 1]; }

    Runner* r = makeRunner(k.core, k.sr);
    r->configure(k.paramsJson);
    r->run(iL.data(), iR.data(), oL.data(), oR.data(), k.n, k.block);
    delete r;

    // Reject non-finite values EXPLICITLY, before any comparison. Every
    // relational operator involving NaN is false, so `if (d > mx)` silently
    // ignores a NaN and the case passes having compared nothing. Four cases
    // here were green on all-NaN reference vectors until this check existed —
    // a false green of exactly the kind this harness is meant to prevent.
    long badRef = 0, badOut = 0;
    for (int i = 0; i < k.n; ++i) {
      if (!std::isfinite(exp_[i * 2]) || !std::isfinite(exp_[i * 2 + 1])) ++badRef;
      if (!std::isfinite(oL[i]) || !std::isfinite(oR[i])) ++badOut;
    }
    if (badRef || badOut) {
      ++nFail;
      char b[512];
      snprintf(b, sizeof b, "%-42s NON-FINITE: %ld reference, %ld produced", k.id.c_str(),
               badRef, badOut);
      failures.push_back(b);
      continue;
    }

    double mx = 0.0;
    int mxAt = -1;
    double scale = 0.0;
    for (int i = 0; i < k.n; ++i)
      scale = std::max(scale, std::max(std::fabs(exp_[i * 2]), std::fabs(exp_[i * 2 + 1])));
    if (scale < 1e-12) scale = 1.0;
    for (int i = 0; i < k.n; ++i) {
      const double dl = std::fabs(oL[i] - exp_[i * 2]);
      const double dr = std::fabs(oR[i] - exp_[i * 2 + 1]);
      const double d = std::max(dl, dr);
      if (d > mx) { mx = d; mxAt = i; }
    }
    const double rel = mx / scale;
    if (rel > worstRel) { worstRel = rel; worstCase = k.id; }
    if (rel <= TOL) {
      ++nPass;
    } else {
      ++nFail;
      char b[512];
      snprintf(b, sizeof b, "%-42s rel %.3e (abs %.3e) first worst at sample %d",
               k.id.c_str(), rel, mx, mxAt);
      failures.push_back(b);
    }
  }

  printf("per-sample agreement with the JS reference:\n");
  printf("  %d/%d cases within %.0e   worst %.3e (%s)\n\n", nPass, nPass + nFail, TOL,
         worstRel, worstCase.c_str());
  if (!failures.empty()) {
    printf("FAILURES:\n");
    for (auto& f : failures) printf("  %s\n", f.c_str());
    printf("\n");
  }

  // ---- 3. structural invariants, asserted EXACTLY -------------------------
  // These are algebraic properties of the C++ code alone. They do not depend on
  // the JS reference or on which libm is linked, so they are held to the same
  // tolerances as the JS suite rather than to TOL.
  printf("structural invariants (must hold under any libm):\n");
  int inv = 0, invFail = 0;
  auto invCheck = [&](const char* what, bool ok, const std::string& detail) {
    printf("  %-4s %-46s %s\n", ok ? "ok" : "FAIL", what, detail.c_str());
    ++inv;
    if (!ok) ++invFail;
  };

  const int SR = 48000, N = SR;
  std::vector<double> sL(N), sR(N);
  {  // deterministic pink-ish stereo, generated here so this section is
     // self-contained and can outlive the JS vectors
    uint32_t st = 7;
    auto rnd = [&]() {
      st = st * 1664525u + 1013904223u;
      return (double)st / 4294967296.0 * 2.0 - 1.0;
    };
    double b0 = 0, b1 = 0, b2 = 0;
    for (int i = 0; i < N; ++i) {
      const double w = rnd();
      b0 = 0.997 * b0 + 0.03 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w;
      // Rounded to float, which is what a host actually hands a plugin, and what
      // the JS suite feeds (Float32Array).
      //
      // This is load-bearing for the mix=0 assertion, not cosmetic. The cores
      // reconstruct the output as m+s = 0.5*(L+R) + 0.5*(L-R). With 24-bit
      // operands, L+R and L-R are exactly representable in float64, so M and S
      // are exact and m+s is exactly L. With full 53-bit operands both sums
      // round, and the identity is 1 ULP off on ~9.5% of random pairs
      // (measured: 190838/2000000, worst 1.11e-16).
      //
      // So "mix=0 is bit-transparent" is true at host precision and 1-ULP at
      // double precision. Feeding this test float64 does not find a bug, it
      // just asks the arithmetic for something it never promised.
      sL[i] = static_cast<float>((b0 + b1 + b2 + w * 0.05) * 0.5);
      sR[i] = static_cast<float>(sL[i] * 0.8 + rnd() * 0.1);
    }
  }

  auto render = [&](const std::string& core, double width, double mix, int block,
                    std::vector<double>& oL, std::vector<double>& oR) {
    Runner* r = makeRunner(core, SR);
    char pj[256];
    snprintf(pj, sizeof pj, "{\"width\":%.17g,\"mix\":%.17g}", width, mix);
    // configure() only overrides the keys present, so every other parameter
    // keeps its declared default.
    r->configure(pj);
    oL.assign(N, 0.0); oR.assign(N, 0.0);
    r->run(sL.data(), sR.data(), oL.data(), oR.data(), N, block);
    delete r;
  };

  for (const char* core : {"PHASER", "DELAY", "REVERB", "CHORUS"}) {
    std::vector<double> aL, aR, bL, bR;
    // 1. mono sum must not depend on WIDTH
    render(core, 0.0, 0.5, 0, aL, aR);
    render(core, 1.0, 0.5, 0, bL, bR);
    double e = 0;
    for (int i = 0; i < N; ++i)
      e = std::max(e, std::fabs((aL[i] + aR[i]) - (bL[i] + bR[i])));
    char d[128];
    snprintf(d, sizeof d, "dev %.2e", e);
    invCheck((std::string(core) + ": mono sum width-invariant (<1e-15)").c_str(), e < 1e-15, d);

    // 2. mix=0 must be bit-transparent
    render(core, 0.7, 0.0, 0, aL, aR);
    double t = 0;
    for (int i = 0; i < N; ++i)
      t = std::max(t, std::max(std::fabs(aL[i] - sL[i]), std::fabs(aR[i] - sR[i])));
    snprintf(d, sizeof d, "dev %.2e", t);
    invCheck((std::string(core) + ": mix=0 bit-transparent (==0)").c_str(), t == 0.0, d);

    // 3. block-size independence
    render(core, 0.7, 0.5, 0, aL, aR);
    render(core, 0.7, 0.5, 128, bL, bR);
    double bdiff = 0;
    for (int i = 0; i < N; ++i) bdiff = std::max(bdiff, std::fabs(aL[i] - bL[i]));
    snprintf(d, sizeof d, "dev %.2e", bdiff);
    invCheck((std::string(core) + ": block-size independent (==0)").c_str(), bdiff == 0.0, d);
  }

  printf("\n%d/%d structural invariants hold\n", inv - invFail, inv);
  const bool ok = (nFail == 0 && invFail == 0);
  printf("\n%s\n", ok ? "DIFFERENTIAL HARNESS PASSES" : "DIFFERENTIAL HARNESS FAILED");
  return ok ? 0 : 1;
}
