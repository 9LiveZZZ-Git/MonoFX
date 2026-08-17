// TX-2 — TRANSLATION PARITY AT SCALE.
// Claim: "the writer's romanization and gloss are byte-identical to the codex's
// own compiler output, for every tongue, over a varied corpus."
//
// Method (deliberately NOT a copy of the writer's projection code):
//   A. Boot the REAL Codex Omnilingua STANDALONE from the scratchpad file,
//      patched exactly the way omniPatchHTML patches it (so CODEX.compileText
//      is reachable), and harvest the RAW compiler output — parts[] and
//      lines[] — for every tongue x every corpus input. That is ground truth.
//   B. In Node, derive the expected romanization / gloss / token stream from
//      that raw output using the documented rule (rom = lines joined by spaces;
//      gloss = one entry per part). The derivation lives HERE, once, so a bug
//      in the writer's own projection cannot hide by being copied.
//   C. Boot the writer (embedded codex, no import step) and call the public
//      seam window.tenebrae.translate2(id, text) for the same matrix.
//   D. Compare: romanization string-identical, gloss JSON-identical, token
//      stream JSON-identical, dir/flow equal to the codex's own scriptDir.
//
// Also asserts the embedded engine IS the codex file (sha256 of the decoded
// #codex-embed payload vs the scratchpad codex.html).
// Run: cd probes && node tx-parity-corpus.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const CODEX_PATH = SCRATCH + '/codex.html';
const PATCHED = SCRATCH + '/tx-codex-patched.html';
const STEP1 = '/home/user/MonoFX/tenebrae/step1.html';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

// ---------- 0. the embedded engine is the codex, byte for byte ----------
{
  const html = await readFile(STEP1, 'utf8');
  const m = html.match(/<script id="codex-embed"[^>]*>([\s\S]*?)<\/script>/);
  const dec = m ? Buffer.from(m[1].trim(), 'base64').toString('utf8') : '';
  const ref = await readFile(CODEX_PATH, 'utf8');
  const sha = s => createHash('sha256').update(s).digest('hex');
  ck('#codex-embed decodes to the real codex byte-for-byte', !!m && dec === ref,
     `embedded ${dec.length}B sha256=${sha(dec).slice(0, 16)} | codex.html ${ref.length}B sha256=${sha(ref).slice(0, 16)}`);
}

// the SAME widening the writer applies at boot (omniPatchHTML), minus the CSP
{
  let html = await readFile(CODEX_PATH, 'utf8');
  if (!/window\.CODEX\s*=\s*\{[^}]*compileText/.test(html))
    html = html.replace(/window\.CODEX\s*=\s*\{/,
      'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ' +
      'CELAN:{N_TOTAL:(typeof N_TOTAL!=="undefined"?N_TOTAL:null),' +
      'ROOTS:(typeof ROOTS!=="undefined"?ROOTS:null),DICT:(typeof DICT!=="undefined"?DICT:null)}, ');
  await writeFile(PATCHED, html);
}

// ---------- the corpus: 35 varied inputs ----------
const LONG = 'the old keeper of the fallen tower walked the long cold road under a silent moon while the sea '
  + 'remembered every oath the drowned king ever swore and the wind carried the names of the dead across the '
  + 'salt water toward the harbor gate where the warden waited with a lamp and a ledger and no word of comfort '
  + 'for anyone who came asking after the morning';
const CORPUS = [
  'The sea remembers',                                                   // 1  plain prose
  'the old king returns to the stone gate',                              // 2  plain prose
  'Declared: my mana - let it stand as coa. Declared: the wax-candle - let it stand as coe.', // 3 warrant
  'She walks alone tonight.',                                            // 4
  'Night waves fall; the keeper watched, remembering old oaths.',        // 5  punctuation
  'Hello, world! (Really?) — yes: truly; indeed…',             // 6  punctuation
  '"Quoted words," she said — ‘single’ too.',             // 7  quotes
  'zzyzx qwertyuiop flibbertigibbet',                                    // 8  unknown words
  '42 tides, 7 storms, 1000 years',                                      // 9  numbers
  'Chapter 3: 1,234.56 units',                                           // 10 numbers
  'wax-candle hand-me-down self-same',                                   // 11 hyphenates
  "don't can't it's o'clock they've",                                    // 12 apostrophes
  'the keeper’s oath — the king’s name',                  // 13 curly apostrophes
  'MiXeD CaSe WoRdS HERE lower UPPER',                                   // 14 mixed case
  'THE SEA REMEMBERS',                                                   // 15 all caps
  '',                                                                    // 16 empty
  '   ',                                                                 // 17 whitespace
  '\n\t \n',                                                             // 18 newline/tab only
  LONG,                                                                  // 19 very long
  'café naïve résumé Zoë',                      // 20 non-ASCII latin
  'Ω αβγ δ',                                    // 21 greek
  'שלום עולם',                   // 22 hebrew (RTL source)
  '日本語のテキスト',                    // 23 CJK
  '🕁 emoji 😀 test',                                // 24 emoji
  'é combining ä mark',                                      // 25 combining marks
  '<tag attr="v"> & </tag>',                                             // 26 XML metacharacters
  'a',                                                                   // 27 single char
  'the the the the',                                                     // 28 repetition
  'supercalifragilisticexpialidocious',                                  // 29 long word
  'x'.repeat(200),                                                       // 30 over-long word
  'the sea\nremembers\nthe king',                                        // 31 embedded newlines
  'Sea. Sea? Sea! Sea…',                                            // 32 sentence-final punct
  '3.14 + 2 = 5; 50% of 100',                                            // 33 math/symbols
  'a-b-c 1-2-3 -leading trailing-',                                      // 34 stray hyphens
  'my mana let it stand as coa',                                         // 35 user's warrant fragment
];
const label = s => JSON.stringify(s.length > 42 ? s.slice(0, 39) + '…' : s);

// ---------- A. ground truth: the codex, standalone ----------
const RAW = `(w, ids, inputs) => {
  const C = w.CODEX;
  const meta = {}, out = {};
  for(const id of ids){
    if(id === 'celan_basic') meta[id] = { name: 'Celan Basic', flow: 'ltr', script: 'the Auric runes' };
    else { const T = C.TRANS[id]; const sc = T.L && T.L.script;
           meta[id] = { name: (T.L && T.L.name) || id, flow: sc ? C.scriptDir(sc) : 'ltr', script: sc ? sc.name : '' }; }
    out[id] = inputs.map(text => {
      try{
        if(id === 'celan_basic'){
          const parts = w.translateE2C(String(text));
          // p.tag is the codex's tagnote — carry it, or the ground truth is
          // missing the very field the gloss comparison is checking
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
  return { meta, out };
}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const codexErrs = [];
const pageA = await browser.newPage();
pageA.on('pageerror', e => { codexErrs.push(e.message); console.log('CODEX PAGE EXCEPTION:', e.message); });
await pageA.goto('file://' + PATCHED);
await pageA.waitForFunction(() => window.CODEX && window.FAMILY && typeof window.translateE2C === 'function', null, { timeout: 40000 });
const IDS = await pageA.evaluate(() => ['celan_basic', ...Object.keys(window.CODEX.TRANS)]);
console.log('codex tongues:', JSON.stringify(IDS));
ck('codex exposes 6 tongues incl. celan_basic', IDS.length === 6 && IDS.includes('celan_basic'), JSON.stringify(IDS));
ck('codex compileText reachable after the writer\'s own patch', await pageA.evaluate(() => typeof window.CODEX.compileText === 'function'));
const gt = await pageA.evaluate(`(${RAW})(window, ${JSON.stringify(IDS)}, ${JSON.stringify(CORPUS)})`);

// ---------- B. derive expectations in Node from the raw codex output ----------
const deriveRom = raw => {
  if (raw.kind === 'error') return null;
  if (raw.kind === 'celan') return raw.parts.filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
  const lines = raw.lines || [raw.parts.filter(p => !p.drop && p.out).map(p => ({ t: p.out, u: !!p.unknown }))];
  return lines.map(l => l.map(p => p.t).join(' ')).join(' ');
};
const deriveGloss = raw => {
  if (raw.kind === 'error') return null;
  if (raw.kind === 'celan')
    return raw.parts.map(p => ({ s: p.tok, o: p.drop ? '∅' : (p.cel || '—'), g: (p.gloss || '') + (p.tag ? ' · ' + p.tag : ''), k: !p.unknown && !p.drop, drop: !!p.drop }));
  return raw.parts.map(p => ({ s: p.tok, o: p.drop ? '∅' : (p.out || '—'), g: (p.gloss || '') + (p.tag ? ' · ' + p.tag : ''), k: !p.unknown && !p.drop, drop: !!p.drop }));
};
const deriveToks = raw => { // non-celan only: lines flattened, separator between lines
  const lines = raw.lines || [raw.parts.filter(p => !p.drop && p.out).map(p => ({ t: p.out, u: !!p.unknown }))];
  const toks = [];
  lines.forEach((l, i) => { l.forEach(p => toks.push({ t: p.t, u: !!p.u })); if (i < lines.length - 1) toks.push({ sep: true }); });
  return toks;
};

const errCells = IDS.flatMap(id => gt.out[id].map((r, i) => r.kind === 'error' ? `${id}#${i} ${r.message}` : null).filter(Boolean));
ck('codex compiles every corpus input without throwing', errCells.length === 0, errCells.slice(0, 4).join(' | '));
// Cells the CODEX ITSELF renders empty are ground truth, not defects (Celan
// Basic drops non-Latin scripts and the bare article "a"). Recorded, then
// asserted for parity below like every other cell.
const blank = IDS.flatMap(id => gt.out[id].map((r, i) => ({ id, i, rom: deriveRom(r) }))).filter(x => !x.rom);
console.log('codex-blank cells (ground truth):', blank.map(x => `${x.id}#${x.i}=${label(CORPUS[x.i])}`).join(', '));
ck('the codex romanizes every ordinary-prose input non-empty',
   !blank.some(x => [0, 1, 2, 3, 4, 18, 34].includes(x.i)), blank.map(x => `${x.id}#${x.i}`).join(' '));

// ---------- C. the writer, fresh boot, embedded codex, public seam ----------
const srv = await startServer();
const pageB = await browser.newPage();
const errsB = [];
pageB.on('pageerror', e => { errsB.push(e.message); console.log('WRITER PAGE EXCEPTION:', e.message); });
await pageB.goto(srv.url + 'step1.html');
await pageB.waitForFunction(() => window.tenebrae && window.tenebrae.engine, null, { timeout: 20000 });
await pageB.waitForTimeout(3500); // embedded engine wake + font forge

const bootCodex = await pageB.evaluate(() => { const c = window.tenebrae.codex(); return { kind: c.kind, name: c.name, embedded: !!c.embedded, sample: !!c.sample }; });
console.log('writer boot codex:', JSON.stringify(bootCodex));
ck('writer boots on the embedded codex with no import', bootCodex.kind === 'omni-host' && bootCodex.embedded && !bootCodex.sample);

const writer = await pageB.evaluate(async ({ ids, inputs }) => {
  const out = {};
  for (const id of ids) {
    out[id] = [];
    for (const text of inputs) {
      try {
        const r = await window.tenebrae.translate2(id, text);
        out[id].push(r ? { rom: r.romanization, gloss: r.gloss, toks: r.toks, dir: r.dir, flow: r.flow,
                           lang: r.lang && r.lang.id, name: r.langName, script: r.script, omni: !!r.omni } : null);
      } catch (e) { out[id].push({ error: String(e && e.message) }); }
    }
  }
  return out;
}, { ids: IDS, inputs: CORPUS });

// ---------- D. compare ----------
let romBad = 0, glossBad = 0, tokBad = 0, flowBad = 0, nullBad = 0, celanLossy = 0;
const firstDiffs = [];
for (const id of IDS) {
  for (let i = 0; i < CORPUS.length; i++) {
    const raw = gt.out[id][i], got = writer[id][i];
    if (!got || got.error) { nullBad++; firstDiffs.push(`${id}#${i} ${label(CORPUS[i])}: writer returned ${JSON.stringify(got)}`); continue; }
    const expRom = deriveRom(raw);
    if (got.rom !== expRom) { romBad++; if (firstDiffs.length < 12) firstDiffs.push(`ROM ${id}#${i} ${label(CORPUS[i])}\n     codex : ${JSON.stringify(expRom)}\n     writer: ${JSON.stringify(got.rom)}`); }
    const expGloss = JSON.stringify(deriveGloss(raw));
    if (JSON.stringify(got.gloss) !== expGloss) { glossBad++; if (firstDiffs.length < 12) firstDiffs.push(`GLOSS ${id}#${i} ${label(CORPUS[i])}\n     codex : ${expGloss.slice(0, 200)}\n     writer: ${JSON.stringify(got.gloss).slice(0, 200)}`); }
    if (raw.kind === 'trans') {
      if (JSON.stringify(got.toks) !== JSON.stringify(deriveToks(raw))) { tokBad++; if (firstDiffs.length < 12) firstDiffs.push(`TOKS ${id}#${i} ${label(CORPUS[i])}\n     codex : ${JSON.stringify(deriveToks(raw)).slice(0, 200)}\n     writer: ${JSON.stringify(got.toks).slice(0, 200)}`); }
    } else {
      // Celan Basic: the writer splits each codex word into stem + trailing
      // punctuation, and splits a part that itself holds whitespace ("na mé")
      // into its word tokens — that is what makes the split lossless, and it is
      // the unit the typesetter draws. So the writer may hold MORE tokens than
      // the codex has parts; what may never change is the text they rejoin to.
      const kept = raw.parts.filter(p => p.cel && !p.drop);
      const rejoin = (got.toks || []).map(t => String(t.t) + String(t.punct || '')).join(' ');
      const codexJoin = kept.map(p => String(p.cel)).join(' ');
      const partWords = kept.reduce((n, p) => n + String(p.cel).trim().split(/\s+/).length, 0);
      if (rejoin !== codexJoin || (got.toks || []).length !== partWords) { celanLossy++; if (firstDiffs.length < 12) firstDiffs.push(`CELAN-TOKS #${i} ${label(CORPUS[i])}\n     codex : ${JSON.stringify(codexJoin).slice(0, 160)}\n     writer: ${JSON.stringify(rejoin).slice(0, 160)}`); }
    }
    const flow = gt.meta[id].flow;
    // bidi dir belongs to the HORIZONTAL rtl tongue only: on a vertical flow
    // `direction` reverses the inline (vertical) axis and inverts the column
    const expDir = flow === 'rtl' ? 'rtl' : 'ltr';
    if (got.flow !== flow || got.dir !== expDir || got.script !== gt.meta[id].script || got.name !== gt.meta[id].name) {
      flowBad++; if (firstDiffs.length < 12) firstDiffs.push(`META ${id}#${i}: writer ${got.name}/${got.script}/${got.flow}/${got.dir} vs codex ${gt.meta[id].name}/${gt.meta[id].script}/${flow}/${expDir}`);
    }
  }
}
const cells = IDS.length * CORPUS.length;
console.log(`\ncompared ${cells} cells (${IDS.length} tongues x ${CORPUS.length} inputs)`);
if (firstDiffs.length) console.log('DIFFS:\n  ' + firstDiffs.join('\n  '));

ck(`romanization byte-identical to the codex on all ${cells} cells`, romBad === 0, `${romBad} mismatches`);
ck(`gloss identical (per-part s/o/g/k/drop) on all ${cells} cells`, glossBad === 0, `${glossBad} mismatches`);
ck('token stream identical to the codex lines for every scripted tongue', tokBad === 0, `${tokBad} mismatches`);
ck('Celan Basic token split is lossless against the codex words (one token per codex word)', celanLossy === 0, `${celanLossy} mismatches`);
ck('tongue metadata (name/script/flow/dir) matches the codex', flowBad === 0, `${flowBad} mismatches`);
ck('writer never returns null/throws on a corpus cell', nullBad === 0, `${nullBad} nulls`);

// per-tongue sample so the output is auditable by eye
console.log('\nsample — input #2 (the warrant):');
for (const id of IDS) console.log(`  ${gt.meta[id].name.padEnd(14)} ${JSON.stringify(writer[id][2].rom).slice(0, 96)}`);
console.log('sample — input #8 (unknown words):');
for (const id of IDS) console.log(`  ${gt.meta[id].name.padEnd(14)} ${JSON.stringify(writer[id][7].rom).slice(0, 96)}`);
console.log('sample — input #9 (numbers):');
for (const id of IDS) console.log(`  ${gt.meta[id].name.padEnd(14)} ${JSON.stringify(writer[id][8].rom).slice(0, 96)}`);

// tongues must not be degenerate copies of each other
const distinct = new Set(IDS.map(id => writer[id][1].rom)).size;
ck('the six tongues produce six distinct romanizations', distinct === IDS.length, `${distinct} distinct`);

ck('no writer page exceptions', errsB.length === 0, errsB.slice(0, 3).join(' | '));
ck('no codex page exceptions', codexErrs.length === 0, codexErrs.slice(0, 3).join(' | '));

console.log('\nTX-2 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
