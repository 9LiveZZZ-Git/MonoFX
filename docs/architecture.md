# MonoFX architecture

## The thesis

A stereo signal can be written as mid and side:

```
M = (L + R) / 2      S = (L - R) / 2
L = M + S            R = M - S
```

A mono listener hears `L + R = 2M`. **The side signal is inaudible in mono —
exactly, at every frequency, with no approximation.**

Almost every classic modulation effect ignores this. A stereo chorus offsets
the LFO phase between channels, so the two channels get different delay times;
in mono those different delays comb against each other and the sound thins out
or disappears. A ping-pong delay puts repeat *n* only in L and repeat *n+1*
only in R; in mono they collapse into one flat train. A stereo phaser puts the
notches at different frequencies per channel; in mono you get a third,
unintended notch pattern that nobody designed.

MonoFX inverts the arrangement:

> **The effect lives in M. Width lives only in S.**

Because the mono sum is exactly the M path, and the M path contains no
width-dependent term, the mono result is *provably* independent of the width
control. This isn't a tuning target; it's an algebraic identity, and the test
suite verifies it as bit-exact in float64.

What this buys: a mono listener always hears the complete, correctly designed
effect — full echo train, full reverb tail, full ensemble — never a comb-filtered
residue. What it costs: the achievable width is genuinely lower than a
phase-offset effect, because we may only use amplitude differences and
decorrelated-but-cancelling content, never inter-channel phase offsets. **That
trade is the entire point of the product**, and it should be stated plainly in
the marketing rather than hidden.

## Common core shape

Every core is a plain class with no dependencies and no closure over outer
scope, so it can be stringified into an AudioWorklet and later translated
almost line-for-line into a JUCE `processBlock`:

```js
class SomethingCore {
  static NAME, PROC, PARAMS   // PARAMS drives the UI automatically
  constructor(sampleRate)
  resetStreams()              // clear delay lines / filter state
  processBlock(inL, inR, outL, outR, numSamples)
}
```

Parameters are plain public fields, set via `Object.assign` (from a worklet
`postMessage`) — the JUCE equivalent is atomics updated from the APVTS listener.

Every core ends with the same three lines, which is where the invariant is
enforced:

```js
const m = mOut*(1-bypassMix) + M*bypassMix;              // mono path
const s = (sOut*(1-bypassMix) + S*bypassMix)*(1-monoMix); // width path
outL[i] = m + s;  outR[i] = m - s;
```

`bypassMix` and `monoMix` are per-sample 10 ms ramps, so both toggles are
click-free without needing a host-level crossfade.

## Per-effect design

### Phaser
Six cascaded first-order allpass sections, swept by one LFO, **shared by both
channels** — so the *mid path's* notch frequencies are identical in both ears
and the mono sum is width-free by construction. That is a claim about the M
chain, not about what each ear receives: once WIDTH > 0 the side term is added
to L and subtracted from R, so at the factory WIDTH 0.7 the two ear responses
differ from each other by up to 19.2 dB and from the mono sum by up to 12.8 dB,
and L peaks at +7.0 dB where the mono sum peaks at +2.1 dB (measured, frozen
LFO at 90°, DEPTH .7 FB .4 MIX 1, cross-spectrum on mono pink noise; at WIDTH 0
L ≡ R ≡ M to 0.000e+0 dB). Feedback is taken around the M chain only,
DC-blocked (a first-order allpass has `H(1)=+1`, so the cascade is zero-phase at
DC and raw feedback boosted it by `1/(1-fb)`). The chain input is *not* scaled —
full resonance runs in the chain and the level is normalised at the output by
`mk = sqrt(2(1-fb²)/(2-fb²))`, which is RMS-flat over the sweep. Width comes from the *difference between stage
1 and stage 4 output* placed in S: a genuinely decorrelated signal with the
phaser's spectral character that vanishes on sum. It must not involve stage 6 —
the mid path already carries stage 6, so a side term containing it is correlated
with the mid and WIDTH pans the image instead of widening it (measured worst
|L/R imbalance| over a 54-point grid: stages 3&6 = 4.58 dB, stages 1&4 = 0.63 dB).

### Delay
One shared delay time, cubic-interpolated read with a 50 ms glide (so time
changes pitch-bend like an analog BBD rather than clicking). The echo train
lives in the M ring. Ping-pong comes from a **second ring fed with the opposite
feedback sign**, so successive repeats alternate their side contribution and
appear to bounce L→R. Because bouncing is expressed as amplitude difference
(ILD) rather than channel routing, the mono sum still contains every repeat at
full level.

### Reverb
Eight-line feedback delay network with a Householder mixing matrix
(`A = I − (2/N)·J`), lossless before damping is applied, computed in O(N) via a
single sum. The trick is the output taps: **M is the all-plus combination of
the eight line outputs; S is the alternating-sign combination.** Those two
vectors are orthogonal, so the side tail is decorrelated from the mid tail
(wide, enveloping) while summing to exactly zero. A mono listener gets the
complete designed tail with no comb whatsoever.

### Chorus
Three voices at different base delays and LFO rates, all summed into M — mono
hears the full ensemble, which is the opposite of what a conventional stereo
chorus gives you. Width is the *voice 1 minus voice 3* difference in S, which
is where the shimmer lives. Voice 2's level is exposed as the VOICES control.

## Relationship to MonoLock

MonoLock is the other half of the same argument. Where MonoFX prevents phase
damage, MonoLock repairs it: it measures the inter-channel relationship as a
function of frequency and time, then rotates each channel's phase symmetrically
toward alignment, with a strength ceiling and an automatic per-band amount so
already-compatible content is left alone. Full algorithm in
`mono-maximizer-spec.md`.

The two share one piece of real code: **`LiveCore`**, the causal short-window
engine. It powers MonoLock's live mode *and* supplies the high-frequency band
of MonoLock's offline dual-resolution render. One causal core, two duties —
the same code-sharing shape the JUCE build should adopt for the whole suite.
