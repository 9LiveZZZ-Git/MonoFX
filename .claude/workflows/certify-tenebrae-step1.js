export const meta = {
  name: 'certify-tenebrae-step1',
  description: 'Certify the Tenebrae Writer step-1 build against its certification standard (static + functional + adversarial)',
  whenToUse: 'Re-run whenever tenebrae/step1.html changes to re-certify step 1.',
  phases: [
    { title: 'Audit', detail: '5 static code auditors + 6 functional Playwright testers, one per requirement area' },
    { title: 'Adversarial', detail: 'refute pass claims, refute fail claims, coverage critic' },
  ],
}

const STANDARD = '/home/user/MonoFX/tenebrae/certification/step1-requirements.md';
const ARTIFACT = '/home/user/MonoFX/tenebrae/step1.html';
const SPEC = '/home/user/MonoFX/tenebrae/spec.md';
const HARNESS = '/home/user/MonoFX/tenebrae/certification/harness';
const MANUSCRIPT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/manuscript.docx';
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

const CTX = `You are one verification agent inside the Tenebrae Writer STEP-1 CERTIFICATION workflow.

Read these first:
- Certification standard (requirement IDs, what pass means): ${STANDARD}
- Artifact under certification (do NOT modify it): ${ARTIFACT}
- Product spec, for context: ${SPEC}

Ground rules:
- Never modify ${ARTIFACT}, ${SPEC}, or ${STANDARD}. Never run git commit/push.
- Evidence is mandatory. Static claims cite step1.html line numbers ("static: L1234-L1240 ...").
  Functional claims cite the probe file you wrote plus the actual output you observed ("probe: probes/xx.mjs -> <output>").
- Statuses: pass | partial | fail | blocked (blocked = could not verify; say exactly why).
- Report EVERY assigned requirement ID exactly once in findings[]. Anything else noteworthy
  (bugs, near-misses, suspicious code) goes in anomalies[] — do not silently drop observations.
- Be adversarial toward the artifact: your job is to find where step 1 is NOT complete,
  not to bless it. A pass you did not actually demonstrate is worse than a fail.
`;

const FUNC_CTX = `Functional probe rules:
- FIRST read ${HARNESS}/probe-example.mjs — it documents the UI seams (screen/sheet ids,
  animation timing, the IIFE constraint, download capture, debounced-save timing) and is a
  verified-working pattern. Copy it, don't reinvent it.
- Write each probe as ${HARNESS}/probes/<area>-<name>.mjs using
  import { chromium } from 'playwright-core' and import { startServer } from '../serve.mjs'.
  Run with: cd ${HARNESS}/probes && node <file>. KEEP the probe files — they are
  certification artifacts and get committed.
- Every probe starts its own server via startServer() and closes it at the end. Never
  assume a shared server is running.
- chromium executablePath: /opt/pw-browsers/chromium. Attach page.on('pageerror') in every
  probe; any page exception is a reportable anomaly even if the flow "worked".
- Drive the real UI (clicks, typing, file inputs). The window.tenebrae seam is legitimate
  for translation assertions only. After edits, wait >= 1200ms before reload (debounced save).
- Action sheets are label-driven: click buttons inside #sheet by text. Prompt sheets:
  #ps-input / #ps-save. Wait ~400ms after sheet transitions.
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
  // ---- static code auditors ----
  {
    label: 'static:structure+editor',
    prompt: `${CTX}
Assigned requirement IDs: ST-1, ST-2, ST-3, ST-4, ST-5, ED-1, ED-2, ED-3, ED-4, ED-5, ED-6, ED-7.
Method: STATIC code inspection only (no probes). The relevant code is roughly: state/model
L954-998, sanitizer L999-1066, library/book rendering L1112-1305, drag-reorder L1305-1360,
editor L1357-1630, sheets/flows L1632-1875 — but read whatever you need. For each ID, verify
the implementation exists, is wired to the UI, and has no obvious defect that would break the
requirement (e.g. check the sanitizer's whitelist actually strips script/style/event handlers,
check drag commit writes state and saves, check word-count rollups aggregate scene->chapter->book).
Prefix all evidence with "static:".`,
  },
  {
    label: 'static:persistence+principles',
    prompt: `${CTX}
Assigned requirement IDs: PR-1, PR-2, PR-3, PR-4, PR-5, PN-1, PN-2, PN-3.
Method: STATIC code inspection only. Storage layer ~L911-953, save scheduling L988-998, boot
L4183+, backup/restore L4033-4067. For PR-4/PN-1/PN-2 sweep the WHOLE file for any network or
AI surface: fetch, XMLHttpRequest, WebSocket, EventSource, navigator.sendBeacon, external
src=/href= URLs, api keys, "anthropic"/"claude"/"openai" strings, dynamic import, eval of
remote content. The only allowed near-network things are navigator.share/clipboard and the
in-page iframe used for an imported codex (verify that iframe only ever loads locally-stored
HTML, never a URL). For PN-3 verify every category of authored state has an export path.
Prefix all evidence with "static:".`,
  },
  {
    label: 'static:cards',
    prompt: `${CTX}
Assigned requirement IDs: CD-1, CD-2, CD-3, CD-4, CD-5, CD-6.
Method: STATIC code inspection only. Cards code ~L2846-3350. Verify the seven types, chip
editing, the mention regex (word boundaries, unicode, case), buildMentions/connectedCards
graph construction, quote-to-card flow, storyBibleMD/cardMD content, the zip writer
(crc32/zipStore — is it a structurally valid ZIP? store-only is fine), and graph.json shape
(nodes + edges). Note determinism: no randomness in linking. Prefix evidence with "static:".`,
  },
  {
    label: 'static:export+import',
    prompt: `${CTX}
Assigned requirement IDs: EX-1, EX-2, EX-3, EX-4, EX-5, EX-6, IM-1, IM-2, IM-3.
Method: STATIC code inspection only. Export ~L1876-2111 (mdFromDoc/mdInline/plainFromDoc/
compile/exportSheet/copyRich/shareOut/download), import ~L3350-4032 (routeImport, per-format
parsers docx/rtf/epub/html/textish, structureFromBlocks, importPreview, commitImport).
Check md escaping correctness, marks->markdown mapping, compile option handling, the t-span
handling in transformExportHTML/mdInline (EX-5: does a translation span export as readable
romanization + is source kept in-app?), the EX-6 disclosure text, import routing by
extension/content, and heading-detection heuristics (IM-3). Prefix evidence with "static:".`,
  },
  {
    label: 'static:translation+deviations',
    prompt: `${CTX}
Assigned requirement IDs: TR-1, TR-2, TR-3, TR-4, TR-5, TR-6, DV-1, DV-2, DV-3, DV-4, DV-5.
Method: STATIC code inspection only. Translation ~L2112-2845: sample codex tables, tnWord/
translateText determinism (no Math.random/Date-dependence in output), makeTSpan/tspanHTML
(does the span store source + language?), RTL handling (dir attr), codex import
(importCodexPack: HTML vs JSON vs ZIP paths, validateCodex, registerCodexFonts,
rerenderAllSpans), omni-host iframe wiring (ensureOmni/omniPatchHTML — confirm it executes
only locally-stored codex HTML), gloss rendering. For DV-1..DV-5 (deviations from the spec
MVP): confirm each deviation is real, describe how the artifact handles it, and whether it is
disclosed in-app where relevant. DV items report status "pass" if accurately
present-and-disclosed as described in the standard, "partial"/"fail" if the deviation is
worse than the standard describes. Prefix evidence with "static:".`,
  },
  // ---- functional testers ----
  {
    label: 'func:manuscript-core',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): ST-1, ST-2, ST-3, ST-4, ST-5, ED-1, PR-1, PR-4.
Probes to build (prefix files "st-"): create a book, chapters, scenes through the real UI;
rename and delete (confirm the destructive guard appears); scene status change and word-goal
display; reorder — drag simulation may be flaky, the "Move to chapter" sheet path is
acceptable evidence for the move half of ST-4, but attempt a drag (mouse events on the drag
handle in edit mode) and report what happened; type prose in #ed-content, verify live save:
reload and confirm title+body+structure persisted (PR-1/ED-1). For PR-4 attach
page.on('request') across an entire session (create/edit/export) and assert every request URL
is your local server origin — list any that are not.`,
  },
  {
    label: 'func:editor-formatting',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): ED-2, ED-3, ED-4, ED-5, ED-6.
Probes to build (prefix "ed-"): in a scene, type text, select ranges (keyboard shift+arrows
or Selection API), apply each mark via the format-bar buttons (bold/italic/underline/strike/
small-caps) and verify the resulting DOM in #ed-content; apply each block (Heading/Sub/Quote,
UL/OL via data-cmd buttons, ⁂ scene break) and verify; watch #ed-count update live as you
type (ED-4) and verify the count rolls up on the book screen after back-navigation; toggle
focus mode (#ed-focusbtn) and verify the zen class/UI state (ED-5); for ED-6 paste hostile
HTML (script tags, onclick attrs, style blocks, nested divs) via clipboard events or
document.execCommand('insertHTML') inside the contenteditable and verify the sanitizer
normalizes it (no script/style/handlers in the stored doc — check via reload + DOM inspect).`,
  },
  {
    label: 'func:cards-flow',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): CD-1, CD-2, CD-3, CD-4, CD-5, CD-6.
Probes to build (prefix "cd-"): create cards of several types; add aliases/keywords via the
chip rows; write scene prose containing a card's title and an alias (multiple occurrences,
mixed case) then open the card and verify the "mentioned in" list shows the scene with a
sane count and navigates to it (CD-3); create two cards whose corpora reference each other
and verify "connected cards" (CD-4); save a verbatim quote from editor selection to a card
(quote-to-card flow) (CD-4); export the story bible .md and cards archive .zip via the
export sheet with acceptDownloads, then unzip (node, or manual offset parsing — the zip is
store-only) and verify per-card .md files and graph.json nodes/edges reference your cards
(CD-5); use card search + type filter (CD-6).`,
  },
  {
    label: 'func:exports',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): EX-1, EX-2, EX-3, EX-5, PR-5.
Probes to build (prefix "ex-"): build a small book with 2 chapters / 3 scenes containing
every mark and block type plus a ⁂ break and a translation span (insert one via selection ->
Translate sheet; see probe-example for sheet timing); download book .md and .txt with
acceptDownloads and read the files; verify EX-1 by toggling each compile option and
re-downloading (chapter titles, scene titles, asterism present/absent as toggled and the
options persist after reload); verify EX-2 mapping (## chapter, ### scene when enabled,
**bold**, *italic*, > quote, list syntax, ⁂ separator, escaped literal * _ \` in prose);
verify EX-3 plain text; verify EX-5: the translation span exports as readable romanization
(no raw PUA/glyph junk) in both .md and .txt, and after reload the span in the editor still
carries its source text (tap it -> sheet shows source, or inspect data attrs). For PR-5
download the backup JSON, verify it contains your book+cards+codex fields, then restore it
through the restore file input on a fresh context and verify the state comes back.`,
  },
  {
    label: 'func:import',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): IM-1, IM-2, IM-3, IM-4.
Test data: the author's real manuscript is at ${MANUSCRIPT} (a 1.2 MB .docx). Do not commit
or copy it into the repo; reference it from the scratchpad path only.
Probes to build (prefix "im-"): generate small fixture files in the probes dir — a .md with
# title/## chapters/### scenes, a .txt with "Chapter 1/2" heading lines (IM-3), a minimal
.html — and drive the import flow (library menu -> Import, set the file input with
page.setInputFiles); verify the preview (title, chapter/scene counts, word count) then
commit and verify the created book matches the preview (IM-1/IM-2/IM-3). Then import the
real manuscript .docx (IM-4): report detected structure, word count, import duration, any
pageerror; spot-check that a passage of body text made it into a scene intact (pick a
distinctive phrase from the preview/scene and confirm it). If .rtf/.epub fixtures are quick
to fabricate (minimal RTF; minimal EPUB = zip with mimetype+container.xml+one xhtml), cover
those routes too; if you skip one, say so in notes rather than claiming coverage.`,
  },
  {
    label: 'func:translation',
    prompt: `${CTX}
${FUNC_CTX}
Assigned requirement IDs (functional): TR-1, TR-2, TR-3, TR-4, TR-5, TR-6.
Test data: the real Codex Omnilingua HTML (3.4 MB) is at ${CODEX}. Do not commit it.
Probes to build (prefix "tr-"): list the tongues via the translate sheet AND
window.tenebrae.langs() — verify all seven and the sample-codex disclosure (TR-1); insert a
translation via real UI selection -> Translate (see probe-example timing), verify the span
appears with the language and that tapping it shows gloss (TR-6) and source text; edit the
source and re-translate, verify regeneration (TR-3); verify Kerrackian span carries
dir="rtl" (TR-4); determinism (TR-2): translate the same sentences repeatedly and across a
reload via window.tenebrae.translate for every tongue, compare full JSON equality; then
TR-5: import the real codex through the library menu codex flow (setInputFiles with the
scratchpad path, generous timeouts — it patches and boots the codex in a hidden iframe),
verify the sample-codex badge clears, spans re-render, fonts register (document.fonts), and
translation still works and is deterministic with the real engine; also verify removing the
codex pack restores the sample engine. If the codex import genuinely cannot complete in
headless Chromium, mark TR-5 blocked with the exact failure, not fail.`,
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
You are the ADVERSARIAL SKEPTIC for PASS claims. Below are all findings currently marked
"pass". Your default position: each pass is unearned until its evidence convinces you.
Focus on: (F)-marked requirements whose pass rests on static evidence alone; evidence that
asserts more than it demonstrates; probe output that could pass while the requirement fails
(e.g. tested one mark of five, tested book export but not scene export, counted mentions
without checking word boundaries). Re-read code and RUN YOUR OWN PROBES (prefix "vp-") for
the ones you doubt most — at minimum, independently re-test 5 of the riskiest passes.
Return a verdict for EVERY distinct requirement id below: agree=true to uphold, or
agree=false with revised_status + reason grounded in code lines or probe output.
FINDINGS:
${JSON.stringify(passes, null, 1)}`,
    { label: 'verify:refute-passes', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
${FUNC_CTX}
You are the ADVERSARIAL SKEPTIC for FAIL / PARTIAL / BLOCKED claims. Below is every finding
not currently a pass. Your default position: the tester erred — the feature exists somewhere
they didn't look, their probe raced an animation or a debounced save, they used the wrong
selector or timing, or they misread the standard. For each id, re-read the code and where
practical RUN YOUR OWN PROBE (prefix "vf-") with more careful timing. Return a verdict for
EVERY distinct requirement id below: agree=true (the gap is real) or agree=false with
revised_status + reason and your stronger evidence. If two sources disagree on the same id
(one pass, one fail), that id appears here — resolve the disagreement explicitly.
FINDINGS (non-pass):
${JSON.stringify(nonPasses, null, 1)}
FOR CONTEXT, pass-claims on the same ids from other auditors:
${JSON.stringify(passes.filter(p => nonPasses.some(n => n.id === p.id)), null, 1)}`,
    { label: 'verify:refute-fails', phase: 'Adversarial', schema: VERDICTS }),
  () => agent(`${CTX}
You are the COVERAGE CRITIC. You do not judge individual findings — you find what the whole
certification MISSED. Read the standard (${STANDARD}), the spec's MVP definition (§8 of
${SPEC}), and the artifact's own self-claims (header comment, About sheet, export-sheet
disclosure, codex sheet in ${ARTIFACT}). Then examine this list of every requirement id the
auditors reported: ${JSON.stringify([...new Set(merged.map(f => f.id))])}.
Report in missed[]: (a) any standard requirement id with no finding; (b) any capability the
artifact ships (or the spec's MVP demands) that the STANDARD itself fails to cover — i.e.
holes in the checklist, named concretely (one per entry, with where you saw it); (c) any (F)
requirement whose findings above lack functional evidence. Return verdicts=[] (empty) and
put everything in missed[].`,
    { label: 'verify:coverage', phase: 'Adversarial', schema: VERDICTS }),
]);

return {
  artifactSha256: '8b20d9a08d4aff5066e1e88a90b0aa48f9a941119f17c5aafd70790c8b75e15e',
  findings: merged,
  anomalies,
  auditorsLost: lost,
  verdictsOnPasses: skepticPass ? skepticPass.verdicts : null,
  verdictsOnFails: skepticFail ? skepticFail.verdicts : null,
  coverageGaps: coverage ? coverage.missed : null,
};
