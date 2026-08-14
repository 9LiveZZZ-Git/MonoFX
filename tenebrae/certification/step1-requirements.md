# Tenebrae Writer — Step 1 Certification Standard

**Artifact under certification:** `tenebrae/step1.html`
(sha256 `ed617a45f18e474ccdd3b85260e499872ee0ff2d9652c0aaa0c57938f813c4c8`, 4305 lines, single-file app)

**Reference documents:** `tenebrae/spec.md` (product & technical specification), the
artifact's own declared scope (header comment line 15, About sheet line 1757, export
sheet disclosure line ~2108).

**Certification rule:** Step 1 is *certified complete in full* when every requirement
in Baseline A holds — verified by static code inspection **and**, where marked (F),
by functional test against the running app in Chromium. Baseline B items are
deviations from the spec's MVP; they do not block certification but must be
accurately reported so scope changes are accepted knowingly, not silently.

Statuses: `pass` | `partial` | `fail` | `blocked` (could not be tested — say why).

---

## Baseline A — Step 1 declared scope (all must pass)

### ST — Manuscript structure (spec §3.1)
- **ST-1** (F) Create books; library lists books with word counts and metadata.
- **ST-2** (F) Book → Chapter → Scene hierarchy: add chapters to a book, scenes to a chapter.
- **ST-3** (F) Rename book/chapter/scene; delete each level with confirmation (destructive actions are guarded).
- **ST-4** (F) Reorder: drag-to-reorder in edit mode; move a scene between chapters.
- **ST-5** (F) Scene status draft/revised/final; per-book word goal with progress display.

### ED — Editor (spec §3.2, adapted to the contenteditable implementation)
- **ED-1** (F) Title + body contenteditable editor; edits autosave (debounced) and flush on visibilitychange; no explicit save button needed.
- **ED-2** (F) Marks: bold, italic, underline, strikethrough, small-caps.
- **ED-3** (F) Blocks: H2/H3 headings, blockquote, unordered + ordered lists, ⁂ scene-break.
- **ED-4** (F) Live word count in the editor; counts roll up to scene rows, book, and library.
- **ED-5** (F) Focus (zen) mode toggle.
- **ED-6** (F) Sanitizer: foreign/pasted HTML is normalized to the app's schema; no script/style survives into a scene doc.
- **ED-7** Format bar rides the keyboard; touch-sized targets; block/mark state reflects the caret.

### PR — Offline-first persistence (spec §5)
- **PR-1** (F) IndexedDB persistence; the complete state (books, cards, codex, options) survives reload.
- **PR-2** In-memory fallback when IndexedDB is unavailable; the app still runs and the user is told storage is not durable.
- **PR-3** `navigator.storage.persist()` requested at boot.
- **PR-4** (F) Fully offline: zero runtime network requests — no fetch/XHR/WebSocket, no external scripts, fonts, CDNs, or API calls of any kind.
- **PR-5** (F) Backup (full-state JSON download) and restore (file picker, validated, confirm-guarded).

### CD — Cards / world-wiki (spec §3.3; Claude harvesting is explicitly v1.5, manual here)
- **CD-1** (F) Manual card creation; seven types (Person, Place, Thing, Faction, Event, Language, Artifact); type is editable.
- **CD-2** (F) Aliases and keywords as editable chip rows; notes field.
- **CD-3** (F) Deterministic mention detection: card title + aliases scanned across every scene (word-boundary, case-insensitive); "mentioned in" list with per-scene counts, navigable to the scene.
- **CD-4** (F) Connected cards derived from cross-card corpus matches; verbatim quotes saved from editor selection to a card.
- **CD-5** (F) Card export independent of the manuscript: story bible `.md`, cards archive `.zip` containing per-card wikilink-compatible `.md` files plus `graph.json` with nodes and edges.
- **CD-6** Card search and type filter; cards reachable from the editor (pin row / cards-in-scene).

### EX — Compile & export (step-1 scope: md / txt / rich copy / share)
- **EX-1** (F) Book compile honors options: chapter titles on/off, scene titles on/off, ⁂ separators on/off; options persist per book.
- **EX-2** (F) Markdown export (book and single scene): valid structure (`#`/`##`/`###`), marks map to `**`/`*`/etc., ⁂ between scenes, markdown special characters escaped.
- **EX-3** (F) Plain-text export (book and single scene).
- **EX-4** Rich copy for Apple Notes (text/html + text/plain clipboard) with plain-text fallback; Share via native share sheet with copy fallback.
- **EX-5** (F) Translation spans survive export legibly: romanization (not raw glyph junk) in md/txt output, with source text retained in the app.
- **EX-6** In-app disclosure that DOCX and EPUB arrive in a later step (scope honesty).

### IM — Smart import (artifact's declared scope, About sheet)
- **IM-1** (F) Import routes `.md`, `.txt`, `.html`, `.docx`, `.rtf`, `.epub` to the correct parser.
- **IM-2** (F) Import preview shows title, detected chapters/scenes, word count; commit creates the book as previewed.
- **IM-3** Chapter-heading detection on plausible manuscript text (headings, "Chapter N" lines).
- **IM-4** (F) Real-world proof: the author's actual manuscript (`SurvivingTheSpiralCascade_4.docx`, 1.2 MB) imports with sane structure and word count, no errors.

### TR — Tenebrae translation layer (included in step 1 ahead of the spec's v1)
- **TR-1** (F) Seven tongues offered (Celan Basic, Celan High, Kerrackian, Kildaren, Calgridarian, Evernessian, Rath-Speech); sample-codex status disclosed in the UI until a real codex is imported.
- **TR-2** (F) Deterministic translation: identical input → identical output across repeated calls and across reloads; no randomness, no Claude, no network.
- **TR-3** (F) Selection → translate flow inserts a span that stores source text + language; source is editable and re-translation is regenerated deterministically.
- **TR-4** (F) The RTL tongue (Kerrackian) renders its span with `dir="rtl"` isolation.
- **TR-5** Codex import surface: accepts the codex HTML itself or a Codex Pack (JSON/ZIP with fonts); fonts registered via FontFace; all existing spans re-render after import/removal. Functional if feasible with the real 3.4 MB codex file, else static + documented.
- **TR-6** Interlinear gloss visible for a translated span.

### PN — Architectural principles (spec §1, as they apply to step 1)
- **PN-1** No AI surface anywhere: no prose generation, no grammar UI, no Anthropic/API code path, no API-key storage. (Claude features are v1.5 by design; step 1 must contain zero of them.)
- **PN-2** Translation is 100 % codex-owned and local (sample codex or imported codex; never a model, never a server).
- **PN-3** No lock-in: every piece of authored state is exportable losslessly (manuscript → md/txt, cards → md/zip/json, whole state → backup JSON; translation spans keep `sourceText`).

## Baseline B — Deviations from spec MVP (report, don't block)
- **DV-1** Architecture: single-file HTML + contenteditable, not React/TipTap/Vite PWA (spec §5/§8). Assess: is the divergence disclosed, and does any Baseline A behavior suffer for it?
- **DV-2** DOCX export deferred to a later step (spec MVP lists it).
- **DV-3** EPUB 3 export deferred to a later step (spec MVP lists it).
- **DV-4** No service worker / manifest — the single file *is* the offline artifact; installability/A2HS story differs from the spec's PWA plan.
- **DV-5** OPFS not used; everything (including an imported codex + fonts) lives in IndexedDB. Spec wanted OPFS for large blobs.

---

*(F)* = must be demonstrated against the running app, not only read from source.
Findings must cite evidence: line numbers for static claims, probe output for functional claims.
