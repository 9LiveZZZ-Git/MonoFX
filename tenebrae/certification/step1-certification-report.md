# Tenebrae Writer — Step 1 Certification Report

**Date:** 2026-08-15
**Artifact:** `tenebrae/step1.html` — sha256 `48f0916f77fae982fc72a928605417e17c6e172c417b2cb97595bdcde0f685e6` (4,320 lines)
**Standard:** `tenebrae/certification/step1-requirements.md` (42 Baseline A requirements + 5 Baseline B deviations)
**Method:** the `certify-tenebrae-step1` workflow — 5 static code auditors + 6 functional Playwright testers driving the real app in headless Chromium, then an adversarial stage (refute every pass, refute every fail, coverage critic). Run five times across five artifact revisions.

---

## Verdict

**Step 1 is CERTIFIED COMPLETE IN FULL.**

In the final certification run, **all 47 findings (42 Baseline A requirements + 5 Baseline B deviation reports) pass**, every pass was re-tested and **upheld by the adversarial stage**, all 14 agents completed, and zero page exceptions were observed in any probe. All five deviations from the spec's MVP are real, disclosed in-app, and accepted as declared scope.

This verdict was not reached by grading on a curve. It took five certification rounds and **11 real defects found, fixed, and re-verified** — each round's adversarial layer dug deeper than the last, and certification was only issued when a full run came back with nothing left to find.

## The road to certification

| Run | Artifact | Result |
|---|---|---|
| 1 | `3e993df2` (original) | 36/42 pass — **6 gaps** |
| 2 | `8b20d9a0` (6 fixed) | All 6 fixes upheld — **2 new gaps** |
| 3 | `ed617a45` (8 fixed) | Both fixes upheld — **2 new gaps** (1 auditor lost to infra error) |
| 4 | `dcbebf3d` (10 fixed) | All upheld, lost coverage restored — **1 new gap** |
| 5 | `48f0916f` (11 fixed) | **All pass, all upheld — CERTIFIED** |

### The 11 defects found and fixed

1. **EX-3** — Plain-text export fused every paragraph of every scene (`plainFromDoc` read `innerText` of a detached element, which has no block separators). Also tainted rich copy's plain flavor.
2. **EX-2a** — Marks on the first typed line of a scene vanished in markdown export and the line fragmented (bare top-level run + child-only fallback serializer). Fixed structurally: the sanitizer now wraps stray top-level runs in `<p>`.
3. **EX-5** — A translation span on a scene's first line leaked raw PUA glyphs into `.md` with no romanization (same root cause as EX-2a).
4. **ED-1** — The `visibilitychange` flush snapshotted state without pulling in-flight editor keystrokes, losing the last sub-debounce burst of typing on page discard.
5. **TR-5** — Four codex-import defects: the ZIP pack arm was dead code (ArrayBuffer/Map contract mismatch), the picker's `accept` filter excluded the codex HTML itself, an installed HTML codex threw an unhandled TypeError on every boot, and a doubled poll chain halved the engine wake budget while leaking ~9 MB iframes on failure.
6. **PR-4** — An imported codex's Google-Fonts `@import` could attempt an external network request (iframe `sandbox` does not block network). Fixed with a CSP injected into the srcdoc — which also cut real-codex wake time to ~2.5 s by making the hanging font fetch fail instantly.
7. **EX-2b** — Prose lines opening with `#`, `>`, `-`, or `1.` exported as markdown structure; a prose line round-tripped through the app's own importer as a fake chapter. Literal `~~…~~` re-imported as strikethrough. Fixed with line-start guarding, a wider escape set, boundary-whitespace-correct emphasis, and a symmetric importer unescape.
8. **PR-5** — Restoring a backup taken with the real codex active silently dropped the codex binding (restore lacked the boot guard's omni-host exemption). Backups now also embed the codex engine, so restore revives it on a fresh device.
9. **CD-4** — A quote selection spanning block boundaries fused its boundary words (`selTextFromRange` read separator-less `textContent`).
10. **CD-6** — A card opened from the editor rendered underneath the still-visible editor and was unclickable (fixed per-screen CSS z-indexes vs. actual navigation order). `applyNav` now assigns stacking from the nav stack.
11. **CD-3** — The mention scan missed card names at block junctions (`plainOfHTML` flattened docs without separators: `…Kael</h2><p>He entered…` → `KaelHe`). Third and final member of the detached-text bug family; all text-analysis paths are now separator-aware.

## Final scoreboard

| Area | Result |
|---|---|
| ST — Manuscript structure | **5/5 pass** |
| ED — Editor | **7/7 pass** |
| PR — Offline persistence | **5/5 pass** |
| CD — Cards / world-wiki | **6/6 pass** |
| EX — Compile & export | **6/6 pass** |
| IM — Smart import | **4/4 pass** |
| TR — Translation layer | **6/6 pass** |
| PN — Principles (no AI, deterministic, no lock-in) | **3/3 pass** |
| DV — Spec-MVP deviations (report-only) | **5/5 accurately disclosed** |

Highlights that held up under adversarial re-testing: the author's real 50,339-word manuscript imports to 19 chapters / 40 scenes in ~250 ms with a verified-intact body text; translation is bit-deterministic across all seven sample tongues and all six real-codex tongues, across repeat calls and reloads; a full session (create → write → translate → export → backup → reload) issues **zero network requests**, including while hosting the imported 3.4 MB codex; and every category of authored state round-trips out of the app (markdown, plain text, cards zip + graph, full-state backup including the codex engine).

## Baseline B — accepted deviations from the spec MVP

| | Deviation | Status |
|---|---|---|
| DV-1 | Single-file HTML + contenteditable + sanitizer, not React/TipTap/Vite | Disclosed (header, About sheet); no Baseline A behavior lost |
| DV-2 | DOCX export deferred | Disclosed on every export sheet |
| DV-3 | EPUB 3 export deferred | Disclosed on every export sheet |
| DV-4 | No service worker/manifest; the file is its own offline artifact | A2HS metas present |
| DV-5 | IndexedDB for everything incl. codex + fonts; no OPFS | In-memory fallback + `storage.persist()` in place |

## Residual anomalies (non-blocking, worth a look before v1)

The final run logged 68 observations; none gate certification. The most useful:

- **Restore doesn't re-sanitize scene docs** — a hand-crafted backup JSON could inject markup the editor's own paste path would normalize. Run restored docs through `sanitizeHTML` once on restore.
- **`idbOpen`'s 2.5 s safety timeout** can theoretically race a slow IndexedDB open into a memory-only session that looks normal.
- **The codex CSP seal is soft against a malicious codex** — `allow-same-origin` still grants an imported HTML file same-origin storage access; the CSP stops its network, not its hands. Fine for the author's own codex; worth hardening if codices are ever shared.
- **Mention counts saturate at 1000 per scene** and names shorter than 2 characters are silently excluded from mention detection.
- **`cardMD` doesn't markdown-escape card titles/aliases/keywords** (the scene exporter does escape).
- **`graph.json`** names its node array `cards`, embeds an export timestamp (so identical states differ byte-wise), and mention edges reference sceneIds with no node entries.
- **EX-2 near-miss:** a paragraph consisting solely of `-` or `=` runs can still setext-promote the previous line in strict CommonMark renderers.
- **Marks/blocks ride the deprecated `execCommand` API** — fine today in all engines, but the eventual TipTap/ProseMirror port (DV-1) is the real successor.
- **tspan source text caps at 2,000 chars** — translating a longer selection silently truncates its stored source.

## Standard v1.1 — checklist holes the coverage critic recommends adding

For the next certification cycle: an explicit deviation entry for **in-editor alias auto-linking** (spec MVP wants tappable `cardMention` spans in prose; step 1 ships out-of-editor mention lists — the one MVP capability not owned by any requirement); import graceful-degradation behaviors (40 MB cap, `.doc` guidance, JSON→restore routing, DecompressionStream fallback); the per-book paragraph-style option; the desktop layer (context menu, keyboard shortcuts); codex pack export; sample-font registration at boot; the `window.tenebrae` console API; theming/A2HS metas.

## Verification machinery (reproducible)

- **5 certification runs · 70 agents · ~7.2 M agent tokens · ~2,000 tool uses** across the campaign; final run 14/14 agents, 362 tool uses, 49 minutes.
- **78 Playwright probes** in `tenebrae/certification/harness/probes/` — every (F) requirement demonstrated against the running app; probes double as the regression suite (`node <probe>.mjs`, each self-serves the app on an ephemeral port).
- Re-certify any future revision with the `certify-tenebrae-step1` workflow after updating the pinned hash in the standard.
- External inputs deliberately kept out of the repo: the author's manuscript `.docx` and the 3.4 MB Codex Omnilingua HTML.

## What's next

Step 1 is closed. The natural step 2 candidates, in the app's and spec's own words: **DOCX and EPUB export** ("arrive in a later step" — spec MVP items DV-2/DV-3, with the conlang-fidelity strategy of spec §6), the **conlang export spike** the spec calls the project's highest risk (pre-shaped runs / PUA / SVG outlines across PDF, DOCX, EPUB), and **in-editor alias auto-linking** to close the one scoped-out MVP capability. The residual-anomaly list above is the recommended hardening pass to fold into whichever comes first.
