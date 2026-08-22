# Tenebrae Writer — Remediation Pass over the Full Certification Report

**Artifact:** `tenebrae/step1.html`
**Bytes at the end of this pass:** sha256 `74c3535f376413282ee4cd1c9220ed28e3f6bceaa2f441ad48f36fcb9851a74a`, 4,978,109 B, 6,826 lines, at commit `b4d03f0`
**Answers:** `certification/full-certification-report.md` (NOT CERTIFIED, 18 open defects, certified against `4a7a120d…` at `0e5b9a4`)
**Standard:** `certification/translation-requirements.md` (TX), `certification/step1-requirements.md` (step-1)
**Date:** 2026-08-22

---

## What this document is, and what it is not

The full certification report closed with eighteen numbered defects (D1–D18) and a
recommended fix order. **Every one of them is now closed**, in five commits, with the
probe that found it green against the final bytes.

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
| **D16** | TX-10b, TX-4 | Auric codepoints are assigned in sorted order, and the whole vocabulary is minted before a file is written. `persistEditor` no longer stamps the book as edited when a scene is merely opened. | `cf-adv-pdf-det-order`, `cf-pdf-determinism-reload` PASS |
| **D17** | ED-6 | `sanitizeHTML` no longer unwraps a source-less `.tspan` into bare prose; it keeps the romanization if there is one and drops the run if there is not. | covered by `cf-assist-nosend`, `cf-adv-ex-pua-leak` |
| **D18** | hygiene | EPUB scene titles survive a ⁂ round trip; the forged style sheet is always last in the head; `window.tenebrae.translate` is `translateSampleLegacy`; an unreadable codex version is no version rather than `v?`; Auric block exhaustion says so; `step1-requirements.md` TR-1/PN-2 are marked superseded by TX-1 with the reason recorded. | `tx-epub-allscripts`, `cf-auric-block-exhaustion` PASS |

---

## Probes that were themselves wrong

Nine probe checks were corrected in this pass. Six had recorded the defect as the
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
4. **Scale.** No manuscript of real novel length. The Auric sorted-mint change makes a
   new word renumber its neighbours, and `auricPrime` mints a whole book before writing a
   file — both are correct and both are unmeasured at book length.
5. **TX-12 still has no probe of its own.** Its status in the full report was derived
   from other domains' defects; those defects are closed, but no adversarial work has
   been aimed at the id.

**New in this pass, and worth an adversarial look:** `edReplaceInBlock` re-serializes and
re-parses the whole block on every span operation. That is a much bigger blast radius
than the old targeted insert — anything in a block that does not survive a
`cloneContents` → `innerHTML` → `insertHTML` round trip would be lost silently. The
probes cover paragraphs, headings, blockquotes, list items, nested `b>i>u`, existing
spans and the asterism; they do not cover every shape a manuscript can hold.

