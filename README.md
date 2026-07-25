# MonoFX

A suite of audio effects built around one idea: **mono compatibility should be
structural, not something you check afterwards.**

- **MonoLock** — spectral phase maximizer. Measures the inter-channel phase
  relationship across frequency and time, then rotates both channels
  symmetrically toward alignment. Repairs existing damage.
- **MonoFX Phaser / Delay / Reverb / Chorus** — modulation and space effects
  that *cannot* comb-filter in mono, because the effect lives entirely in the
  mid signal and width lives only in the side signal. Prevents damage.

Everything here is a validated JavaScript reference implementation plus the
regression suites that define correct behavior. The C++/JUCE plugin build does
not exist yet — see `CLAUDE.md`.

## Quick start

```bash
npm test          # 80 assertions across both suites (~60 s)
npm run serve     # then open http://localhost:8000/prototypes/
```

Open `prototypes/monofx-suite.html` for the four effects (tabbed faceplate,
live worklet processing, goniometer, built-in invariance verifier) or
`prototypes/monolock-prototype.html` for the maximizer (studio + live modes,
test signals, WAV export). Both need to be *served*, not opened as `file://` —
AudioWorklet requires a real origin.

## Layout

```
CLAUDE.md                       Handoff brief. Read this first.
docs/
  architecture.md               The M/S thesis and per-effect design
  juce-port-plan.md             Repo shape, param plumbing, milestones
  mono-maximizer-spec.md        MonoLock algorithm spec, v0.5
src/
  monofx-phaser.js              \
  monofx-delay.js                | The four MonoFX cores — plain classes,
  monofx-reverb.js               | no dependencies, worklet-ready
  monofx-chorus.js              /
  monolock-engine.generated.js  GENERATED — do not edit (npm run extract)
prototypes/
  monofx-suite.html             Tabbed test faceplate for the four effects
  monolock-prototype.html       MonoLock UI + engine (source of truth)
tests/
  monofx-cores.test.js          Invariance, transparency, stability, packaging
  monolock-engine.test.js       Offline maximizer + LiveCore at 512/1024
  lib/signals.js                Deterministic seeded test material
tools/
  extract-engine.js             Pulls the MonoLock engine out of the HTML
```

## Current measurements

MonoFX cores (all four): the mono sum is width-invariant to 1–2 ULP of float64
output rounding (−307 to −319 dB); the *mid path itself* is bit-exact, but the
cores return L and R separately and `fl(m+s)+fl(m−s)` is not exactly `2m`.
float32 deviation is 1 ULP (−141 to −144.5 dBFS). `mix=0` bit-transparent,
block-size independent, deterministic, stable at maximum settings on sustained
material, recovers from NaN/Inf input, and WIDTH widens without panning the
image (worst L/R imbalance 0.08–0.99 dB).

MonoLock offline (strength 1.0): 5 ms delay 0.197 → 1.000 · polarity inversion
−1.000 → 0.992 · broadband rotation 0.455 → 0.993 · decorrelated material left
transparent · 8 ms drift 0.349 → 0.927 · mid-file polarity flip 0.037 → 0.747 ·
identical channels null at −122.9 dBFS across the *whole* buffer at every
strength, edges included.

MonoLock live: latency is exactly the window length and does not vary with the
host block size — 512-pt = 512 samples (10.7 ms), 1024-pt = 1024 samples
(21.3 ms). Anti-phase recovery −1.000 → 0.986 (512) and → 0.988 (1024); both
null identical channels at −122.9 dBFS; both bit-identical across host block
sizes from 32 to 8192 samples.

## Why the numbers are stated everywhere

Every figure in these docs is a measurement from `npm test`, not an estimate.
If you change the DSP and a number moves, update the number. A spec that lies
is worse than no spec.
