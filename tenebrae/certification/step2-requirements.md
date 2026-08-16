# Tenebrae Writer — Step 2 Certification Standard: DOCX + EPUB Export

**Artifact under certification:** `tenebrae/step1.html` (step-2 revision — the file keeps its
path; the in-app version label reads "step 2"). Pinned hash recorded at certification time.

**Scope:** the two export formats Step 1 explicitly deferred ("DOCX and EPUB arrive in a
later step"), per spec §8 MVP ("DOCX (Latin prose only), EPUB 3 (Latin prose)"). Conlang
*glyph* fidelity (PUA/pre-shaped runs/embedded fonts, spec §6) remains the v1 spike and is
NOT in step-2 scope: translation spans export as legible romanization, with the stronger
guarantee that the EPUB path round-trips spans losslessly through the app's own importer.

**Architecture constraint (binding):** the app stays a single offline HTML file with zero
dependencies and zero network. Both formats are ZIP containers and must be produced by the
app's own store-only ZIP writer (`zipStore`). No external libraries.

**Certification rule:** step 2 is certified complete when every X2 requirement passes —
static + functional, adversarially verified — AND the entire step-1 standard still passes
(regression gate). Statuses and evidence rules are identical to the step-1 standard.

---

## X2 — Step 2 requirements (all must pass)

### DOCX export
- **X2-1** (F) Export sheet offers "Word (.docx)" at book scope and scene scope; downloads
  a structurally valid OOXML package: `[Content_Types].xml`, `_rels/.rels`,
  `word/_rels/document.xml.rels`, `word/styles.xml`, `word/numbering.xml`,
  `word/document.xml`; every XML part well-formed.
- **X2-2** (F) Structure mapping: book title → `Title` style; chapter titles → `Heading1`;
  scene titles → `Heading2`; in-scene H2/H3 → `Heading3`/`Heading4`; blockquote → `Quote`;
  UL/OL → `ListBullet`/`ListNumber` with real `numPr` numbering; ⁂ scene breaks as centered
  paragraphs. Compile options (chapter titles / scene titles / ⁂) honored exactly as in md.
- **X2-3** (F) Marks map to run properties: bold→`w:b`, italic→`w:i`, underline→`w:u`,
  strikethrough→`w:strike`, small-caps→`w:smallCaps`; nesting composes.
- **X2-4** (F) DOCX round-trip: a book exported with the canonical options
  (chapterTitles ON, sceneTitles ON, asterism OFF) re-imports through the app's own .docx
  importer with the same title, chapter/scene structure, prose, and marks.
- **X2-5** (F) Translation spans export as italic romanization text — never raw PUA glyphs.

### EPUB export
- **X2-6** (F) Export sheet offers "EPUB (.epub)" at book scope; downloads a valid EPUB 3
  container: `mimetype` is the FIRST entry, stored, exactly `application/epub+zip`;
  `META-INF/container.xml` points at the OPF; the OPF carries `dc:identifier`, `dc:title`,
  `dc:language`, and `dcterms:modified`; `nav.xhtml` has an `epub:type="toc"` nav listing
  every chapter; one XHTML file per chapter; spine in reading order; a stylesheet is
  included and referenced.
- **X2-7** (F) Every XHTML file parses as well-formed XML (strict XML parse, not HTML
  tag-soup), with the XHTML namespace; chapter headings h1, scene headings h2, in-scene
  headings h3/h4; ⁂ separators as centered paragraphs; small-caps and translation-span
  styling present in the CSS. Compile options honored.
- **X2-8** (F) EPUB round-trip: an exported book re-imports through the app's own .epub
  importer with the same chapters, scenes, prose, and marks.
- **X2-9** (F) **Translation spans round-trip losslessly through EPUB**: spans are written
  as `span.tspan` with `data-lang`/`data-src`/`data-rom` (+ `dir="rtl"` where applicable)
  and re-import as live, re-translatable spans with source intact — better than md/txt,
  where only romanization survives.

### Cross-cutting
- **X2-10** (F) Determinism: identical book state exports byte-identical .docx and .epub
  (no wall-clock timestamps; `dcterms:modified` derives from the book's own stored
  `updated` stamp).
- **X2-11** (F) Offline + principles hold: the new exporters issue zero network requests,
  contain no AI surface, and the in-app scope disclosure is updated honestly (DOCX/EPUB no
  longer "later"; PDF is the remaining deferred format).
- **X2-13** (F) Undo: every translation operation joins the native undo stack — inserting a
  span, editing its source (retranslate), changing tongue, reverting to plain text, and
  removing it are each one Cmd/Ctrl+Z away from the prior state, with redo; undone states
  persist. Raw Range mutations that bypass undo history are defects.
- **X2-14** (F) Actual script, not styled Latin: translations render in the constructed
  script itself — under the sample codex, PUA codepoints drawn by the embedded script
  fonts (canvas-provable real glyphs, never tofu, never the romanization restyled); under
  an imported codex, the codex's own glyph systems including vertical flows — with
  romanization demoted to metadata (data-rom, gloss sheet, exports).
- **X2-12** Regression gate: every step-1 requirement (ST/ED/PR/CD/EX/IM/TR/PN) still
  passes; the full step-1 probe suite stays green against the step-2 artifact.

---

*(F)* = must be demonstrated against the running app (downloads captured and inspected;
round-trips driven through the real import UI). Evidence rules as in the step-1 standard.
