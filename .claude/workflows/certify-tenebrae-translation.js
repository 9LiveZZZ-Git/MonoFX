export const meta = {
  name: 'certify-tenebrae-translation',
  description: 'Certify the Tenebrae translation services end to end: engine parity, script rendering, round-trip, and export fidelity',
  whenToUse: 'Re-run whenever the translation, forge, or script-rendering code in tenebrae/step1.html changes.',
  phases: [
    { title: 'Audit', detail: '3 static auditors + 5 functional testers across engine, script, UX, export and stress' },
    { title: 'Adversarial', detail: 'refute passes, refute fails, coverage critic' },
  ],
}

const ARTIFACT = '/home/user/MonoFX/tenebrae/step1.html';
const STANDARD = '/home/user/MonoFX/tenebrae/certification/translation-requirements.md';
const HARNESS = '/home/user/MonoFX/tenebrae/certification/harness';
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

const CTX = `You are one verification agent in the TENEBRAE TRANSLATION CERTIFICATION workflow.

The product claim under test: "highlight English, translate it into a real
Tenebrae tongue, see the canonical script, and get it back — 100% working."

Read first:
- The standard (TX requirement ids): ${STANDARD}
- The artifact (do NOT modify): ${ARTIFACT}

How the system works — do not re-derive this wrongly:
- The REAL Codex Omnilingua is EMBEDDED in the artifact (base64 in
  <script id="codex-embed">) and installs as the default engine at boot. There
  is also a legacy SAMPLE codex (a shift-cipher placeholder) whose FONTS are
  still used for legacy spans; the sample must never be the translation engine.
- Translation is codex-owned: the engine boots in an iframe and the app calls
  its compileText/translateE2C. window.tenebrae.translate2(langId, text) is the
  ACTIVE-engine call; window.tenebrae.translate(...) is the legacy SAMPLE call.
- Scripts render as TEXT, never SVG: at wake the app FORGES a real TTF per
  script from the codex's own glyph vectors ("script font forge" section) and
  spans carry PUA characters in those fonts (data-scr), with data-rom holding
  the romanization and data-src the English source.
- Script text is stored in LOGICAL order; CSS produces the canonical visual
  layout per the codex's own typesetter (transcribeScriptSVG):
    cols-rtl  (Celan High) letters down a column, columns advance right->left
    btt-stave (Kildaren)   one stave per word, staves left->right, letters
                           bottom-up, staves standing on common ground
    rtl       (Kerrackian) letters and words right->left
  via writing-mode / direction / unicode-bidi:isolate-override.

Ground rules:
- Never modify the artifact or the standard. Never run git commit/push.
- Evidence is mandatory: static claims cite step1.html line numbers; functional
  claims cite the probe you ran and its actual output.
- Statuses: pass | partial | fail | blocked (blocked = say exactly why).
- Report EVERY assigned id exactly once in findings[]; extras go in anomalies[].
- Ground truth is ALWAYS the codex itself (${CODEX}), never your expectations
  about how a conlang "should" look. When the writer and the codex disagree,
  the codex wins.
`;

const FUNC = `Functional probe rules:
- Read ${HARNESS}/probes/ex-lib.mjs (shared helpers) and these known-green
  reference probes before writing your own: s2-script-structure.mjs (the
  rigorous structural parity probe), s2-embedded-codex.mjs, s2-codex-fidelity.mjs,
  s2-visual-parity.mjs, s2-render-parity.mjs. Do not merely re-run them and call
  that your evidence — probe what they do NOT cover.
- Write probes as ${HARNESS}/probes/tx-<name>.mjs; run: cd ${HARNESS}/probes && node <file>.
  KEEP them (they are certification artifacts). Each probe starts its own server
  (startServer from ../serve.mjs), uses chromium executablePath
  /opt/pw-browsers/chromium, and attaches page.on('pageerror').
- The embedded engine needs ~3s to wake and forge on a fresh page; wait for it.
- Useful seams: window.tenebrae.{translate2,langs,codex,engine} and
  window.tenebrae._forge.{map,textFor,textForToks,fontBytes}.
- For font-level truth use python3 with fontTools (installed) via child_process.
`;

const FINDINGS = {
  type: 'object', required: ['findings'], additionalProperties: false,
  properties: {
    findings: { type: 'array', items: {
      type: 'object', required: ['id', 'status', 'evidence'], additionalProperties: false,
      properties: { id: { type: 'string' }, status: { type: 'string', enum: ['pass','partial','fail','blocked'] },
                    evidence: { type: 'string' }, notes: { type: 'string' } } } },
    anomalies: { type: 'array', items: { type: 'string' } },
  },
};
const VERDICTS = {
  type: 'object', required: ['verdicts'], additionalProperties: false,
  properties: {
    verdicts: { type: 'array', items: {
      type: 'object', required: ['id', 'agree', 'reason'], additionalProperties: false,
      properties: { id: { type: 'string' }, agree: { type: 'boolean' },
                    revised_status: { type: 'string', enum: ['pass','partial','fail','blocked'] },
                    reason: { type: 'string' } } } },
    missed: { type: 'array', items: { type: 'string' } },
  },
};

phase('Audit');

const AUDITORS = [
  {
    label: 'static:engine',
    prompt: `${CTX}
Assigned ids: TX-1, TX-2, TX-3 (static halves).
STATIC inspection of the engine path: the embedded-codex install (decodeEmbeddedCodex,
embeddedCodexPack, boot install, ensureOmni's html source), omniTranslate/omniLangId/
resolveTranslate/tonguesList, and the sample-codex boundary. Verify: the sample cipher can
never become the translation engine on any path (boot, removal of an imported pack, removal
of an imported codex, restore-from-backup, failed wake); translation output is a pure
function of (codex, tongue, text) with no Date/random; the engine iframe only ever executes
locally-stored HTML and the injected CSP seals its network. Name every code path that could
silently downgrade the engine. Prefix evidence "static:".`,
  },
  {
    label: 'static:forge',
    prompt: `${CTX}
Assigned ids: TX-4, TX-5 (static halves).
STATIC inspection of the "script font forge": forgeFlattenPath (M/L/H/V/C/Q coverage and
flattening fidelity), forgeCapsule/forgeGlyphContours (stroke width 8 on the 100-grid, round
caps/joins, uniform scale), forgeTTF table construction against the TrueType spec (head,
hhea, maxp field counts, hmtx, loca long format, glyf point flags and deltas, cmap format 4
segment math including the 0xFFFF terminator, checksums and checkSumAdjustment), PUA base
assignment per tongue, the dot glyph for unknown tokens, omniMatchWord's parity with the
codex's own matchWord, and forge determinism (identical codex => identical bytes). Also
verify omniScriptText keeps LOGICAL order and omniScriptCSS emits the canonical
writing-mode/direction/bidi per flow at sufficient selector specificity. Prefix "static:".`,
  },
  {
    label: 'static:integration',
    prompt: `${CTX}
Assigned ids: TX-9, TX-10 (static halves).
STATIC. TX-9: span lifecycle — spanFromResult/decorateAll/retranslateSpan/placeTSpan and the
sanitizer's tspan branch. Verify data-src/data-rom/data-scr/data-flow/dir survive sanitize,
persist and reload; that a span whose engine is asleep never degrades to Latin text; that
undo-aware editing (edApplyHTML/edApplyText) covers every span mutation. TX-10: exports —
does the script text (PUA) travel into EPUB with its forged fonts embedded and per-language
CSS, and does DOCX correctly carry romanization instead of PUA? Check epubFontEntries /
epubLangCSS / epubSceneInto / docxRunsFrom. Prefix "static:".`,
  },
  {
    label: 'func:engine-parity',
    prompt: `${CTX}
${FUNC}
Assigned ids: TX-1, TX-2, TX-3 (functional).
Prove the writer's translation IS the codex's translation, at scale. Boot the real codex
STANDALONE as ground truth (patch it the way omniPatchHTML does so CODEX.compileText is
reachable — see s2-codex-fidelity.mjs) and compare against the writer for EVERY tongue over
a corpus of at least 25 varied inputs: plain prose, the user's warrant text, punctuation,
unknown words, numbers, hyphenates, apostrophes, mixed case, empty/whitespace, very long
sentences, and non-ASCII. Assert byte-identical romanization and identical gloss structure.
Then determinism: identical output across repeat calls, across a reload, and on a
storage-fresh browser context. Report any input where they diverge.`,
  },
  {
    label: 'func:script-render',
    prompt: `${CTX}
${FUNC}
Assigned ids: TX-4, TX-5, TX-6 (functional).
Prove the rendered script is the codex's script. For every scripted tongue: (a) glyph
sequence parity — decode the span's PUA back to glyph keys and compare with the codex's own
matchWord tokenization, over many words; (b) geometry — DOM-measured proof of each flow's
canonical layout (cols-rtl columns advance right->left with letters running down;
btt-stave staves advance left->right with letters bottom-up and bottoms on common ground;
rtl right-to-left), including multi-word phrases and a phrase long enough to wrap columns;
(c) rail continuity — stacked letters abut with zero gap so stems fuse; (d) fonts — extract
each forged TTF via window.tenebrae._forge.fontBytes and validate with python3 fontTools
(all tables decompile, cmap covers every PUA code used, contours non-empty, deterministic
bytes across two forges). Zero <svg> inside any span.`,
  },
  {
    label: 'func:roundtrip-ux',
    prompt: `${CTX}
${FUNC}
Assigned ids: TX-7, TX-8, TX-9 (functional).
Prove the author's loop works: highlight English -> translate -> read it -> get back.
Cover: selection to translate through the real UI for every tongue; the tap sheet showing
the big script render, the source line, the romanization and the interlinear gloss; edit
source and retranslate; change tongue (including between flows, e.g. Celan High -> Kerrackian
-> Kildaren) with the span re-rendering correctly each time; revert to plain text restoring
the exact English; remove span; and that EVERY one of those is undoable with Ctrl+Z and
redoable, including a mixed sequence interleaved with ordinary typing. Then persistence:
spans survive reload, and a span created before a codex import re-renders after it.`,
  },
  {
    label: 'func:export-fidelity',
    prompt: `${CTX}
${FUNC}
Assigned ids: TX-10, TX-11 (functional).
Prove translations leave the app intact. EPUB: export a book containing spans in all
scripted tongues; unzip (store-only reader in s2-export-roundtrip.mjs); assert each span
carries the PUA script text plus data-src/data-rom/data-flow, that every forged font used is
embedded and manifested, that the CSS carries @font-face plus the per-language and per-flow
rules, that every XHTML part parses as strict XML, and validate the embedded fonts with
fontTools. Then re-import the EPUB through the real UI and assert spans come back LIVE with
source intact and re-render identically. DOCX/MD/TXT: assert romanization (never PUA) and
that the source text is recoverable. Report anything that would render wrong in a reader
lacking the fonts.`,
  },
  {
    label: 'func:stress',
    prompt: `${CTX}
${FUNC}
Assigned id: TX-12 (functional).
Break it. Hostile and edge inputs through the REAL UI and the seams: a 2000+ character
selection; a selection spanning multiple paragraphs and existing spans; translating a span's
own script text; text with XML/HTML metacharacters (& < > " ' and a literal </span>);
emoji and combining marks; RTL source text; a word longer than a column; rapid repeated
translate/undo cycles; translating while the engine is still waking; and reload mid-flight.
Assert: no page exceptions, no data loss, no Latin fallback in a span, no corrupted spans,
and the app remains usable. Report every anomaly with its repro.`,
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
log(`Audit: ${merged.length} findings from ${ok.length}/${AUDITORS.length} auditors, ${anomalies.length} anomalies`);

phase('Adversarial');

const passes = merged.filter(f => f.status === 'pass');
const nonPasses = merged.filter(f => f.status !== 'pass');

const [skepticPass, skepticFail, coverage] = await parallel([
  () => agent(`${CTX}
${FUNC}
ADVERSARIAL SKEPTIC for PASS claims. Default position: unearned until proven. The user has
already been burned twice — once by a placeholder engine producing plausible-but-wrong
output, once by rendering that looked like glyphs but violated the codex's layout rules. So
hunt exactly that class of defect: output that LOOKS right but is not the codex's. Run your
own probes (prefix tx-vp-*) for at least 5 of the riskiest passes, and for at least one,
compare against the codex's own rendering rather than against the writer's own seams.
Return a verdict for EVERY distinct id below.
FINDINGS:
${JSON.stringify(passes, null, 1)}`,
    { label: 'verify:refute-passes', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
${FUNC}
ADVERSARIAL SKEPTIC for FAIL/PARTIAL/BLOCKED claims. Default position: the tester erred —
stale sample-codex expectations, a probe that raced the engine wake, a geometry check that
ignored column wrapping or the inverted stave axis, or a misreading of the codex's rules.
Re-verify each with your own probe (prefix tx-vf-*) where practical. Resolve cross-source
disagreements explicitly. Return a verdict for EVERY distinct id below.
NON-PASS FINDINGS:
${JSON.stringify(nonPasses, null, 1)}
Pass claims on the same ids, for context:
${JSON.stringify(passes.filter(p => nonPasses.some(n => n.id === p.id)), null, 1)}`,
    { label: 'verify:refute-fails', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
COVERAGE CRITIC. You judge the certification, not the findings. Read the standard, the
translation/forge/script code in the artifact, and the codex's own renderers
(transcribeScriptHTML, transcribeScriptSVG, wordScriptSVG, matchWord, scriptDir) at
${CODEX}. Report in missed[]: (a) any TX id with no finding; (b) any translation-service
behavior the STANDARD fails to cover — name it concretely and say where you saw it;
(c) any (F) id whose findings lack functional evidence; (d) any codex rule the writer does
not implement at all (e.g. a script feature, a direction mode, a glyph-composition rule);
(e) any place the writer's output would diverge from the codex on material the corpus never
exercised. Reported ids: ${JSON.stringify([...new Set(merged.map(f => f.id))])}.
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
