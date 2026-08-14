# Tenebrae Writer — Product & Technical Specification

## TL;DR
- **Build a PWA-first, offline-capable rich-text manuscript editor in React/TipTap** with a hard architectural rule that Claude never generates prose (grammar suggestions + card extraction only), translation is 100% deterministic from your Codex Omnilingua engine, and every artifact exports to .md/PDF/DOCX/.doc-compat/EPUB with no lock-in.
- **The single hardest technical problem is conlang-font fidelity through exports.** Because target renderers (Kindle KFX especially, pdf-lib, Word by default) will not reliably honor your OpenType GSUB ligatures at render time, the spec mandates **pre-shaping** every translated span in-browser (fontkit `font.layout()` or harfbuzzjs) and embedding either shaped-glyph runs or vector outlines — never relying on downstream feature support.
- **Ship in three phases:** MVP (editor + manuscript structure + Markdown/DOCX/EPUB export + Cards), v1 (deterministic translation spans + full per-format conlang fidelity + PDF), v1.5 (Claude grammar/card layer + Capacitor App Store wrap).

## Key Findings

**Competitive lessons.** Scrivener's binder/corkboard is the organizational gold standard but its Dropbox-based iOS sync is a chronic pain point: Literature & Latte's own forums document users hitting errors such as *"Invalid Project. The project cannot be opened because it does not contain a valid binder structure file"* and Dropbox's *"1 file might not update"* / Scrivener's *"Invalid file"* during sync. An offline-first, single-store local model avoids this entire failure class. Ulysses and iA Writer prove writers love Markdown portability and distraction-free editing. World Anvil and Campfire are the closest analogs to the Cards system: World Anvil's `[@King Aldric]`-style interlinking that turns a manuscript into a navigable wiki is the pattern to adopt; its complexity is the trap to avoid. Atticus and Vellum are the export benchmark — writers accept a one-way "compile to publish" step and expect EPUB that renders identically across Apple Books/Kobo/Kindle. On AI: fiction communities are actively hostile to AI that writes prose (the Sudowrite backlash) but broadly accept AI that assists — grammar, consistency, and organization. Luc's "Claude never writes" rule is exactly aligned with what the market's most vocal writers demand.

**Editor engine.** TipTap (ProseMirror) is the right choice over Lexical for this app: its mark/node/decoration model maps cleanly onto translated spans and card mentions, it has a mature extension ecosystem, and it stores content as portable ProseMirror JSON. The one caveat is that ProseMirror's document model can slow with very large single documents (10K+ nodes) — mitigated here by the scene-based structure (each scene is a separate small doc).

**Export libraries.** Markdown is trivial (serialize from JSON). DOCX via the `docx` npm library, with fonts embedded as TTF (OTF/CFF cannot be embedded in Word). PDF is the critical fork: PDFKit and @react-pdf/renderer call fontkit's `layout()` and apply GSUB ligatures by default for LTR text, but neither does bidi/RTL reordering, and pdf-lib does not shape at all (cmap-only). EPUB 3 via JSZip with @font-face embedded fonts and CSS `writing-mode`/`direction`. True binary .doc is a dead end — no modern JS writes it — so .doc is handled as a compatibility export (RTF or DOCX-served-as-.doc).

**iOS PWA reality (2026).** Installed PWAs work well for this use case, but per WebKit's own tracking-prevention policy, ITP *"deletes all cookies created in JavaScript and all other script-writeable storage after 7 days of no user interaction"* — covering IndexedDB, LocalStorage, Service Worker registrations and cache. Crucially, WebKit states that home-screen web apps have *"their own counter"* and that it *"would consider it a serious bug"* if a first-party home-screen web app had its data deleted — which materially strengthens the case for the Add-to-Home-Screen install path plus a Capacitor wrap. There is also a history of IndexedDB instability on iOS. This mandates OPFS for large blobs, `navigator.storage.persist()`, aggressive export/backup nudges, and a Capacitor wrap for App Store distribution where packaged assets aren't subject to the same eviction.

## Details

### 1. Product vision & non-negotiable principles

Tenebrae Writer is a mobile-first fiction-writing environment purpose-built for authoring inside a constructed world with its own writing systems. It is not a general word processor and not an AI co-writer. It is a manuscript editor + a lightweight world-wiki + a deterministic conlang typesetting engine, unified so that a writer on a phone can draft prose, harvest that prose into interconnected lore cards, drop in correctly-rendered Tenebrae-language passages, and export a publication-quality file — all offline.

**Non-negotiable principles (encode these as architectural invariants, not preferences):**

1. **AI never writes prose.** Claude is invoked only for (a) grammar/mechanics suggestions presented as accept/reject diffs and (b) extracting structured cards (people/places/things) with keywords and *verbatim* quotes lifted from the author's own text. There is no "continue writing," "rephrase," "describe," or "brainstorm" surface anywhere in the product. This is enforced at the API layer (see §5) via constrained tool schemas that structurally cannot return generated narrative.
2. **Translation is deterministic and codex-owned.** All Tenebrae translation is produced by the Codex Omnilingua engine/data — never by Claude. The same source sentence always yields the same output. Claude has no role in translation.
3. **Everything is exportable; no lock-in.** Every document, card, and translation span round-trips to open formats. Source text for every translated span is stored losslessly so nothing is trapped inside a rendered glyph run.

### 2. Competitive analysis summary

| App | Organization model | Wiki/worldbuilding | Export | Mobile | AI stance | Lesson taken |
|---|---|---|---|---|---|---|
| **Scrivener** | Binder + corkboard + outliner (gold standard) | Research folders, no true wiki links | Powerful "Compile" | iOS app, Dropbox-sync is a chronic failure point | None built-in | Adopt hierarchical structure; **reject external-cloud sync** in favor of offline-first local store |
| **Ulysses** | Markdown "sheets," flexible groups | None | PDF/EPUB/DOCX/HTML | Apple-only, iCloud sync praised | None | Markdown portability + distraction-free writing |
| **iA Writer** | Plain-text folders | None | Markdown-centric | Minimalist, cross-platform | None | Focus mode; syntax-light writing |
| **Dabble** | Scenes/chapters + plot grid | Story notes | Limited (no pro formatting) | Good cross-device sync | None (deliberately) | Simplicity; better sync than Scrivener |
| **Novlr / First Draft Pro / LivingWriter** | Chapter/scene + templates | Story elements/auto-tracking | Varies | Cloud, cross-device | Assist-only (grammar) | Auto-tracked "story elements" ≈ Cards |
| **yWriter / bibisco / Storyist** | Scene cards, character DB | Character/location DBs | DOCX/EPUB (Storyist) | Cross-platform | None | Scene-card model; deep entity records |
| **Obsidian + Longform** | Markdown vault + Longform compile | `[[wikilinks]]` + backlink graph (best-in-class) | Compile to single doc | Mobile app + sync | Optional plugins | **Backlink graph + wikilinks are the Cards blueprint** |
| **Plottr** | Visual timeline/beats | Character/place cards | Companion tool | Cross-platform | None | Visual card/beat organization |
| **Campfire** | Modular (chapters + worldbuilding) | Interlinked elements, author-centric | Varies | Web | None | Author-first worldbuilding modules |
| **World Anvil** | Wiki articles + templates | `[@Entity]` interlinking, deepest codex | Web/PDF | Heavy on mobile | None | **`@`-mention interlinking = tag web**; avoid its complexity |
| **Atticus** | Write + format in one, cross-platform | None | **EPUB/PDF/DOCX benchmark** | Browser-based | None | Export-quality bar; one-click compile |
| **Vellum** | Format-only, Mac-only | None | **Industry-benchmark EPUB/PDF** | Mac desktop only | None | Per-retailer EPUB fidelity target |
| **JotterPad** | Markdown/Fountain mobile | None | Cloud print → PDF/DOCX/EPUB | Strong mobile (Android) | Assist | Mobile Markdown→multi-format export pipeline |

**AI reaction pattern (critical):** The Sudowrite launch triggered visible hostility among working writers ("the prose is fine but not quite yours"), while tools that *assist* (grammar, critique, organization) are broadly accepted. This validates the product's central guardrail.

### 3. Feature specifications

#### 3.1 Manuscript structure
Three-level hierarchy: **Book → Chapter → Scene**. Each Scene is an independent TipTap/ProseMirror document (keeps node counts low, preserves editor performance on long books, enables granular sync/versioning). Chapters and Books are containers with metadata (title, order, word-count goals, status: draft/revised/final). Drag-to-reorder at every level (Longform/Dabble pattern). A "Compile" step (Scrivener/Longform pattern) concatenates scenes with configurable separators into the export pipeline.

#### 3.2 Editor
- TipTap headless editor with a custom toolbar tuned for touch (large tap targets, no hover-only affordances — a Dabble complaint).
- Core marks: bold, italic, strike, underline, small-caps; block nodes: headings, blockquote, scene-break, lists.
- Two **custom** schema elements are the heart of the app:
  - **`cardMention` mark/node** — a decoration over a span that references a Card (like World Anvil `@`-mentions / Obsidian wikilinks). Tapping navigates to the card; the span is styled subtly.
  - **`translationSpan` node** — an atomic inline node holding both source text and rendered Tenebrae output (see §3.5).
- Focus mode, live word count, autosave to local store on every transaction (debounced).

#### 3.3 The Cards system
Cards are the world-wiki. **Card types:** Person, Place, Thing, plus extensible custom types (Faction, Event, Language, Artifact). Each card holds:
- Title + aliases (aliases power auto-linking).
- **Harvested keywords** and **verbatim quotes** — collected *only* from Luc's own manuscript text. This is the sole Claude "card creation" surface: Claude reads a passage and returns, via a constrained JSON tool schema, a set of {entity, type, keywords[], quotes[] (verbatim substrings with character offsets)}. Claude does not invent facts, summaries in its own words, or descriptions — only extraction and classification. The author edits/curates everything after.
- **Automatic tag-web linking:** when a card's title or alias appears in prose, the editor offers to create a `cardMention`. All mentions become edges in a **backlink graph** (Obsidian pattern): each card shows "mentioned in" scenes and "connected cards."
- **Separate card export** as Markdown (one file per card, wikilink-compatible) and JSON (full graph with edges) — the cards are portable independent of the manuscript, satisfying the "export and change separately" requirement.

#### 3.4 Grammar-check flow
- Author selects a scene or range → "Check grammar."
- Request goes to Claude (Haiku-class model for cost/latency) with a **strict tool schema** returning an array of `{range:{from,to}, type, original, suggestion, explanation}`.
- Suggestions render as **inline diffs with accept/reject** (Grammarly-style, but the model output is constrained to corrections only). A hard guardrail: any suggestion whose `suggestion` diverges from `original` beyond a mechanical-edit threshold (length ratio / semantic-rewrite heuristic) is dropped client-side, so the model cannot smuggle in prose rewriting.
- Accept applies a ProseMirror transaction; reject discards. Nothing is auto-applied.

#### 3.5 Tenebrae translation flow (deterministic)
1. Author highlights a sentence → "Translate to…" → picks one of the seven tongues (Celan Basic, Celan High, Kerrackian, Kildaren, Calgridarian, Evernessian, Rath-Speech).
2. The **Codex Omnilingua engine** (imported/bundled — see §5) performs deterministic translation: lexicon lookup, morphological rules, interlinear gloss. **Claude is not involved.**
3. The result is inserted as a `translationSpan` node storing `{sourceText, language, romanization, renderedForm, direction, font, glyphRun}`.
4. The span renders inline with the correct typeface (e.g., "Tenebrae Fallen Script" for Kerrackian), correct GSUB ligatures, and correct **direction/layout** (Kerrackian is written right-to-left even though the font renders LTR — handled at the text-layout level via `dir="rtl"` + `unicode-bidi: isolate` wrapping, so the RTL run is sealed from surrounding LTR prose).
5. **Source text is retained** for round-trip editing: the author can re-open, edit source, and re-translate; the rendered form is regenerated deterministically.

### 4. Data model

```
Book { id, title, order, meta }
Chapter { id, bookId, title, order, meta }
Scene { id, chapterId, title, order, status, doc:ProseMirrorJSON, wordCount }

// Marks/nodes inside Scene.doc:
cardMention (mark) { cardId }
translationSpan (inline atom node) {
  sourceText,            // lossless original, always stored
  language,              // one of seven Tenebrae tongues
  romanization,          // deterministic romanized form
  renderedForm,          // display string post-GSUB, or PUA-substituted string
  direction,             // "ltr" | "rtl"
  fontFamily,            // e.g. "Tenebrae Fallen Script"
  glyphRun               // pre-shaped {glyphIds[], advances[], offsets[]} for export
}

Card { id, type, title, aliases[], keywords[], quotes[{text, sceneId, from, to}], userNotes }
Link (graph edge) { fromCardId, toCardId | sceneId, kind:"mention"|"relation" }
```

Everything persists as JSON in the local store; exports are pure functions of this model.

### 5. Architecture

**PWA-first, offline-first.**
- React + TipTap + Vite, service-worker cached app shell, re-cached on every launch (iOS eviction defense).
- **Storage:** document/card JSON in IndexedDB (via a wrapper like Dexie); **large binary blobs (bundled fonts, exported files, glyph caches) in OPFS**, which is more robust than IndexedDB on iOS. Call `navigator.storage.persist()` on launch and surface storage status to the user. Because WebKit exempts home-screen web apps from the standard 7-day script-storage purge, prompt the user to Add-to-Home-Screen early.
- **Codex Omnilingua integration:** Luc's codex is a single-file responsive HTML app with a 289-root Celan lexicon (~337,000 entries), a deterministic translator, morphological analyzer, and four embedded custom TTFs. The editor **imports the codex data (lexicon + translation rules as JSON) and the four TTFs** ("Tenebrae Celan Runes," "Tenebrae Seal Hand," "Tenebrae Fallen Script," "Tenebrae Drover's Notch") as a versioned "Codex Pack" bundle. The translation engine is ported/wrapped as a pure JS module invoked locally — no network, fully offline, deterministic. Fonts are registered via `@font-face` (WOFF2 for screen) and kept as raw TTF for embedding in exports. The codex is not redesigned; it is a data/asset provider to the editor.
- **Capacitor wrap** for App Store: same web codebase, assets packaged inside the app (avoids Apple's PWA-listing rejection and storage-eviction issues), native share-sheet/filesystem plugins for export save. This is the store-distribution path; the PWA remains the primary target.
- **Claude API layer:** BYOK (user pastes their own Anthropic API key, stored in secure local storage) is the recommended default — no server, no key custody, user pays their own metered usage. All calls go direct from client to the Anthropic API. Two endpoints only:
  - `extractCards(passage)` — strict tool schema, `anthropic-beta: structured-outputs` header, temperature ~0.2, returns entities+keywords+verbatim quote offsets.
  - `checkGrammar(passage)` — strict tool schema returning correction ranges only.
  - **Guardrail prompts** instruct the model it is an extractor/proofreader, never a writer; the *structural* enforcement (tool schema + client-side diff thresholds) is what actually prevents prose generation, since prompts alone are insufficient.
  - **Cost/latency:** Claude Haiku 4.5 (model ID `claude-haiku-4-5-20251001`) is exactly **$1.00 input / $5.00 output per million tokens** per Anthropic's official 2026 rates (verified Aug 11, 2026). A chapter-length grammar pass (~4,000 words ≈ ~5,300 input tokens plus modest structured output) therefore costs on the order of a fraction of a cent; the Batch API halves this and prompt caching cuts cached input by ~90%. For higher-quality extraction, **Claude Sonnet 5** is at introductory **$2.00/$10.00 per MTok through Aug 31, 2026** (reverting to the standard $3.00/$15.00 on Sept 1, 2026), with Opus 5 at $5/$25.

### 6. Export pipeline (per format) with conlang-fidelity strategy

The universal fidelity rule, confirmed by research: **do not depend on any downstream renderer honoring runtime OpenType features.** Instead, **pre-shape every translated span once in-browser** — using fontkit's `font.layout(string)` (which applies GSUB ligature substitution and is validated against HarfBuzz output) or **harfbuzzjs** (HarfBuzz-in-WASM, returns final glyph IDs + positions) — and persist the resulting `glyphRun`. Each format then consumes the pre-shaped result in the most robust way it supports. This is precisely the approach HarfBuzz maintainers endorse: per GitHub Discussion #4767, *"Properly generated PDFs should be already typeset. That means what you are viewing in a PDF has already been shaped and the output of the shaper captured."*

- **Markdown (.md):** Prose serialized from ProseMirror JSON. Translation spans emit the romanization plus an HTML comment carrying `{language, sourceText}` so nothing is lost; optionally an inline SVG/image reference for the rune rendering. Cards optionally exported as linked `.md` files.
- **PDF:** Use **@react-pdf/renderer or PDFKit** — both call fontkit `layout()`, applying GSUB ligatures for LTR by default (PDFKit's `features` option defaults include `liga`; @react-pdf/fontkit lists *"Advanced OpenType features including glyph substitution (GSUB) and positioning (GPOS)"*) — with the TTFs subset-embedded. **Do not use pdf-lib for translated runs:** it maps characters to glyphs via cmap only (`encodeText`), applies no GSUB, and has no bidi — runes would render unsubstituted. For **RTL runs (Kerrackian)**, since neither library reorders bidi, **pre-shape and reorder the run manually**, then draw by glyph ID; or, for guaranteed fidelity, emit `glyph.path.toSVG()` vector outlines of the shaped run with a PDF `/ActualText` entry so copy/search still yields the source. This "outline the shaped run" approach is the established production technique when feature support is uncertain.
- **DOCX:** Use the `docx` npm library. **Embed fonts as TTF only** — per Microsoft Learn, Office *"programs... don't embed fonts that have the .otf extension"* and *"only embed fonts that have the .ttf extension."* If the conlang substitution is authored as a registered ligature tag (`liga`/`dlig`/`calt`), the exporter must write the `<w:ligatures>` run property (Word ligatures are OFF by default). For **non-standard/custom GSUB features or RTL**, Word support is unreliable — so fall back to inserting the **pre-substituted PUA codepoint string** (simple cmap lookup, no GSUB needed) or an embedded image/vector of the run for guaranteed fidelity. Store source text in a Word comment or hidden run for round-trip.
- **.doc (compatibility export):** No modern JS writes true binary .doc. Ship **RTF** (universally readable by Word/Pages/WordPad, text-based, macro-safe) or a DOCX served with a `.doc` extension, and label it clearly in the UI as "Word 97 compatibility (.doc)." Conlang runs use the PUA/image fallback since RTF has no OpenType shaping.
- **EPUB 3:** JSZip-assembled, TTF/WOFF `@font-face` embedded, per-run CSS. Apple Books honors OpenType features but ligatures are off unless CSS enables them (`font-feature-settings:"liga" 1,"dlig" 1`); Kobo is inconsistent (needs KePub/typography path); **Kindle KFX/KF8 conversion applies aggressive overrides and is the highest risk of feature loss.** Therefore, for cross-reader guarantee, **pre-substitute translated runs to PUA codepoints** (so only a cmap glyph lookup is required, no GSUB) or embed inline **SVG outlines** for critical runes. Use CSS `writing-mode`/`direction:rtl` set on the containing block for RTL passages (per Apple's asset guide, each content document supports a single writing-mode value). Validate with Kindle Previewer, Kobo tooling, and Apple Books.

### 7. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **iOS storage eviction (7-day ITP purge of script-writable storage)** | Manuscript loss for infrequent Safari-tab users | Add-to-Home-Screen (exempt from purge per WebKit) + OPFS + `storage.persist()`; re-cache shell on launch; aggressive auto-export/backup; Capacitor build for serious users |
| **IndexedDB instability on iOS** | Corruption/transaction failures | Wrapper lib (Dexie), transactional writes, periodic integrity checks, JSON export backups |
| **GSUB not honored downstream** | Runes render as raw romanization | **Pre-shape in-browser** (fontkit/harfbuzzjs); embed shaped glyph runs, PUA substitution, or SVG outlines per format |
| **Word can't embed OTF; ligatures off by default** | Broken runes in DOCX | Ship TTF only; write `<w:ligatures>`; PUA/image fallback for custom features |
| **Kindle strips features** | Runes wrong in Kindle | PUA codepoints or SVG outlines; validate in Kindle Previewer |
| **RTL (Kerrackian) reordering** | Wrong glyph order | `unicode-bidi:isolate`+`dir="rtl"` on screen; manual reorder / pre-shaped run in exports (react-pdf/pdf-lib don't do bidi) |
| **Font licensing/subsetting** | N/A — Luc owns his fonts | Subset freely with hb-subset/fontkit (preserve layout tables so shaping survives on subset) |
| **`.doc` expectations** | User expects true binary .doc | Label as compatibility export (RTF/DOCX-as-.doc); document the limitation |
| **Claude prose leakage** | Violates core principle | Structural enforcement: constrained tool schemas + client-side diff thresholds, not just prompts |
| **ProseMirror large-doc slowdown** | Editor lag | Scene-level documents keep node counts low |

### 8. Phased roadmap

- **MVP (~8–10 weeks): Editor + structure + core export + Cards.**
  - TipTap editor, Book/Chapter/Scene hierarchy, offline IndexedDB/OPFS store, focus mode, word counts.
  - Cards: manual card creation, alias auto-linking, backlink graph, card export (md/JSON).
  - Exports: Markdown, DOCX (Latin prose only), EPUB 3 (Latin prose). No conlang runs yet.
  - Deliverable: a genuinely usable offline mobile novel editor with a working world-wiki.

- **v1 (~8–12 weeks): Deterministic translation + full conlang export fidelity + PDF.**
  - Import Codex Pack (lexicon JSON + rules + 4 TTFs); port translator as pure JS module.
  - `translationSpan` node, highlight→translate→render flow with correct font/ligatures/direction.
  - In-browser pre-shaping (fontkit/harfbuzzjs) + glyphRun persistence.
  - PDF export (react-pdf/PDFKit) with subset-embedded fonts; per-format conlang fidelity (PUA/SVG fallbacks) wired into DOCX/EPUB; .doc-compat (RTF).
  - Deliverable: fully exportable Tenebrae-language typesetting across all formats.

- **v1.5 (~4–6 weeks): Claude assist layer + App Store.**
  - BYOK Claude integration: `extractCards` + `checkGrammar` with strict schemas and guardrails.
  - Inline grammar diff accept/reject UX; Claude-assisted card harvesting (keywords + verbatim quotes).
  - Capacitor wrap, native share-sheet export, App Store submission.
  - Deliverable: the complete product per Luc's three requirements.

## Recommendations
1. **Start the MVP on TipTap immediately**; validate long-document performance early on a real iPhone with a full book of scenes. If ProseMirror lags despite scene-splitting, evaluate Lexical before v1.
2. **De-risk conlang fidelity first among the hard problems:** build a spike that takes one Kerrackian sentence and produces a correct pre-shaped run in PDF (RTL), DOCX (PUA fallback), and EPUB (Apple Books + Kindle Previewer) before committing the v1 export architecture. This is where the project is most likely to fail; prove it early. Concretely, benchmark fontkit `font.layout()` vs harfbuzzjs on your four fonts and pick one shaper.
3. **Make BYOK the default Claude integration** to avoid server costs and key custody; only build a proxy if non-technical distribution demands it. Use Haiku 4.5 for grammar passes and Sonnet 5 for card extraction, routed by task.
4. **Treat the codex as an immutable versioned dependency** (Codex Pack with a version string); never fork its data into the editor.
5. **Benchmarks that change the plan:** if iOS eviction causes any real data loss in testing, promote the Capacitor build from v1.5 to MVP-adjacent. If Word/Kindle PUA-substitution proves visually perfect, you may skip the heavier SVG-outline path entirely. If Claude grammar passes exceed acceptable latency on mobile, switch to batched/section-level checks.

## Caveats
- Reader-behavior specifics for Apple Books/Kobo/Kindle ligature defaults are corroborated by community and design sources plus Apple's Books Asset Guide, but the Kindle/Kobo feature-preservation behavior should be re-verified against Amazon KDP's current publishing guidelines before locking the EPUB pipeline. The HarfBuzz WASM *shaper* (font-embedded shaping logic) is experimental and explicitly not production-ready — use **harfbuzzjs** (HarfBuzz-as-library) instead.
- Claude API model names/pricing are 2026-current and will drift (e.g., Sonnet 5's introductory rate reverts to $3/$15 on Sept 1, 2026); the architecture (BYOK, strict schemas) is model-agnostic.
- Effort estimates assume one experienced creative-coding developer working solo and are rough; the conlang-fidelity spike could expand v1 materially.
- The .doc requirement cannot be met as true binary .doc with any current JS tooling; the spec deliberately reframes it as a compatibility export, which should be confirmed as acceptable to Luc.