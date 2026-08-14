# Tenebrae Writer — Step 1 Certification Report

**Date:** 2026-08-14
**Artifact:** `tenebrae/step1.html` — sha256 `3e993df2e43c855fc2a93183ef8a9ba4bf790293890600e0b4481035bfc63235` (4,234 lines)
**Standard:** `tenebrae/certification/step1-requirements.md` (42 Baseline A requirements, 5 Baseline B deviations)
**Method:** 14-agent certification workflow (`.claude/workflows/certify-tenebrae-step1.js`) — 5 static code auditors + 6 functional testers driving the real app in headless Chromium (45 Playwright probes, kept in `harness/probes/`), followed by an adversarial stage that attempted to refute every pass claim, refute every fail claim, and audit the checklist itself. 80 findings, 84 recorded anomalies, zero agents lost.

---

## Verdict

**Step 1 is NOT yet certified complete in full.**

**36 of 42** Baseline A requirements pass with converging static + functional evidence, upheld under adversarial re-testing. **Six requirements fall short** — one outright failure and five partials — all with pinpointed root causes and small prescribed fixes. All five Baseline B deviations from the spec MVP are confirmed real and accurately disclosed in-app.

What passed is genuinely strong: the entire manuscript structure (ST-1..5), nearly all of the editor (ED-2..7), the cards system end to end (CD-1..6), compile options and rich copy/share (EX-1, EX-4, EX-6), the whole import pipeline including the author's real 50,339-word manuscript (IM-1..4), translation determinism across all seven tongues and across reloads (TR-1..4, TR-6), and every architectural principle (PN-1..3 — zero AI surface, zero network code paths, no lock-in). The app threw **zero page exceptions** across every probe flow except one specific codex-related boot path (see Gap 5).

Certification will be granted when the six gaps below are closed and the workflow is re-run green.

## Scoreboard

| Area | Result |
|---|---|
| ST — Manuscript structure | **5/5 pass** |
| ED — Editor | 6/7 pass — ED-1 partial |
| PR — Offline persistence | 4/5 pass — PR-4 partial |
| CD — Cards / world-wiki | **6/6 pass** |
| EX — Compile & export | 3/6 pass — EX-2 partial, **EX-3 fail**, EX-5 partial |
| IM — Smart import | **4/4 pass** |
| TR — Translation layer | 5/6 pass — TR-5 partial |
| PN — Principles (no AI, deterministic, no lock-in) | **3/3 pass** |
| DV — Spec-MVP deviations (report-only) | 5/5 accurately disclosed |

Adversarial stage outcomes worth noting: two auditor partials were **overturned to pass** on stronger evidence (PR-1, PR-5 — the functional demonstrations were conclusive), and one static pass was **overturned to partial** (EX-5 — the static auditor missed a code path a probe then proved leaks glyphs). Every other verdict was independently re-tested and upheld. The adversarial stage worked as designed in both directions.

---

## The six gaps

### Gap 1 — EX-3 **FAIL**: plain-text export destroys paragraph structure
Every scene body in a `.txt` export (book and single-scene) collapses into one unbroken run, fusing words across block boundaries: a two-paragraph scene exports as `first paragraph ends heresecond paragraph starts here`. Chapter/book titles and ⁂ separators survive only because `compile()` adds its own newlines.

- **Root cause:** `plainFromDoc` (L1954–1960) reads `textOf()` on a **detached** element; `textOf` (L886–887) short-circuits to `el.innerText`, and per the HTML spec `innerText` on an unrendered element returns `textContent` — no block separators. The block-aware walker at L888–899 is dead code for elements. Proven in-page: detached `<p>One.</p><p>Two.</p>` → `One.Two.`; attached → `One.\n\nTwo.`.
- **Blast radius:** also taints the `text/plain` clipboard flavor of "Copy for Apple Notes" (L2084) and the share fallback. Word counts are *not* affected (they pass a DocumentFragment, which takes the correct walker path).
- **Fix:** make `plainFromDoc` walk blocks and emit `\n` after each block tag on the detached clone (or attach the node before reading `innerText`).
- **Evidence:** `probes/ex-plaintext.mjs`, independently reproduced by `probes/vf-ex3-plaintext.mjs`.

### Gap 2 — EX-2 partial: markdown export mishandles the first line of every scene; titles never escaped
The md mapping is otherwise correct and complete (verified: `#`/`##`/`###` structure, `**`/`*`/`~~`/`<u>` marks, `>` quotes, `-`/`1.` lists, ⁂ separators, body escaping of `` \ ` * _ ``). Two defects:
1. **First-line marks are dropped and the line fragments.** The first typed line of a fresh scene stays a bare top-level text run (Chromium never wraps it in `<p>`; the sanitizer preserves top-level inline nodes). `mdFromDoc`'s fallback (L1950) serializes such runs via `mdInline(n)`, which maps only children's tags — bold on the first line vanishes and the line splits into one paragraph per node. Control test: identical content on a wrapped line 2 exports perfectly.
2. **Book/chapter/scene titles are concatenated raw** (L1969/L1976/L1985/L2000) — a title containing `*`, `#`, or `` ` `` corrupts the markdown. Body escaping also omits `~`, line-leading `#`/`>`/`-`/`N.`, brackets, and raw `<`/`&`.
- **Fix:** wrap bare top-level runs in `<p>` during sanitize (this also fixes half of Gap 3), and pass titles through `mdEscape`.
- **Evidence:** `probes/ex-md-mapping.mjs`, `probes/ex-md-firstline.mjs`, `probes/vf-ex2ex5-firstline.mjs`.

### Gap 3 — EX-5 partial: translation spans on a scene's first line leak raw PUA glyphs into markdown
The tspan export path is well designed — romanization wrapped in `<!--tenebrae:begin {language,source}-->…<!--tenebrae:end-->` comments (with `--` escaping so source text can't break the comment), round-tripped back to live spans on import, source retained losslessly in-app, `.txt` clean. But a span inserted into the scene's **first line** (the same bare top-level run as Gap 2) falls into the L1950 fallback, which serializes the span's PUA `textContent`: the `.md` gets raw glyph junk and no romanization — exactly what EX-5 prohibits.
- **Fix:** same as Gap 2 — wrap top-level runs; or teach the fallback to route `.tspan` through the tspan serializer.
- **Evidence:** `probes/ex-translation-export.mjs` (wrapped path passes), `probes/ex-md-firstline.mjs` + `probes/vf-ex2ex5-firstline.mjs` (first-line leak), `probes/vp-ex5-span-export.mjs` (both-scope romanization verification incl. RTL Kerrackian).

### Gap 4 — ED-1 partial: the visibility flush loses the last sub-debounce burst of typing
Autosave itself is solid (typed prose lands in IndexedDB after the 450 ms editor debounce and survives reload verbatim; no save button needed). But `flushSave()` (L992–995), called on `visibilitychange`/`pagehide` (L996–997), snapshots `state` **without first calling `persistEditor()`** — keystrokes younger than the 450 ms debounce at hide time are absent from the flushed write. On a phone this loses the last moments of typing whenever the OS discards the backgrounded page. Proven with no reload race: at hide time the text was in the editor DOM but not in the flushed IndexedDB write.
- **Fix (one line):** have the hide handlers (or `flushSave` itself) call `persistEditor()` + `persistCard()` first — exactly what the manual Cmd+S path already does (L4144).
- **Evidence:** `probes/st-editor-save.mjs`, independently confirmed by `probes/vf-ed1-flush.mjs`.

### Gap 5 — TR-5 partial: the codex import surface has one dead arm and three real defects
The heart of it works: JSON Codex Packs import through the pure UI (badge clears, FontFace registers, spans re-render from source, removal restores the sample engine), and the **real 3.4 MB Codex Omnilingua HTML** boots inside the app's iframe with full determinism across repeats and reloads — 6 tongues awake. Four defects remain:
1. **The ZIP/`.codexpack` arm can never succeed** (dead code): L2661 passes a `Uint8Array` to `unzipAll`, whose first statement `new DataView(buf)` (L3551) throws for non-ArrayBuffer; independently, L2662–2668 treat `unzipAll`'s `Map` return as an array of `{name,data}` objects (`Map` has no `.find`). Every ZIP import toasts "Couldn't read that pack."
2. **The codex picker can't pick the codex:** `#codex-input` `accept` (L867) omits `.html`/`text/html`, though the codex HTML is the advertised primary path — accept-enforcing pickers (iOS, the app's declared target) can't select it, and the manuscript importer that *does* accept `.html` would parse a codex as a manuscript.
3. **Unhandled TypeError on every boot with an HTML codex installed:** `codexFontCSS` (L2600) does `codex.languages.map`, but the omni-host pack has no `languages[]` — the only page exception observed anywhere in certification.
4. **The wake budget is effectively halved:** two interleaved 60 ms poll chains (L2334/L2337) share `ensureOmni`'s 250-try counter, and failed attempts leak fully-booted ~9 MB iframes. Adversarial re-testing corrected the initial diagnosis: the real codex wakes through the pure UI in **0.5 s** when its external font `@import` fails fast (true-offline behavior); it only exceeds the ~7.5 s effective budget when that request *hangs*.
- **Fixes:** pass the ArrayBuffer and consume the `Map` correctly (or drop the ZIP arm from step 1 scope and the standard); add `.html,text/html` to the accept list; guard `codexFontCSS` for `kind:'omni-host'`; single poll chain + teardown of orphaned iframes.
- **Evidence:** `probes/tr-codex-import.mjs`, `probes/tr-codex-zip.mjs`, `probes/vf-tr5-omni-boot.mjs`, `probes/vf-tr5-wake-mechanism.mjs`.

### Gap 6 — PR-4 partial: an imported codex can attempt an external network request
The artifact's own code is conclusively network-free: the static sweep found zero `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/external URLs in all 4,234 lines, and a full functional session (boot → create → type → translate → export → backup → reload) observed exactly two requests, both the local `step1.html` load. But the imported codex HTML carries a Google Fonts `@import`, and the app hosts it in an iframe whose `sandbox="allow-scripts allow-same-origin"` does not block network — the running app was observed attempting `https://fonts.googleapis.com/css2?family=JetBrains+Mono…` after a real codex import. It fails harmlessly when truly offline, but "zero runtime network requests of any kind" does not fully hold in an advertised step-1 flow.
- **Fix:** inject a `Content-Security-Policy` meta (e.g. `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'unsafe-inline'`) into the srcdoc during `omniPatchHTML`, or strip external `@import`/`url(http…)` references on import. Related hardening (anomaly, not a gap): the same-origin sandbox gives imported HTML full app-storage access — a CSP also narrows that exposure.
- **Evidence:** `probes/st-offline-network.mjs` (app-only: pass), `probes/vf-pr4-codex-network.mjs` (codex leak).

---

## Baseline B — deviations from the spec MVP (all confirmed, all disclosed)

| | Deviation | Assessment |
|---|---|---|
| DV-1 | Single-file HTML + contenteditable + sanitizer instead of React/TipTap/Vite | Real; disclosed in header + About sheet; no Baseline A behavior suffered except the bare-first-line wrapping defect (Gaps 2–3), which is the cost of not having ProseMirror's schema — the fix is small |
| DV-2 | DOCX export deferred | Real; disclosed on every export sheet |
| DV-3 | EPUB export deferred | Real; disclosed on every export sheet |
| DV-4 | No service worker / manifest | Real; the single file is its own offline artifact; A2HS meta tags present |
| DV-5 | No OPFS — everything incl. imported codex + fonts in IndexedDB | Real; in-memory fallback + storage-persist request in place |

## Notable non-blocking anomalies (from 84 recorded)

Worth fixing alongside the gaps, none block certification:
- **Backup doesn't round-trip an imported codex** — `backupAll` exports only `state`; the codex engine HTML lives under the separate `codexEngine` key, so restore on a fresh device loses the codex (spans keep source text and re-render once re-imported).
- Restore skips boot's field-by-field migration normalization — a hand-edited or older backup could install un-normalized state.
- `idbOpen`'s 2.5 s safety timeout can theoretically race a slow-opening IndexedDB into a memory-only session that looks normal.
- Sanitizer emits `<ul>/<ol>` nested inside `<p>` after list commands (parse-unstable HTML; self-heals next save).
- ⁂ insertion mid-word splits the word; caret lands before the break.
- Inserted translation spans append an NBSP → double space in exports.
- Rath-Speech is sample-only; under a real codex it silently remaps to Celan Basic.
- `graph.json` names its node array `cards` (fine, but consumers should know) and embeds a timestamp, so repeated exports differ byte-wise.
- Card-screen quirk: tapping a "Mentioned in" row while the notes field has focus is swallowed by the blur re-render.

## Standard v1.1 — holes the coverage critic found in the checklist itself

The next certification run should extend the standard with: **(a)** an explicit Baseline B entry for **in-editor alias auto-linking** (`cardMention` spans in prose) — the spec MVP demands it, the artifact ships only out-of-editor mention lists, and no requirement currently owns that scope change (the most significant hole); **(b)** import graceful-degradation behaviors (40 MB cap, `.doc` rejection guidance, `.json`→restore routing, missing-DecompressionStream fallback); **(c)** the per-book paragraph-style option; **(d)** the desktop layer (context menu, Cmd/Ctrl shortcuts); **(e)** codex pack *export* (ships, uncovered by PN-3); **(f)** sample-codex font registration/rendering at boot; **(g)** the `window.tenebrae` console API surface; **(h)** theming + A2HS meta behavior.

## Reproduction

```
cd tenebrae/certification/harness && npm install   # playwright-core; Chromium at /opt/pw-browsers/chromium
node probes/<any-probe>.mjs                        # each probe self-serves the app on an ephemeral port
```
Re-run the full certification via the `certify-tenebrae-step1` workflow after any change to `step1.html` (external inputs referenced from outside the repo: the author's manuscript `.docx` and the 3.4 MB codex HTML — both deliberately uncommitted).

**Certification run stats:** 14/14 agents completed · 80 findings · 84 anomalies · 45 probes · 496 tool uses · ~92 minutes.
