// vp-TR-2 — adversarial re-test of translation determinism, independent of
// tr-determinism.mjs: all 7 sample tongues x 3 sentences (punctuation, digits,
// unknown words, apostrophes), each translated 3x, full-JSON compared, then the
// page is RELOADED and every combination re-compared against the pre-reload
// output. Every network request is logged (PR-4 corroboration) — anything that
// is not the local step1.html fails the probe.
// window.tenebrae seam use is sanctioned for translation assertions.
// Run: cd probes && node vp-tr2-det-reload.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [], requests = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
page.on('request', r => requests.push(r.url()));
page.on('websocket', w => requests.push('WS:' + w.url()));
const T = ms => page.waitForTimeout(ms);

const SENTS = [
  "The sea remembers the stone bridge.",
  "Don't count 12 ravens — they lie, twice!",
  "Xylophonic quandaries perplex the boatwright?",
];

await page.goto(srv.url + 'step1.html');
await T(700);

const round = () => page.evaluate(async (sents) => {
  const { langs } = await window.tenebrae.langs();
  const out = {};
  for(const l of langs){
    for(const s of sents){
      const a = await window.tenebrae.translate(l.id, s);
      const b = await window.tenebrae.translate(l.id, s);
      const c = await window.tenebrae.translate(l.id, s);
      const ja = JSON.stringify(a);
      if(ja !== JSON.stringify(b) || ja !== JSON.stringify(c)) return { fail: `repeat mismatch ${l.id}` };
      out[l.id + '|' + s] = ja;
    }
  }
  return { ids: langs.map(l => l.id), out };
}, SENTS);

const r1 = await round();
if(r1.fail){ console.log('FAIL:', r1.fail); process.exit(1); }
console.log('tongues:', JSON.stringify(r1.ids), '| combos:', Object.keys(r1.out).length);

// distinctness: the 7 tongues must not collapse into one output
const roms = r1.ids.map(id => JSON.parse(r1.out[id + '|' + SENTS[0]]).romanization);
const distinct = new Set(roms).size;
console.log('distinct romanizations for sentence 1:', distinct, JSON.stringify(roms.map(r => r.slice(0, 34))));

await page.reload();
await T(700);
const r2 = await round();
if(r2.fail){ console.log('FAIL:', r2.fail); process.exit(1); }

let stable = true;
for(const k of Object.keys(r1.out)){
  if(r1.out[k] !== r2.out[k]){ stable = false; console.log('RELOAD MISMATCH at', k); }
}
console.log('all', Object.keys(r1.out).length, 'combos identical across reload:', stable);

const external = requests.filter(u => !u.startsWith(srv.url));
console.log('requests:', requests.length, '| external:', JSON.stringify(external));

const ok = r1.ids.length === 7 && Object.keys(r1.out).length === 21 && distinct === 7 &&
  stable && external.length === 0 && errors.length === 0;
console.log('pageerrors:', errors.length);
console.log(ok ? 'vp-TR-2 VERDICT: PASS' : 'vp-TR-2 VERDICT: FAIL');

await browser.close();
await srv.close();
