// vp-TR-2 — adversarial re-test of translation determinism, independent of
// tr-determinism.mjs: every tongue the app offers x 3 sentences (punctuation,
// digits, unknown words, apostrophes), each translated 3x, full-JSON compared,
// then the page is RELOADED and every combination re-compared against the
// pre-reload output. Every network request is logged (PR-4 / TX-1 corroboration).
//
// 2026-08 TRIAGE (stale-probe fix, TX-1/TX-3):
//   * the engine seam is window.tenebrae.translate2 (resolveTranslate → the
//     embedded Codex Omnilingua). window.tenebrae.translate is the LEGACY
//     sample-cipher seam and is not the engine under test: driven with the real
//     codex's tongue ids it falls back to one sample language, so celan_basic
//     and celan_high came back byte-identical ("Te meres memnerin te petrek
//     punten") and the tongue count read 5 distinct of 7. Real engine: 6
//     tongues, 6 distinct romanizations.
//   * the app ships 6 tongues (celan_basic, celan_high, kerrackian, kildaren,
//     calgridarian, evernessian) — the "7 sample tongues" expectation predates
//     the embedded codex.
//   * the codex iframe's own <style> carries an @import for the JetBrains Mono
//     CDN. omniPatchHTML() injects a CSP that BLOCKS it (requestfailed
//     errorText "csp", console "Refused to load the stylesheet"), so no bytes
//     leave the machine — but Chromium still emits a 'request' event for the
//     blocked load. Counting request events therefore measured the wrong thing.
//     This probe now demands the stronger fact: every external request must be
//     blocked (no response, failure recorded) — an external request that
//     actually completes still fails the probe.
// window.tenebrae seam use is sanctioned for translation assertions.
// Run: cd probes && node vp-tr2-det-reload.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [], requests = [], failed = new Map(), responded = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
page.on('request', r => requests.push(r.url()));
page.on('requestfailed', r => failed.set(r.url(), (r.failure() || {}).errorText));
page.on('response', r => responded.push(r.url()));
page.on('websocket', w => { requests.push('WS:' + w.url()); responded.push('WS:' + w.url()); });
const T = ms => page.waitForTimeout(ms);

const SENTS = [
  "The sea remembers the stone bridge.",
  "Don't count 12 ravens — they lie, twice!",
  "Xylophonic quandaries perplex the boatwright?",
];

await page.goto(srv.url + 'step1.html');
await T(4000); // embedded engine wake + forge

const round = () => page.evaluate(async (sents) => {
  const { langs } = await window.tenebrae.langs();
  const out = {};
  for(const l of langs){
    for(const s of sents){
      const a = await window.tenebrae.translate2(l.id, s);
      const b = await window.tenebrae.translate2(l.id, s);
      const c = await window.tenebrae.translate2(l.id, s);
      const ja = JSON.stringify(a);
      if(ja !== JSON.stringify(b) || ja !== JSON.stringify(c)) return { fail: `repeat mismatch ${l.id}` };
      out[l.id + '|' + s] = ja;
    }
  }
  return { ids: langs.map(l => l.id), out };
}, SENTS);

const r1 = await round();
if(r1.fail){ console.log('FAIL:', r1.fail); process.exit(1); }
const N = r1.ids.length;
console.log('tongues:', JSON.stringify(r1.ids), '| combos:', Object.keys(r1.out).length);

// distinctness: the tongues must not collapse into one output
const roms = r1.ids.map(id => JSON.parse(r1.out[id + '|' + SENTS[0]]).romanization);
const distinct = new Set(roms).size;
console.log('distinct romanizations for sentence 1:', distinct, JSON.stringify(roms.map(r => r.slice(0, 34))));

await page.reload();
await T(4000);
const r2 = await round();
if(r2.fail){ console.log('FAIL:', r2.fail); process.exit(1); }

let stable = true;
for(const k of Object.keys(r1.out)){
  if(r1.out[k] !== r2.out[k]){ stable = false; console.log('RELOAD MISMATCH at', k); }
}
console.log('all', Object.keys(r1.out).length, 'combos identical across reload:', stable);

const external = requests.filter(u => !u.startsWith(srv.url));
const leaked = external.filter(u => responded.includes(u) || !failed.has(u));
console.log('requests:', requests.length, '| external:', JSON.stringify([...new Set(external)]));
console.log('external blocked:', JSON.stringify([...new Set(external)].map(u => u.slice(0, 48) + ' -> ' + failed.get(u))));
console.log('external that actually completed:', JSON.stringify(leaked));

const ok = N === 6 && Object.keys(r1.out).length === N * SENTS.length && distinct === N &&
  stable && leaked.length === 0 && errors.length === 0;
console.log('pageerrors:', errors.length);
console.log(ok ? 'vp-TR-2 VERDICT: PASS' : 'vp-TR-2 VERDICT: FAIL');

await browser.close();
await srv.close();
