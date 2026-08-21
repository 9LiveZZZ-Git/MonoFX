// TX-6 REFUTATION PROBE — the cols-rtl "one column per word" contract against
// the longest word ORDINARY ENGLISH can actually reach, not the longest word a
// hand-written 24-phrase list happened to reach.
//
// cf-script-longword-layout.mjs asserted TX-6 on a 21-cell Celan High word and
// noted in its own diagnostic that a 22-cell run splits into two columns
// (max-height:var(--tsrun,22em), step1.html:2508/3365, --tsrun never assigned).
// It then concluded 21 was the ceiling of the corpus. This probe sweeps the
// codex's OWN English lexicon (TRANS.celan_high.EN2L, 408 clean keys) through
// the real engine to find how long a word really gets, then drives the winner
// through the REAL editor UI and measures the resulting span.
//
// Run: cd probes && node cf-adv-colcap.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1400 });
await wait(page, 3500);

/* ---- 1. sweep the codex's own lexicon for the longest single script word ---- */
const sweep = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const F = window.tenebrae._forge;
  const en2l = w.CODEX.TRANS['celan_high'].EN2L;
  const words = Object.keys(en2l).filter(k => /^[a-z]{3,}$/.test(k));
  const cells = s => [...s].filter(c => c.charCodeAt(0) >= 0xE000).length;
  let best = { n: 0 }; let over = 0, tried = 0;
  const t0 = Date.now();
  outer:
  for(const a of words){
    for(const b of words){
      const en = `the sea remembers the ${a} ${b}`;
      let t; try{ t = await window.tenebrae.translate2('celan_high', en); }catch(e){ continue; }
      tried++;
      if(!t) continue;
      const scr = F.textForToks('celan_high', t.toks || []);
      if(!scr) continue;
      let m = 0; for(const u of scr.split(/[\n ]/)) m = Math.max(m, cells(u));
      if(m >= 22) over++;
      if(m > best.n) best = { n: m, en, rom: t.romanization };
      if(Date.now() - t0 > 120000) break outer;
    }
  }
  return { words: words.length, tried, over, best, ms: Date.now() - t0 };
});
console.log(`   sweep: ${sweep.tried} ordinary-English phrases from the codex's own lexicon in ${sweep.ms}ms`);
console.log(`   phrases whose script contains a word of >= 22 cells: ${sweep.over}`);
console.log(`   longest: "${sweep.best.en}" -> ${sweep.best.n} cells   rom: ${sweep.best.rom}`);
ck('SETUP: ordinary English DOES reach past the 22-cell cols-rtl cap', sweep.best.n >= 22,
   `${sweep.best.n} cells, ${sweep.over} phrases over the cap`);

const PHRASE = sweep.best.en;

/* ---- 2. same measurement code the audited probe used, on the REAL span ---- */
const MEASURE = `(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return { err: 'no span' };
  const tn = sp.firstChild;
  const s = sp.textContent;
  const units = []; let cur = [];
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(c === '\\n' || c === ' '){ if(cur.length){ units.push(cur); cur = []; } continue; }
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1);
    const b = r.getBoundingClientRect();
    cur.push({ i, x: b.left, y: b.top, r: b.right, b: b.bottom });
  }
  if(cur.length) units.push(cur);
  const cs = getComputedStyle(sp);
  return { units, flow: sp.dataset.flow || 'ltr', lang: sp.dataset.lang,
           css: { wm: cs.writingMode, dir: cs.direction, fam: cs.fontFamily, fs: cs.fontSize, mh: cs.maxHeight },
           svg: sp.querySelectorAll('svg,img,canvas').length };
})()`;

function analyse(m){
  const out = { lens: m.units.map(u => u.length) };
  // "one column per word": every cell of a word shares one x band
  out.perWordSpread = m.units.map(u => +(Math.max(...u.map(c => c.x)) - Math.min(...u.map(c => c.x))).toFixed(1));
  out.oneColumnPerWord = out.perWordSpread.every(v => v <= 1.5);
  // how many DISTINCT x bands each word occupies
  out.colsPerWord = m.units.map(u => {
    const xs = [...new Set(u.map(c => Math.round(c.x)))].sort((a, b) => a - b);
    const bands = []; for(const x of xs){ if(!bands.length || x - bands[bands.length - 1] > 2) bands.push(x); }
    return bands.length;
  });
  const cx = m.units.map(u => u.reduce((s, c) => s + c.x, 0) / u.length);
  out.colXs = cx.map(v => +v.toFixed(1));
  out.advanceLR = cx.every((v, i) => i === 0 || v > cx[i - 1] + 1);
  out.tops = m.units.map(u => +u[0].y.toFixed(1));
  out.allTops = m.units.map(u => +(Math.min(...u.map(c => c.y))).toFixed(1));
  out.ceiling = Math.max(...out.allTops) - Math.min(...out.allTops) <= 1.5;
  out.runsDown = m.units.every(u => u.every((c, i) => i === 0 || c.y > u[i - 1].y));
  return out;
}

async function build(langLabel, title){
  await createBook(page, title);
  await page.click('#ed-content');
  await page.keyboard.type('opening line');
  await page.keyboard.press('Enter');
  await page.keyboard.type(PHRASE);
  await wait(page, 400);
  await insertTranslationSpan(page, PHRASE, langLabel);
  await wait(page, 1400);
  const m = await page.evaluate(MEASURE);
  if(m.err) throw new Error(m.err);
  const a = analyse(m);
  console.log(`   [${m.lang}/${m.flow}] cells per word = ${a.lens.join(',')}`);
  console.log(`   [${m.lang}] columns occupied per word = ${a.colsPerWord.join(',')}   max-height=${m.css.mh} font-size=${m.css.fs}`);
  console.log(`   [${m.lang}] x-spread within each word (px) = ${a.perWordSpread.join(',')}`);
  console.log(`   [${m.lang}] top of each word = ${a.allTops.join(',')}`);
  await page.click('#ed-back'); await wait(page, 500);
  await page.click('#bk-back'); await wait(page, 500);
  return { m, a };
}

const CH = await build('Celan High', 'ColCap CH');
ck('the real editor really did write the long word (>= 22 cells in one word)',
   Math.max(...CH.a.lens) >= 22, `lens=${CH.a.lens.join(',')}`);
ck('TX-6 cols-rtl: ONE COLUMN PER WORD on ordinary English',
   CH.a.oneColumnPerWord, `columns per word = ${CH.a.colsPerWord.join(',')} (x-spread ${CH.a.perWordSpread.join(',')})`);
ck('TX-6 cols-rtl: columns advance LEFT->RIGHT',
   CH.a.advanceLR, JSON.stringify(CH.a.colXs));
ck('TX-6 cols-rtl: every word hangs from the common ceiling',
   CH.a.ceiling, JSON.stringify(CH.a.allTops));
ck('TX-6 cols-rtl: letters run DOWN the column in logical order',
   CH.a.runsDown, CH.a.runsDown ? '' : 'a cell jumps back UP to the top of a second column mid-word');
ck('script is still TEXT in the forged face (not a rendering fallback)',
   CH.m.svg === 0 && /Tenebrae Omni/.test(CH.m.css.fam), CH.m.css.fam);

/* control: btt-stave has no max-height, so the same phrase must NOT split */
const KD = await build('Kildaren', 'ColCap KD');
ck('CONTROL btt-stave: one stave per word on the same phrase (no cap on that flow)',
   KD.a.oneColumnPerWord, `staves per word = ${KD.a.colsPerWord.join(',')}`);

ck('no page exceptions', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

const ok = checks.every(c => c[1]);
console.log(`\n${checks.filter(c => c[1]).length}/${checks.length} checks`);
verdict('TX-6 colcap', ok);
await browser.close(); await srv.close();
