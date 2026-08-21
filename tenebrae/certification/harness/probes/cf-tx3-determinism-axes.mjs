// cf-TX-3 — DETERMINISM ON THE AXES NOBODY TESTED.
//
// tr-determinism.mjs and vp-tr2-det-reload.mjs already prove: repeat calls,
// reload, storage-fresh context — all with the SAME call order in the SAME
// process. This probe is the gap:
//   A  call ORDER invariance          corpus forward vs reversed vs tongue-interleaved
//   B  CONCURRENCY invariance         all calls fired at once vs sequential
//   C  ENGINE RE-WAKE invariance      teardown the codex iframe, wake it again
//   D  SECOND PROCESS invariance      a second chromium process, cold profile
//   E  "no time or randomness"        proved mechanically, not by reading code:
//        Math.random / Date.now / new Date / performance.now are counted in BOTH
//        realms (the writer page AND the codex engine iframe) across a full
//        translate2 call, and a context whose clock is moved forward 10 years
//        must produce byte-identical output.
//   F  Auric mint order               diagnostic: the Celan Basic word-font mints
//        a PUA codepoint per word in FIRST-USE order (step1.html L3187,
//        `AURIC_BASE + A.order.length`), so the codepoint is session-local. The
//        assertion here is that translate2's own output (rom/gloss/toks) does not
//        depend on it.
// Run: cd probes && node cf-tx3-determinism-axes.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const SENTS = [
  'The sea remembers the stone gate',
  "Don't count 12 ravens — they lie, twice!",
  'Xylophonic quandaries perplex the boatwright?',
  'the keeper’s oath — MMXXVI',
];

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const newPage = async (ctxOpts, initScript) => {
  const context = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 } }, ctxOpts || {}));
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  if(initScript) await page.addInitScript(initScript);
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(4000);
  return { context, page };
};

const { page } = await newPage();
const IDS = await page.evaluate(() => window.tenebrae.langs().then(x => x.langs.map(l => l.id)));
console.log('tongues:', JSON.stringify(IDS));

// sequential, corpus in the given order
const run = (pg, ids, sents) => pg.evaluate(async ({ ids, sents }) => {
  const out = {};
  for(const id of ids) for(const s of sents){
    const r = await window.tenebrae.translate2(id, s);
    out[id + '::' + s] = JSON.stringify(r);
  }
  return out;
}, { ids, sents });

const base = await run(page, IDS, SENTS);
const cmp = (tag, other) => {
  const bad = Object.keys(base).filter(k => base[k] !== other[k]);
  ck(tag, bad.length === 0, bad.length ? bad.slice(0, 3).join(' | ') : `${Object.keys(base).length} combos identical`);
};

// ---------- A. order invariance ----------
cmp('A1 reversed tongue order + reversed sentence order gives identical output',
    await run(page, [...IDS].reverse(), [...SENTS].reverse()));
const interleaved = await page.evaluate(async ({ ids, sents }) => {
  const out = {};
  for(const s of sents) for(const id of ids){ // sentence-major instead of tongue-major
    const r = await window.tenebrae.translate2(id, s);
    out[id + '::' + s] = JSON.stringify(r);
  }
  return out;
}, { ids: IDS, sents: SENTS });
cmp('A2 sentence-major (interleaved tongues) gives identical output', interleaved);

// ---------- B. concurrency ----------
const concurrent = await page.evaluate(async ({ ids, sents }) => {
  const keys = [], jobs = [];
  for(const id of ids) for(const s of sents){ keys.push(id + '::' + s); jobs.push(window.tenebrae.translate2(id, s)); }
  const res = await Promise.all(jobs);
  const out = {};
  keys.forEach((k, i) => out[k] = JSON.stringify(res[i]));
  return out;
}, { ids: IDS, sents: SENTS });
cmp('B  all 24 calls fired concurrently give identical output', concurrent);

// ---------- E. no time, no randomness (both realms) ----------
const probeCounters = await page.evaluate(async ({ id, s }) => {
  const inst = w => {
    const c = { random: 0, dateNow: 0, dateCtor: 0, perfNow: 0 };
    const R = w.Math.random; w.Math.random = function(){ c.random++; return R.apply(this, arguments); };
    const D = w.Date.now;    w.Date.now    = function(){ c.dateNow++; return D.apply(this, arguments); };
    const P = w.performance && w.performance.now;
    if(P) w.performance.now = function(){ c.perfNow++; return P.apply(this, arguments); };
    const OD = w.Date;
    const ND = new Proxy(OD, { construct(t, a){ c.dateCtor++; return new t(...a); } });
    ND.now = w.Date.now; w.Date = ND;
    return { c, restore(){ w.Math.random = R; w.Date = OD; OD.now = D; if(P) w.performance.now = P; } };
  };
  const eng = await window.tenebrae.engine();
  const a = inst(window), b = inst(eng);
  const r = await window.tenebrae.translate2(id, s);
  const scr = window.tenebrae._forge.textForToks(id, r.toks || []);
  const out = { page: JSON.parse(JSON.stringify(a.c)), engine: JSON.parse(JSON.stringify(b.c)), rom: r.romanization, scrLen: [...(scr || '')].length };
  a.restore(); b.restore();
  return out;
}, { id: 'celan_high', s: SENTS[0] });
console.log('E  counters during one translate2 + script build:', JSON.stringify(probeCounters));
ck('E1 no Math.random anywhere in the translate path (page + engine realms)',
   probeCounters.page.random === 0 && probeCounters.engine.random === 0, JSON.stringify(probeCounters));
ck('E2 no clock read anywhere in the translate path (Date.now / new Date / performance.now)',
   probeCounters.page.dateNow === 0 && probeCounters.page.dateCtor === 0 && probeCounters.page.perfNow === 0 &&
   probeCounters.engine.dateNow === 0 && probeCounters.engine.dateCtor === 0 && probeCounters.engine.perfNow === 0,
   JSON.stringify(probeCounters));

// a context whose clock is ten years ahead, in a different timezone/locale
const { page: pageT } = await newPage({ timezoneId: 'Pacific/Kiritimati', locale: 'tr-TR' }, () => {
  const SHIFT = 10 * 365 * 24 * 3600 * 1000;
  const OD = Date;
  const ND = new Proxy(OD, { construct(t, a){ return a.length ? new t(...a) : new t(OD.now() + SHIFT); } });
  ND.now = () => OD.now() + SHIFT;
  ND.parse = OD.parse; ND.UTC = OD.UTC;
  // eslint-disable-next-line no-global-assign
  Date = ND;
});
cmp('E3 identical output with the clock 10 years ahead, tz Kiritimati, locale tr-TR',
    await run(pageT, IDS, SENTS));

// ---------- C. engine teardown + re-wake in the same page ----------
await page.evaluate(async () => {
  const pack = window.tenebrae.codex();       // the embedded omni-host pack
  window.tenebrae._omni.setPack(pack);        // setPack calls omniTeardown()
  await window.tenebrae.engine();             // wake it again from scratch
});
await page.waitForTimeout(3000);
const rewoken = await run(page, IDS, SENTS);
cmp('C  identical after the engine iframe is torn down and re-woken', rewoken);

// ---------- D. second browser process, cold profile ----------
const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx2 = await browser2.newContext({ viewport: { width: 1280, height: 900 } }); // different viewport too
const page2 = await ctx2.newPage();
page2.on('pageerror', e => { errors.push('proc2: ' + e.message); });
await page2.goto(srv.url + 'step1.html');
await page2.waitForTimeout(4000);
cmp('D  identical in a second browser process with a cold profile', await run(page2, IDS, SENTS));

// ---------- F. Auric mint order (diagnostic + the assertion that matters) ----------
const auricProbe = async order => {
  const { page: p } = await newPage();
  const res = await p.evaluate(async ({ order }) => {
    const codes = {};
    for(const w of order){
      await window.tenebrae.translate2('celan_basic', w);           // engine output
      const t = window.tenebrae._forge.textFor('celan_basic', w);   // forged PUA text
      codes[w] = t ? [...t].map(c => c.codePointAt(0).toString(16)) : null;
    }
    const roms = {};
    for(const w of ['sea', 'gate', 'king'])
      roms[w] = JSON.stringify(await window.tenebrae.translate2('celan_basic', w));
    return { codes, roms };
  }, { order });
  return res;
};
const f1 = await auricProbe(['sea', 'gate', 'king']);
const f2 = await auricProbe(['king', 'gate', 'sea']);
console.log('F  auric codepoints, order sea/gate/king:', JSON.stringify(f1.codes));
console.log('F  auric codepoints, order king/gate/sea:', JSON.stringify(f2.codes));
const sameCodes = JSON.stringify(f1.codes) === JSON.stringify(f2.codes);
console.log('F  auric PUA codepoints are write-order independent:', sameCodes,
            '(session-local mint by design — step1.html L3187)');
ck('F  translate2 output for Celan Basic does not depend on write order',
   JSON.stringify(f1.roms) === JSON.stringify(f2.roms));

ck('no page exceptions on any axis', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-TX-3 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser2.close();
await browser.close();
await srv.close();
