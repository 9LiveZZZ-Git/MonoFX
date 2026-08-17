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
- **TX-11** (F) **Other formats stay legible.** DOCX/Markdown/plain text carry romanization
  (never raw PUA) and keep the English source recoverable.

### Robustness
- **TX-12** (F) **Hostile input.** Long selections, selections spanning paragraphs and
  existing spans, XML/HTML metacharacters, emoji and combining marks, over-long words,
  translating while the engine wakes, rapid translate/undo cycles, and reload mid-flight
  produce no page exceptions, no data loss, no corrupted spans, and no Latin fallback.
