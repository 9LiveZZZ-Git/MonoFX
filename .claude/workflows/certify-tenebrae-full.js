export const meta = {
  name: 'certify-tenebrae-full',
  description: 'Full certification of Tenebrae Writer: engine, script, the author loop, all five export formats, and the v1.5 Claude assist layer',
  whenToUse: 'Re-run whenever tenebrae/step1.html changes materially. Supersedes the per-step workflows, whose briefings describe superseded layout contracts.',
  phases: [
    { title: 'Triage', detail: 'every non-passing probe: stale expectation or real defect?' },
    { title: 'Audit', detail: '6 domain agents, each static + functional over its own requirement ids' },
    { title: 'Refute', detail: 'an adversarial pass per domain, trying to break every claimed pass' },
    { title: 'Critic', detail: 'coverage critic + synthesis' },
  ],
}

const ART = '/home/user/MonoFX/tenebrae/step1.html';
const STD = '/home/user/MonoFX/tenebrae/certification/translation-requirements.md';
const S1 = '/home/user/MonoFX/tenebrae/certification/step1-requirements.md';
const S2 = '/home/user/MonoFX/tenebrae/certification/step2-requirements.md';
const H = '/home/user/MonoFX/tenebrae/certification/harness';
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

const SUITE = (args && args.suite) || 'not supplied';

const CTX = `You are one verification agent certifying TENEBRAE WRITER, an offline-first
novel editor for fiction written inside a constructed world with its own writing systems.

The claim under test: an author can write offline, highlight English, translate it into a
real Tenebrae tongue, see that tongue's CANONICAL SCRIPT as live text, get the English back,
and carry the whole thing out into five formats without losing any of it.

Read first (do NOT modify any of them):
- Standards: ${STD} (TX ids), ${S1} (step-1 ids), ${S2} (X2 ids)
- Artifact: ${ART}

HOW THE SYSTEM ACTUALLY WORKS. This briefing is authoritative — several of these
points reverse what an earlier version of this workflow said, and re-deriving them
from intuition produces false findings:

1. ENGINE. The real Codex Omnilingua is EMBEDDED in the artifact (base64 in
   <script id="codex-embed">) and installs as the engine at boot, with no import
   step. A legacy SAMPLE codex (a shift cipher) still exists for its fonts only;
   it must NEVER be the translation engine on any path. window.tenebrae.translate2
   is the real engine; window.tenebrae.translate is the legacy sample seam — a
   probe that uses the latter is testing the wrong thing.

2. SCRIPT AS TEXT. At wake the app FORGES a TrueType font per tongue from the
   codex's own glyph vectors. Spans carry PUA characters (data-scr) in those
   fonts, data-rom holds romanization, data-src the English. Never SVG in prose.

3. LAYOUT — current contract, one column/stave PER WORD:
     cols-rtl  (Celan High) one column per word, letters DOWN the column in
               logical order, columns advancing LEFT->RIGHT, hanging from a
               common ceiling.
     btt-stave (Kildaren) one stave per word, staves left->right, letters
               bottom-up, standing on common ground.
     rtl       (Kerrackian) letters and words right->left.
   dir="rtl" belongs to the HORIZONTAL rtl tongue alone: inside a vertical
   writing mode, direction reverses the inline (vertical) axis and stands the
   column on its head. The codex reverses token order for rtl and btt-stave and
   NOT for cols-rtl.

4. WHAT GETS WRITTEN. The codex feeds its typesetter cleanText — compiled lines
   with untranslated parts (p.u) removed — and strips everything outside
   [letters, digits, ' ’ -] from each word. The writer does the same for the
   five ALPHABETS: an untranslatable word is not transliterated letter by letter.

5. CELAN BASIC IS DIFFERENT and this is deliberate. It has no alphabet in
   TRANS[].L.script. Its Auric runes are carved per WORD by the codex's
   composeWord. The forge mints a PUA codepoint the first time a word is written
   and rebuilds the face (lazy, session-local). Because this script HAS a device
   for a borrowing (a pseudo-rune plus a loan diamond), loans ARE written here —
   the deliberate exception to point 4.

6. EXPORTS. Markdown (source in an HTML-comment marker, plus doc/scene markers so
   our own files round-trip exactly), plain text and .docx (English printed
   bracketed beside the romanization, exportOpts.sourceGloss), EPUB (PUA text +
   embedded forged fonts), and PDF (hand-written, CIDFontType2 + Identity-H,
   glyph ids straight into the content stream).

7. CLAUDE ASSIST (v1.5) is the ONE non-offline feature. BYOK, off until a key is
   pasted, no request at boot or any other path without one. It must never send
   script or romanization, never let an unverifiable claim through, and never put
   the key anywhere a shared backup could carry it.

GROUND RULES:
- Ground truth is the codex itself (${CODEX}) and the artifact's actual behaviour,
  never your expectations of how a conlang "should" look or how a feature "should"
  be built. When the writer and the codex disagree, the codex wins.
- NEVER modify ${ART} or any standard. NEVER run git commit/push/checkout.
- Evidence is mandatory. Static claims cite step1.html line numbers. Functional
  claims cite the probe you ran and quote its ACTUAL output. "It looks correct"
  is not evidence and will be rejected by the refuter.
- Statuses: pass | partial | fail | blocked. blocked must say exactly why.
- Report every assigned id exactly once in findings[]. Anything else goes in
  anomalies[] — including things that are wrong but outside your ids.

DETERMINISTIC GROUND TRUTH — the full probe suite was run immediately before this
workflow. Do not re-run the whole suite; use this and probe what it does NOT cover:
${SUITE}
`;

const FUNC = `Functional rules:
- Read ${H}/probes/ex-lib.mjs first for the shared helpers (launch, wait,
  createBook, insertTranslationSpan, downloadFromSheet, verdict).
- Write NEW probes as ${H}/probes/cf-<name>.mjs and run: cd ${H}/probes && node <file>.
  KEEP them — they are certification artifacts. Do not overwrite existing probes.
- Each probe starts its own server (startServer from ../serve.mjs), uses chromium
  executablePath /opt/pw-browsers/chromium, and attaches page.on('pageerror').
- The embedded engine needs ~3.5s to wake and forge on a fresh page.
- Seams: window.tenebrae.{translate2,langs,codex,engine,_forge,_pdf,_claude,_omni}.
- For font truth use python3 + fontTools. For PDF truth see _pdfcheck.py.
- Re-running an existing green probe is NOT evidence of anything new. Your job is
  the gap: the case nobody wrote a probe for.
- Only 4 CPUs: run probes one at a time, not in parallel.`;

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
    new_defects: { type: 'array', items: { type: 'string' } },
  },
};

const DOMAINS = [
  { key: 'engine', ids: 'TX-1, TX-2, TX-3',
    brief: `The engine path. Static: decodeEmbeddedCodex / embeddedCodexPack / ensureCodexInstalled /
resolveTranslate / tonguesList / omniTranslate / the boot install / offerRestore+migrateBooks.
Name EVERY path on which the sample cipher could answer a translation — boot race, failed
wake, removing an imported pack, restore from a backup with no codex. Functional: prove
parity of romanization AND gloss against the codex's own compiler over a varied corpus
(punctuation, unknowns, numbers, hyphenates, apostrophes, mixed case, empty, very long,
non-ASCII), and prove determinism across reload and a storage-fresh context.` },

  { key: 'script', ids: 'TX-4, TX-5, TX-6, TX-6b, TX-6c',
    brief: `The forge and the glyphs. Static: forgeFlattenPath / forgeCapsule / forgeTTF table
construction against the TrueType spec / the Auric word-font path (auricGlyph, auricEnsure,
auricRebuild, AURIC_BASE) / omniScriptText / omniScriptCSS specificity. Functional: prove the
writer's glyph stream equals the codex's OWN typesetter for the alphabets, and that the Auric
glyphs equal composeWord's geometry segment for segment. Then attack the WORD-SCRIPT
specifically — it is the newest and least exercised code in the artifact. Its codepoints are
session-local and minted lazily: what happens across a reload, across a scene never opened,
when the 4352-slot block is exhausted, when two words differ only by case or punctuation?` },

  { key: 'loop', ids: 'TX-7, TX-8, TX-9, TX-11c, TX-11d',
    brief: `The author's loop. Static: spanFromResult / placeTSpan (including the gap-ownership rule
and data-pad) / rangeAround / retranslateSpan / decorateAll / tspanSheet / the sanitizer's
tspan branch. Functional: selection shapes the ordinary probes never make — inside a bold
run, inside a heading, spanning an existing span, a selection that IS an entire block, a
selection with leading and trailing whitespace, nested marks. Prove undo reverses every span
operation including the placement repair and the pad rule, and that revert returns the
author's line codepoint for codepoint.` },

  { key: 'exports', ids: 'TX-10, TX-11, TX-11b',
    brief: `Markdown, plain text, DOCX and EPUB. Static: mdInline / plainFromDoc / docxRunsFrom /
epubFontEntries / epubLangCSS / syncScriptDoc / the tenebrae:doc and tenebrae:scene markers.
Functional: round-trip fidelity is the whole point — export and re-import in each format and
compare structure and content against what went in. Attack the marker scheme: what happens to
a foreign markdown file that happens to contain our marker text? What about a book whose
scene title itself looks like a heading, or an empty chapter, or a scene containing only a
span?` },

  { key: 'pdf', ids: 'TX-10b',
    brief: `The PDF writer — hand-written, no library, so every byte is ours to get wrong. Static:
pdfFile / pdfBuf / the xref and trailer construction / CIDFontType2 and Identity-H setup /
the /W array / pdfWinAnsi / pdfLiteral / the flow-specific painters. Functional: go beyond
s2-pdf-export. Attack the layout engine: a very long unbreakable word, a scene of only a
vertical span, a span at a page boundary, a book with an empty chapter, text containing
characters outside WinAnsi, a nested bold+italic run, a list. Verify the file still parses
and that no glyph id is emitted that the embedded font lacks. Confirm byte-determinism.` },

  { key: 'assist', ids: 'TX-13, TX-14, TX-15, TX-16, TX-17',
    brief: `The Claude assist layer. This one is SECURITY-SHAPED: treat it as though a mistake leaks
the author's key or their manuscript. Static: claudeLoad / claudeAsk / claudeSceneText /
claudeGrammar / claudeCards / claudeApplyFix / claudeSheet, and every call site. Verify by
reading the code that (a) no request can be made without an explicit user action, (b) the key
is never written into `+"`state`"+` and so cannot enter a backup, (c) no PUA or romanization can
reach a request body on any path including a span whose data-src is empty, (d) an accepted
fix cannot land inside a .tspan, (e) the guardrails cannot be bypassed by a crafted response.
Functional: stub window.fetch (never make a real API call, there is no key) and attack the
guardrails with hostile model responses — overlapping fixes, a fix whose `+"`after`"+` contains
script, a card quote that matches only after normalisation, unicode tricks, a huge response.` },
];

phase('Triage');

// The suite left 18 probes not passing. Some are stale — the artifact has
// deliberately moved past what they assert — and some may be real. Both have
// happened repeatedly in this project, and calling a real defect "stale" is the
// expensive mistake, so each group is judged on evidence, not on vibe.
const TRIAGE_RULES = `For each probe assigned to you:
1. RUN it: cd ${H}/probes && node <name>. Capture the real output.
2. Read the probe AND the code it exercises. Decide, with evidence:
   - STALE: the probe asserts a contract the artifact deliberately replaced.
     Say which contract, cite the requirement id in the standards that now
     governs, and FIX the probe to the current contract, then re-run it green.
   - REAL: the artifact is wrong. Do NOT fix the artifact — report it as a
     defect with a minimal reproduction and the exact probe output.
   - ENVIRONMENTAL: it fails only under parallel load / timeout. Prove it by
     running it alone, and say so.
3. A probe that fails because a menu label or seam was RENAMED is stale; fix it.
4. Never weaken an assertion to make it pass. If you cannot tell, say REAL.
Report one finding per probe with id = the probe filename.`;

const TRIAGE = [
  { key: 'triage-legacy-tr', list: 'cc-probe1.mjs, tr-alias-roundtrip.mjs, tr-codex-zip.mjs, tr-determinism.mjs, tr-tongues.mjs' },
  { key: 'triage-legacy-st', list: 'st-editor-save.mjs, st-offline-network.mjs, vf-cd3-block-junction.mjs, vf-ed1-flush.mjs, vf-pr4-codex-network.mjs, vp-cd6-card-over-editor.mjs, vp-sk-pr5-restore-hostile-doc.mjs' },
  { key: 'triage-current', list: 's2-ux-sheet-bigrender.mjs, tx-engine-always.mjs, tx-vp-glyph-vector-truth.mjs, vf-ex2ex5-firstline.mjs, vp-ex5-span-export.mjs, vp-tr2-det-reload.mjs' },
];
const triaged = await parallel(TRIAGE.map(t => () => agent(
  `${CTX}\n${FUNC}\n\nYou are triaging non-passing probes.\n${TRIAGE_RULES}\n\nYour probes: ${t.list}`,
  { label: t.key, phase: 'Triage', schema: FINDINGS, effort: 'high' })));
const triageOut = triaged.filter(Boolean);
log(`triage done: ${triageOut.reduce((n, t) => n + (t.findings || []).length, 0)} probes judged`);

phase('Audit');

const results = await pipeline(
  DOMAINS,
  d => agent(`${CTX}\n${FUNC}\n\nYOUR DOMAIN: ${d.key}\nAssigned ids: ${d.ids}\n\n${d.brief}\n\nDo BOTH the static reading and the functional probing. Report each assigned id exactly once.`,
    { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS, effort: 'high' }),
  (res, d) => agent(`${CTX}\n${FUNC}\n\nYou are the ADVERSARY for domain "${d.key}" (ids ${d.ids}).
Another agent audited it and reported:

${JSON.stringify(res, null, 1)}

Your job is to REFUTE, not to agree. For every finding marked pass or partial, try to
construct a case that breaks it — write a probe that would fail if the claim were false, and
run it. Default to agree:false when the evidence is thin, generic, or merely cites a
pre-existing green probe. For every finding marked fail or blocked, check it is REAL and not
a stale expectation in the auditor's own probe: our probes have been wrong before, and a
false alarm costs as much as a miss. Report a verdict for every id, and put anything new you
broke in new_defects[].`,
    { label: `refute:${d.key}`, phase: 'Refute', schema: VERDICTS, effort: 'high' })
    .then(v => ({ domain: d.key, audit: res, refute: v }))
);

phase('Critic');

const clean = results.filter(Boolean);
const critic = await agent(`${CTX}

Every domain has been audited and adversarially refuted:

${JSON.stringify(clean, null, 1)}

You are the COVERAGE CRITIC. Do not re-verify what was verified. Answer one question:
WHAT IS STILL UNTESTED? Look for (a) requirement ids nobody actually exercised, (b) claims
resting only on static reading where behaviour could differ, (c) interactions BETWEEN
domains that no single agent could see — a span created before a codex change and then
exported to PDF; the Auric font's lazy minting crossing an export; the Claude assist applying
a fix next to a span's pad; a restore that lands mid-session. Pick the two or three most
likely to hide a real defect, write probes for them, run them, and report what you find.
Anything that actually breaks goes in findings[] as a fail with its probe output.`,
  { label: 'coverage-critic', phase: 'Critic', schema: FINDINGS, effort: 'high' });

const report = await agent(`${CTX}

Probe triage (stale vs real):
${JSON.stringify(triageOut, null, 1)}

Audits + refutations:
${JSON.stringify(clean, null, 1)}

Coverage critic:
${JSON.stringify(critic, null, 1)}

Write the certification report to
/home/user/MonoFX/tenebrae/certification/full-certification-report.md.

Rules for the report:
- One row per requirement id with its FINAL status after refutation. Where the auditor and
  the refuter disagreed, the refuter's revised status wins unless its reasoning is plainly
  weaker — say which you took and why.
- State the overall verdict plainly: CERTIFIED or NOT CERTIFIED, and if not, exactly what
  blocks it. Do not round a partial up to a pass to make the report look better.
- List every open defect with its evidence, most severe first.
- List what remains UNTESTED and why, including anything that cannot be tested in this
  environment (no API key, no macOS, no real device).
- Include the deterministic suite result as an appendix.
Return a short plain-text summary of the verdict and the open defects.`,
  { label: 'report', phase: 'Critic', effort: 'high' });

return { report, domains: clean.map(c => c.domain), triaged: triageOut };
