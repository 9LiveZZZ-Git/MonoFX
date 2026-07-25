# CLAUDE.md — handoff brief

You are picking up a validated DSP research prototype and turning it into a
shipping VST3/AU plugin suite. **The DSP is done and measured. The plugin
infrastructure is not.** Your job is mostly the second half.

Read this file first, then `docs/architecture.md`, then
`docs/mono-maximizer-spec.md`. Run `npm test` before you change anything so you
know what green looks like.

---

## 1. What this is

Five plugins around one idea: **mono compatibility should be structural, not a
thing you check afterwards.**

| Plugin | What it does | Mechanism |
|---|---|---|
| **MonoLock** | Repairs existing phase damage | Spectral phase unification (analysis-driven) |
| **MonoFX Phaser** | Phaser that can't comb in mono | Effect in M, width in S |
| **MonoFX Delay** | Ping-pong that survives mono | Effect in M, width in S |
| **MonoFX Reverb** | FDN with no mono comb | Effect in M, width in S |
| **MonoFX Chorus** | Chorus that can't thin out | Effect in M, width in S |

MonoLock is the corrective tool (it measures and fixes). The four MonoFX
effects are the preventive tools (they cannot create the problem). They share
a runtime pattern but not an algorithm.

## 2. Invariants — do not regress these

These are the product. Everything else is negotiable.

1. **Mono sum must not depend on the width control** (MonoFX). Verified in
   float64 as bit-exact; float32 gets exactly the 1-ULP rounding floor
   (≈ −138 dBFS). If a change makes this −90 dBFS, the change is wrong even if
   it sounds better.
2. **Already-compatible audio must pass through untouched** (MonoLock). An
   identical-channel input nulls at −122.9 dBFS at every strength setting, and
   the optional enhancement stages (consistency pass, dual-resolution) must
   never fire on it.
3. **`mix = 0` is bit-transparent** on every MonoFX core.
4. **Block-size independence.** A 4096-sample render must equal a 128-sample
   streamed render exactly. Hosts vary the quantum arbitrarily.
5. **Determinism.** Same input + same params ⇒ bit-identical output. No
   `Math.random`, no time-dependent state, no uninitialized memory.
6. **Enhancement stages are adoption-guarded.** Any stage that "improves"
   output must be measured against the primary objective and discarded if it
   doesn't help. Two stages in MonoLock already fail this on some material and
   are correctly rejected at runtime.

`npm test` checks all six across 60 assertions. Port these to Catch2 or
GoogleTest as you port the DSP — see `docs/juce-port-plan.md` §4.

## 3. What is NOT done

Be clear-eyed about this list; it's the actual remaining work.

- **No JUCE project exists.** No CMake, no `AudioProcessor`, no editor. Start here.
- **No parameter automation, no state save/restore, no presets.**
- **No oversampling.** The phaser and chorus have nonlinear-ish behavior at
  extreme settings that would benefit from 2× — measure before assuming.
- **No denormal protection in the C++ sense.** The JS cores flush tiny values
  manually in the feedback paths; C++ needs `ScopedNoDenormals` plus a review
  of every recursive path.
- **Reverb makeup gain (1.5×) was set by ear-free guesswork.** FDN loudness
  needs real listening. Same for chorus side-shimmer depth at high width.
- **The live mic path in the MonoLock prototype is untested** — headless
  testing can't reach it.
- **MonoLock's mid-file polarity flip tops out at 0.745** (vs ~0.99 for the
  other cases). Cause is estimator convergence inside the ±0.25 s boundary
  crossfade, not a bug. It's the most promising remaining algorithmic win.
- **No latency compensation reporting** — MonoLock live must call
  `setLatencySamples()`; MonoFX cores are zero-latency and must report 0.

## 4. Build order (suggested)

1. **CMake + JUCE skeleton**, one shared `monofx_core` static library, five
   plugin targets. Get an empty pass-through VST3 loading in a host first.
2. **Port the four MonoFX cores** — they're ~60 lines each, straight
   translation, no FFT. Port `tests/monofx-cores.test.js` alongside; it should
   go green in C++ with the same numbers.
3. **Generic editor driven by the `PARAMS` descriptor.** Each core already
   declares its parameters (id, label, min, max, default, log, unit, decimals).
   Build one editor that reads that table so all four plugins share it.
4. **Port `LiveCore`** (MonoLock live mode). Radix-2 FFT, 512/1024 selectable.
   This is the bridge to the hard one.
5. **Port the offline MonoLock engine.** Biggest job by far — see
   `docs/mono-maximizer-spec.md` for the full algorithm. Consider ARA2 or a
   render-on-demand model rather than real-time.

## 5. Failure modes already discovered — don't rediscover them

Eight numbered regression principles are in `docs/mono-maximizer-spec.md` §10.
The ones most likely to bite a C++ port:

- **Circular quantities need circular arithmetic.** Linear slew limiting on a
  phase value sign-flips across ±π when rounding lands sub-ULP past the
  boundary. Use shortest-arc.
- **COLA constants are not guessable.** Hann at 75 % overlap sums to 2.0, not
  1.5. Verify by summing windows, not by memory.
- **DC and Nyquist bins are real bins.** Leaving them untouched broke
  correlation on bass-heavy material.
- **`atan2(0,0)` is a silence trap.** Never steer from instantaneous phase;
  steer from a smoothed cross-spectrum, which is zero-safe by construction.
- **Verify that a "fix" lever actually has travel.** One refinement lever moved
  the objective by < 0.001 and was silently doing nothing for a whole revision.
- **Statistical flutter is not a failure.** Verdict thresholds need a
  deadband (−0.1), or you'll chase noise forever.

## 6. Working agreements

- **The HTML prototypes are the reference implementation** until C++ passes the
  same tests. If C++ and JS disagree, JS is right until proven otherwise.
- `src/monolock-engine.generated.js` is **generated** — never hand-edit it.
  Edit `prototypes/monolock-prototype.html` and run `npm run extract`.
- Every measured claim in the docs is a real measurement. If you change the
  engine and a number moves, **update the number** — don't leave a stale figure
  in the spec. A spec that lies is worse than no spec.
- When you add a DSP feature, add its regression test in the same commit.
