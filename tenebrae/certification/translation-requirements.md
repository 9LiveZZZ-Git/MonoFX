# Tenebrae Writer — Translation Services Certification Standard

**Artifact:** `tenebrae/step1.html` (hash pinned at certification time)
**Ground truth:** the real Codex Omnilingua — embedded in the artifact, and available
standalone at the scratchpad path for independent comparison. Where the writer and the
codex disagree, **the codex is right**.

**The claim under test:** highlight English, translate it into a real Tenebrae tongue,
see the canonical script, and get it back — with nothing lost.

**Certification rule:** every TX requirement passes, static + functional, adversarially
verified. Statuses and evidence rules follow the step-1 standard. `(F)` = must be
demonstrated against the running app.

---

## TX — Translation service requirements

### Engine (the words themselves)
- **TX-1** (F) **The codex is the engine, always.** The real Codex Omnilingua is the
  translation engine from first launch with no import step. The legacy sample cipher can
  never become the translation engine on any path: boot, failed engine wake, removal of an
  imported codex, removal of an imported JSON pack, or restore from backup.
- **TX-2** (F) **Translation parity.** For every tongue, over a corpus of at least 25
  varied inputs (prose, punctuation, unknown words, numbers, hyphenates, apostrophes,
  mixed case, empty, very long, non-ASCII), the writer's romanization and gloss are
  byte-identical to the codex's own compiler output.
- **TX-3** (F) **Determinism.** Identical input yields identical output across repeat
  calls, reloads, and storage-fresh contexts. No time or randomness in the path.

### Script (the glyphs)
- **TX-4** (F) **Real script, as text.** Scripts render as characters in fonts forged from
  the codex's own glyph vectors — never SVG, never images, never romanization in a Latin
  face. Every forged TTF is structurally valid (fontTools decompiles every table), its
  cmap covers every codepoint used, and forging is deterministic.
- **TX-5** (F) **Glyph-sequence parity.** The PUA run in a span decodes back to exactly the
  glyph keys the codex's own tokenizer produces for that word, including the unknown-token
  mark.
- **TX-6** (F) **Canonical layout, per the codex's own typesetter.** DOM geometry proves:
  `cols-rtl` gives one column per word, letters running down the column in logical order,
  columns advancing left→right, all hanging from a common ceiling; `btt-stave` gives one
  stave per word, staves left→right, letters bottom-up, all staves standing on common
  ground; `rtl` runs letters and words right→left. Stacked letters abut with zero gap so
  stems fuse into a continuous rail. Holds for multi-word phrases and long words.
  `dir="rtl"` belongs to the horizontal `rtl` tongue **alone** — inside a vertical writing
  mode `direction` reverses the *inline* (vertical) axis and stands the column on its head.
  The codex reverses its token order for `rtl` and `btt-stave` and **not** for `cols-rtl`.
- **TX-6b** (F) **Only what the codex would write.** The codex feeds its typesetter
  `cleanText` — the compiled lines with untranslated parts (`p.u`) removed — and strips
  everything outside `[letters, digits, ' ’ -]` from each word before matching. The writer
  does the same: a word the lexicon could not render is **not** transliterated letter by
  letter into the script, and sentence punctuation is not written as a glyph. The full
  romanization (unknown words included) still lives in `data-rom` and the tap sheet.
- **TX-6c** (F) **Celan Basic is a word script, and it is forged too.** The codex gives it
  no alphabet in `TRANS[].L.script`; its Auric runes are carved per WORD by `composeWord` —
  root rune, domain radical, a link stroke per extra root, a loan diamond for anything the
  lexicon does not know, and prefix/suffix marks anchored to the whole word. The forge mints
  a codepoint the first time a word is written and rebuilds the face. Geometry parity is
  structural: one capsule per carver segment, each centred on that segment, every advance the
  carver's own word width. Because this script has its own device for a borrowing, loans are
  written here — the exception to TX-6b, which exists only because an alphabet has no way to
  write a foreign word except letter-by-letter transliteration.

### The author's loop
- **TX-7** (F) **Highlight → translate.** Selection to translated span works through the
  real UI for every tongue; the span stores its English source, its tongue, its
  romanization and its script form.
- **TX-8** (F) **Read it back.** The tap sheet shows the big script render, the source
  line, the romanization and the interlinear gloss; edit-source retranslates; change-tongue
  re-renders correctly across flows; revert restores the exact English.
- **TX-9** (F) **Nothing is trapped or lost.** Every span operation is undoable and
  redoable, including mixed sequences interleaved with typing; spans survive reload; spans
  created before a codex import re-render after it; a span never degrades to Latin text.

### Leaving the app
- **TX-10** (F) **EPUB carries the script.** Exported EPUBs carry the PUA script text with
  `data-src`/`data-rom`/`data-flow`, embed and manifest every forged font used, and include
  `@font-face` plus per-language and per-flow CSS; every XHTML part is strict-XML valid;
  re-importing restores live spans with source intact.
- **TX-10b** (F) **PDF carries the script, and cannot be talked out of it.** DOCX asks Word
  to honour an embedded face and EPUB asks the reader to; both may decline. A PDF carries the
  outlines and the positions itself. Every tongue on the page is embedded as a CIDFontType2
  with `Identity-H` encoding and `CIDToGIDMap /Identity`; English prose rides the base-14
  Times faces as real WinAnsi text. Proof is decoded, not eyeballed: every xref offset lands
  on its object, every `FontFile2` decompiles under fontTools, and every glyph id in the
  content stream maps — through the embedded font's OWN cmap — back to exactly the codepoints
  the app shows on screen, in the order each flow requires (`rtl` reversed, the rest logical).
  `cols-rtl` and `btt-stave` are set as their own blocks, keeping the common ceiling and the
  common ground; an inline column nine ems tall would wreck a printed page. Byte-deterministic
  for identical state.
- **TX-11** (F) **Other formats stay legible.** DOCX/Markdown/plain text carry romanization
  (never raw PUA) and keep the English source recoverable. Markdown hides the source in a
  `<!--tenebrae:begin …-->` marker so it round-trips into a live span. Plain text and .docx
  cannot carry markers, so they print the English bracketed beside the romanization —
  `exportOpts.sourceGloss`, on by default, togglable from the export sheet. The .docx
  romanization stays its own italic run; the gloss is a separate upright run.
- **TX-11b** (F) **Our own Markdown round-trips exactly.** A Tenebrae export stamps
  `<!--tenebrae:doc-->` and marks each scene-title heading with `<!--tenebrae:scene-->`,
  because `###` means both "scene title" and "in-scene H2". Re-importing one of our files
  reproduces its chapter/scene structure exactly. Foreign Markdown carries no markers and
  keeps the heading-level heuristic.

### Robustness
- **TX-11c** (F) **A selection the codex cannot write produces no span.** If every word of
  a selection is untranslatable, the codex's own wing draws nothing (`if(cleanText)`), so the
  writer declines the span, says so, and leaves the author's characters exactly where they
  are. It never invents a row of unknown marks and never leaves an invisible, un-tappable
  element behind. The same rule governs changing tongue on an existing span.
- **TX-11d** (F) **A span lands where the author put it.** `execCommand('insertHTML')` hoists
  the span out of its block when the selection ran to the block's end, and drops the inline
  marks the replaced text carried. The span is returned to its block and re-wrapped in the
  bold/italic/underline run it replaced, so a translation inside a heading stays inside that
  heading. Undo still reverses the whole operation.
- **TX-12** (F) **Hostile input.** Long selections, selections spanning paragraphs and
  existing spans, XML/HTML metacharacters, emoji and combining marks, over-long words,
  translating while the engine wakes, rapid translate/undo cycles, and reload mid-flight
  produce no page exceptions, no data loss, no corrupted spans, and no Latin fallback.
