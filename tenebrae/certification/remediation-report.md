# Tenebrae Writer — Remediation Pass over the Full Certification Report

**Artifact:** `tenebrae/step1.html`
**Bytes at the end of pass 1:** sha256 `74c3535f…`, 4,978,109 B, 6,826 lines, at commit `b4d03f0`
**Bytes at the end of pass 2:** sha256 `d8089a49a87be1fbe1672786aecc30e2dc2fc87d483a887c92139b6ad4370dec`, 4,987,316 B, 6,995 lines, at commit `eec1ae4`
**Answers:** `certification/full-certification-report.md` (NOT CERTIFIED, 18 open defects, certified against `4a7a120d…` at `0e5b9a4`)
**Standard:** `certification/translation-requirements.md` (TX), `certification/step1-requirements.md` (step-1)
**Date:** 2026-08-22

---

## What this document is, and what it is not

The full certification report closed with eighteen numbered defects (D1–D18) and a
recommended fix order. **Every one of them is now closed**, with the probe that found it
green against the final bytes.

This took **two passes**, and the second one is the more instructive record. Pass 1
closed D1–D18. Pass 2 put the pass-1 work in front of adversarial readers — five agents
diagnosing the probes that were still red, each with an independent refuter told to
break the diagnosis — and found that **four of the pass-1 fixes were wrong**, two of
them worse than the defect they closed. §"What pass 2 found" has the detail. The whole
217-probe suite is green against the final bytes: 195 PASS, 22 diagnostics, 0 FAIL,
0 crashes.

This is **not a second certification.** A certification is an adversarial audit run by
readers who did not write the code; this pass was made by the same hand that wrote the
defects, checked against the probes that caught them. The right next step for a
CERTIFIED verdict is another independent run over these bytes — the standard and the
harness are both ready for one, and the defect list it inherits is empty rather than
eighteen long.

What it *is*: a record of what was wrong, what changed, and what the evidence is, so a
future certifier can check the reasoning rather than re-derive it.

---

## The one that changed the design

D1 (a translation made at the START of a paragraph lands at the END of it) and D11 (undo
leaves accumulating residue; redo does not reproduce the insertion) turned out to be the
same defect seen from two ends, and the first two attempts at it both made something
else worse. The sequence is worth recording, because it is the reason `placeTSpan` looks
nothing like it did.

**The problem.** `execCommand('insertHTML')` decides for itself where an atomic element
lands. It hoists the span out of its block when the selection touches a block edge, drops
it entirely inside a list item while keeping its text, and dissolves the bold run the
replaced text was sitting in. The old answer was to remember the block and repair
afterwards — which is right only for a selection that ran to the block's END, and for the
phrase a paragraph OPENS with it teleported the author's words to the end of the
paragraph. And because every repair happened *after* the `execCommand`, none of it was on
the browser's undo stack: redo put back a span outside its heading, outside its bold run,
with the NBSP back before the comma.

**Attempt 1 — steer the insert with landmarks.** Park an invisible zero-width mark just
outside each edge of the selection, so the selection no longer touches a block edge.
This worked: the insert landed in place natively, undo and redo of the translation itself
were exact, and cf-ref-span-placement, cf-adv-loop-blockstart and cf-loop-undo-repair all
went green.

**Attempt 1's cost.** `Range.insertNode` at a text-node boundary **splits** the node, and
a split breaks the undo commands the browser recorded against it: the author's *earlier
typing* stopped being undoable, and redo duplicated it. Inserting the mark as a character
instead (`insertData`, no split) fixed that — and then removing the character afterwards
shifted the offsets the undo stack had recorded, so undo put the restored words back in
the wrong place. Leaving the characters in the document keeps undo perfect and puts
invisible characters in the manuscript. Every version of the landmark idea trades one for
another; two probes (`cf-adv-loop-undo-typing`, `tx-undo-persist`) caught it each time.

**Attempt 2 — stop steering it.** Leave `execCommand` no decision to make: rewrite the
whole block in ONE command — the text before, the new fragment inside the inline run it
belongs to, the text after. There is nothing to hoist, nothing to drop, nothing to
dissolve, no raw DOM edit anywhere, and one command is exactly what the undo stack wants.
`edReplaceInBlock` is that; translate, revert, remove and change-tongue all go through it.
A cross-block selection has no single block to rewrite and falls back to the old path.

This closed D1, D3, D11 and D12 together, and also the two legs of `cf-loop-undo-repair`
(R2's triple-nested `b>i>u`, R3's list item) that had been failing before any of this
pass began.

---

## Defect by defect

| id | requirement | what changed | evidence |
|---|---|---|---|
| **D1** | TX-11d, TX-7, TX-12 | `edReplaceInBlock` rewrites the block in one command; the span lands where the author put it, in the inline run it replaced. | `cf-ref-span-placement`, `cf-adv-loop-blockstart`, `cf-adv-loop-blockstart-typed` PASS |
| **D2** | PR-5 | `offerRestore` lets go of the open scene, card and book **before** `state = st`, so `flushSave` cannot copy the replaced session's live DOM into the restored record. | `cc-restore-midsession` PASS |
| **D3** | TX-11, TX-9, TX-12 | The block rewrite does not drop the element in a list item at all; `stripLooseScript` sweeps any run that still gets left loose. Script characters live inside a span and nowhere else. | `cf-adv-loop-li-leak`, `cf-adv-ex-pua-leak` PASS |
| **D4** | TX-6 | The `cols-rtl` column cap is gone (`max-height:none`, `word-break:keep-all`), in the forge CSS and in `EPUB_CSS`. One column per word, and the column is as tall as its word. | `cf-adv-colcap`, `cf-script-longword-layout`, `s2-script-structure` PASS |
| **D5** | TX-10b | The PDF export item awaits `ensureOmni()`/`forgeOmniFonts()` the way the EPUB item does, and says so if the codex is still waking. | `cf-adv-pdf-forge-race-slow` PASS (CPU throttled 20×) |
| **D6** | TX-10b | Columns wrap into rows at the right margin, each row keeping its own ceiling or ground; a block too deep for the page is set smaller; rows paginate; an inline run is set word by word so a sentence wraps like prose; an atom wider than the measure is broken rather than pushed past the edge. | `cf-pdf-block-overflow`, `cf-adv-deepcol-pdf`, `cf-adv-pdf-inline-overflow`, `cf-pdf-hostile-layout` PASS |
| **D7** | TX-14 | `noTenebrae` strips U+E000–U+F8FF at `claudeAsk`, the last gate before the wire, and `claudeSceneText` strips too so the app and the model read the same text. | `cf-adv-assist-tenebrae`, `cf-assist-nosend` PASS |
| **D8** | TX-1 | `makeTSpan` calls `ensureCodexInstalled()` first, like the other two translation entry points. | `cf-ref-tx1-preboot-import`, `cf-tx1-persistence-paths`, `tx-engine-always` PASS |
| **D9** | TX-15 | A copy-edit's anchor is re-checked at apply time against the words around it in the scene the model read; two equally plausible matches and it refuses and says so. Card quotes are matched inside ONE block, and what is stored is the scene's own slice. A replacement carrying script or a bidi override is dropped, in copy-edits and card fields alike. | `cf-adv-assist-overlap`, `cf-adv-assist-apply`, `cf-assist-guardrails` PASS |
| **D10** | TX-16 | A parseable answer of the wrong shape throws instead of reporting "the scene reads clean". `claudeAsk` has a 90 s abort and says "Still waiting on the API…" at 12 s. | `cf-adv-assist-failure`, `cf-assist-failures` PASS |
| **D11** | TX-9, TX-11d | See above. The pad is decided BEFORE the insert so redo reproduces it; `padAfter` reads through blanked nodes and empty husks; `pruneHusks` drops husks from the fragment before it is inserted. | `cf-adv-loop-residue-real`, `cf-loop-undo-repair`, `cf-loop-repair-residue`, `tx-undo-persist` PASS |
| **D12** | TX-8 | Change tongue and edit source go through the same block rewrite, so the bold run survives; and they carry the span's pad, size and block flag across. | `cf-loop-realui`, `cf-loop-sheet-inplace` PASS |
| **D13** | TX-11b | An in-scene ⁂ carries its own marker; a chapter boundary with no title carries one too; a marked scene heading is a scene whatever its level; a lone top-level heading before any prose is the book title even with chapter breaks present; an empty chapter comes back empty; the import preview names the rule it is using. | `cf-ex-md-marker-roundtrip`, `cf-ex-md-splitrule`, `cf-adv-ex-md-optionsmatrix`, `cf-ex-degenerate-formats` PASS |
| **D14** | TX-9 | A tongue this codex does not have is refused, never relabelled. The span keeps the author's words and its recorded tongue, marks itself so it cannot pass for prose, and its sheet says what happened and offers the two ways out. | `cc-legacy-tongue-crossformat`, `cf-tx2-parity-extended` PASS |
| **D15** | TX-4 | `head`'s bounding box is clamped to zeros when no glyph has an outline; `post.isFixedPitch` is read off the advances. An EPUB embeds only the faces the book's own spans call for. | `cf-forge-ttf-spec` PASS |
| **D16** | TX-10b, TX-4 | ~~Sorted mint order.~~ **Superseded in pass 2** — sorting renumbered words already on screen and broke TX-3. The live mapping is arrival-ordered and never renumbers; an *export* swaps in a document-ordered mapping for the length of the write and restores the session's afterwards, so the file is a pure function of the book. `persistEditor` no longer stamps the book as edited when a scene is merely opened. | `cf-adv-pdf-det-order`, `cf-pdf-determinism-reload`, `cf-auric-mint-drift`, `tx-vp-determinism-axes` PASS |
| **D17** | ED-6, TX-14 | ~~Keeps the romanization in the span's place.~~ **Superseded in pass 2** — that put the romanization on the wire, which TX-14 forbids in the same breath as the script. The run stays inside a **marked span**, where the reader can see it is not prose and `claudeSceneText` cannot pick it up. The keep-test also stopped being a conjunction (a span that kept the author's English but lost its tongue was being discarded), and the rule now holds over every carrier, not just `SPAN`. | `cf-assist-nosend`, `cf-adv-assist-tenebrae`, `cf-adv-ex-pua-leak` PASS |
| **D18** | hygiene | EPUB scene titles survive a ⁂ round trip; the forged style sheet is always last in the head; `window.tenebrae.translate` is `translateSampleLegacy`; an unreadable codex version is no version rather than `v?`; Auric block exhaustion says so; `step1-requirements.md` TR-1/PN-2 are marked superseded by TX-1 with the reason recorded. | `tx-epub-allscripts`, `cf-auric-block-exhaustion` PASS |

---

## What pass 2 found

Pass 1 closed all eighteen defects and left six probes red. Five agents were set on
them, one per probe, each told to decide **from the standard** whether the app had
regressed or the probe's oracle had gone stale — several probes had been written to
*record* a defect, so closing it turns them red legitimately. Each diagnosis then went
to an independent refuter whose brief was to break it.

That second opinion earned its keep: it overturned one verdict outright and broke the
proposed fix on two more. What follows is what was actually wrong.

### Four pass-1 fixes were defective

| what pass 1 did | what was wrong with it | how it was found |
|---|---|---|
| **D17** — a source-less `.tspan` was replaced by its **romanization** as bare prose, to stop the raw run being promoted to prose | TX-14 reads "never as script **or romanization**" — one clause. `claudeSceneText` reads `dataset.src`, so a *span* sends nothing, but the romanization left in its place was ordinary text and went to the API in the author's own sentences. The fix satisfied half the clause by breaking the other half. | refuter on `cf-assist-nosend`, which had *agreed* it was a stale oracle |
| **D16** — Auric codepoints minted in **sorted** order, so two exports of the same state match | Sorting means a new word renumbers its neighbours, including words already on screen and already in a stored `data-scr`. That is TX-3, a core invariant, traded for a partial clause of TX-10b. Four determinism probes went red at once. | the suite |
| **D11** — the pad decided before the insert by `padPlan` | `padPlan` read only the *first* character after the selection, so a block ending in collapsible whitespace answered `'space'`, no pad was written, and `data-pad` was cleared. Chromium then had no rendered caret position after the atomic span: `execCommand('delete')` did nothing **and returned true**. Remove and Revert silently failed. | refuter on `tx-vp-span-lifecycle` |
| **D1/D11** — `ok` taken from `execCommand`'s return value | It lies. The `if(!ok)` fallback therefore never fired. Worse, this was broken at the **certified baseline** too: translate mid-sentence, backspace away the words that followed, then Remove — the span survives and the prose is duplicated. The suite's green there meant "never walked this path", not "correct". | refuter on `tx-vp-span-lifecycle` |

The replacements: the sanitizer keeps a source-less run **inside a marked span** rather
than promoting anything to prose; the live Auric mapping is arrival-ordered and never
renumbers, while an **export** swaps in a document-ordered mapping for the length of the
write and restores the session's afterwards; and removal and revert go through
`edReplaceSpan`, which gives the command somewhere to land and then judges the outcome
against **the block's own text**, restoring it byte for byte if anything but the span
changed.

### Two more real defects, neither in the original report

- **EPUB had no channel for the two asterisms.** `epubSceneInto` and `epubChapterXHTML`
  both wrote `<p class="ast">⁂</p>`, so the importer read every one as a scene break.
  **No split rule the app offers round-tripped its own EPUB** — the default invented a
  phantom untitled scene and stranded a span in it, "Headings" demoted real scene titles.
  D13's fix had been applied to Markdown only. (X2-8, X2-9)
- **Separator-shaped prose is deleted on round-trip.** A paragraph the author *types* as
  `⁂`, or `#`, or a rule of dashes, serialized as a bare line and came back as a scene
  split with the paragraph gone. Nothing in the suite had ever typed an asterism — every
  one came from the toolbar's `#fb-break` button, which makes a `div.asterism` the
  exporter can already mark. (TX-11b)

### Three defects introduced *during* pass 2, caught by the suite

Recorded because they say something about the shape of this work.

1. **`loosePua` parsed untrusted paste markup in a live `<div>`.** A detached div is not
   inert: the browser loads its images and fires their handlers. `<img src=x onerror=…>`
   executed on paste, before the sanitizer saw it. ED-6. Caught by `ed-sanitizer`.
2. **`plan === 'need'` conflated two situations** — "nothing rendered follows" and "a
   real word follows with no space between". The reconcile trims the whitespace after
   the pad, and Chromium merges the pad into the same text node as the text after it, so
   `pad.nodeValue = '\u00A0'` **deleted the rest of the paragraph**. Translate
   `"the old king "` out of `"the old king waits alone"` and `waits alone` was gone, span
   placed, no exception. Caught by `tx-vp-selection-shapes`, whose last case is the only
   one in the suite that selects with a trailing space and prose behind it.
3. **A reference to `TS_MARK`**, an identifier deleted in pass 1 when the landmark
   bracketing was replaced by `edReplaceInBlock`. `padPlan` threw on every call and fell
   through to its `catch`, returning `'need'` unconditionally. Four probes red at once.

Two of these were silent, plausible-looking, and destroyed the author's text. Neither
survived a suite run. The lesson recorded for the next hand: **a fix to the pad rule is a
fix to the text-loss surface**, and the suite is the only thing standing between a
plausible edit there and a lost paragraph.

### Probe oracles corrected in pass 2

Six checks, every one of them only after a refuter had tried and failed to find a real
defect behind it:

- `cf-assist-nosend` ×2 and `cf-adv-assist-tenebrae` — "teeth" preconditions asserting
  that the sanitizer promotes the run to prose, and that a plain-text paste of script
  lands in the scene. Both now assert the fixed behaviour, including that the kept span
  is *marked*.
- `cf-ref-tx3-cold-history` — required the private-use **codepoint** to match across two
  cold sessions with different histories. TX-6c specifies a mint that is
  history-dependent by definition, and TX-3's axes are repeat calls, reloads and
  storage-fresh contexts, all of which pass. It now compares the **rune**: outlines and
  advances pulled from each context's own face with fontTools. Its font check also
  hashed only length plus the first 64 bytes; it now hashes the whole buffer, and asks
  that only of the alphabet faces. **This probe was red at the certified baseline too**,
  so the full report's TX-3 "pass" row over-claimed.
- `cf-adv-ex-epub-staleauric` and `cf-pdf-determinism-reload` — decoded a *file's*
  codepoints through the *session's* Auric map, which the export deliberately stopped
  being. Both now compare outlines through the embedded face; the stale-Auric probe
  seeds decoy words into the low codepoints and still proves every exported rune right.
- `ex-md-mapping` — counted bare `⁂` lines, which cannot tell the two asterisms apart and
  would keep its count if a regression swapped the markers. It now anchors on which is
  which and on their order.

### Probes added in pass 2

- `cf-span-lastinblock` — a span that is the last rendered thing in its block, reached
  both ways: placed there, and *made* so afterwards by backspacing the following words.
  Five shapes, all typed.
- `cf-md-sepprose` — four separator-shaped lines the author types, through export and
  re-import.

---

## Probes that were themselves wrong in pass 1

Nine probe checks were corrected in pass 1. Six had recorded the defect as the
expectation — which is what a gap probe does, and is exactly right until the defect is
fixed. Three could not have passed against a correct artifact:

- `cf-pdf-hostile-layout` measured the whole word's width from the first drawn piece's
  start x, which reads a correctly broken word as an overflowing one. It now measures
  each piece the writer actually drew, and checks the pieces still spell the word.
- `cf-adv-ex-legible-alltongues` required `"source":"…"-->` with no room for the marker
  JSON's closing brace, and ran a lazy `[^]*?` from the FIRST marker's begin to the
  SECOND marker's end — so it reported a newline inside a marker body whenever two
  markers sat on two lines, which is every ordinary document.
- `cf-adv-loop-revert-truth` C10 compared a cross-block revert against raw `textContent`,
  which has no separator at a block boundary, and so demanded the two boundary words fuse
  into "remembersthe".

The six that recorded defects: `cf-assist-guardrails` (×2, the replacement text was not
inspected), `cf-forge-ttf-spec` (an EPUB embeds a face the book never writes in),
`cf-tx2-parity-extended` (×2, an unknown or empty tongue id answers as Celan Basic), and
`cf-adv-pdf-forge-race`'s precondition (which needs a machine slow enough to still be
waking at the tap, and is now recorded rather than failed on a fast one — the
slow-device variant covers that window deterministically).

One probe re-selected by element id across five translate/revert cycles
(`cf-loop-repair-residue`): a revert brings the author's words back inside a bold run but
not inside the same `<b>` node, and element identity was never the contract.

---

## What remains untested

Everything in §"What remains untested" of the full certification report still stands,
unchanged, except item 6 (the suite had not been re-run whole), which this pass closes.
In particular:

1. **The live Claude API.** No key. Every assist finding is against a stubbed `fetch`.
   The new 90 s abort and the 12 s "still waiting" toast are tested against a stub that
   never answers, not against a real slow request.
2. **macOS, iOS and Safari.** Every probe is Chromium via Playwright on Linux. The block
   rewrite is a change to exactly the layer that differs most — `contenteditable` +
   `execCommand('insertHTML')` fragment handling — so **D1/D11/D12's evidence does not
   transfer to Safari untested**, and neither does TX-6's `writing-mode` geometry.
3. **No real device**, no real e-reader, no Word, no Acrobat, nothing printed. The PDF
   layout fixes are proved by a decoder (`cf-pdfcheck2.py`) and by measuring the content
   stream; the printed result is now *known to be on the paper*, which it was not, but
   nobody has printed one.
4. **Scale.** No manuscript of real novel length. `auricExportOrder` compiles every
   document a file will contain before writing it, and re-forges the face as it goes —
   correct, and unmeasured at book length. `edReplaceSpan` snapshots and may restore the
   whole block on every span operation; also unmeasured on a very long paragraph.
5. **TX-12 still has no probe of its own.** Its status in the full report was derived
   from other domains' defects; those defects are closed, but no adversarial work has
   been aimed at the id.
6. **Nobody has adversarially read pass 2's own work.** Pass 2 exists because pass 1's
   fixes were read by someone other than their author, and four of them did not survive
   that. Pass 2's fixes have had the suite, and the suite caught three self-inflicted
   defects — two of which silently destroyed text — but no independent reader. That is
   the same gap, one level up.

**New in this pass, and worth an adversarial look:** `edReplaceInBlock` re-serializes and
re-parses the whole block on every span operation. That is a much bigger blast radius
than the old targeted insert — anything in a block that does not survive a
`cloneContents` → `innerHTML` → `insertHTML` round trip would be lost silently. The
probes cover paragraphs, headings, blockquotes, list items, nested `b>i>u`, existing
spans and the asterism; they do not cover every shape a manuscript can hold.

