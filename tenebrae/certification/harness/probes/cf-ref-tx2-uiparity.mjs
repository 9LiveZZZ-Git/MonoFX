// cf-REF-TX-2 — PARITY OF WHAT THE AUTHOR ACTUALLY GETS, NOT OF THE SEAM.
//
// REFUTATION TARGET. Both parity probes (tx-parity-corpus.mjs and the auditor's
// cf-tx2-parity-extended.mjs) call window.tenebrae.translate2 directly. The
// author never does. Between the author's selection and the engine sit
// selTextFromRange (step1.html L3874-3898: span-swallowing, block-separator
// injection, whitespace folding, NBSP-pad rules) and placeTSpan. If any of that
// mangles the source, the romanization the author sees is a faithful answer to
// the wrong question — and no existing probe would notice, because they all
// hand the engine a pristine string.
//
// So: build spans through the real context-menu UI over deliberately awkward
// selections (trailing punctuation, a curly apostrophe, a cross-paragraph
// selection, a selection that swallows an existing span, a selection adjacent
// to a span's NBSP pad), then read data-src / data-rom off the LIVE spans and
// check each one against the REAL codex booted standalone from the scratchpad
// file — a second engine in a second page, never the writer's own.
// Run: cd probes && node cf-ref-tx2-uiparity.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const PATCHED = SCRATCH + '/cf-ref-codex-patched.html';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

{ let html = await readFile(SCRATCH + '/codex.html', 'utf8');
  if(!/window\.CODEX\s*=\s*\{[^}]*compileText/.test(html))
    html = html.replace(/window\.CODEX\s*=\s*\{/,
      'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ' +
      'CELAN:{N_TOTAL:(typeof N_TOTAL!=="undefined"?N_TOTAL:null),' +
      'ROOTS:(typeof ROOTS!=="undefined"?ROOTS:null),DICT:(typeof DICT!=="undefined"?DICT:null)}, ');
  await writeFile(PATCHED, html);
}

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

// ---- ground truth: the codex, standalone, in its own page ----
const gtPage = await browser.newPage();
gtPage.on('pageerror', e => { errors.push('codex: ' + e.message); });
await gtPage.goto('file://' + PATCHED);
await gtPage.waitForFunction(() => window.CODEX && window.FAMILY && typeof window.translateE2C === 'function', null, { timeout: 120000 });
const codexRom = (id, text) => gtPage.evaluate(({ id, text }) => {
  const C = window.CODEX;
  if(id === 'celan_basic')
    return window.translateE2C(String(text)).filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
  const T = C.TRANS[id];
  if(!T) return null;
  const res = C.compileText(T, String(text), 'e2l');
  const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
  return lines.map(l => l.map(p => p.t).join(' ')).join(' ');
}, { id, text });

// ---- the writer ----
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push('writer: ' + e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(4200);

await page.click('#lib-new'); await page.waitForTimeout(400);
await page.fill('#ps-input', 'Parity Book'); await page.click('#ps-save'); await page.waitForTimeout(800);
await page.click('#ed-content');
await page.keyboard.type('opening line');
for(const line of [
  'alpha the sea remembers omega',
  'beta the keeper’s oath omega',
  'gamma the stone gate omega',
  'delta the tide came back omega',
  'epsilon the raven counted twelve omega',
  'zeta the sea remembers omega',
  'eta held fast',
  'beyond the wall',
]){ await page.keyboard.press('Enter'); await page.keyboard.type(line); }
await page.waitForTimeout(600);

// select an arbitrary text range by (startNeedle, endNeedle) across nodes
const selectSpan = (a, b) => page.evaluate(({ a, b }) => {
  const ed = document.querySelector('#ed-content');
  const nodes = [];
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n; while((n = w.nextNode())) nodes.push(n);
  let sN = null, sO = 0, eN = null, eO = 0, si = -1;
  for(let k = 0; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(a); if(i > -1){ sN = nodes[k]; sO = i; si = k; break; } }
  if(sN){
    for(let k = si; k < nodes.length; k++){
      const from = (k === si) ? sO : 0;
      const i = nodes[k].nodeValue.indexOf(b, from);
      if(i > -1){ eN = nodes[k]; eO = i + b.length; break; }
    }
  }
  if(!sN || !eN) return false;
  const r = document.createRange();
  r.setStart(sN, sO); r.setEnd(eN, eO);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
}, { a, b });

async function translateSelection(label){
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await page.waitForTimeout(400);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await page.waitForTimeout(700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await page.waitForTimeout(900);
}

// every case is MID-paragraph and in a paragraph of its own, so the cases
// cannot interfere with one another
const CASES = [
  ['plain phrase',                     'the sea',    'remembers',   'Celan High'],
  ['curly-apostrophe possessive',      'keeper’s',   'oath',        'Kerrackian'],
  ['two-word noun phrase',             'the stone',  'gate',        'Kildaren'],
  ['four-word clause',                 'the tide',   'came back',   'Calgridarian'],
  ['numeral word + unknown word',       'raven',      'twelve',      'Evernessian'],
  ['word script (Celan Basic)',        'the sea rem','omega',       'Celan Basic'],
  ['CROSS-PARAGRAPH selection',        'held',       'the wall',    'Kildaren'],
];
for(const [name, a, b, label] of CASES){
  const ok = await selectSpan(a, b);
  if(!ok){ ck('setup: found selection for ' + name, false, `${a} .. ${b}`); continue; }
  const selTxt = await page.evaluate(() => String(getSelection()));
  await translateSelection(label);
  console.log(`  [case] ${name} -> ${label}; selection=${JSON.stringify(selTxt)}`);
}
const readSpans = () => page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')]
  .map(s => ({ lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, omni: s.dataset.omni || null })));
const spansBefore = await readSpans();
// a selection that SWALLOWS an existing span: its data-src must be re-expanded
// to the author's English, never to the romanization (selTextFromRange L3878)
{
  const ok = await selectSpan('delta', 'omega');
  if(ok) await translateSelection('Celan Basic');
  else ck('setup: swallowing selection found', false);
}
console.log('DOM:', (await page.evaluate(() => document.querySelector('#ed-content').innerHTML)).replace(/data-scr="[^"]*"/g, 'data-scr="…"').replace(/>[\s\S]*?</g, '><').slice(0, 1200));

const spans = await readSpans();
const seen = new Set(), all = [];
for(const s2 of [...spansBefore, ...spans]){ const k = s2.lang + '\u0000' + s2.src; if(!seen.has(k)){ seen.add(k); all.push(s2); } }
console.log('spans created:', spans.length);
ck('every awkward selection produced a span (>=6)', spans.length >= 6, JSON.stringify(spans.map(s => s.lang)));

let bad = 0, tongues = new Set();
for(const s of all){
  tongues.add(s.lang);
  const truth = await codexRom(s.lang, s.src);
  const same = truth === s.rom;
  if(!same) bad++;
  console.log(`  ${same ? 'ok  ' : 'FAIL'} [${s.lang}] src=${JSON.stringify(s.src)}\n        writer: ${JSON.stringify(s.rom)}\n        codex : ${JSON.stringify(truth)}`);
}
ck(`every span's data-rom is byte-identical to the standalone codex for its own data-src (${all.length} spans)`, bad === 0, bad + ' mismatches');
ck('no span carries the English through as its romanization',
   all.every(s => s.rom !== s.src), JSON.stringify(all.filter(s => s.rom === s.src)));
ck('no span lost its data-omni marking', spans.every(s => s.omni === '1'), JSON.stringify(spans.map(s => s.omni)));
ck('the swallowing selection re-expanded the swallowed span to the author\'s ENGLISH',
   spans.some(s => s.lang === 'celan_basic' && /delta.the tide came back omega/.test(s.src)),
   JSON.stringify(spans.filter(s => s.lang === 'celan_basic').map(s => s.src)));
ck('all six tongues were exercised through the real UI', tongues.size === 6, JSON.stringify([...tongues]));
console.log('tongues exercised:', JSON.stringify([...tongues]));

// the tap sheet's romanization line for each span must be the same string
const sheetRoms = [];
for(let i = 0; i < spans.length; i++){
  await page.evaluate(n => document.querySelectorAll('#ed-content .tspan')[n].click(), i);
  await page.waitForTimeout(700);
  const txt = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    return s ? s.innerText : '';
  });
  sheetRoms.push(txt.indexOf(spans[i].rom) > -1);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s) s.click(); });
  await page.waitForTimeout(350);
}
ck('the tap sheet shows the same romanization the span stores, for every span',
   sheetRoms.every(Boolean), JSON.stringify(sheetRoms));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-REF-TX-2 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
