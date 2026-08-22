// TX-VF: two questions the earlier reports disagreed about.
//   1. TX-1/TX-3: state.codex is undefined from script-eval until boot's
//      `await kvGet('state')` resolves. window.tenebrae.translate2 is exposed
//      at script-eval time. Does a translate issued in that window fall through
//      resolveTranslate:3145 to the legacy SAMPLE cipher?
//   2. TX-3: is the engine a pure function of (codex, tongue, text) across a
//      storage-fresh context, a reload, and a second browser process?
// Run: cd probes && node tx-vf-boot-race.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { verdict } from './ex-lib.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? '  ok   ' : '  FAIL '), label, extra === undefined ? '' : extra); };
const PHRASE = 'The sea remembers the old king';
const CORPUS = [
  ['celan_basic', 'the sea remembers'], ['celan_high', PHRASE], ['kerrackian', 'my mana let it stand'],
  ['kildaren', 'she walks alone tonight'], ['calgridarian', "o'connor's 42 towers — naïve?"], ['evernessian', ''],
  ['celan_high', 'The sea remembers. The king waits.'], ['kildaren', '☕ 汉字 שלום'],
];

const srv = await startServer();
const errors = [];
async function fresh(browser){
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  return { context, page };
}

// ---------- 1. earliest-possible translate2 ----------
const b1 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
{
  const { context, page } = await fresh(b1);
  // fire translate2 the instant window.tenebrae exists, long before boot finishes
  await page.addInitScript(() => {
    window.__early = { t: null, err: null, when: null };
    const t0 = performance.now();
    const poll = setInterval(() => {
      if(window.tenebrae){
        clearInterval(poll);
        window.__early.when = performance.now() - t0;
        try{
          const p = window.tenebrae.translate2('celan_high', 'The sea remembers the old king');
          Promise.resolve(p).then(r => { window.__early.t = r ? r.romanization : null; window.__early.lang = r && r.lang && r.lang.id; },
                                  e => { window.__early.err = String(e); });
        }catch(e){ window.__early.err = String(e); }
      }
    }, 0);
  });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(4500);
  const early = await page.evaluate(() => window.__early);
  const truth = await page.evaluate(async phrase => {
    const w = await window.tenebrae.engine();
    const C = w.CODEX;
    const res = C.compileText(C.TRANS.celan_high, phrase, 'e2l');
    return { codex: res.lines.map(l => l.map(p => p.t).join(' ')).join(' '),
             sample: window.tenebrae.translateSampleLegacy('celan_high', phrase).romanization };
  }, PHRASE);
  console.log('earliest translate2 fired at', early.when && early.when.toFixed(1), 'ms after navigation');
  console.log('  result:', JSON.stringify(early.t), 'lang:', JSON.stringify(early.lang), 'err:', early.err);
  console.log('  codex :', JSON.stringify(truth.codex));
  console.log('  sample:', JSON.stringify(truth.sample));
  ck('earliest-possible translate2 is not the legacy sample cipher',
     early.t !== truth.sample, `returned the sample cipher: ${JSON.stringify(early.t)}`);
  ck('earliest-possible translate2 is the codex (or cleanly null)',
     early.t === null || early.t === truth.codex, `returned ${JSON.stringify(early.t)}`);
  await context.close();
}

// ---------- 2. determinism across contexts / reload / process ----------
const runCorpus = page => page.evaluate(async corpus => {
  const out = {};
  for(const [id, text] of corpus){
    const r = await window.tenebrae.translate2(id, text);
    const scr = r ? (window.tenebrae._forge.textForToks(id, r.toks) || null) : null;
    out[id + '|' + text] = r ? JSON.stringify({ rom: r.romanization, gloss: r.gloss, toks: r.toks, dir: r.dir, flow: r.flow, scr }) : null;
  }
  return out;
}, corpusArg());
function corpusArg(){ return CORPUS; }

const sigs = [];
{
  const { context, page } = await fresh(b1);
  await page.goto(srv.url + 'step1.html'); await page.waitForTimeout(3800);
  sigs.push(['fresh ctx A', await runCorpus(page)]);
  sigs.push(['repeat same page', await runCorpus(page)]);
  await page.reload(); await page.waitForTimeout(3800);
  sigs.push(['after reload', await runCorpus(page)]);
  await context.close();
}
{
  const { context, page } = await fresh(b1); // storage-fresh (new context)
  await page.goto(srv.url + 'step1.html'); await page.waitForTimeout(3800);
  const ls = await page.evaluate(() => ({ ls: localStorage.length }));
  console.log('storage-fresh context localStorage entries:', ls.ls);
  sigs.push(['storage-fresh ctx B', await runCorpus(page)]);
  await context.close();
}
await b1.close();
{
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const { context, page } = await fresh(b2);
  await page.goto(srv.url + 'step1.html'); await page.waitForTimeout(3800);
  sigs.push(['second process', await runCorpus(page)]);
  await context.close(); await b2.close();
}

const base = sigs[0][1];
for(let i = 1; i < sigs.length; i++){
  const [label, s] = sigs[i];
  const diff = Object.keys(base).filter(k => base[k] !== s[k]);
  ck(`identical output: ${label}`, diff.length === 0, `${diff.length} differing cells: ${JSON.stringify(diff.slice(0, 3))}`);
}
console.log('\nsample cells:', JSON.stringify(Object.entries(base).slice(0, 3).map(([k, v]) => [k, JSON.parse(v || 'null') && JSON.parse(v).rom])));

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF BOOT RACE + DETERMINISM', checks.every(c => c[1]) && errors.length === 0);
await srv.close();
