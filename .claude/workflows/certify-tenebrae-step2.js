export const meta = {
  name: 'certify-tenebrae-step2',
  description: 'Certify Tenebrae Writer step 2 (DOCX + EPUB export) against its standard, with step-1 regression gate',
  whenToUse: 'Re-run whenever tenebrae/step1.html changes to re-certify step 2.',
  phases: [
    { title: 'Audit', detail: '4 static auditors + 4 functional testers over the X2 requirements + regression gate' },
    { title: 'Adversarial', detail: 'refute pass claims, refute fail claims, coverage critic' },
  ],
}

const STANDARD = '/home/user/MonoFX/tenebrae/certification/step2-requirements.md';
const STEP1_STANDARD = '/home/user/MonoFX/tenebrae/certification/step1-requirements.md';
const ARTIFACT = '/home/user/MonoFX/tenebrae/step1.html';
const SPEC = '/home/user/MonoFX/tenebrae/spec.md';
const HARNESS = '/home/user/MonoFX/tenebrae/certification/harness';

const CTX = `You are one verification agent inside the Tenebrae Writer STEP-2 CERTIFICATION workflow.
Step 2 adds DOCX + EPUB export to the already-certified step-1 artifact.

Read these first:
- Step-2 standard (X2 requirement IDs, what pass means): ${STANDARD}
- Artifact under certification (do NOT modify it): ${ARTIFACT}
- Step-1 standard (the regression baseline): ${STEP1_STANDARD}
- Product spec §6/§8 for the export-fidelity context: ${SPEC}

Ground rules:
- Never modify the artifact, specs, or standards. Never run git commit/push.
- Evidence is mandatory. Static claims cite step1.html line numbers. Functional claims cite
  the probe file you wrote/ran plus the actual output you observed.
- Statuses: pass | partial | fail | blocked (blocked = could not verify; say exactly why).
- Report EVERY assigned requirement ID exactly once in findings[]; extra observations go in
  anomalies[]. Be adversarial: your job is to find where step 2 is NOT complete.
- The new code lives in the "DOCX export", "EPUB export", and "script font forge"
  sections of step1.html (search for those banners). The script-as-text model is
  deliberate: an imported codex's scripts are FORGED into real TTFs and spans carry PUA
  TEXT (data-scr) — PUA in the EPUB is intentional and travels with embedded fonts;
  PUA in the DOCX is a defect (romanization there). Known-green reference probes:
  s2-export-roundtrip.mjs, s2-glyph-script.mjs, s2-undo-translation.mjs,
  s2-codex-fidelity.mjs — do not merely re-run them and call that your evidence;
  probe what they do NOT cover.
`;

const FUNC_CTX = `Functional probe rules:
- FIRST read ${HARNESS}/probe-example.mjs and ${HARNESS}/probes/ex-lib.mjs (shared helpers:
  launch, buildRichBook, selection, translation-span insertion, sheet downloads) and
  ${HARNESS}/probes/s2-export-roundtrip.mjs (the canonical step-2 probe — copy its
  store-only unzip helper and import-drive pattern).
- Write each probe as ${HARNESS}/probes/s2-<name>.mjs; run with: cd ${HARNESS}/probes && node <file>.
  KEEP probe files — they are certification artifacts.
- Every probe starts its own server (startServer from ../serve.mjs); chromium executablePath
  /opt/pw-browsers/chromium; attach page.on('pageerror') and report any exception.
- Downloads: newContext({acceptDownloads:true}) + waitForEvent('download') + dl.path().
  Exported zips are store-only — parse them with the manual reader from the canonical probe,
  and/or validate with python3 (zipfile + xml.dom.minidom) via child_process.
- Drive the real UI. After edits wait >= 1200ms before reloads (debounced save).
`;

const FINDINGS = {
  type: 'object', required: ['findings'], additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'status', 'evidence'], additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'partial', 'fail', 'blocked'] },
          evidence: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    anomalies: { type: 'array', items: { type: 'string' } },
  },
};
const VERDICTS = {
  type: 'object', required: ['verdicts'], additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'agree', 'reason'], additionalProperties: false,
        properties: {
          id: { type: 'string' },
          agree: { type: 'boolean' },
          revised_status: { type: 'string', enum: ['pass', 'partial', 'fail', 'blocked'] },
          reason: { type: 'string' },
        },
      },
    },
    missed: { type: 'array', items: { type: 'string' } },
  },
};

phase('Audit');

const AUDITORS = [
  {
    label: 'static:docx',
    prompt: `${CTX}
Assigned requirement IDs: X2-1, X2-2, X2-3, X2-5 (static halves).
Method: STATIC inspection of the DOCX export section (docxRunsFrom/docxPara/docxScenePs/
docxBodyXML/DOCX_STATIC/docxFile) plus its consumers in exportSheet. Verify against the
OOXML expectations AND against the app's own importer (docxToBlocks) for round-trip
consistency: style ids, rPr element order, numbering.xml/abstractNum wiring, xml:space,
escaping of &<>"' in titles and prose (esc()), option handling parity with compile(), the
scene-scope path, and what happens on edge content (empty scenes, empty chapters, titles
containing XML specials, BR runs, nested marks, tspan without data-rom). Hunt defects the
green probe would not catch. Prefix evidence "static:".`,
  },
  {
    label: 'static:epub',
    prompt: `${CTX}
Assigned requirement IDs: X2-6, X2-7, X2-9, X2-10 (static halves).
Method: STATIC inspection of the EPUB export section (epubXhtml/epubSceneInto/
epubChapterXHTML/epubNavXHTML/EPUB_CSS/epubFile) plus zipStore. Verify OCF rules (mimetype
first/stored/no extra field — check zipStore emits no extra fields and general-purpose flag
bits are benign), OPF validity (unique-identifier, dcterms:modified format, manifest/spine
completeness, ids), XHTML construction (namespace, serializer output, entity safety via
createTextNode), nav epub:type wiring, css coverage (sc/tspan/ast/rtl), chapter filtering
edge cases (books with zero non-empty chapters, chapters with empty titles), and
determinism (any wall-clock Date/random anywhere in the new code — new Date(book.updated)
is the only allowed time source). Prefix evidence "static:".`,
  },
  {
    label: 'static:integration',
    prompt: `${CTX}
Assigned requirement IDs: X2-11 (static half), X2-12 (static half).
Method: STATIC. For X2-11: export-sheet wiring (labels, scopes, MIME types on download()),
the updated disclosure text (PDF/true-glyph deferred — no stale "DOCX and EPUB arrive"
text anywhere), the step-2 version label in header comment and About sheet, and a sweep of
the ENTIRE new code for network/AI surface (must be none) and for regressions to step-1
invariants (e.g. does any new code touch persistence, sanitizer, or translation state).
For X2-12 static half: diff-oriented reading — identify every pre-existing function the
step-2 change modified or now calls differently (exportSheet, zipStore usage, download)
and verify none of the step-1 requirement behaviors changed semantics. Prefix "static:".`,
  },
  {
    label: 'static:forge',
    prompt: `${CTX}
Assigned requirement IDs: X2-13 (static half), X2-14 (static half).
Method: STATIC inspection of the "script font forge" section (forgeFlattenPath/
forgeCapsule/forgeGlyphContours/forgeTTF/omniMatchWord/forgeOmniFonts/omniScriptText/
omniScriptCSS/omniScriptFor) plus the undo-aware editing helpers (edApplyHTML/edApplyText/
placeTSpan/retranslateSpan and the revert/remove sheet actions). For X2-14: verify the TTF
table construction against the TrueType spec (head/hhea/maxp field counts, cmap format 4
segment math incl. the 0xFFFF terminator, loca long format, glyf point flags, checksums +
checkSumAdjustment), determinism (no Date/random anywhere in the forge), correct PUA base
assignment and matchWord parity with the codex's own tokenizer, canonical ordering rules
(RTL and btt-stave reversals), CSS writing-mode wiring and the [data-omni] specificity
note, and sanitizer persistence of data-scr/data-flow (length caps). For X2-13: verify
every span mutation path routes through execCommand and identify any remaining raw Range
mutation that would bypass undo. Prefix evidence "static:".`,
  },
  {
    label: 'func:editor-ux',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs: X2-13, X2-14 (functional).
The canonical probes cover the main flows. Your probes (prefix s2-ux-*) must cover what
they do NOT: undo across MIXED operations (type, translate, type more, retranslate — a
single Ctrl+Z sequence must walk back cleanly without corrupting prose); undo immediately
after a codex import re-renders spans; script text SELECTABILITY and clipboard copy (the
PUA text should reach the clipboard); tongue-sheet big render is text (no svg) under both
engines; sample->codex->removal transitions keep spans as text with correct fonts at each
stage; and the vertical flows' geometry (a cols-rtl span must be taller than wide; two
words must produce two columns). Real 3.4MB codex at
/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html.`,
  },
  {
    label: 'func:docx',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs: X2-1, X2-2, X2-3, X2-4, X2-5 (functional).
The canonical probe covers the happy path. Your probes (prefix s2-docx-*) must cover what
it does NOT: a book/chapter/scene titled with XML specials (& < > " ') and unicode — export
must stay well-formed and round-trip the exact titles; toggling EACH compile option and
verifying the docx paragraph stream changes accordingly; an empty-body scene with a title;
a scene that is ONLY a translation span; scene-scope export content equals that scene;
python3 zipfile+minidom validation of every artifact you produce. Round-trip each hostile
export through the real import UI.`,
  },
  {
    label: 'func:epub',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs: X2-6, X2-7, X2-8, X2-9, X2-10 (functional).
Beyond the canonical probe (prefix s2-epub-*): fonts — every embedded .ttf in the EPUB
must parse (python3 fontTools), be manifested with media-type font/ttf, be referenced by an
@font-face, and cover the PUA codepoints the spans use; spans carry script text with
data-rom metadata. Then: XML-special + unicode titles through OPF,
nav, and xhtml (well-formed, titles exact after round-trip); an RTL Kerrackian span — the
exported xhtml must carry dir="rtl" on the tspan and the css unicode-bidi rule, and
re-import must restore a live RTL span; option toggles reflected in the xhtml stream;
books whose chapters are empty or untitled (manifest/spine must stay consistent — no
dangling itemrefs); determinism after an edit + undo-style revert (state back to identical
=> bytes identical); python3 validation of every artifact.`,
  },
  {
    label: 'func:regression',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement ID: X2-12 (functional) — the step-1 regression gate.
Run the ENTIRE existing probe suite in ${HARNESS}/probes (every *.mjs except ex-lib.mjs and
the fixtures dir; run them one at a time: cd ${HARNESS}/probes && for p in *.mjs; do ...)
against the current artifact and report: total run, pass count, and EVERY probe whose
verdict line is not PASS / NO DEFECT / HOLE NOT REPRODUCED (known anomaly-doc/diagnostic probes, NOT regressions — report them as such: tr-alias-roundtrip
and ex-md-h2-reimport-split and ex-restore-malformed print expected FAIL verdicts documenting
pre-existing anomalies (the last verified failing identically on the certified step-1 artifact);
cd-mention-tap-race prints ANOMALY REPRODUCED; tr-codex-csp-diag and vf-tr5-wake-mechanism are
verdictless diagnostics; vp-cd5-zip-realunzip ends with a python-validation handoff line, and its
zip was python-validated clean; vp-sk-pr5-restore-hostile-doc can hang in this environment —
skip it after 120s and note it). For
any unexpected failure, re-run it once to rule out flake, then diagnose whether step-2
code caused it. Your findings[] entry for X2-12 summarizes; every non-green probe goes in
anomalies[] with its verdict line.`,
  },
];

const audits = await parallel(AUDITORS.map(a => () =>
  agent(a.prompt, { label: a.label, phase: 'Audit', schema: FINDINGS })
    .then(r => r && { source: a.label, ...r })
));

const ok = audits.filter(Boolean);
const merged = ok.flatMap(a => a.findings.map(f => ({ ...f, source: a.source })));
const anomalies = ok.flatMap(a => (a.anomalies || []).map(x => `[${a.source}] ${x}`));
const lost = AUDITORS.filter(a => !ok.some(x => x.source === a.label)).map(a => a.label);
if (lost.length) log(`WARNING: auditors returned nothing: ${lost.join(', ')}`);
log(`Audit done: ${merged.length} findings from ${ok.length}/${AUDITORS.length} auditors, ${anomalies.length} anomalies`);

phase('Adversarial');

const passes = merged.filter(f => f.status === 'pass');
const nonPasses = merged.filter(f => f.status !== 'pass');

const [skepticPass, skepticFail, coverage] = await parallel([
  () => agent(`${CTX}
${FUNC_CTX}
You are the ADVERSARIAL SKEPTIC for PASS claims. Default position: each pass below is
unearned until its evidence convinces you. Focus on evidence that asserts more than it
demonstrates, hostile inputs nobody tried (XML specials, RTL, empty structures, huge
books), and (F) passes resting on static reading. RUN YOUR OWN PROBES (prefix s2-vp-*) for
at least 4 of the riskiest passes. Return a verdict for EVERY distinct id below.
FINDINGS:
${JSON.stringify(passes, null, 1)}`,
    { label: 'verify:refute-passes', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
${FUNC_CTX}
You are the ADVERSARIAL SKEPTIC for FAIL/PARTIAL/BLOCKED claims. Default position: the
tester erred (timing, selector, misread standard). Re-verify each with code reading and,
where practical, your own probe (prefix s2-vf-*). Resolve any cross-source disagreements
explicitly. Return a verdict for EVERY distinct id below.
FINDINGS (non-pass):
${JSON.stringify(nonPasses, null, 1)}
Pass-claims on the same ids for context:
${JSON.stringify(passes.filter(p => nonPasses.some(n => n.id === p.id)), null, 1)}`,
    { label: 'verify:refute-fails', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
You are the COVERAGE CRITIC. Find what the certification MISSED: (a) any X2 id with no
finding; (b) capabilities the step-2 change ships that the STANDARD fails to cover (read
the new export code and the export sheet — name holes concretely); (c) any (F) id whose
findings lack functional evidence; (d) spec §6 export-fidelity expectations that neither
the standard nor the deferral disclosure accounts for. Reported ids: ${JSON.stringify([...new Set(merged.map(f => f.id))])}.
Return verdicts=[] and put everything in missed[].`,
    { label: 'verify:coverage', phase: 'Adversarial', schema: VERDICTS }),
]);

return {
  findings: merged,
  anomalies,
  auditorsLost: lost,
  verdictsOnPasses: skepticPass ? skepticPass.verdicts : null,
  verdictsOnFails: skepticFail ? skepticFail.verdicts : null,
  coverageGaps: coverage ? coverage.missed : null,
};
