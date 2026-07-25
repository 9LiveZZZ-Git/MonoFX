# Mono Compatibility Maximizer — Technical Specification

**Working title:** MonoLock (placeholder)
**Version:** Spec v0.5 — July 2026 (adds live mode with shared causal core, onset-aligned segmentation, Δ(f) anchor smoothing, dual-resolution HF path, measured final verdict; all figures validated against the web prototype)
**Author:** Luc
**Category:** Stereo utility / phase correction
**Formats:** VST3, AU (CLAP optional later) — built with JUCE 8

---

## 1. Purpose

A set-and-forget stereo processor that guarantees a fully mono-compatible output: no inter-channel phase misalignment survives that would destructively interfere on mono summation. Philosophy: **maximizer with minimum intervention** — the engine measures where the program is already mono-safe and leaves it untouched, and rotates only where misalignment actually exists. The Strength knob is a *ceiling* the engine works under, not a force it applies.

Design constraints:

- Fully automated. One user-facing control.
- No destructive interference in the mono sum under any program material.
- Already-compatible material passes **bit-transparent at any Strength setting** (verified: ≤ −120 dBFS null on identical channels at 0/50/100%).
- Stereo image preserved where it is already mono-safe (level panning); phase-based width is converted to ILD, not deleted.
- Deterministic: identical input produces identical output.

---

## 2. Signal Flow

```
In L/R ──► [Stage 1: Broadband Pre-Alignment] ──► [Stage 2: Two-Pass Spectral Phase Unification] ──► [Stage 3: Width Restoration] ──► Out L/R
                    │                                     │
              lag estimate                     PASS 1: whole-file analysis
              (GCC-PHAT)                       PASS 2: apply (seeded converged)
                                               PASS 3: verify & refine (closed loop)
```

The engine is **two-pass** because the product processes a *sample*: causality is optional, so analysis runs over the whole file first and application starts fully converged from sample zero. §8 defines how this maps onto the streaming plugin build.

---

## 3. Stage 1 — Broadband Pre-Alignment

Unchanged from v0.1 and validated (recovers a 5 ms inter-channel offset to sub-sample accuracy):

| Item | Spec |
|---|---|
| Lag estimator | **Tracked**: windowed GCC-PHAT (0.5 s windows, 0.25 s hop) with per-window confidence, hold-last-good fill, and 3-point median filtering |
| Search range | ±20 ms per window |
| Sub-sample resolution | Parabolic peak interpolation, ≤ 0.05 samples |
| Delay line | Constant path: cubic fractional delay. Drifting path: **time-varying cubic fractional delay** on per-sample linear interpolation of the track |
| Stability policy | Track span < 1 sample collapses to the constant-lag path (preserves null behavior exactly); no confident window anywhere → passthrough |
| Validated | 0→8 ms linear drift recovered: corr 0.349 → 0.927, track span 6.6 ms |

---

## 4. Stage 2 — Two-Pass Spectral Phase Unification

### 4.1 Geometry (temporal + spectral oversampling)

| Item | Spec |
|---|---|
| Analysis window W | √Hann, 2048 @ ≤50 kHz / 4096 @ ≤100 kHz / 8192 above (constant ≈43 ms) |
| FFT size | **2·W (2× zero-padded)** — spectral oversampling sharpens peak localization and phase estimates; the pad region doubles as guard space absorbing the circular-convolution tail of per-bin gain changes |
| Hop | **W/8 (87.5 % overlap)** — temporal oversampling smooths rotation trajectories and gives the slew limiter fine granularity |
| Synthesis | √Hann of length W applied to the un-padded region of the IFFT; OLA normalization = **4.0** (Hann COLA sum at hop W/8) |

### 4.2 Pass 1 — whole-file analysis (no audio output)

Runs at hop W/4 (analysis needs no dense hops). **Onset-aligned segmentation:** cross-/auto-spectra accumulate in 0.25 s micro-blocks (max 128); per-block band-phasor signatures are compared against the running segment, and a signature jump (distance > 0.45) opens a new segment (max 32). Whole-file sums derive from the merged segments. **Δ(f) anchor smoothing:** each segment's complex cross-spectrum is frequency-smoothed (3× box blur, ±3 bins) — since |S_LR| ≈ coherence·energy, complex blurring is anchor-weighted circular interpolation: low-coherence bins inherit Δ from nearby confident bins. Per bin *k* in float64:

- **Per-segment and whole-file cross-spectrum** `A_LR[k] = Σ_f L·conj(R)`, plus auto-spectra `A_LL`, `A_RR`. Segment means become non-causal anchors for pass 2 (§4.3), handling material whose stereo relationship changes over time (dry body vs FX tail, mid-file phase flips).
- **Whole-file coherence** `C₁[k] = |A_LR|² / (A_LL·A_RR)` and **mean phase offset** `Δ₀[k] = ∠A_LR`.
- **Noise floor** `floor[k]` via minimum statistics: running minimum of 50 ms leaky-smoothed bin power.
- **Per-band correlation** (24 log bands, 40 Hz–20 kHz) → **auto-strength profile**:
  `autoS[b] = 1 − smoothstep(0.90, 0.98, bandCorr[b])` — bands already ≥ 0.95 correlated receive no rotation.

### 4.3 Pass 2 — application (seeded fully converged)

All leaky estimators are initialized from pass-1 statistics; per-bin rotation state is pre-seeded at its target. There is no warm-up transient anywhere.

**Rotation rule (cross-spectrum target).** Instantaneous phases never steer the rotation. Per bin:

- Leaky cross-/auto-spectra (τ = 80 ms) update with **SNR-adaptive rate**: `α_eff = α · smoothstep(2, 8, power/floor[k])`. Silent or near-floor bins freeze their estimates entirely.
- Steering estimates (gate coherence and Δ) blend the live leaky state with a **segment prior** (35 %), crossfaded to the neighboring segment only within ±0.25 s of the detected boundary — never center-to-center, which was measured to smear the transition. Seeding at frame 0 uses segment 0. Validated: a mid-file in-phase→anti-phase flip, invisible to whole-file statistics (global coherence ≈ 0), is detected as exactly 2 segments and recovers 0.037 → 0.747.
- The inter-channel phase offset is tracked as a **continuous (unwrapped) angle** `Δc[k]` following `∠S_LR` — complex-domain smoothing has no wrap discontinuity, and per-bin unwrapping keeps the applied rotation branch-stable at the ±π boundary.
- Applied rotation is the **symmetric split**: `rot_L = −Δc/2 · amt`, `rot_R = +Δc/2 · amt`, with `amt = gate(C) · Strength · autoS[band]` and gate = smoothstep(0.25, 0.6) on magnitude-squared coherence.
- **Circular slew limiting**: rotation angles slew along the shortest arc, ≤ π rad per 20 ms. (Linear slew on a circular quantity is a verified failure mode — see §9.)
- **Identity phase locking, main-lobe scoped**: per-frame spectral peaks are detected on the combined magnitude; bins within ±4 bins of a peak (the 2×-oversampled Hann main lobe) inherit the peak's rotation. Distant bins compute their own — full-region locking is verified too coarse for broadband material.
- **Multiband transient freeze**: spectral flux is computed in 4 frequency groups (splits at 200 Hz / 1.2 kHz / 5 kHz), each with its own 200 ms running median; flux > 2× median freezes rotation only in that group's bins — an HF attack no longer freezes the bass.
- **Silence hold**: bins below an absolute magnitude epsilon keep rotation state untouched (the SNR gate makes this nearly redundant; it remains as a guard).
- **DC & Nyquist** (real-valued bins): sign alignment toward sign(L+R), linearly interpolated by Strength. Not optional — LF-heavy material carries real energy at DC.

At full amt the mono sum recovers systematic misalignment completely; instantaneous deviations from the mean offset are, by construction, the incoherent residue the gate protects.

---

### 4.4 Pass 3 — verify & refine (closed loop)

After each render, per-band post correlation is measured (already accumulated in-loop, zero extra cost) and checked against a **strength-scaled target** `T[b] = bandCorrPre + (0.95 − bandCorrPre)·Strength`. Bands that miss by > 0.02, carry meaningful energy (≥ −60 dB of the loudest band), and are classified *fixable* (energy-weighted coherence ≥ 0.35) get three levers pulled and the render repeats:

1. `autoS[b] → 1` (full depth),
2. coherence gate relaxed (`lo ×0.5`, `hi ×0.6`, floored),
3. **main-lobe locking disabled** and **slew rate ×4** for that band — the levers verified to actually move results; gate relaxation alone measurably does not, because gates rarely bind on real material.

Bounded at 3 rounds with **no-progress detection**: a band improving < 0.01 per round is marked ceiling-limited and never fought again (incoherent content cannot be made to correlate without destroying it — its ceiling is its coherent energy fraction). Fast path: material passing round 1 costs nothing extra.

**Verdict semantics:** the safety criterion is *non-destructive summation*, not the maximizer target. A band is reported destructive only if post correlation < −0.1 (below statistical flutter of finite incoherent content). Incoherent bands at low positive correlation sum power-wise and are mono-safe by nature. Deliberately low Strength on misaligned material correctly produces a "destructive bands remain" warning.

### 4.5 Consistency pass (Griffin-Lim style, single iteration)

Heavily rotated renders (rotation-weighted magnitude fraction > 2 %) get one spectral-consistency iteration: the engine re-runs the frame processing to reconstruct target magnitudes on the fly (no stored-spectra memory cost), takes phases from a re-analysis of the rendered output, and re-synthesizes — reducing overlap-add inconsistency from fast-varying per-bin gains. Two guards: it is skipped when measured inconsistency < 0.1 % (transparent/null paths never touch it), and the result is **adopted only if output correlation is preserved within 0.01** — consistency must never cost mono compatibility. Validated: adopted on anti-phase and rotated-noise renders (inconsistency 0.20 / 0.10), automatically rejected on the mid-file-flip signal where boundary re-analysis would smear phases.

### 4.6 Dual-resolution HF path

Heavily rotated renders additionally run the whole (stage-1-aligned) signal through the **causal short-window core** (512-pt, hop 128 — the same `LiveCore` that powers live mode), warmed by one full preliminary pass over the file. A zero-phase complementary FFT crossover (1.8–3.5 kHz) takes LF from the long-window render and HF from the short engine — LF phase resolution and HF transient handling simultaneously. Adoption-guarded like the consistency pass (output correlation within 0.01); skipped entirely on transparent/null paths. Validated: drift test improved 0.919 → 0.927.

### 4.7 Measured final verdict

Band correlation for the verdict and the UI strip is measured by an analysis-only sweep of the **actual final output** (post-consistency, post-dual-res), never taken from intermediate render accumulators.

## 5. Stage 3 — Width Restoration

Psychoacoustically mapped: per bin, `g = 1 + w(f)·sin(min(|Δc|, π/2))·amt` with `w(f) = 0.5·smoothstep(200 Hz, 700 Hz, f)` — phase width is converted to ILD only in the range where ILD actually localizes; below 200 Hz nothing is converted (mono bass is the desirable outcome there). Applied as an ILD boost to the louder channel, energy-renormalized per bin. Band-activity classification in verification is **A-weighted**, so inaudible spectral extremes never drive refinement. Level-panned width passes through untouched.

---

## 6. Controls, UI, Metering

| Control | Range | Default | Behavior |
|---|---|---|---|
| **Strength** | 0–100 % | 100 % | Ceiling on `amt`; interpolates rotation geodesically. With auto-strength active, 100 % on clean material is still transparent. |
| Mono audition | toggle | off | (L+R)/2 on both outputs, post-processing; goniometer follows (trace collapses to mid axis) |
| Mode switch | STUDIO / LIVE | STUDIO | Top of the faceplate; LIVE runs the causal core with Learn/Freeze and sample-loop or microphone input |
| Live window | 512 · TIGHT / 1024 · HQ | 512 | 10.7 vs 21.3 ms latency (exactly W, constant across host block sizes); bass-mono crossover fixed at 180 Hz for both; engine rebuilt seamlessly on toggle |
| A/B monitoring | toggle | original | **Loudness-matched**: processed side gain-compensated to the original's stereo RMS (±6 dB clamp) |
| Export | button | — | 16-bit stereo WAV render of the studio output |
| Bypass | toggle | off | Latency-compensated |

Metering: pre/post correlation (±1, 300 ms ballistics), detected lag readout, mono-sum gain readout, 24-band pre/post correlation strip, goniometer. Status line reports window/FFT size, render rounds, and the verification verdict (\"no destructive bands\" / \"N destructive band(s) remain\").

---

## 7. Latency, Performance, Edge Cases

| Item | Spec |
|---|---|
| Latency (streaming build) | 20 ms (stage-1 lookahead) + W samples ≈ **62.7 ms @ 48 kHz**; hop density does not add latency. The live core alone is exactly W (10.7 ms at 512). |
| CPU (streaming) | ≤ 4 % of one core @ 48 kHz (2× frame rate and 2× FFT size vs v0.1; 4 FFTs of 2·W per hop) |
| Offline throughput | Prototype reference: ≈ 0.4× realtime in JS; native target ≥ 10× realtime |
| Determinism | Two-pass render is exactly reproducible; verified identical across runs |
| Mono input | Transparent passthrough |
| Anti-phase mono (L = −R) | Recovered via symmetric ±π/2 split; singularity-free (cross-spectrum target is real-negative, not undefined) |
| Digital silence gaps | Rotation state holds through gaps; verified on impulsive material with true zeros between hits |

---

## 8. Plugin (JUCE) Architecture — mapping two-pass to streaming

```
Source/dsp/
  PreAligner        — GCC-PHAT + fractional delay + lag hysteresis/slew
  StftEngine        — W-window, 2W zero-padded FFT, hop W/8, OLA (÷4)
  Analyzer          — pass-1 accumulators: cross-spectrum, min-stats floor, band corr, autoS
  PhaseUnifier      — Δc tracking, SNR-adaptive estimators, circular slew,
                      main-lobe locking, transient freeze, rotation apply
  WidthRestorer     — |Δc| → ILD
  CorrelationMeter  — lock-free FIFO to UI
```

Two operating modes sharing the identical DSP chain:

- **Offline render / ARA-style:** true two-pass, exactly the prototype.
- **Live streaming (implemented in the prototype as `LiveCore`):** **selectable window** — 512-pt (TIGHT, 10.7 ms latency) or 1024-pt (HQ, 21.3 ms) — √Hann, hop W/4 (75 % overlap); I/O runs through a staging FIFO, primed with `hop` zeros so the latency is exactly W for **any** host block size and the output is bit-identical across quanta from 32 to 8192 samples. The forced bass-mono crossover is a fixed 180 Hz at both windows and every sample rate; it is switchable via `bassMono`, because collapsing bass unconditionally also collapses genuinely decorrelated bass (it pulled the suite's own `wide` case from 0.288 to 0.606; with it off the rotation path alone leaves that material at 0.291). Leaky-only estimators (τ = 80 ms) with the identical cross-spectrum rotation core, circular slew, and psychoacoustic width; below ~150 Hz phase is not measured at all — a **forced bass-mono crossover** (120–180 Hz blend) guarantees LF compatibility where a short window cannot resolve phase. Learn/Freeze toggles estimator updates; bypass is latency-matched and click-free (10 ms ramps). Runs as an AudioWorklet (ScriptProcessor fallback) fed by the loaded sample or live microphone input. Validated headless in 128-sample quanta: anti-phase −1.000 → 0.986 (512) / 0.988 (1024), identical-channel null −122.9 dBFS at both windows, bit-identical determinism. The same class is reused verbatim as the offline dual-resolution HF path — one causal core, two duties, which is precisely the code-sharing shape the JUCE build should adopt.

Build order: StftEngine + null test → Analyzer → PhaseUnifier on test signals → PreAligner → WidthRestorer → UI.

---

## 9. Validation Matrix (updated with prototype findings)

| Test signal | Pass criterion | Prototype result |
|---|---|---|
| Identical L=R, Strength ∈ {0, 50, 100 %} | Null ≤ −120 dBFS at **every** Strength | −122.9 dBFS ✔ |
| L=R with 5 ms offset | Lag within ±0.1 smp; corr → 1.0 | −5.00 ms, 1.000 ✔ |
| L = −R steady noise | corr ≥ +0.99 | 0.997 ✔ |
| L = −R impulsive, **true digital silence between hits** | corr ≥ +0.99 (freeze/hold interaction) | 0.998 ✔ |
| Allpass phase-rotated noise | corr ≥ 0.98 full; monotonic vs Strength | 0.987 / 0.808 @ 50 % ✔ |
| Panned tones + independent noise | corr change ≤ 0.1; deviation ≤ −20 dBFS | Δ 0.03, −22.3 dBFS ✔ |
| 96 kHz material | Correct W/FFT selection; corr ≥ 0.98 | 4096/8192, 0.983 ✔ |
| Offline vs repeated render | Sample-identical | ✔ |
| Ceiling-limited coherent material (allpass noise) | Refinement measurably improves then stops on no-progress | 0.935 → 0.946, corr 0.994 ✔ |
| Coherent + independent-noise blend | Converges toward coherence ceiling, no destructive verdict | 0.634 → 0.645 (ceiling ≈ 0.74) ✔ |
| Anti-phase @ 25 % Strength | Destructive warning fires (honest low-strength reporting) | 24 bands flagged ✔ |
| Linearly drifting delay (0→8 ms) | Lag track follows; corr ≥ 0.9 | 0.349 → 0.927, span 6.6 ms ✔ |
| Mid-file phase-relationship flip | Segment priors recover what whole-file stats cannot (global C ≈ 0) | 0.037 → 0.720 ✔ |
| Consistency pass on null/transparent paths | Never fires | ✔ (−122.9 dBFS nulls preserved) |
| Live core: anti-phase noise | corr ≥ 0.98 through the causal engine | 0.986 (512-pt) / 0.988 (1024-pt) ✔ |
| Live core: measured latency | exactly W: 512 = 10.7 ms, 1024 = 21.3 ms, identical at every host block size from 32 to 8192 | ✔ (empirical lag detection) |
| Live core: identical channels | Null ≤ −120 dBFS (bass-mono of identical = identity) | −122.9 dBFS ✔ |
| Dual-res path on null/transparent paths | Never fires | ✔ |

**Regression tests derived from found defects** (each was a real bug in the prototype):

1. Rotation slew must be **circular** — targets at the ±π boundary flip sign per frame via rounding; linear slew drags rotation through zero.
2. OLA constant must match the actual COLA sum — Hann @ 75 % is 2.0, @ 87.5 % is 4.0 (a wrong constant is a silent gain error that also corrupts metering).
3. DC/Nyquist must be processed — untouched real bins measurably break correlation on LF-heavy material.
4. Estimators must never chase phases of silence — atan2(0,0) targets combined with transient freeze put garbage rotation exactly on attacks. (Structurally solved by cross-spectrum targets + SNR gating.)
5. Refinement levers must be verified to have travel — coherence-gate relaxation alone moved band correlation by < 0.001 (gates already saturate near 1 on real material); locking-off and slew relaxation are the levers that measurably act.
6. The safety verdict must not count statistical flutter — incoherent bands fluctuate around 0 correlation on finite samples; the destructive threshold sits at −0.1.
7. Post-processing "enhancement" stages must be adoption-guarded against the primary objective — the consistency pass measurably improves some renders and measurably harms others (phase-flip boundaries); it is kept only when output correlation survives within 0.01. The same guard now covers the dual-resolution combine.
8. Segment priors must crossfade in a fixed window around the detected boundary — interpolating between segment centers smears the transition across the whole inter-center span (measured: 0.709 vs 0.747 on the flip test) and gets worse the better the boundary detection is.

---

## 10. Roadmap (post-v1)

- **v1.1:** per-band correlation strip in the plugin UI; width-recovery depth as an advanced setting; Learn button UX for live mode.
- **v1.2:** "Transparent" mode (Δφ clamp to ±90°) sharing the engine; auto-strength target exposed (0.90–0.99).
- **v2:** sidechain reference alignment (align a stereo track to a reference); forced bass-mono crossover; CLAP build.
