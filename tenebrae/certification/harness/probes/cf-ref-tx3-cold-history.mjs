// cf-REF-TX-3 — DETERMINISM ACROSS COLD CONTEXTS WITH DIFFERENT HISTORIES.
//
// REFUTATION TARGET. cf-tx3-determinism-axes.mjs proves order/concurrency
// invariance, but every one of those comparisons (A1, A2, B, C) runs in the
// SAME page as the baseline — a page that had already translated the whole
// corpus once. Any engine state that is built on FIRST use (a coinage counter,
// a lazily-minted table, a matcher cache) is therefore already warm when the
// "reordered" run happens, so a genuine order dependence would be invisible.
// The one cold-process axis (D) uses the SAME forward order as the baseline.
//
// This probe closes that hole: four COLD contexts, each doing something
// different BEFORE the measured corpus:
//   H0  measured corpus only, forward order                      (baseline)
//   H1  a 30-sentence unrelated prelude across all tongues first
//   H2  the measured corpus in reversed tongue+sentence order, first thing
//   H3  baseline, then a full page reload in the SAME profile, remeasured
// Compared: the whole translate2 JSON, AND the forged script text for the
// result's own tokens (window.tenebrae._forge.textForToks), AND the forged
// font bytes — i.e. what the author would actually see and export, not just
// the engine's JSON.
// Run: cd probes && node cf-ref-tx3-cold-history.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createHash } from 'node:crypto';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const SENTS = [
  'The sea remembers the stone gate',
  "Don't count 12 ravens — they lie, twice!",
  'Xylophonic quandaries perplex the boatwright?',
  'the keeper’s oath — MMXXVI',
];
const PRELUDE = [];
for(let i = 0; i < 30; i++) PRELUDE.push(`prelude ${i} zorbik quandle ${'x'.repeat(i % 7)} the harbour bell tolled ${i} times`);

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function coldPage(){
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(4200);
  return { context, page };
}

// measure: full translate2 JSON + the forged PUA text for those tokens
const measure = (pg, ids, sents) => pg.evaluate(async ({ ids, sents }) => {
  const out = {};
  for(const id of ids) for(const s of sents){
    const r = await window.tenebrae.translate2(id, s);
    const scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null;
    out[id + '::' + s] = JSON.stringify({ r, scr: scr ? [...scr].map(c => c.codePointAt(0).toString(16)).join(' ') : null });
  }
  return out;
}, { ids, sents });

const fontHashes = pg => pg.evaluate(() => {
  const m = window.tenebrae._forge.map() || {};
  const out = {};
  for(const k of Object.keys(m)){
    const b = m[k] && m[k].ttf;
    out[k] = b ? [b.length, Array.from(b.slice(0, 64)).join(',')].join('|') : null;
  }
  return out;
});

const { page: p0, context: c0 } = await coldPage();
const IDS = await p0.evaluate(() => window.tenebrae.langs().then(x => x.langs.map(l => l.id)));
console.log('tongues:', JSON.stringify(IDS));
const base = await measure(p0, IDS, SENTS);
const baseFonts = await fontHashes(p0);

const splitCmp = (tag, other) => {
  const bad = Object.keys(base).filter(k => base[k] !== other[k]);
  const romBad = [], scrBad = [];
  for(const k of bad){
    const a = JSON.parse(base[k]), b = JSON.parse(other[k]);
    if(JSON.stringify(a.r) !== JSON.stringify(b.r)) romBad.push(k);
    if(a.scr !== b.scr) scrBad.push(k + '\n     base: ' + a.scr + '\n     this: ' + b.scr);
  }
  ck(tag + ' — engine JSON (rom/gloss/toks) identical', romBad.length === 0,
     romBad.length ? romBad.slice(0, 3).join(' | ') : `${Object.keys(base).length} combos identical`);
  ck(tag + ' — forged script text identical', scrBad.length === 0,
     scrBad.length ? scrBad.slice(0, 2).join('\n') : `${Object.keys(base).length} combos identical`);
};

// ---------- H1 : unrelated prelude first ----------
{
  const { page, context } = await coldPage();
  await page.evaluate(async ({ ids, sents }) => {
    for(const s of sents) for(const id of ids){
      const r = await window.tenebrae.translate2(id, s);
      if(r) window.tenebrae._forge.textForToks(id, r.toks || []); // mint whatever it mints
    }
  }, { ids: IDS, sents: PRELUDE });
  splitCmp('H1 30-sentence unrelated prelude first', await measure(page, IDS, SENTS));
  await context.close();
}

// ---------- H2 : reversed order, first thing in a cold context ----------
{
  const { page, context } = await coldPage();
  const rev = await measure(page, [...IDS].reverse(), [...SENTS].reverse());
  splitCmp('H2 reversed tongue+sentence order in a COLD context', rev);
  const f2 = await fontHashes(page);
  const bad = Object.keys(baseFonts).filter(k => baseFonts[k] !== f2[k]);
  ck('H2 forged font bytes identical to the baseline context', bad.length === 0, bad.join(','));
  await context.close();
}

// ---------- H3 : reload in the same profile ----------
{
  await p0.reload();
  await p0.waitForTimeout(4200);
  splitCmp('H3 same profile after a full reload', await measure(p0, IDS, SENTS));
}

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-REF-TX-3 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await c0.close();
await browser.close();
await srv.close();
