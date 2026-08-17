// TX-3 — DETERMINISM, four ways.
//   1. repeat calls in one page           (same engine window, warm)
//   2. across a full reload               (engine re-woken from the embed)
//   3. in a storage-fresh browser context (no IndexedDB, no localStorage, cold)
//   4. against a SECOND browser process   (nothing shared at all)
// plus the two things determinism actually means in code:
//   5. no time in the path   — Date / Date.now / performance.now booby-trapped
//                              to throw during translation, in BOTH the app
//                              window and the codex engine window
//   6. no randomness         — Math.random booby-trapped likewise
//   7. no network            — zero off-localhost requests in any context
// Compared as full JSON of translate2 (romanization, gloss, toks, dir, flow,
// lang) over every tongue x a varied corpus, plus the forged script text for
// each result (so a nondeterministic font forge would surface too).
// Run: cd probes && node tx-determinism-deep.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const CORPUS = [
  'The sea remembers',
  'Declared: my mana - let it stand as coa. Declared: the wax-candle - let it stand as coe.',
  'Night waves fall; the keeper watched, remembering old oaths.',
  'zzyzx qwertyuiop flibbertigibbet',
  '42 tides, 7 storms, 1000 years',
  "don't can't it's o'clock",
  'wax-candle hand-me-down',
  'MiXeD CaSe WoRdS HERE',
  '',
  '   ',
  'café naïve résumé Zoë',
  '日本語 שלום 🕁',
  'the old keeper of the fallen tower walked the long cold road under a silent moon while the sea remembered every oath',
  'x'.repeat(120),
];

// snapshot = [[key, json], …] over every tongue x every corpus line
const SNAP = `async () => {
  const ids = ['celan_basic', ...Object.keys((await window.tenebrae.engine()).CODEX.TRANS)];
  const corpus = ${JSON.stringify(CORPUS)};
  const out = [];
  for(const id of ids){
    for(let i = 0; i < corpus.length; i++){
      const r = await window.tenebrae.translate2(id, corpus[i]);
      let scr = null;
      try{ scr = r ? window.tenebrae._forge.textForToks(id, r.toks) : null; }catch(e){ scr = 'ERR:' + e.message; }
      out.push([id + ' #' + i, JSON.stringify({ r: r, scr: scr })]);
    }
  }
  return out;
}`;

const RUN = `(${SNAP})()`;
const asMap = rows => Object.fromEntries(rows);
const boot = async (browser, url) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errs = [], reqs = [], resps = [], fails = [];
  const ext = u => !/^http:\/\/127\.0\.0\.1/.test(u) && !/^data:|^blob:|^about:/.test(u);
  page.on('pageerror', e => { errs.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  page.on('request', r => { if (ext(r.url())) reqs.push(r.url()); });
  // a RESPONSE is real wire traffic; a CSP-killed attempt fires 'request' then
  // 'requestfailed' with no bytes exchanged (see vp-pr4-csp-blocked.mjs)
  page.on('response', r => { if (ext(r.url())) resps.push(r.url() + ' -> ' + r.status()); });
  page.on('requestfailed', r => { if (ext(r.url())) fails.push(r.url() + ' :: ' + ((r.failure() || {}).errorText || '?')); });
  await page.goto(url);
  await page.waitForFunction(() => window.tenebrae && window.tenebrae.engine, null, { timeout: 20000 });
  await page.waitForTimeout(3500);
  return { context, page, errs, reqs, resps, fails };
};
const diff = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]);
const show = (ks, a, b) => ks.slice(0, 3).map(k => `${k}\n     A: ${String(a[k]).slice(0, 150)}\n     B: ${String(b[k]).slice(0, 150)}`).join('\n  ');

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---------- context A ----------
const A = await boot(browser, srv.url + 'step1.html');
const a1 = asMap(await A.page.evaluate(RUN));
console.log(`snapshot = ${Object.keys(a1).length} cells (6 tongues x ${CORPUS.length} inputs)`);

// 1. repeat calls, same page, warm engine
const a2 = asMap(await A.page.evaluate(RUN));
const a3 = asMap(await A.page.evaluate(RUN));
ck('repeat calls in the same page are identical (x3)', diff(a1, a2).length === 0 && diff(a1, a3).length === 0,
   show(diff(a1, a2).concat(diff(a1, a3)), a1, a2));

// 2. across a full reload
await A.page.reload();
await A.page.waitForFunction(() => window.tenebrae && window.tenebrae.engine, null, { timeout: 20000 });
await A.page.waitForTimeout(3500);
const a4 = asMap(await A.page.evaluate(RUN));
ck('identical after a full page reload', diff(a1, a4).length === 0, show(diff(a1, a4), a1, a4));

const stored = await A.page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer');
  rq.onsuccess = () => { const n = [...rq.result.objectStoreNames]; rq.result.close(); res(n); };
  rq.onerror = () => res(['<err>']);
}));
console.log('IndexedDB stores in context A (proves the reload was a real, persisted boot):', JSON.stringify(stored));

// 3. storage-fresh context
const B = await boot(browser, srv.url + 'step1.html');
const freshLS = await B.page.evaluate(() => localStorage.length);
const b1 = asMap(await B.page.evaluate(RUN));
ck('storage-fresh context yields identical output', diff(a1, b1).length === 0, show(diff(a1, b1), a1, b1));
console.log('context B localStorage entries at boot:', freshLS);

// 4. a second browser process
const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const C = await boot(browser2, srv.url + 'step1.html');
const c1 = asMap(await C.page.evaluate(RUN));
ck('a second browser process yields identical output', diff(a1, c1).length === 0, show(diff(a1, c1), a1, c1));
await browser2.close();

// ---------- 5/6. no time, no randomness anywhere in the path ----------
const sabotage = await A.page.evaluate(async corpus => {
  const w = await window.tenebrae.engine();
  const wins = [window, w];
  const saved = wins.map(x => ({ x, random: x.Math.random, Date: x.Date, perf: x.performance && x.performance.now }));
  const trip = { random: 0, date: 0, perf: 0 };
  for (const x of wins) {
    x.Math.random = () => { trip.random++; throw new Error('Math.random used'); };
    const Real = x.Date;
    x.Date = new Proxy(Real, {
      apply: () => { trip.date++; throw new Error('Date() used'); },
      construct: () => { trip.date++; throw new Error('new Date() used'); },
      get: (t, p) => (p === 'now' ? () => { trip.date++; throw new Error('Date.now used'); } : Reflect.get(t, p)),
    });
    if (x.performance) x.performance.now = () => { trip.perf++; throw new Error('performance.now used'); };
  }
  const out = [];
  let thrown = null;
  try {
    const ids = ['celan_basic', ...Object.keys(w.CODEX.TRANS)];
    for (const id of ids)
      for (let i = 0; i < corpus.length; i++)
        out.push([id + ' #' + i, JSON.stringify(await window.tenebrae.translate2(id, corpus[i]))]);
  } catch (e) { thrown = String(e && e.message); }
  for (const s of saved) { s.x.Math.random = s.random; s.x.Date = s.Date; if (s.x.performance && s.perf) s.x.performance.now = s.perf; }
  return { out, thrown, trip };
}, CORPUS);
console.log('sabotage trips:', JSON.stringify(sabotage.trip), '| thrown:', sabotage.thrown);
ck('translation completes with Date/Math.random/performance.now booby-trapped', sabotage.thrown === null, sabotage.thrown || '');
ck('nothing in the translation path touched time or randomness',
   sabotage.trip.random === 0 && sabotage.trip.date === 0 && sabotage.trip.perf === 0, JSON.stringify(sabotage.trip));
const sab = asMap(sabotage.out);
const sabBad = Object.keys(sab).filter(k => JSON.stringify(JSON.parse(a1[k]).r) !== sab[k]);
ck('booby-trapped output is byte-identical to the normal output', sabBad.length === 0, sabBad.slice(0, 3).join(' | '));

// ---------- 7. no network ----------
const allReqs = [...A.reqs, ...B.reqs, ...C.reqs];
const allResps = [...A.resps, ...B.resps, ...C.resps];
const allFails = [...A.fails, ...B.fails, ...C.fails];
console.log('external request attempts:', allReqs.length, allReqs.length ? '(' + [...new Set(allReqs)].join(', ').slice(0, 120) + ')' : '');
console.log('external failures        :', [...new Set(allFails)].join(' | ').slice(0, 200) || 'none');
ck('zero off-localhost RESPONSES — no bytes on the wire', allResps.length === 0, allResps.slice(0, 5).join(' '));
ck('every external attempt was blocked before the network (CSP), never answered',
   allReqs.length === allFails.length, `${allReqs.length} attempts / ${allFails.length} blocked`);
ck('no page exceptions in any context', A.errs.length + B.errs.length + C.errs.length === 0,
   [...A.errs, ...B.errs, ...C.errs].slice(0, 3).join(' | '));

console.log('sample (input #0 per tongue):');
for (const [k, v] of Object.entries(a1)) if (k.endsWith(' #0'))
  console.log(`  ${k.slice(0, -3).padEnd(14)} ${JSON.parse(v).r.romanization}`);

console.log('TX-3 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
