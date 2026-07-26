// MonoFX — JavaScript-compatible math layer.
//
// Two separate concerns live here, and conflating them is how ports go wrong.
//
// 1. SEMANTIC differences between JS and C++ that are exact and must be
//    matched. These are not precision issues — the answers are simply
//    different functions. Getting one wrong produces an off-by-one delay line
//    or a sign flip, not a rounding discrepancy.
//
// 2. PRECISION differences in the transcendentals. ECMAScript defines sin,
//    cos, tan, exp, pow, log and atan2 as *implementation-approximated*; it
//    only recommends fdlibm. V8 uses fdlibm; C++ uses the platform libm
//    (glibc / Apple / MSVC UCRT), which differ from fdlibm and from each
//    other. Bit-exact JS parity therefore requires calling the same routines.
//    MONOFX_USE_BUNDLED_LIBM is the seam for that; see native/README.md.
//
// The practical consequence of (2), measured on this DSP: structural
// invariants (mono-sum width invariance, mix=0 transparency, block-size
// independence) are unaffected because they are algebraic, while sample values
// agree to ~1e-15 relative. So the port asserts invariants exactly and sample
// values within a tolerance.
#pragma once
#include <cmath>
#include <cstdint>

namespace monofx {

// ---- (1) semantic compatibility -------------------------------------------
namespace jsmath {

// JS Math.round is floor(x + 0.5): it rounds half toward POSITIVE INFINITY.
// std::round rounds half AWAY FROM ZERO, so std::round(-2.5) == -3 while
// Math.round(-2.5) === -2. The reverb's line lengths and pre-delay both go
// through this, and a one-sample line-length error is inaudible but makes
// every subsequent sample differ — which reads as a broken port.
inline double round(double x) noexcept { return std::floor(x + 0.5); }

// JS Math.min/Math.max propagate NaN; std::min/std::max return whichever
// argument the comparison happens to favour. The parameter clamps use these,
// so a NaN parameter must clamp to NaN (and be caught) rather than silently
// becoming a bound.
inline double min(double a, double b) noexcept {
  if (std::isnan(a) || std::isnan(b)) return NAN;
  return a < b ? a : b;
}
inline double max(double a, double b) noexcept {
  if (std::isnan(a) || std::isnan(b)) return NAN;
  return a > b ? a : b;
}

// JS `x & mask` first applies ToInt32 (truncate toward zero, modulo 2^32) and
// then a two's-complement AND. For a power-of-two mask this wraps negative
// indices correctly, which the fractional-delay readers rely on when the read
// pointer is behind the write pointer.
inline int32_t toInt32(double x) noexcept { return static_cast<int32_t>(x); }

// The cores' shared denormal-flush-and-NaN-quarantine guard. Written as one
// function because the original JS bug was writing it *almost* right: the old
// guard was Math.abs(x) < 1e-24, and Math.abs(NaN) < 1e-24 is false, so NaN
// passed straight through and latched the recursive state permanently.
inline double flush(double x) noexcept {
  return (std::isfinite(x) && (x > 1e-24 || x < -1e-24)) ? x : 0.0;
}

}  // namespace jsmath

// ---- (2) transcendental provider ------------------------------------------
#ifndef MONOFX_USE_BUNDLED_LIBM
#define MONOFX_USE_BUNDLED_LIBM 0
#endif

namespace math {
#if MONOFX_USE_BUNDLED_LIBM
// Point these at the vendored fdlibm to get bit-exact parity with V8 and,
// more usefully, with yourself across Windows/macOS/Linux.
double sin(double);
double cos(double);
double tan(double);
double exp(double);
double log(double);
double pow(double, double);
double atan2(double, double);
#else
using std::atan2;
using std::cos;
using std::exp;
using std::log;
using std::pow;
using std::sin;
using std::tan;
#endif
// sqrt and the arithmetic operators are IEEE-754 specified and therefore
// identical on every conforming platform — they never need a provider.
using std::fabs;
using std::sqrt;
}  // namespace math

}  // namespace monofx
