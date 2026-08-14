// TR-2 — Deterministic translation: identical input → identical output across
// repeated calls and across a full page reload, for every one of the seven
// sample tongues. Full JSON equality of the translate() result (romanization,
// rendered PUA form, gloss, dir, lang def). Also confirms zero network
// requests are made by translation (no Claude, no server).
// Run: cd probes && node tr-determinism.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const IDS = ['celan-basic', 'celan-high', 'kerrackian', 'kildaren',
             'calgridarian', 'evernessian', 'rath-speech'];
const SENTENCES = [
  'The sea remembers the stone gate',
  'Night waves fall; the keeper watched, remembering old oaths.',
  'She speaks truth to kings and queens — nothing waits forever!',
  'Xylophones & quartz (unknown words) survive: 42 tides, 7 storms.',
];

const { srv, browser, page, errors } = await launch();

const requests = [];
page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) requests.push(r.url()); });

const snap = () => page.evaluate(({ ids, sentences }) => {
  const out = {};
  for (const id of ids)
    for (const s of sentences)
      out[id + '::' + s] = JSON.stringify(window.tenebrae.translate(id, s));
  return out;
}, { ids: IDS, sentences: SENTENCES });

const a = await snap();          // run 1
const b = await snap();          // run 2, same page
await page.reload();
await wait(page, 900);
const c = await snap();          // run 3, after reload

const keys = Object.keys(a);
console.log('combinations checked:', keys.length, `(${IDS.length} tongues x ${SENTENCES.length} sentences)`);
let sameRepeat = true, sameReload = true;
for (const k of keys) {
  if (a[k] !== b[k]) { sameRepeat = false; console.log('REPEAT MISMATCH', k, '\n  a:', a[k].slice(0, 200), '\n  b:', b[k].slice(0, 200)); }
  if (a[k] !== c[k]) { sameReload = false; console.log('RELOAD MISMATCH', k, '\n  a:', a[k].slice(0, 200), '\n  c:', c[k].slice(0, 200)); }
}
// spot-print one result per tongue so the output is auditable
for (const id of IDS) {
  const r = JSON.parse(a[id + '::' + SENTENCES[0]]);
  console.log(`${id}: rom="${r.romanization}" dir=${r.dir} gloss=${r.gloss.length} words`);
}

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('repeat calls identical (full JSON) for all 28 combos', sameRepeat),
  has('identical across reload for all 28 combos', sameReload),
  has('outputs differ between tongues (engine not degenerate)',
      new Set(IDS.map(id => JSON.parse(a[id + '::' + SENTENCES[0]]).romanization)).size === IDS.length),
  has('zero external network requests', requests.length === 0),
];
if (requests.length) console.log('EXTERNAL REQUESTS:', requests);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-2', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
