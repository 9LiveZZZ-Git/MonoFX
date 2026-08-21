# Tenebrae Writer — Full Certification Report

**Artifact:** `/home/user/MonoFX/tenebrae/step1.html`
**Certified bytes:** sha256 `4a7a120d5b167893a06b22ef95b871cd7b53bcc2dd5ca066acdeef4e76be3cd2`, 4,948,635 B, 6,275 lines, at commit `0e5b9a4` (2026-08-21 19:16 UTC)
**Standards:** `certification/translation-requirements.md` (TX), `certification/step1-requirements.md` (step-1), `certification/step2-requirements.md` (X2)
**Ground truth:** the real Codex Omnilingua, embedded in the artifact and compared against the standalone copy at `scratchpad/codex.html`
**Method:** per-domain audit (static + functional, real UI) → independent adversarial refutation of every finding → coverage critic on the seams no domain owned
**Date:** 2026-08-21

---

## Verdict

# NOT CERTIFIED

The certification rule is *"every TX requirement passes, static + functional, adversarially verified."* Four requirements fail outright and eight are partial. The claim under test — write offline, highlight English, translate it into a real tongue, see the canonical script as live text, get the English back, and carry it out into five formats without losing any of it — holds in its engine and its script and fails in its **loop** and, in two places, in its **exports**.

What blocks certification, precisely:

1. **TX-11d — the author's words get silently reordered.** Highlighting the phrase a paragraph *opens* with puts the translation at the **end** of that paragraph. Ordinary highlight, ordinary paragraph, typed document, no warning. Reverting it makes it worse (the span survives and the English is duplicated).
2. **TX-6 — one column per word is not true.** The `cols-rtl` cap of 22 cells splits a single word across two columns, pitched exactly like the gap between words, on 1,273 of 166,464 phrases built from the codex's own dictionary. The same rule is in `EPUB_CSS`, so it ships to readers.
3. **TX-12 — hostile/ordinary input produces data loss and corrupted spans** (derived; see the row note).
4. **PR-5 (step-1) — restore silently keeps today's mistake.** Restoring your own backup mid-session writes the live card DOM over the restored card, persists it, and re-restoring does not recover it.

Two more are severe enough to block a release even though their requirement rows are *partial*: **raw PUA reaching Markdown/plain-text/.docx from a translation made in a list item (TX-11)**, and **a PDF exported one tap early carrying no script at all (TX-10b)** — on the one format whose entire premise is that it cannot be talked out of carrying the script.

Nothing here is rounded up. Where the auditor said pass and the refuter produced a reproducible counter-example through the real UI, the report takes the counter-example.

---

## Requirement rows — final status

Legend: **A** = domain auditor's status, **R** = refuter's revised status, **Final** = what this report certifies.

| id | requirement | A | R | Final | why this status |
|---|---|---|---|---|---|
| **TX-1** | The codex is the engine, always | pass | partial | **partial** | Took the refuter. Every path the standard *names* is genuinely guarded and the embedded payload is the codex byte for byte, but `makeTSpan` (L3825) is the one translation-capable entry point with no `ensureCodexInstalled()` guard, and it falls through to the legacy cipher. Verified statically in the final bytes: `if(omniPack()){…} const r = translateText(langId, src);`. The auditor's own note conceded the hole and rested on "I found no UI trigger"; the refuter found one. |
| **TX-2** | Translation parity | pass | pass | **pass** | Confirmed twice from independent directions: 192 fresh seam-level cells (0 mismatches, hostile Unicode) and 8 spans built through the real context menu compared against the standalone codex. |
| **TX-3** | Determinism | pass | pass | **pass** | Repeat / reload / storage-fresh / reordered / concurrent / cold-process / clock-shifted, all identical. Zero `Math.random`, `Date.now`, `new Date`, `performance.now` in *both* realms, measured by instrumentation, not code reading. |
| **TX-4** | Real script, as text; valid TTF | partial | partial | **partial** | Agreed. Everything the standard operationalizes passes (fontTools decompiles every table on every face, cmap covers every codepoint used, forging deterministic, never SVG). Two real spec deviations: an inverted `head` bounding box on the zero-glyph Auric face, which ships in every EPUB, and `post.isFixedPitch = 1` on all six non-monospaced faces. |
| **TX-5** | Glyph-sequence parity | pass | pass | **pass** | Re-earned by the refuter against the *span's* `data-scr` (the auditor's probe read the engine seam), decoded through the codex's own `wordScriptSVG` path over hostile input, all five alphabets. |
| **TX-6** | Canonical layout | pass | **fail** | **fail** | Took the refuter; its reasoning is plainly stronger. The auditor conceded the mechanism in its own anomaly and dismissed it on a 24-phrase hand-written corpus. The refuter swept the codex's own 408-word lexicon: 1,273 / 166,464 phrases contain a word ≥ 22 cells; the longest (37 cells) occupies two columns at the same 24.3 px pitch as real word breaks. Cause is unconditional: `max-height:var(--tsrun,22em)` at L2508 and L3365, and `--tsrun` is never assigned anywhere in the file. |
| **TX-6b** | Only what the codex would write | pass | pass | **pass** | Held under an all-loan attack: Celan High writes only the codex's own `cleanText` wrapper words, all three loans absent from the script and present in `data-rom`. |
| **TX-6c** | Celan Basic is a word script, forged | pass | pass | **pass** | Word identity, case/punctuation collapse, the 4,352-slot block boundary, one capsule per carver segment, the loan diamond, and carver-own advances all verified; loan runes survive into an EPUB unchanged. |
| **TX-7** | Highlight → translate | pass | pass | **pass** | Confirmed for all six tongues through the real UI, plus cross-block selections. Narrow pass: the insertion defects that travel this path are charged to TX-11d and TX-9 rather than double-counted here. |
| **TX-8** | Read it back | partial | partial | **partial** | Agreed, and weaker than first reported. Sheet panes, cross-flow re-render and six consecutive tongue changes are correct; but *Change tongue* / *Edit source* strip the author's bold/italic/underline run, and revert is not codepoint-exact on a repaired placement (stray space) or on a leading-selection span (the span survives and the English is duplicated). |
| **TX-9** | Nothing is trapped or lost | partial | partial | **partial** | Agreed by both, and extended by the coverage critic. Undo restores the author's text every time and no span is orphaned; but the placement repair is not reversed (empty `<b></b>` wrappers accumulate one per cycle and reach storage), redo does not reproduce the repair or the pad rule, a translation in a list item leaves a loose duplicate PUA run, and an imported span naming a tongue this codex lacks degrades to Latin — the one state this clause says must never exist. |
| **TX-10** | EPUB carries the script | pass | pass | **pass** | Held against stale cross-session Auric codepoints (regenerated correctly), XML-hostile titles and sources, and all six tongues. Every XHTML part parses strictly; every font referenced is in the zip and manifested. |
| **TX-10b** | PDF carries the script, and cannot be talked out of it | partial | partial | **partial** | Agreed. The decoded format contract is genuinely sound on all six tongues (Type0 / Identity-H / CIDFontType2 / `CIDToGIDMap /Identity`, `/W` against the face's own `hmtx`, every glyph id back through the embedded cmap, per-flow order, ceiling/ground). Three clauses fail: content painted outside the MediaBox, byte-determinism broken by first-write order, and a PDF exported before the forge wakes carrying no script at all. The refuter kept *partial*; this report keeps it too, while listing the forge race as a release blocker. |
| **TX-11** | Other formats stay legible | pass | **partial** | **partial** | Took the refuter. Three sub-clauses hold across all six tongues (romanization not PUA in the ordinary case, English recoverable, gloss default-on/togglable, `.docx` run separation). The absolute clause "never raw PUA" fails: a translation made inside a list item leaves a bare duplicate script run that all three legible exporters print verbatim. Corroborated independently by the loop domain's `cf-adv-loop-li-leak.mjs`. |
| **TX-11b** | Our own Markdown round-trips exactly | partial | partial | **partial** | Agreed, with a longer fix list than first reported. The `###` ambiguity the requirement names *is* solved and foreign Markdown keeps the heuristic; "exactly" does not hold — an in-scene ⁂ is consumed, an empty chapter gains a phantom scene, and two of four export-option combinations corrupt the structure. |
| **TX-11c** | A selection the codex cannot write produces no span | pass | pass | **pass** | Strongest result in the report. 24 tongue × shape combinations agree with the codex's own `cleanText` oracle, plus the never-driven edit-source path and a no-poisoning control. |
| **TX-11d** | A span lands where the author put it | partial | **fail** | **fail** | Took the refuter. The auditor's *partial* rested on "the insertion contract holds"; the refuter took the mirror case — a selection starting at the block's **first** character — and the span is appended at the block's **end**, in a paragraph, a heading and a blockquote, on a document built by typing. Confirmed statically in the final bytes: `hostBlock.appendChild(live)` at L4041 is the right home only when the selection ran to the block's end. A guarantee stated unconditionally that silently reorders the author's sentence is a fail, not a partial. |
| **TX-12** | Hostile input | — | — | **fail** (derived) | **No domain was assigned TX-12 and no probe was written for the id this round.** Its suite probes (`tx-hostile-input`, `tx-hostile-race`, `tx-hostile-degenerate`) are green. This status is derived from what other domains found on the paths TX-12 names: a selection spanning an existing span in a list item leaves a duplicate PUA run that ships to three formats, a cross-block selection loses a space on revert, and a leading selection reorders the block. TX-12 forbids "data loss ... corrupted spans" on exactly those paths. Recorded as fail with the derivation stated; it is not an independent TX-12 assessment. |
| **TX-13** | It does not exist until the author opts in | pass | pass | **pass** | Every outbound transport (fetch, XHR, sendBeacon, WebSocket, EventSource) instrumented before boot and across reloads: zero attempts at cold boot, zero with a stored key at boot, zero through a full authoring battery. Passes absent from all four menus without a key, present with one, gone again after "Forget the key". Default model `claude-opus-5`. |
| **TX-14** | The Tenebrae is never sent | partial | partial | **partial** | Agreed. A translated span goes as the author's English and no accepted edit lands inside a span — both verified with real spans. The absolute clause "no PUA codepoint may appear in any request body" fails: the app's own Ctrl+C puts 44 PUA codepoints on the system clipboard, and a paste-and-match-style of that clipboard puts them straight into the request body; harvested card titles leak too. Nothing in the artifact filters U+E000–U+F8FF. |
| **TX-15** | Constrained answers, verified claims | partial | partial | **partial** | Agreed, weaker than first reported. Schema, headers, `max_tokens`, no-apply-without-accept, undo-reverses, hostile-anchor filtering and a 5,000-fix answer all hold. Two verification failures: a chained fix's anchor is not re-checked at apply time and lands on text the previous fix manufactured; and `norm()` collapses the block joiner, so a fabricated "quote" spanning a paragraph break passes the verbatim test and is stored in the world bible. |
| **TX-16** | Failure says something true | partial | partial | **partial** | Agreed. Six failure classes each surface a distinct, plain, true message — including the 401 "That API key was rejected". Two holes: a malformed answer that happens to parse (`{"fixes":"none at all"}`, `{}`, `{"fixes":null}`) is coerced to an empty list and reported as "Nothing to correct — the scene reads clean", byte-identical to the genuinely-clean toast; and there is no `AbortController` or timeout, so a request that never answers says nothing, ever. |
| **TX-17** | The key stays on the device | pass | pass | **pass** | Asserted against real downloaded bytes for every artifact the app can hand over, container formats unzipped by magic bytes: backup, .md, .txt, .docx, .pdf, .epub, story bible, cards archive. Key only in its own kv record; not in state, localStorage, sessionStorage, cookies, or the live DOM after the sheet closes; `offerRestore` never writes it. |
| **PR-5** (step-1) | Restore validated | — | — | **fail** | Coverage critic, uncontested. Restoring your own backup **mid-session** after opening any card leaves today's card note in place: `state = st` at L6083 is followed by `flushSave()` at L6100, whose first act is `persistEditor(); persistCard();` (L1011-1017), copying the *replaced* session's live DOM into the restored record. It persists, survives reload, and re-restoring the same file does not fix it. Verified statically in the final bytes. |

**Fixed during this run and re-verified:** the hostile-backup execution defect (`<img onerror>` in a restored scene doc executing when the scene is opened; ED-6) was found by probe triage and closed by commit `8d14da4`, which runs `sanitizeHTML` over every restored scene doc and card note. `vp-sk-pr5-restore-hostile-doc.mjs` now reports PASS. Two copy defects (`Remove codex (use sample)`, "fall back to the sample tongues") and a harvested-quote shape bug were fixed in the same window (`8d14da4`, `0e5b9a4`).

---

## Open defects, most severe first

### D1 — A translation made at the START of a paragraph is moved to the END of it (TX-11d, TX-7, TX-12)
Highlighting the phrase a block opens with and translating it appends the span after the words that followed it. Ordinary action, no hostile input, reproduced on a document built entirely by typing.

- Probe `cf-adv-loop-blockstart.mjs`: `FAIL S1 head of the first paragraph: the span reads where the author put it — before the words that followed it  script starts at 11, the author's "at the gate" at 0`. Same failure S2 (later paragraph), S3 (heading, Celan High), S4 (blockquote, Evernessian).
- Probe `cf-adv-loop-blockstart-typed.mjs`, typed document: `after translate: opening·line<p>&nbsp;·at·the·gate<span class="tspan" data-lang="kildaren" data-src="the·sea·remembers" …>`.
- Earlier isolation `cf-ref-span-placement.mjs`: START `→ "· alpha bravo{T:the sea remembers}"` FAIL; MIDDLE and END ok.
- Cause (verified in the final bytes): `placeTSpan` L4038-4044 — `hostBlock.appendChild(live)` returns a hoisted span to the block's **end**, which is correct only when the selection ran to the block's end. `insertHTML` also drops the span out of its block for a leading selection, so the repair fires and teleports it.
- Reverting compounds it: `FAIL revert leaves no span behind 1`, `FAIL revert leaves no script behind 22` — the document ends up holding both the span and a duplicate of the English. In the heading case the following `<p>tail</p>` is absorbed into the `<h2>`, demoting a manuscript block to inline text.

### D2 — Mid-session restore silently keeps today's mistake (PR-5)
- Probe `cc-restore-midsession.mjs`, all real UI: `FAIL restore brings the card note back — today's note must be gone "<p>TODAY mistaken note.</p>"`, `FAIL the restored card note is what got persisted` (read back out of IndexedDB after a reload), `FAIL restoring the same backup again recovers the card note`. Control: `ok CONTROL: the same restore works when the session has not opened the card (post-reload)`.
- Cause: `offerRestore` L6083 `state = st;` → L6100 `flushSave()` → L1013 `persistEditor(); persistCard();` writes the replaced session's `ccTitle`/`ccNotes` over the restored card, because `currentCardId` is cleared only on card *delete* (L5125) and the restore jumps home with `navStack = ['library']` rather than popping. The scene escapes only by accident, because `#ed-back → pop() → closeEditor()` clears `currentSceneId` first.
- Fix shape: clear `currentSceneId`/`currentCardId` (or take the snapshot) **before** `state = st`. The same one line also closes the latent scene-side hole any future home/deep-link route would open.

### D3 — A translation inside a list item leaves a duplicate raw PUA run that ships to three formats (TX-11, TX-9, TX-12)
- Probe `cf-adv-ex-pua-leak.mjs`: `FAIL TX-11 md: not one private-use codepoint  e60a e61f e600 e61a …`, same for txt and docx; leak by tongue `kildaren(btt-stave, in list): 9  kerrackian(rtl, in list): 14  celan_high(cols-rtl, in paragraph): 0`.
- Probe `cf-adv-loop-li-leak.mjs`, document built by typing plus the toolbar's bullet button: `PUA inside spans=5  PUA loose in the prose=5`, `FAIL every script character in the document lives inside a span`, `FAIL the Markdown export carries no raw script characters`, `FAIL the plain-text export carries no raw script characters`.
- Cause: `placeTSpan`'s list-item fallback (L4020-4030) re-inserts the span by hand when `insertHTML` "reported success but dropped the element" — but `insertHTML` kept the span's **text** and nothing removes it. The loose run has no `data-src`, no sheet, survives revert, and because it carries no `.tspan` class, `mdInline` (L1976), `tspanPlain` (L2030) and `docxRunsFrom` (L2261) all print it verbatim. The same stored doc feeds `epubSceneInto` and the PDF writer.

### D4 — `cols-rtl` splits one word across two columns on ordinary English (TX-6)
- Probe `cf-adv-colcap.mjs`: `sweep: 166464 ordinary-English phrases from the codex's own lexicon`, `phrases whose script contains a word of >= 22 cells: 1273`, `longest: "the sea remembers the growing blessing" -> 37 cells`. Through the real editor: `cells per word = 4,8,2,8,2,37,1`, `columns occupied per word = 1,1,1,1,1,2,1`, `x-spread within each word (px) = 0,0,0,0,0,24.3,0` — the continuation column is pitched identically to the gap between genuine words, so a reader cannot tell it from a new word.
- Cause: `max-height:var(--tsrun,22em)` with `word-break:break-all` at L3365 (forge CSS) and **L2508 (`EPUB_CSS`)**; `--tsrun` is never assigned anywhere in the file, so 22 cells is always in force. The `btt-stave` control on the same phrase passes (`max-height:none`), isolating the cap as the cause. Because the rule is in `EPUB_CSS`, the break ships to readers.

### D5 — A PDF exported one tap too early carries no script at all (TX-10b)
- Probe `cf-adv-pdf-forge-race-slow.mjs` (CDP `Emulation.setCPUThrottlingRate 20`, phone-like): `sheet opened at +9640ms; forge map when the sheet opened = {"forged":null,…}` → `early PDF: {"bytes":2529,"type0":0,"fontFile2":0,"glyphRuns":0,"italicRuns":18}` → `FAIL a PDF exported one tap too early still carries the script`. Control after the wake, same book, no edit: `{"bytes":65575,"type0":2,"fontFile2":2,"glyphRuns":49,"italicRuns":0}`.
- Cause: the PDF item's `onTap` (L2208-2213) is synchronous, where the EPUB item immediately below it awaits `ensureOmni()` / `forgeOmniFonts()` (L2217-2221). With no forged face, `pdfRunsFrom` substitutes the italic romanization for every span. No warning, no toast — the download just happens.

### D6 — PDF paints content off the page (TX-10b)
Three instances of one missing edge rule:
- Vertical blocks: `cf-pdf-block-overflow.mjs`, a 72-word `cols-rtl` span — `FAIL A: … rightmost column x = 761.92, page width = 595.28`; 437 cells, 145 past the right margin, 101 entirely outside the MediaBox. At Script size Huge: `rightmost column x = 1658.82`, 289 outside — 66 % of the passage is not on the paper.
- Deep columns: `cf-adv-deepcol-pdf.mjs` on the 37-cell word — `[huge] 62 script cells, size 25.3, y -169.15..741.65`, `FAIL Huge: every script cell sits inside the MediaBox (y >= 0)  lowest y=-169.15`; ten glyphs placed at negative y and lost from the printed page.
- Inline horizontal runs at **ordinary sentence length**: `cf-adv-pdf-inline-overflow.mjs` — `words=8 rightmost ink 560.2 <-- past margin`, `words=10 … 629.3 <-- OFF PAPER`, `words=12 … 706.0`; a normal 15-word Calgridarian sentence ends at 640.26 pt on a 595.28 pt page.
- Cause: `scriptBlockSize` (L2760-2765) computes the block's width `w` and **no caller reads it**; the block flow (L2818-2827) calls only `need(box.h + 10)`; `drawScriptBlock` lays columns at `x + ci * pitch` with no right-edge test; `putAtom` (L2810-2815) pushes an over-wide atom anyway; `drawScriptInline` (L2747-2757) advances `cx` with no edge test. The same hole drops a 193-character Latin word's ink at 1010.9 pt.

### D7 — PUA reaches the Claude request body (TX-14)
- Probe `cf-adv-assist-tenebrae.mjs`: the app's own Ctrl+C over a rendered span puts the script on the system clipboard (`U+E612 U+E608 U+E600 …`, 44 codepoints — there is no `copy` handler anywhere in the file); an ordinary rich paste is **safe**, but a paste-and-match-style of that same clipboard gives `<scene>\nA clean opening line. [44 PUA]\n</scene>` → `FAIL NO PUA codepoint in the request body … leaked 44`. Card titles harvested from such text leak into the cards body too (`leaked 12`).
- Probe `cf-assist-nosend.mjs` adds a second route: `sanitizeHTML` promotes a `data-src`-less span's script to bare prose, and `claudeSceneText` then sends all 46 PUA characters.
- Cause: nothing in the artifact filters U+E000–U+F8FF (`grep` for the range finds only `AURIC_BASE`/`AURIC_TOP` at L3158). One strip in `claudeSceneText`, plus the same on the `known` card titles, closes every path.

### D8 — A pre-boot import routes through the legacy sample cipher and permanently mislabels the tongue (TX-1)
- Probe `cf-ref-tx1-preboot-import.mjs`: with `indexedDB.open` answering 3 s late (the real database, just slow — the case `setTimeout(resolve, 2500) // safety: never hang boot` at L939 exists for), the library screen and its handlers are already live while `state.codex` is still null. Importing a Tenebrae Markdown file through the real UI gives `R2 spans …: [{"lang":"celan-basic","src":"the sea remembers","rom":"te meres memnerin","omni":null}]` — the legacy cipher's output, byte for byte. Not transient: the file recorded `celan_high`, the cipher collapsed the unknown id onto `languages[0]`, and after boot `rerenderAllSpans` recompiles from the corrupted attribute — `data-lang="celan_basic" data-rom="mara memora"` where the author wrote Celan High.
- Cause (verified in the final bytes, L3825): `makeTSpan` is the only translation-capable entry point without `ensureCodexInstalled()`; `resolveTranslate` (L3763) and `tonguesList` (L3769) both have it. One line at the head of `makeTSpan` closes it.
- Caveat stated plainly: the slowness is injected by the probe, and a human must complete a native file picker inside 2.5 s. The path, the degraded-boot mode and the corruption are the app's own.

### D9 — Verified-claims guarantees have two holes (TX-15)
- Chained anchors: `cf-adv-assist-overlap.mjs` — both anchors unique in the manuscript the model read; after accepting `{reeve→drover}` then `{drover→ferryman}` the text reads `"The ferryman stands at the gate.…The drover walks the long road home."` — fix 2 landed on the word fix 1 manufactured. Uniqueness is checked once at offer time (L4591); `claudeApplyFix` takes the first document-order match with no re-check (L4664-4670). Needs a colliding single-token anchor; a two-word anchor landed correctly.
- Fabricated quotes spanning a paragraph break: `cf-adv-assist-apply.mjs` — model quote `"the sea remembers the old king. The lamp held steady"`, `kept: [...]`, `literally present in payload: false`. `claudeSceneText` joins blocks with `\n\n` (L4541) and `norm()` (L4640) collapses it. The world bible stores a sentence the author never wrote. The stored quote is also the model's raw string, not the matched scene slice, so curly-quote folding leaves non-verbatim text on the card.
- A fix's **replacement** text is never inspected at all: PUA script and a U+202E RTL override both survive to the offer.

### D10 — A malformed-but-parseable answer is reported as good news; a hung request says nothing (TX-16)
- `cf-adv-assist-failure.mjs`: `{"fixes":"none at all"}`, `{}` and `{"fixes":null}` all produce `Nothing to correct — the scene reads clean` — byte-identical to the genuinely-clean toast measured in the same run. Cards pass gives `Nothing new to file` for the same three shapes. Cause: `Array.isArray(out.fixes) ? out.fixes : []` (L4584) and `Array.isArray(out.cards) ? out.cards : []` (L4638).
- No `AbortController`, no timeout anywhere in `claudeAsk` (verified: the only `fetch(` in the file is L4500 and there is no `signal:`): `after 15s on a request that never answers, toasts: ["Reading the scene…"]`.

### D11 — Undo leaves accumulating residue; redo does not reproduce the insertion (TX-9, TX-11d)
- `cf-adv-loop-residue-real.mjs`, typed document, five translate/undo cycles: `empty marks after each cycle: [1,2,3,4,5]`, saved doc `<p>and·<b></b><b></b><b></b><b></b><b></b><b>the·sea·remembers</b>·now</p>`.
- Redo, codepoint level on a plain paragraph: inserted tail `… e600 2c 20` vs redone `… e600 a0 2c 20` — redo puts an NBSP back before the comma, the exact `stand , and` typo the pad rule exists to prevent. `FAIL P3 … redo puts the span back, repair and all [["","1",21]] vs [["P","1",21]]` — the redone span becomes a direct child of `#ed-content`, outside its paragraph.
- Cause: the placement repair (L4038-4052) and the pad rule (L4059-4076) are raw DOM edits made **after** the `execCommand`, so the undo stack neither reverses nor replays them.
- Related, same region: the pad-ownership rule reads `live.nextSibling` (L4060) *after* the rewrap loop has moved `live` inside a fresh wrapper, so `data-pad` is never set on a repaired placement and revert leaves a stray space (`a··tail` where the author had `a·tail`, five cycles out of five). A second trigger exists on cross-block selections, where the span ends as its block's last child and the pad is left in the following node — a fix that only re-locates the pad after the rewrap loop will not cover it.

### D12 — The sheet's own actions strip the author's formatting (TX-8)
`cf-loop-realui.mjs`, document built with the real toolbar: `after translate : B>H2 bold=true weight=900` → `after change tongue : H2 bold=false weight=700`, `FAIL 2: change tongue kept the author's BOLD run`. Cause: `retranslateSpan` (L3864) re-inserts through `rangeAround(el)` with none of `placeTSpan`'s `hostBlock`/`inlineChain` repair.

### D13 — Markdown round-trip is not exact (TX-11b)
- In-scene ⁂ consumed: `cf-ex-md-marker-roundtrip.mjs` — `preview stats: "2 chapters · 4 scenes · 18 words"` for a 2-chapter/3-scene book; `FAIL A: the in-scene ⁂ stays an asterism inside its scene`. `mdFromDoc` L2007 and `compile`'s sep L2060 emit the identical `⁂` line, and `structureFromBlocks` L5820-5821 splits on it even in `mark` mode. No split-rule setting rescues it: `cf-ex-md-splitrule.mjs` — `modes that reproduce the original exactly: []`.
- Export options: `cf-adv-ex-md-optionsmatrix.mjs` on a clean book — `chapterTitles=0 sceneTitles=1` → `[{"t":"First Light","s":[""]},{"t":"Second Sight","s":[""]},{"t":"Third Watch","s":[""]}]` (marked *scene* titles opened as chapters, because L5806 tests `b.level === chapterLevel` before the `mode === 'mark'` branch and `chapterLevel` collapses onto 3); `chapterTitles=0 sceneTitles=0` → 3 scenes become 2 (chapter chunks joined with a bare `\n\n`, so the boundary carries no separator).
- Empty chapter gains a phantom scene (L5836-5839).
- Import preview misreports the active split rule (L5849 reports `mark` as `h`), so clicking the preselected button produces a different book and the author cannot get back.

### D14 — An imported span naming an unknown tongue is silently relabelled, or degrades to Latin (TX-9)
`cc-legacy-tongue-crossformat.mjs`: a Tenebrae `.md` naming `rath-speech` (one of the seven tongues step-1 offered; now dead in the codex) imports as `celan_basic` and **re-exports as `"language":"celan_basic"`** — the author's record of which tongue a passage was in is destroyed with no notice. A span naming `klingon` renders as English in the UI serif stack while still carrying `class="tspan"` — the Latin-fallback state TX-9 forbids. What holds: no tofu, no orphaned PUA, no missing font rule, no export exception.

### D15 — Two TrueType spec deviations, one of which ships in every EPUB (TX-4)
`cf-forge-ttf-spec.mjs`: `boot-celan_basic.ttf glyphs=2 bbox=[9999,9999,-9999,-9999] sane=false`, and `epub-embedded Auric face: [9999,9999,-9999,-9999]`. Cause: `forgeTTF` initialises the sentinels at L2999 and only moves them from glyphs that *have* contours; `auricRebuild` is called at boot with an empty word list, and `epubFontEntries` (L2517-2531) pushes every value of `omniForged` unconditionally — so a book that never uses Celan Basic ships an inverted-bbox font. Second: `post.isFixedPitch` is the hardcoded `u32(1)` at L3094 on all six faces, none monospaced (advances 400/700/1000 and 340/800/1000). Confirmed not to reach a PDF (the PDF writer hardcodes `/FontBBox [-250 -300 1400 900]` at L2885); the damage is confined to EPUB and other downstream TTF consumers. Related dead weight: every EPUB embeds all ten faces including the four legacy sample ones.

### D16 — Byte-determinism breaks on first-write order (TX-10b, TX-4)
`cf-adv-pdf-det-order.mjs`: two cold starts from the same stored state are byte-identical (`8421 vs 8421, first difference at -1`), but `FAIL B: exporting one scene first does not change the bytes of the book export … first difference at 578; plain cold [porta osca en dawna mara memora aneth regath] after scene export [mara memora aneth regath porta osca en dawna]`. Same state, same session, same book, two different files depending on which button was pressed first. Cause: Auric codepoints are minted in first-write order (`AURIC_BASE + A.order.length`, L3187) and `pdfFile` writes those ids straight into the page. The drift is visual-neutral (decoded outlines identical at identical placements), but the clause says byte-deterministic.

### D17 — `sanitizeHTML` destroys a `data-src`-less span and promotes its script to bare prose
L1041 keeps a `.tspan` only `if(child.classList.contains('tspan') && child.dataset.src && child.dataset.lang)`, else `unwrap(child)` (L1068). Measured: a span with `data-src=""` comes back as `<p>[46 PUA chars]</p>` with no tspan. `persistEditor` (L1453) runs this on every editor persist, so it is not restricted to hostile files. The reader loses tap-back to English, the text loses its forged font, and the script becomes sendable prose (feeds D7). Related: `selTextFromRange` (L3882) falls back to `data-rom` when `data-src` is empty, so a selection over such a span yields **romanization**, which flows into card titles and saved quotes and from there into the cards request body.

### D18 — Cosmetic / hygiene
- Importing the real codex file by the name `codex.html` labels it `v?` (L4227 derives the version from the filename or the first 4,000 characters); the placeholder reaches the codex sheet and the exported filename.
- `insertHTML` junk wrappers (`<span style="font-size: 18px;">`, `<span style="color: rgb(33,30,28);">`) are left inside headings and blockquotes on a leading selection and survive into the saved manuscript.
- `auricRebuild` re-forges the entire face on every batch that adds a word — O(n²) if words arrive singly, 2.87 MB at the cap — and each rebuild drops and re-adds the `FontFace`, leaving a brief tofu window (this is the mechanism behind the `s2-ux-sheet-bigrender` suite flake).
- Auric block exhaustion (4,352 distinct words, reachable in a real novel) is a silent, session-long cliff: the span is declined with no message and only a reload recovers.
- EPUB re-import loses scene titles when a ⁂ separator is present (`mode` becomes `sep`, so the `h2`s read as in-scene headings).
- Per-language EPUB CSS is correct only by document order: four tongue ids collide between the legacy sample rules and the forged rules at equal specificity. Same class of race in the head styles, where `#omni-style` beats `#codex-style` only because the forge's 600 ms timer normally lands after four `FontFace.load()` calls.
- `window.tenebrae.translate` (L4425) routes real codex tongue ids into the legacy cipher's fallback language and returns plausible-looking output. It caused four of the six red probes in one domain. Rename it `translateSampleLegacy` or remove it.
- **Standard is stale, not the artifact:** `step1-requirements.md` L68 (TR-1) still requires seven tongues and a sample-codex disclosure, and L77 (PN-2) still says "sample codex or imported codex". Both are superseded by TX-1, which forbids exactly what they require. A future certifier reading the step-1 standard alone will re-file three false findings.

---

## What remains untested, and why

**Cannot be tested in this environment**

1. **The live Claude API.** No API key. Every assist finding is against a stubbed `fetch`. Untested: whether `anthropic-dangerous-direct-browser-access` actually works against the live endpoint; whether the real model honours the closed `output_config` schema (which is what makes D10's wrong-shape case rare rather than routine); real refusal and rate-limit bodies; real latency and streaming; real token accounting against `max_tokens: 8000` on a long scene. TX-13/14/15/16/17 are certified on *the writer's* handling, not on the API's behaviour.
2. **macOS, iOS and Safari.** Every probe is Chromium via Playwright on Linux. This is a phone-shaped app and WebKit differs in exactly the places it is built on: `contenteditable` + `execCommand('insertHTML')` fragment repair (the whole of D1/D11), `writing-mode: vertical-lr` + `text-orientation: upright` metrics (D4 and all of TX-6's geometry), `document.fonts` / `FontFace` timing (the tofu window and D5's race), and IndexedDB eviction. **TX-6's layout evidence and TX-11d's placement evidence do not transfer to Safari untested.**
3. **No real device.** The slow-boot window in D8 and the forge race in D5 were produced with an injected IDB delay and CDP CPU throttling. Real-phone timings are unknown, and could be worse.
4. **No real e-reader, no Word, no printer.** The EPUB is proved strict-XML valid with every font manifested and every cmap covering; it has not been opened in Apple Books, ADE, Kobo or Calibre. The `.docx` is proved to be well-formed OOXML with correct run structure; Word has never opened it. The PDF is proved correct by a custom decoder (`cf-pdfcheck2.py`: object graph, xref, `/Length`, fontTools on every `FontFile2`, glyph ids through the embedded cmap); Acrobat has never opened it and nothing has been printed. **D6 in particular means the printed result is known to be wrong — but "how it prints" is otherwise unmeasured.**

**Not covered this round, testable in principle**

5. **TX-12 was assigned to no domain.** Its own suite probes are green, but no adversarial work was aimed at the id. Its status here is derived from other domains' defects (see the row).
6. **The full suite was not re-run after the mid-run commits.** The appendix numbers predate `8d14da4` and `0e5b9a4`. Those two commits changed sheet copy, added `sanitizeRestoredBooks`, and fixed the harvested-quote shape; I re-verified every defect site cited above against the final bytes by hand, but the 142-probe suite has not been re-run end to end on `4a7a120d`.
7. **Scale.** No manuscript of real novel length has been written, exported or restored. The Auric 4,352-slot cap was reached synthetically in one batch, not by writing. Export timings, IndexedDB size limits and the O(n²) forge rebuild are unmeasured at book scale.
8. **The harvested-quote fix (`8d14da4`) is verified only by inspection**, not by a probe that harvests cards through the real API path (which needs a key — see 1).
9. **Accessibility.** Nothing tested: screen readers, focus order, contrast, reduced motion, or what a screen reader does with a PUA run in a forged font (almost certainly nothing useful — the PDF also carries no `/ToUnicode`, so exported script cannot be copied, searched or extracted).
10. **Multi-device / shared-backup behaviour** beyond the key-leak check: no test of two devices editing the same manuscript, or of a backup taken on one build restored on another.

---

## Appendix A — deterministic suite result

Full probe suite, run immediately before this workflow against the bytes then in the working tree: **142 probes, 108 PASS, 18 not passing.** Probes with no `VERDICT` line are diagnostics and are excluded from the tally.

| probe | suite result | triage | outcome |
|---|---|---|---|
| `cc-probe1.mjs` | CRASH | stale ×2 (forge-record shape assumed an alphabet for the word script; codex ground truth silently degraded to `coreTranslate`) | probe fixed; 50 rows, 0 romanization mismatches |
| `s2-ux-sheet-bigrender.mjs` | FAIL | stale (demanded the legacy `Tenebrae Celan Runes`; boot now forges `Tenebrae Auric Runes`) — also flaky via the `FontFace` reload window | probe fixed and strengthened; PASS |
| `st-editor-save.mjs` | UNKNOWN | stale (verdict line carried prose; the tail-loss hole it noted is closed) | fixed, one check promoted; PASS |
| `st-offline-network.mjs` | FAIL | stale (counted `request` events; the codex's own `@import` is CSP-refused before the wire) | rewritten to require zero *responses*; PASS |
| `tr-alias-roundtrip.mjs` | CRASH | stale (waited for `Rath-Speech`, dead in the codex) | retargeted to two live tongues; PASS |
| `tr-codex-zip.mjs` | FAIL | stale, and the old expectation is now *forbidden* by TX-1 | rewritten; PASS |
| `tr-determinism.mjs` | FAIL | stale (drove the legacy seam; counted request events) | rewritten onto `translate2`; PASS |
| `tr-tongues.mjs` | FAIL | stale (asserted seven tongues + sample badge, both superseded by TX-1) | roster now read from the codex; PASS |
| `tx-engine-always.mjs` | CRASH | environmental/flaky — one domain reproduced a `TimeoutError` ("element is not stable") even running alone | wait budgets raised; PASS standalone, **but unreliable as a certification artifact** |
| `tx-vp-glyph-vector-truth.mjs` | CRASH | stale (iterated the forge map and assumed every face has `TRANS[].L.script`; Celan Basic has none, by design) | word script skipped explicitly; PASS |
| `vf-cd3-block-junction.mjs` | UNKNOWN | stale (tri-state verdict; the defect is fixed — `plainOfHTML` injects block separators) | PASS |
| `vf-ed1-flush.mjs` | UNKNOWN | stale (the hole is closed — `flushSave` pulls the DOM into state first) | PASS |
| `vf-ex2ex5-firstline.mjs` | FAIL | stale (legacy seam for the expected romanization) | PASS |
| `vf-pr4-codex-network.mjs` | UNKNOWN | not a failure — verdict line carried trailing prose | PASS |
| `vp-cd6-card-over-editor.mjs` | UNKNOWN | stale (fixed CSS hierarchy superseded by nav-order inline z-index) | PASS |
| `vp-ex5-span-export.mjs` | FAIL | stale (legacy seam); also does not reproduce standalone | PASS |
| `vp-sk-pr5-restore-hostile-doc.mjs` | CRASH | **REAL DEFECT** — file was also checked in truncated, so it hung to the 15-min SIGKILL | probe completed; defect confirmed (`window.__restorePwn === 1`), **fixed in `8d14da4`**, now PASS |
| `vp-tr2-det-reload.mjs` | FAIL | stale (legacy seam; 7 tongues; counted request events) | PASS |

Triage outcome: **17 of 18 were stale probes or environmental flakes; 1 was a real defect, now fixed.** Two harness lessons are recorded for future runs: `_runall.mjs` L23 scores only a bare `VERDICT: PASS|FAIL` at end of line, so four green runs were misfiled as UNKNOWN; and a probe checked in without a `browser.close()` tail costs 15 minutes of wall clock per run.

## Appendix B — probes added this round

All runnable with `cd /home/user/MonoFX/tenebrae/certification/harness/probes && node <file>`. None modifies `step1.html` or any standard; scratch output goes to the scratchpad only.

**Engine** `cf-tx1-persistence-paths.mjs`, `cf-tx2-parity-extended.mjs`, `cf-tx3-determinism-axes.mjs`, `cf-ref-tx1-preboot-import.mjs` (FAIL — D8), `cf-ref-tx2-uiparity.mjs`, `cf-ref-tx3-cold-history.mjs`, `cf-diag-engine-seams.mjs`, `cf-net-trace.mjs`, `cf-pr4-boot-wire.mjs`, `cf-forgemap-shape.mjs`, `cf-codex-compiletext.mjs`
**Script** `cf-forge-ttf-spec.mjs` (FAIL — D15), `cf-script-longword-layout.mjs`, `cf-auric-mint-drift.mjs`, `cf-auric-block-exhaustion.mjs`, `cf-auric-word-identity.mjs`, `cf-adv-span-truth.mjs`, `cf-adv-colcap.mjs` (FAIL — D4), `cf-adv-auric-allloan.mjs`
**Loop** `cf-loop-shapes.mjs`, `cf-loop-decline.mjs`, `cf-loop-undo-repair.mjs` (FAIL), `cf-loop-repair-residue.mjs` (FAIL), `cf-loop-sheet-inplace.mjs` (FAIL — D12), `cf-loop-realui.mjs` (FAIL), `cf-loop-diag.mjs`, `cf-adv-loop-alltongues.mjs`, `cf-adv-loop-flowswitch.mjs`, `cf-adv-loop-revert-truth.mjs` (FAIL), `cf-adv-loop-residue-real.mjs` (FAIL — D11), `cf-adv-loop-undo-typing.mjs`, `cf-adv-loop-decline-edge.mjs`, `cf-adv-loop-blockstart.mjs` (FAIL — D1), `cf-adv-loop-blockstart-typed.mjs` (FAIL — D1), `cf-adv-loop-li-leak.mjs` (FAIL — D3), `cf-ref-span-placement.mjs` (FAIL — D1)
**Exports** `cf-ex-epub-roundtrip-shape.mjs`, `cf-ex-degenerate-formats.mjs`, `cf-ex-gloss-toggle.mjs`, `cf-ex-md-marker-roundtrip.mjs` (FAIL — D13), `cf-ex-md-splitrule.mjs` (FAIL — D13), `cf-ex-md-clean-foreign.mjs`, `cf-adv-ex-epub-staleauric.mjs`, `cf-adv-ex-epub-xmlhostile.mjs`, `cf-adv-ex-legible-alltongues.mjs`, `cf-adv-ex-pua-leak.mjs` (FAIL — D3), `cf-adv-ex-md-optionsmatrix.mjs` (FAIL — D13)
**PDF** `cf-pdf-hostile-layout.mjs` (FAIL — D6), `cf-pdf-block-overflow.mjs` (FAIL — D6), `cf-pdf-determinism-reload.mjs` (FAIL — D16), `cf-pdf-literal-escapes.mjs`, `cf-pdfcheck2.py`, `cf-adv-pdf-alltongues.mjs`, `cf-adv-pdf-inline-overflow.mjs` (FAIL — D6), `cf-adv-pdf-det-order.mjs` (FAIL — D16), `cf-adv-pdf-forge-race.mjs`, `cf-adv-pdf-forge-race-slow.mjs` (FAIL — D5), `cf-adv-deepcol-pdf.mjs` (FAIL — D6)
**Assist** `cf-assist-gate.mjs`, `cf-assist-nosend.mjs` (FAIL — D7), `cf-assist-guardrails.mjs` (FAIL — D9), `cf-assist-failures.mjs` (FAIL — D10), `cf-assist-key.mjs`, `cf-adv-assist-boot.mjs`, `cf-adv-assist-tenebrae.mjs` (FAIL — D7), `cf-adv-assist-spanguard.mjs`, `cf-adv-assist-overlap.mjs` (FAIL — D9), `cf-adv-assist-apply.mjs` (FAIL — D9), `cf-adv-assist-failure.mjs` (FAIL — D10), `cf-adv-assist-keybytes.mjs`
**Coverage** `cc-restore-midsession.mjs` (FAIL — D2), `cc-legacy-tongue-crossformat.mjs` (D14), `cc-assist-pad-span.mjs`

## Appendix C — recommended fix order

1. `placeTSpan`: distinguish the block-START case from the block-END hoist (D1), and take the pad *before* the rewrap loop (D11). Same function, one review.
2. `offerRestore`: clear `currentSceneId`/`currentCardId` before `state = st` (D2).
3. `placeTSpan` list-item fallback: remove the text `insertHTML` left behind (D3).
4. `cols-rtl`: derive the column cap from the codex's longest producible word, or drop the cap; fix `EPUB_CSS` in the same edit (D4).
5. PDF export item: `await ensureOmni()/forgeOmniFonts()` as the EPUB item does (D5).
6. `claudeSceneText` and the card-title list: strip U+E000–U+F8FF (D7).
7. `makeTSpan`: `ensureCodexInstalled()` first statement (D8).
8. PDF layout: use the `w` that `scriptBlockSize` already returns; add a right-edge test to `drawScriptInline` and a column cap to `drawScriptBlock` (D6).
9. `claudeApplyFix`: re-check anchor uniqueness at apply time; match card quotes per block and store the matched slice (D9). Throw on a non-array `fixes`/`cards`; add an `AbortController` timeout (D10).
10. `structureFromBlocks`: consult `b.scene` before the `chapterLevel` test in `mark` mode; stop splitting on `⁂` in `mark` mode; give the in-scene asterism its own marker (D13).
11. `forgeTTF`: clamp the `head` bbox to zeros when no glyph has contours; set `post.isFixedPitch` from `hmtx` (D15).
12. Update `step1-requirements.md` TR-1/PN-2 to record that TX-1 supersedes them (D18).
