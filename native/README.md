# native/ — C++ core and differential harness

The four MonoFX cores ported to C++, plus the harness that proves the port
matches the JS reference. No plugin framework is involved: `monofx_core` is
header-only and framework-free, so it can be unit-tested without a host and
re-shelled for VST3 / AU / CLAP / AAX later.

```bash
npm run test:diff        # generate vectors, build, run — the whole loop
```

or by hand:

```bash
npm run vectors                                   # writes vectors/ (~56 MB, gitignored)
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release && cmake --build native/build -j
./native/build/monofx_diff vectors [tolerance]    # default tolerance 1e-9
```

## What it checks, and why in three separate sections

**1. Per-sample agreement with the JS reference.** Every sample of every case,
not summary statistics. A correlation figure staying at 0.83 tells you nothing
about a transposed coefficient at sample 40 000; this does. 64 cases spanning
four cores × eight parameter sets × five signals × three sample rates × three
host block sizes.

Current: **64/64 within 1e-9, worst 6.6e-14.**

**2. Structural invariants, asserted exactly.** These are algebraic properties
of the C++ alone — they do not involve the JS reference and must hold under any
libm, compiler or optimisation level:

| Invariant | Held to |
|---|---|
| Mono sum does not depend on WIDTH | `< 1e-15` (1–2 ULP of output rounding) |
| `mix = 0` is bit-transparent | exactly `0` |
| Block-size independence | exactly `0` |

**3. The libm parity probe.** Measures the JS↔C++ transcendental gap over the
argument ranges these cores actually use, so the decision below can be made
from data.

## Why sample agreement is 1e-14 and not zero

ECMAScript defines `sin`, `cos`, `tan`, `exp`, `pow`, `log` and `atan2` as
*implementation-approximated* — it only recommends fdlibm. V8 uses fdlibm; C++
uses the platform libm. Measured here (glibc 2.39 vs V8), over this DSP's own
argument ranges:

```
fn        differing           of    max ULP
atan2           319         2000          1
cos              60         2000          1
exp             189         2000          1
hypot           712         2000          2
log             125         2000          1
pow             378         4000          1
sin              78         2000          1
tan              77         2000          1
```

So the libraries genuinely disagree — on 3–36 % of inputs, by 1–2 ULP. The DSP
consequence is small because every feedback path here is contractive: the error
does not compound. Perturbing *every* transcendental by 1 ULP (a deliberate
worst case) moves output samples by ≤ 8.3e-15 relative even at maximum feedback
over a 30-second render, and leaves all three structural invariants exact.

**Therefore: assert invariants exactly, assert samples within a tolerance.**
1e-9 is ~5 orders of magnitude looser than the observed divergence and ~5
orders tighter than any real DSP error — the negative controls below land
between them comfortably.

## Bundling a libm

`-DMONOFX_USE_BUNDLED_LIBM=ON` switches `monofx::math::*` from the platform
libm to a vendored one; wire the declarations in `MonoFXMath.h` to fdlibm or
musl's libm to complete it.

The reason to do this is **not** audio quality — 6.6e-14 is −262 dBFS and
inaudible. It is that without it, your Windows, macOS and Linux builds produce
subtly different output from identical source, which makes "did this commit
change the sound?" unanswerable and makes an audio regression un-bisectable.
Vendoring one libm makes every platform agree with every other, and (since V8
uses fdlibm) with the JS reference as a bonus.

## Compiler flags

`CMakeLists.txt` sets `-ffp-contract=off` (MSVC `/fp:precise`). Measured
effects, so the reasoning is on record rather than folkloric:

| Setting | Result |
|---|---|
| `-ffp-contract=off/on/fast` on baseline x86-64 | **identical binaries** — no FMA instruction is available to contract into |
| `-mfma -ffp-contract=fast` | 68 FMA instructions emitted; worst deviation 6.6e-14 → **2.5e-13**; invariants still exact |
| `-O0 / -O2 / -O3` | identical results |
| `-Ofast` (implies `-ffast-math`) | **breaks** — do not use |

Contraction is therefore a *reproducibility* concern, not a correctness one: it
matters because `-march=native` on x86 and Apple Silicon (where FMA is
baseline) would otherwise disagree with a plain x86-64 build. `-ffast-math` is
a correctness concern — it permits reassociation and denormal flushing, either
of which can break the mono-sum identity.

## Negative controls

A harness that only ever passes is worthless. Verified failures:

| Injected defect | Detected |
|---|---|
| Phaser width taken from stages 1&3 instead of 1&4 | 12/64 cases fail, worst rel 4.7e-1 |
| 1e-7 relative error in one chorus interpolator coefficient | 13/64 cases fail, worst rel 3.3e-8 |
| A single NaN in one reference vector | flagged `NON-FINITE`, case fails |
| `std::round` for `jsmath::round` in the reverb | **not** detected — correctly, see below |

The last one is not a gap. `std::round` and `floor(x+0.5)` differ only for
negative half-integers, and every quantity rounded here is positive, so the
substitution is genuinely a no-op *at present*. The `jsmath::round` seam is
defensive: it becomes load-bearing the moment any rounded quantity can go
negative.

## A trap worth knowing about

The impulse cases initially passed on **all-NaN reference vectors**. Every
relational operator involving NaN is false, so `if (d > max)` silently skips a
NaN and the case reports zero error having compared nothing. Both sides now
reject non-finite values explicitly — the generator throws, and the runner
fails the case before any comparison. If you extend this harness, keep that
check: a NaN reference is indistinguishable from a perfect match otherwise.

## Porting notes

`MonoFXMath.h` separates two things that are easy to conflate:

* **Semantic** JS/C++ differences, which are exact and must be matched.
  `Math.round` is `floor(x+0.5)` (half toward +∞) while `std::round` is half
  away from zero; `Math.min`/`Math.max` propagate NaN while `std::min`/`std::max`
  do not; `x & mask` in JS is `ToInt32` then a two's-complement AND, which is
  what makes the fractional-delay readers wrap correctly on negative indices.
* **Precision** differences in the transcendentals, which are the subject of
  the libm discussion above.

Keep the cores a line-for-line translation of `src/monofx-*.js`. The harness
compares them per sample, so an "improvement" here surfaces as a failure rather
than as a better plugin.
