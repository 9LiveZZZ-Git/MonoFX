// TR-2 / TX-3 — Deterministic translation: identical input → identical output
// across repeated calls, across a full page reload, and in a storage-fresh
// context, for every tongue the embedded codex offers. Full JSON equality of
// the translate2() result (romanization, gloss, tokens, lang def, flow) plus
// the forged script text. Also confirms nothing leaves the machine.
//
// TRIAGE 2026-08-21 — two stale expectations fixed, no assertion weakened:
//
// 1. ENGINE. It drove window.tenebrae.translate — the LEGACY SAMPLE seam
//    (step1.html L4424: translate → translateText, the shift cipher), over the
//    seven sample ids including 'rath-speech'. TX-1 makes the embedded Codex
//    Omnilingua the engine from boot, and translate2 (L4425: resolveTranslate)
//    is that engine. Determinism proved on the cipher proved nothing about the
//    engine the author actually uses. Now: translate2, over the codex's own
//    roster read from window.tenebrae.langs(), and the forged PUA script run
//    is compared too — the forge is session-local and lazy (TX-4 "forging is
//    deterministic"), so it is the part most likely to drift across a reload.
//
// 2. NETWORK. It asserted "zero external request events". The embedded codex
//    carries its own @import of fonts.googleapis.com (codex.html L9); the
//    writer seals the engine iframe with an injected CSP (step1.html
//    L3578-3580) so the load is REFUSED. Chromium still emits a `request`
//    event for a CSP-refused subresource, immediately followed by
//    `requestfailed` with errorText "csp" — nothing is put on the wire. The
//    real requirement is that no external request SUCCEEDS, which is what is
//    asserted now (requestfinished/response count must be 0), with every
//    external attempt required to be blocked and printed.
// Run: cd probes && node tr-determinism.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const SENTENCES = [
  'The sea remembers the stone gate',
  'Night waves fall; the keeper watched, remembering old oaths.',
  'She speaks truth to kings and queens — nothing waits forever!',
  'Xylophones & quartz (unknown words) survive: 42 tides, 7 storms.',
];

const { srv, browser, page, errors } = await launch();

const local = u => u.startsWith('http://127.0.0.1');
const attempted = [], succeeded = [], blocked = [];
page.on('request', r => { if (!local(r.url())) attempted.push(r.url()); });
page.on('requestfinished', r => { if (!local(r.url())) succeeded.push(r.url()); });
page.on('requestfailed', r => { if (!local(r.url())) blocked.push(r.url().slice(0, 60) + ' :: ' + ((r.failure() || {}).errorText || '?')); });

await wait(page, 3500); // engine wake + forge
const IDS = (await page.evaluate(() => window.tenebrae.langs().then(x => x.langs.map(l => l.id))));
console.log('tongues under test:', JSON.stringify(IDS));

const snap = () => page.evaluate(async ({ ids, sentences }) => {
  const out = {};
  for (const id of ids)
    for (const s of sentences) {
      const r = await window.tenebrae.translate2(id, s);
      let scr = null;
      try { scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null; } catch (e) { scr = 'ERR:' + e; }
      out[id + '::' + s] = JSON.stringify({ r, scr });
    }
  return out;
}, { ids: IDS, sentences: SENTENCES });

const a = await snap();          // run 1
const b = await snap();          // run 2, same page
await page.reload();
await wait(page, 3500);
const c = await snap();          // run 3, after reload

// run 4: storage-fresh context (new profile, no IndexedDB carry-over)
const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fpage = await fresh.newPage();
const ferrors = [];
fpage.on('pageerror', e => ferrors.push(e.message));
await fpage.goto(srv.url + 'step1.html');
await fpage.waitForTimeout(4000);
const d = await fpage.evaluate(async ({ ids, sentences }) => {
  const out = {};
  for (const id of ids)
    for (const s of sentences) {
      const r = await window.tenebrae.translate2(id, s);
      let scr = null;
      try { scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null; } catch (e) { scr = 'ERR:' + e; }
      out[id + '::' + s] = JSON.stringify({ r, scr });
    }
  return out;
}, { ids: IDS, sentences: SENTENCES });

const keys = Object.keys(a);
console.log('combinations checked:', keys.length, `(${IDS.length} tongues x ${SENTENCES.length} sentences)`);
let sameRepeat = true, sameReload = true, sameFresh = true;
for (const k of keys) {
  if (a[k] !== b[k]) { sameRepeat = false; console.log('REPEAT MISMATCH', k, '\n  a:', a[k].slice(0, 200), '\n  b:', b[k].slice(0, 200)); }
  if (a[k] !== c[k]) { sameReload = false; console.log('RELOAD MISMATCH', k, '\n  a:', a[k].slice(0, 200), '\n  c:', c[k].slice(0, 200)); }
  if (a[k] !== d[k]) { sameFresh = false; console.log('FRESH-CONTEXT MISMATCH', k, '\n  a:', a[k].slice(0, 200), '\n  d:', String(d[k]).slice(0, 200)); }
}
// spot-print one result per tongue so the output is auditable
for (const id of IDS) {
  const { r, scr } = JSON.parse(a[id + '::' + SENTENCES[0]]);
  console.log(`${id}: rom="${r.romanization}" flow=${r.flow} gloss=${(r.gloss || []).length} scrLen=${scr ? [...scr].length : 0}`);
}

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const nCombo = keys.length;
const checks = [
  has(`repeat calls identical (full JSON + script run) for all ${nCombo} combos`, sameRepeat),
  has(`identical across reload for all ${nCombo} combos`, sameReload),
  has(`identical in a storage-fresh context for all ${nCombo} combos`, sameFresh),
  has('outputs differ between tongues (engine not degenerate)',
      new Set(IDS.map(id => JSON.parse(a[id + '::' + SENTENCES[0]]).r.romanization)).size === IDS.length),
  has('no external request succeeds (every attempt blocked before the wire)',
      succeeded.length === 0 && attempted.length === blocked.length),
];
console.log('external attempts:', attempted.length, '| succeeded:', succeeded.length);
if (blocked.length) console.log('blocked:', blocked);
if (succeeded.length) console.log('LEAKED:', succeeded);

console.log('pageerrors:', errors.length ? errors : 'none', '| fresh-ctx:', ferrors.length ? ferrors : 'none');
verdict('TR-2 / TX-3', checks.every(Boolean) && errors.length === 0 && ferrors.length === 0);

await browser.close();
await srv.close();
