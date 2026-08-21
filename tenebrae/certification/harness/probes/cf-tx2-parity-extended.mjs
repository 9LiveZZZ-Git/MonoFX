// cf-TX-2 — TRANSLATION PARITY, ADVERSARIAL EXTENSION.
//
// tx-parity-corpus.mjs already proves rom/gloss/tok parity over 35 ordinary +
// mildly hostile inputs. This probe is the GAP: 32 inputs that corpus does not
// contain — invisible and format characters (NBSP, CRLF, soft hyphen, ZWSP,
// ZWJ/ZWNJ, bidi overrides), locale case-folding traps (Turkish İ/ı, German ß),
// fullwidth forms, non-ASCII digits, digits inside words, doubled and curly
// apostrophes, degenerate one-character inputs, a 5000-character word, a
// multi-sentence input (forces compileText's multi-LINE path), and a ZWJ emoji
// sequence — plus three seam questions the corpus probe never asks:
//   * the OMNI_ALIAS ids ('celan-basic', 'celan-high') must give byte-identical
//     output to their canonical ids (step1.html L3573);
//   * a tongue id the codex does not have must return null — NOT the legacy
//     sample cipher's answer (TX-1 corroboration);
//   * non-string arguments must behave as String(x), the writer's own contract.
//
// Ground truth is the REAL codex, booted standalone from the scratchpad file,
// patched the way omniPatchHTML patches it. The rom/gloss/tok derivation lives
// in THIS file (documented rule), never copied from the writer, so a bug in the
// writer's projection cannot hide by being reproduced here.
// Run: cd probes && node cf-tx2-parity-extended.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const CODEX_PATH = SCRATCH + '/codex.html';
const PATCHED = SCRATCH + '/cf-codex-patched.html';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

{ // same widening the writer applies at import time, minus the CSP
  let html = await readFile(CODEX_PATH, 'utf8');
  if(!/window\.CODEX\s*=\s*\{[^}]*compileText/.test(html))
    html = html.replace(/window\.CODEX\s*=\s*\{/,
      'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ' +
      'CELAN:{N_TOTAL:(typeof N_TOTAL!=="undefined"?N_TOTAL:null),' +
      'ROOTS:(typeof ROOTS!=="undefined"?ROOTS:null),DICT:(typeof DICT!=="undefined"?DICT:null)}, ');
  await writeFile(PATCHED, html);
}

const LONG2 = ('a warden of the drowned harbor counted the tides and the names and the broken oars '
  + 'while the bell above the water tower rang for every ship that never came back to the stone quay ').repeat(3);
const CORPUS = [
  'The sea remembers',                     // 0  NBSP word joiner (the pad char)
  'the sea\r\nremembers the gate',                   // 1  CRLF
  'soft­hyphen word',                           // 2  soft hyphen
  'zero​width space',                           // 3  ZWSP
  'joiner‍joined‌not',                     // 4  ZWJ / ZWNJ
  '‮bidi override‬ text',                  // 5  bidi control chars
  'İSTANBUL iık',                          // 6  Turkish dotted/dotless I
  'straße GROSS ß',                        // 7  German sharp s
  'ＦＵＬＬ ｔｅｘｔ',// 8 fullwidth forms
  'MMXXVI chapter IV',                               // 9  roman numerals
  '1st 2nd 3rd 21st',                                // 10 ordinals
  '$1,000 €50 £7',                         // 11 currency
  'STONE-GATE SEA-KING',                             // 12 all-caps hyphenates
  "don''t o''clock",                                 // 13 doubled apostrophes
  "O'Neill-Smith's ledger",                          // 14 apostrophe + hyphen + possessive
  'h4x0r w0rd5 mix3d',                               // 15 digits inside words
  '٣٤ ٥٦ arabic digits',         // 16 non-ASCII digits
  'x²y³ superscripts',                     // 17 superscripts
  '👨‍👩‍👧 family',// 18 ZWJ emoji sequence
  '  leading and trailing  ',                        // 19 padded whitespace
  'tab\tseparated\twords',                           // 20 tabs
  'em—dash—joined words',                  // 21 em dashes inside a word
  'a'.repeat(5000),                                  // 22 5000-char word
  LONG2,                                             // 23 long multi-clause prose
  'the sea remembers. the sea remembers. the sea remembers.', // 24 multi-sentence -> multi-line
  '…',                                          // 25 ellipsis only
  '-',                                               // 26 single hyphen
  "'",                                               // 27 single apostrophe
  '’',                                          // 28 curly apostrophe alone
  'Sea, sea; SEA: sEa',                              // 29 case variants of one word
  'gaté combining acute',                      // 30 combining mark
  '0',                                               // 31 bare zero
];
const label = (s, i) => `#${i} ` + JSON.stringify(s.length > 34 ? s.slice(0, 31) + '…' : s);

// ---------- A. ground truth ----------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const cErrs = [];
const pageA = await browser.newPage();
pageA.on('pageerror', e => { cErrs.push(e.message); console.log('CODEX PAGE EXCEPTION:', e.message); });
await pageA.goto('file://' + PATCHED);
await pageA.waitForFunction(() => window.CODEX && window.FAMILY && typeof window.translateE2C === 'function', null, { timeout: 120000 });
const IDS = await pageA.evaluate(() => ['celan_basic', ...Object.keys(window.CODEX.TRANS)]);
console.log('codex tongues:', JSON.stringify(IDS));

const gt = await pageA.evaluate(({ ids, inputs }) => {
  const C = window.CODEX, out = {};
  for(const id of ids){
    out[id] = inputs.map(text => {
      try{
        if(id === 'celan_basic'){
          const parts = window.translateE2C(String(text));
          return { kind: 'celan', parts: parts.map(p => ({ tok: p.tok, cel: p.cel, drop: !!p.drop, unknown: !!p.unknown, gloss: p.gloss || '', tag: p.tag || '' })) };
        }
        const T = C.TRANS[id];
        const res = C.compileText(T, String(text), 'e2l');
        return { kind: 'trans',
          parts: (res.parts || []).map(p => ({ tok: p.tok, out: p.out, drop: !!p.drop, unknown: !!p.unknown, gloss: p.gloss || '', tag: p.tag || '' })),
          lines: res.lines ? res.lines.map(l => l.map(p => ({ t: p.t, u: !!p.u }))) : null };
      }catch(e){ return { kind: 'error', message: String(e && e.message) }; }
    });
  }
  return out;
}, { ids: IDS, inputs: CORPUS });
await pageA.close();
ck('the codex compiles all ' + CORPUS.length + ' adversarial inputs without throwing',
   IDS.every(id => gt[id].every(r => r.kind !== 'error')),
   IDS.flatMap(id => gt[id].map((r, i) => r.kind === 'error' ? id + '#' + i + ' ' + r.message : null)).filter(Boolean).slice(0, 4).join(' | '));

// ---------- B. derive expectations here, from the raw codex output ----------
const deriveRom = raw => {
  if(raw.kind === 'celan') return raw.parts.filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
  const lines = raw.lines || [raw.parts.filter(p => !p.drop && p.out).map(p => ({ t: p.out, u: !!p.unknown }))];
  return lines.map(l => l.map(p => p.t).join(' ')).join(' ');
};
const deriveGloss = raw => raw.parts.map(p => ({
  s: p.tok, o: p.drop ? '∅' : ((raw.kind === 'celan' ? p.cel : p.out) || '—'),
  g: (p.gloss || '') + (p.tag ? ' · ' + p.tag : ''), k: !p.unknown && !p.drop, drop: !!p.drop }));
const deriveToks = raw => {
  const lines = raw.lines || [raw.parts.filter(p => !p.drop && p.out).map(p => ({ t: p.out, u: !!p.unknown }))];
  const toks = [];
  lines.forEach((l, i) => { l.forEach(p => toks.push({ t: p.t, u: !!p.u })); if(i < lines.length - 1) toks.push({ sep: true }); });
  return toks;
};

// ---------- C. the writer, fresh boot, embedded codex ----------
const srv = await startServer();
const pageB = await browser.newPage();
const errsB = [];
pageB.on('pageerror', e => { errsB.push(e.message); console.log('WRITER PAGE EXCEPTION:', e.message); });
await pageB.goto(srv.url + 'step1.html');
await pageB.waitForTimeout(3800);
const boot = await pageB.evaluate(() => { const c = window.tenebrae.codex(); return { kind: c.kind, embedded: !!c.embedded, sample: !!c.sample }; });
ck('writer is on the embedded codex (no import step)', boot.kind === 'omni-host' && boot.embedded && !boot.sample, JSON.stringify(boot));

const writer = await pageB.evaluate(async ({ ids, inputs }) => {
  const out = {};
  for(const id of ids){
    out[id] = [];
    for(const text of inputs){
      try{
        const r = await window.tenebrae.translate2(id, text);
        out[id].push(r ? { rom: r.romanization, gloss: r.gloss, toks: r.toks, flow: r.flow, lang: r.lang && r.lang.id } : null);
      }catch(e){ out[id].push({ error: String(e && e.message) }); }
    }
  }
  return out;
}, { ids: IDS, inputs: CORPUS });

let romBad = 0, glossBad = 0, tokBad = 0, nullBad = 0, celanBad = 0;
const diffs = [];
for(const id of IDS){
  for(let i = 0; i < CORPUS.length; i++){
    const raw = gt[id][i], got = writer[id][i];
    if(!got || got.error){ nullBad++; diffs.push(`NULL ${id} ${label(CORPUS[i], i)} -> ${JSON.stringify(got)}`); continue; }
    const expRom = deriveRom(raw);
    if(got.rom !== expRom){ romBad++; if(diffs.length < 10) diffs.push(`ROM ${id} ${label(CORPUS[i], i)}\n     codex : ${JSON.stringify(expRom).slice(0, 180)}\n     writer: ${JSON.stringify(got.rom).slice(0, 180)}`); }
    const expG = JSON.stringify(deriveGloss(raw));
    if(JSON.stringify(got.gloss) !== expG){ glossBad++; if(diffs.length < 10) diffs.push(`GLOSS ${id} ${label(CORPUS[i], i)}\n     codex : ${expG.slice(0, 200)}\n     writer: ${JSON.stringify(got.gloss).slice(0, 200)}`); }
    if(raw.kind === 'trans'){
      if(JSON.stringify(got.toks) !== JSON.stringify(deriveToks(raw))){ tokBad++; if(diffs.length < 10) diffs.push(`TOKS ${id} ${label(CORPUS[i], i)}\n     codex : ${JSON.stringify(deriveToks(raw)).slice(0, 200)}\n     writer: ${JSON.stringify(got.toks).slice(0, 200)}`); }
    }else{
      // Celan Basic: the writer splits a codex part into word + trailing punct;
      // what may never change is the text the tokens rejoin to.
      const kept = raw.parts.filter(p => p.cel && !p.drop);
      const rejoin = (got.toks || []).map(t => String(t.t) + String(t.punct || '')).join(' ');
      if(rejoin !== kept.map(p => String(p.cel)).join(' ')){ celanBad++; if(diffs.length < 10) diffs.push(`CELAN-TOKS ${label(CORPUS[i], i)}\n     codex : ${JSON.stringify(kept.map(p => p.cel).join(' ')).slice(0, 180)}\n     writer: ${JSON.stringify(rejoin).slice(0, 180)}`); }
    }
  }
}
const N = IDS.length * CORPUS.length;
console.log(`compared ${N} cells (${IDS.length} tongues x ${CORPUS.length} inputs)`);
if(diffs.length) console.log(diffs.join('\n'));
ck(`romanization byte-identical to the codex in all ${N} cells`, romBad === 0, romBad + ' mismatches');
ck(`gloss JSON-identical to the codex in all ${N} cells`, glossBad === 0, glossBad + ' mismatches');
ck('token stream identical for the five alphabet tongues', tokBad === 0, tokBad + ' mismatches');
ck('Celan Basic tokens rejoin to the codex text exactly', celanBad === 0, celanBad + ' mismatches');
ck('no cell returned null / threw', nullBad === 0, nullBad + ' nulls');

// audit trail: one non-trivial row per tongue
for(const id of IDS) console.log(`  ${id} #24 -> ${JSON.stringify(String(writer[id][24].rom).slice(0, 70))}`);
console.log('  celan_basic #6 (Turkish) ->', JSON.stringify(writer.celan_basic[6].rom));
console.log('  celan_basic #0 (NBSP)    ->', JSON.stringify(writer.celan_basic[0].rom));
console.log('  kildaren    #22 (5000ch) ->', JSON.stringify(String(writer.kildaren[22].rom).slice(0, 60)));

// ---------- D. seam questions the corpus probe never asks ----------
const seam = await pageB.evaluate(async () => {
  const j = x => JSON.stringify(x);
  const canonB = await window.tenebrae.translate2('celan_basic', 'the sea remembers the stone gate');
  const aliasB = await window.tenebrae.translate2('celan-basic', 'the sea remembers the stone gate');
  const canonH = await window.tenebrae.translate2('celan_high', 'the sea remembers the stone gate');
  const aliasH = await window.tenebrae.translate2('celan-high', 'the sea remembers the stone gate');
  const rath   = await window.tenebrae.translate2('rath-speech', 'the sea remembers the stone gate');
  const bogus  = await window.tenebrae.translate2('klingon', 'the sea remembers the stone gate');
  const empty  = await window.tenebrae.translate2('', 'the sea remembers the stone gate');
  const num    = await window.tenebrae.translate2('celan_basic', 42);
  const numStr = await window.tenebrae.translate2('celan_basic', '42');
  const nul    = await window.tenebrae.translate2('celan_basic', null);
  const nulStr = await window.tenebrae.translate2('celan_basic', 'null');
  const legacy = window.tenebrae.translate('celan-basic', 'the sea remembers the stone gate');
  return { aliasBasicSame: j(canonB) === j(aliasB), aliasHighSame: j(canonH) === j(aliasH),
           rathLang: rath && rath.lang && rath.lang.id, rathRom: rath && rath.romanization,
           canonBRom: canonB.romanization, canonHRom: canonH.romanization,
           bogus, emptyId: empty && { omni: !!empty.omni, lang: empty.lang && empty.lang.id, rom: empty.romanization }, numSame: j(num) === j(numStr), numRom: num && num.romanization,
           nulSame: j(nul) === j(nulStr), nulRom: nul && nul.romanization,
           legacyRom: legacy && legacy.romanization };
});
console.log('seam:', JSON.stringify(seam).slice(0, 600));
ck("alias id 'celan-basic' is byte-identical to 'celan_basic'", seam.aliasBasicSame);
ck("alias id 'celan-high' is byte-identical to 'celan_high'", seam.aliasHighSame);
ck("the dead tongue 'rath-speech' answers as Celan Basic in the CODEX, never in the cipher",
   seam.rathLang === 'celan_basic' && seam.rathRom === seam.canonBRom && seam.rathRom !== seam.legacyRom,
   `rath=${JSON.stringify(seam.rathRom)} legacy-sample=${JSON.stringify(seam.legacyRom)}`);
ck('an unknown tongue id returns null, not a cipher answer', seam.bogus === null, JSON.stringify(seam.bogus));
// An EMPTY tongue id is not a refusal: omniLangId('') is falsy, so
// omniTranslate falls back to its default tongue (step1.html L3654,
// `omniLangId(rawLangId) || 'celan_basic'`). The requirement TX-1 imposes is
// that the answer is the CODEX's and is labelled honestly — which it is. An
// unknown-but-non-empty id still refuses with null (checked above).
ck("an empty tongue id defaults to Celan Basic in the CODEX (never the cipher) and says so",
   seam.emptyId && seam.emptyId.omni === true && seam.emptyId.lang === 'celan_basic'
   && seam.emptyId.rom === seam.canonBRom && seam.emptyId.rom !== seam.legacyRom,
   JSON.stringify(seam.emptyId));
ck('non-string text is handled as String(text) — 42', seam.numSame, JSON.stringify(seam.numRom));
ck('non-string text is handled as String(text) — null', seam.nulSame, JSON.stringify(seam.nulRom));
ck('the legacy sample seam still answers differently (the parity check discriminates)',
   seam.legacyRom !== seam.canonBRom, `sample=${JSON.stringify(seam.legacyRom)} codex=${JSON.stringify(seam.canonBRom)}`);

ck('no page exceptions (writer)', errsB.length === 0, errsB.slice(0, 3).join(' | '));
ck('no page exceptions (codex ground truth)', cErrs.length === 0, cErrs.slice(0, 3).join(' | '));
console.log('cf-TX-2 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
