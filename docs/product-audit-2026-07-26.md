# MonoFX suite — product quality audit, 2026-07-26

Scope: all five plugins, judged as products rather than as algorithms. Does each
do what it claims, is the audio quality good, is the latency right, and what
would stop this shipping?

Every number below was produced by executing code against the sources at commit
`2dfa711`. Nothing in the repository was modified. This audit complements
`audit-2026-07-25.md`, which covered correctness; this one covers *quality*.

**Method note.** This was intended to run as a six-agent workflow. All three
attempts failed: the harness rejected every subagent tool call (101 calls, 101
errors, 94 explicit permission-handler rejections — required parameters stripped
before reaching the tool). The audit below was therefore run directly. Two
measurements in it were wrong on the first attempt and are recorded as such in
§4, because the corrections are more instructive than the results.

---

## 1. Verdict

**The central product claim is real, and the suite is in better shape than most
pre-release DSP.** Mono compatibility is structural, not aspirational: against a
worst-case conventional chorus — the topology that puts the wet signal entirely
in S — the conventional effect *vanishes completely* when summed to mono
(−337 dBFS residual; you get the dry signal back), while the MonoFX chorus
delivers its full ensemble. The phaser retains 103 % of its audible effect in
mono where a conventional one retains 83 %. All four cores are genuinely
zero-latency, bypass is bit-exact, `resetStreams()` is clean, and everything is
stable from 22.05 to 192 kHz.

**The single thing standing between this and shipping is the reverb's
calibration.** Its DECAY control reads 8–18 % long, and its output level swings
roughly 23 dB across the DECAY × SIZE space. A user cannot A/B two reverb
settings without the louder one winning, which is the classic way a good
algorithm gets dismissed in a shootout.

Everything else on the fix list is a polish item.

---

## 2. Per plugin

### Phaser — does what it claims
Mono retains **103 %** of the effect's spectral modulation (mean per-bin sd of
`|X(f,t)|`, 200 Hz–6 kHz: 6.51 dB at one ear, 6.71 dB in the sum) against
**83 %** for a conventional L/R-offset phaser (8.23 → 6.85 dB). Mono actually
hears *more* phasing than one ear does, because the ear also receives the
decorrelated side signal, which partially fills the notches. Zero latency
confirmed (best cross-correlation lag 0). Worst spurious content −77.3 dB.
Most expensive core at 1.31 % of one CPU core, still trivial.

### Delay — does what it claims, precisely
Delay time is **exact**: 0.00 ms error at 100, 250, 380, 750 and 1500 ms
settings. Ping-pong confirmed — successive repeats alternate L/R. Cleanest core
measured, worst spur −92.7 dB, and cheapest at 0.25 % CPU. One minor
calibration point: with FEEDBK at 0.600 the measured second/first repeat ratio
is 0.634 (≈0.5 dB high), an artefact of the tone filter spreading the impulse
rather than a gain error.

### Reverb — works, but is not calibrated
Mono compatibility and stability are fine, but two calibration problems:

- **T60 reads short by 8–18 %, systematically.** Measured against setting:
  0.3 → 0.25 s (−17.8 %), 1 → 0.92 s (−8.4 %), 2.2 → 1.95 s (−11.4 %),
  5 → 4.23 s (−15.5 %), 12 → 10.03 s (−16.4 %). The error is not constant, so
  it is not a single scale factor.
- **Level swings ~23 dB across the parameter space.** Tail RMS (impulse in,
  mix=1, width=0, 0.1–1.1 s window) ranges from 1.89e-4 at DECAY 0.5/SIZE 0.4
  to 2.62e-3 at DECAY 8/SIZE 2.0. The docs already admit the 1.5× makeup gain
  was guesswork; this quantifies it.

Highest spur of the three linear effects at −69.7 dB.

### Chorus — does what it claims, most convincingly of the four
This is where the thesis shows best. Tested against the true worst-case
conventional topology (`L = dry + v`, `R = dry − v`, wet entirely in S), the
conventional chorus's wet signal cancels **completely** in mono — max difference
from the dry input 1.39e-17, i.e. −337 dBFS. The MonoFX chorus differs from dry
by 0.281 in mono: the whole ensemble survives. Zero latency despite 8/14/22 ms
voice delays, because the dry path is unmodulated.

Caveat: it has the **highest spurious content** of the four (−69.5 dB worst
spur, −62.0 dB integrated), consistent with a Catmull-Rom interpolator on a
moving delay line. Audible as a slight edge on sustained pure tones. It is also
the loudest core at defaults, which is the main driver of the suite's level
inconsistency.

### MonoLock — the strongest engineering in the suite
- **Transients are untouched.** A click through the offline engine at strength
  1.0 comes out at peak 0.9000 (input 0.9000), at offset 0, with pre-ringing at
  −167 dB. For a tool that rewrites phase, this is the failure everyone expects
  and it simply is not there.
- **Gentle and monotonic on healthy material.** On a normal correlated stereo
  mix (corr 0.858), strength 0 → 1 moves correlation only to 0.864 and reduces
  S/M width by **0.20 dB**. It does not flatten material that does not need
  fixing.
- **Pathological input is safe**: digital silence, DC, one channel silent, and a
  full-scale square all produce finite output at sane levels.
- **LiveCore has no frame-boundary artefacts**: on a steady 440 Hz tone the
  maximum output sample step equals the source's exactly (ratio 1.000).
- **Offline cost is 0.81× realtime**, flat across file length (2 s → 1620 ms,
  8 s → 6490 ms). A five-minute master takes about six minutes. Defensible for
  an offline tool, but it rules out the render-on-demand plugin model feeling
  interactive.

---

## 3. Ranked fix list

1. **Recalibrate the reverb DECAY law.** T60 is 8–18 % short and the error
   varies with the setting, so the fix is a corrected mapping, not a constant.
   Users compare reverbs by setting both to "2 seconds".
2. **Normalise reverb output across DECAY and SIZE.** ~23 dB of swing means
   parameter changes are level changes. This is the single biggest obstacle to
   the reverb being taken seriously.
3. **Level-match the suite.** At defaults: chorus −0.80 dB, phaser −2.02 dB,
   delay −2.62 dB, reverb −2.76 dB relative to input. A ~2 dB jump when
   switching plugins undermines the "suite" framing.
4. **Reduce chorus spurious content**, or document it. −62 dB integrated is
   audible on sustained tones. A higher-order interpolator or 2× oversampling on
   the modulated delay is the standard fix; the docs already list oversampling
   as unmeasured work.
5. **Decide the MonoLock offline delivery model** given 0.81× realtime. ARA2 or
   explicit offline rendering; do not promise real-time.

---

## 4. Two measurements that were wrong

Recorded because the errors are the instructive part.

**A mono-fold metric that measured the wrong thing.** The first attempt scored
mono compatibility as `10·log10(|L+R|²/4 ÷ mean(|L|²,|R|²))`, and reported that
every core "COLLAPSES" — including ones whose mono-sum invariance is verified to
1e-16. With `L = m+s` and `R = m−s` that expression reduces to
`|m|²/(|m|²+|s|²)`: it is a side-to-mid ratio, so it penalises *any* stereo
width, including the intended kind. It scored width=0 as perfect and width=1 as
catastrophic, for every effect. Discarded.

**A gain blow-up that was the input's own amplitude.** MonoLock on a
one-channel-silent input appeared to produce a peak of 3.5997 from what was
assumed to be a ≤1.0 signal — an 11 dB clipping hazard. `pink(48000,5)` returns
unnormalised noise whose peak is exactly 3.5997. Processing gain was 0.00 dB.
Re-run with peak-normalised input at six pan positions from centre to fully
hard, offline gain is 0.00 dB in every case and LiveCore *reduces* peak by
2.5–2.8 dB on hard-panned material.

Both slipped through because a plausible number was accepted without a control.
The general lesson for this codebase: measure the input too.

---

## 5. Verified sound — do not re-investigate

- **Zero latency on all four MonoFX cores**, by cross-correlation against the
  dry signal: best lag 0, and correlation at lag 0 equals the maximum.
- **Bypass is bit-exact** (−600.0 dBFS null on all four) and the ramp is
  click-free: maximum output sample step during the 10 ms crossfade is
  1.00–1.21× the source's own maximum step.
- **`resetStreams()` fully clears state** on all four — a dirtied instance after
  reset is bit-identical to a fresh one (0.00e+0). Preset and session recall
  will not carry state.
- **No dead parameter quartiles.** Every parameter of every core was swept in
  quartiles and produces an audible change across its whole declared range.
- **Stable at every sample rate from 22.05 to 192 kHz**, no non-finite output,
  peaks 0.50–0.85.
- **CPU is not a concern**: phaser 1.31 %, chorus 0.83 %, reverb 0.69 %, delay
  0.25 % of one core (JS reference; C++ will be far cheaper).

---

## 6. Coverage gaps — these are unaudited, not clean

- **Nobody has listened to any of it.** Every judgement here is numeric. The
  reverb's *character* (does 8 lines sound like a room or like discrete echoes?),
  the chorus's musicality, and the phaser's sweep feel are unassessed. Echo
  density and modal distribution were not measured.
- **Aliasing at extreme settings** was characterised only on a 1 kHz tone at
  default parameters. Fast LFO rates and maximum depth were not probed, and
  there is no oversampling analysis.
- **MonoLock's documented recovery figures** (0.197→1.000, −1.000→0.992, etc.)
  were not independently re-derived here; they are covered by `npm test`, which
  is green at 80 assertions.
- **The C++ port was not re-audited**; it is covered by the differential harness
  (64/64 cases, 12/12 invariants).
- **No plugin layer exists to test.** Automation, state recall, preset handling,
  host latency reporting, and PDC behaviour are all untested because none of it
  is written.
- **No multi-instance, long-session, or denormal-stress testing** of the kind a
  real host imposes.
