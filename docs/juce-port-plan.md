# JUCE port plan

## 1. Repository shape

```
CMakeLists.txt              # top level, add_subdirectory per target
libs/JUCE/                  # submodule, JUCE 8.x
modules/monofx_core/        # shared static lib — all DSP, zero JUCE deps
  MonoFXCore.h              # abstract base: prepare/process/reset/params
  PhaserCore.{h,cpp}
  DelayCore.{h,cpp}
  ReverbCore.{h,cpp}
  ChorusCore.{h,cpp}
  LiveCore.{h,cpp}          # MonoLock causal engine (512/1024)
  MonoLockEngine.{h,cpp}    # MonoLock offline engine
  ParamDescriptor.h         # mirrors the JS PARAMS table
plugins/
  MonoFXPhaser/  MonoFXDelay/  MonoFXReverb/  MonoFXChorus/  MonoLock/
tests/                      # Catch2, links monofx_core only
```

Keep `monofx_core` free of JUCE headers. It makes the DSP unit-testable without
a plugin host and keeps a future CLAP/AUv3/WASM target cheap.

## 2. Parameter plumbing

Each JS core exposes a `PARAMS` array of
`{id, label, min, max, def, log, unit, dp}`. Mirror it as a
`static constexpr std::array<ParamDescriptor, N>` and generate:

- the `AudioProcessorValueTreeState` layout (`NormalisableRange` with
  `skewFactorFromMidPoint` for the `log: true` entries),
- the editor's knob row,
- the parameter-to-core-field bridge.

Write it once in a template/CRTP base so adding a fifth effect is one file.
Cache parameter pointers in `prepareToPlay`; never call
`getRawParameterValue` per sample.

## 3. Real-time correctness

- `ScopedNoDenormals` at the top of every `processBlock`.
- No allocation, no locks, no file or GUI access on the audio thread. The
  reverb's `refresh()` currently resizes delay-line *lengths* when SIZE changes
  — in C++, preallocate the maximum and change only the read/write modulus.
- Parameter smoothing: the JS cores smooth bypass/mono over 10 ms and delay
  time over 50 ms. Use `SmoothedValue` for anything the user can drag; the
  invariant tests will not catch a zipper.
- `setLatencySamples`: MonoFX cores report **0**. MonoLock live reports
  `core.latencySamples()`, which is **W** (512 at 512-pt, 1024 at 1024-pt) and
  is constant for every host block size. Call the method; do not re-derive it.
  It used to be `W − hop` plus a variable FIFO-priming term, which is why the
  measured figure moved with the quantum (384–480 samples at 512-pt) and why
  the old "18.7 ms at 1024-pt" was really 16 ms of engine plus 128 samples of
  the test's own block size.
- The JS `processBlock` handles any block size via a staging FIFO, verified
  bit-identical across 17 quanta from 32 to 8192 samples. Keep that structure —
  but note the JS version *grows* the FIFO on demand, which allocates. In C++,
  size it once in `prepareToPlay` from `maximumExpectedSamplesPerBlock` and
  never reallocate. The FIFO must be primed with `hop` zeros at reset: without
  that cushion the reader structurally underruns whenever the block size is not
  commensurate with `hop`, and the old code then emitted a zero *without*
  advancing the read pointer, which stretched the stream instead of delaying it.

## 4. Test port

`tests/monofx-cores.test.js` and `tests/monolock-engine.test.js` translate
directly to Catch2. Same signals (the LCG generator in `tests/lib/signals.js` is
deliberately trivial to reimplement — copy the constants exactly so the numbers
match), same assertions, same tolerances. Run them in CI on every commit.

The float64-vs-float32 split matters in the port: JUCE processes `float`
buffers, so run the invariance test by rendering into `double` buffers directly
from the core (template the sample type, or add a test-only `double` overload).
Otherwise you can only ever verify the 1-ULP bound, not the exact identity, and
you'll lose the ability to distinguish "algebraically correct" from "close".

## 5. MonoLock-specific concerns

MonoLock's offline engine is not a real-time algorithm — it makes multiple
passes over the whole file, including a verification pass that re-analyzes its
own output. Options, in increasing order of effort:

1. **Render-on-demand.** Plugin holds the region, processes on a background
   thread, plays back the rendered result. Simple; awkward with automation.
2. **ARA2.** The correct home for this algorithm — the host hands you the whole
   audio source and expects analysis. Significant integration work.
3. **Live-only build.** Ship `LiveCore` alone as a real-time mono maximizer and
   keep the offline engine as a separate offline/ARA product.

Recommendation: ship the four MonoFX effects and a `LiveCore`-based MonoLock
first. The offline engine is the most valuable and the most expensive; it
shouldn't gate the suite.

FFT: replace the hand-rolled radix-2 with `juce::dsp::FFT` (or PFFFT/FFTW).
Verify COLA numerically after the swap — window normalization is exactly the
kind of thing that survives a refactor while being silently wrong.

## 6. Milestones

| # | Deliverable | Done when |
|---|---|---|
| 1 | CMake + empty pass-through VST3 | Loads in a host, audio passes |
| 2 | Four MonoFX cores in C++ | Catch2 port green with matching numbers |
| 3 | Descriptor-driven editor | All four plugins share one editor build |
| 4 | State, presets, automation | Session recall round-trips exactly |
| 5 | `LiveCore` / MonoLock Live | Anti-phase test green in-host |
| 6 | Oversampling + denormal audit | No behavior change at 1×; measured at 2× |
| 7 | Offline MonoLock (ARA or render) | Full offline suite green |
