// TX-6 / TX-10b FOLLOW-ON — the DEEP column, not the wide block.
//
// cf-adv-colcap.mjs shows ordinary English reaches a 37-cell Celan High word
// (1273 of 166,464 lexicon phrases exceed 22 cells). cf-pdf-block-overflow.mjs
// tested a WIDE cols-rtl block (72 short words) and found it inside the margins.
// Nothing has tested a DEEP one: drawScriptBlock (step1.html:2766) puts every
// cell of a word in one column with no cap and no split, and scriptBlockSize
// makes the block `deepest * s + s*0.3` tall, so a 37-cell word is 37 ems of
// column. need(h) can only start a NEW page; it cannot make the column fit.
//
// Run: cd probes && node cf-adv-deepcol-pdf.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-deepcol';
await mkdir(OUT, { recursive: true });
const PHRASE = 'the sea remembers the growing blessing';
const P = { w: 595.28, h: 841.89, m: 72 };
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : String(x).slice(0, 300)); };

function placements(buf){
  const d = buf.toString('latin1');
  const out = [];
  for(const m of d.matchAll(/BT \/(S_[a-z_]+) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g))
    out.push({ f: m[1], size: +m[2], x: +m[3], y: +m[4] });
  return out;
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, 'Deep Column');
await page.click('#ed-title'); await page.keyboard.type('Deep');
await page.click('#ed-content');
await page.keyboard.type('lead in line');
await page.keyboard.press('Enter');
await page.keyboard.type(PHRASE);
await wait(page, 500);
await insertTranslationSpan(page, PHRASE, 'Celan High');
await wait(page, 1600);

const info = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  const scr = sp.dataset.scr || '';
  const units = scr.split(/[\n ]/).filter(Boolean);
  return { flow: sp.dataset.flow, deepest: Math.max(...units.map(u => u.length)), units: units.map(u => u.length) };
});
console.log('   span:', JSON.stringify(info));
ck('precondition: one cols-rtl word is 22+ cells deep', info.flow === 'cols-rtl' && info.deepest >= 22,
   JSON.stringify(info.units));

await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const grab = async tag => {
  const buf = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
  await writeFile(`${OUT}/${tag}.pdf`, buf);
  const pl = placements(buf);
  const ys = pl.map(p => p.y);
  console.log(`   [${tag}] ${pl.length} script cells, size ${pl.length ? pl[0].size : '-'}, y ${Math.min(...ys)}..${Math.max(...ys)} (bottom margin ${P.m})`);
  return pl;
};

const A = await grab('normal');
ck('normal size: every script cell sits inside the bottom margin',
   A.every(p => p.y >= P.m), `${A.filter(p => p.y < P.m).length} cells below y=${P.m}; lowest y=${Math.min(...A.map(p => p.y))}`);
ck('normal size: every script cell sits inside the MediaBox (y >= 0)',
   A.every(p => p.y >= 0), `lowest y=${Math.min(...A.map(p => p.y))}`);

// Script size -> Huge, one tap away in the real UI
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 800);
await page.locator('#sheet .sh-item', { hasText: 'Script size' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Huge' }).click();
await wait(page, 1200);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 500);
const B = await grab('huge');
ck('precondition: Huge really changed the PDF type size', B.length && A.length && B[0].size > A[0].size,
   `${A.length ? A[0].size : '-'} -> ${B.length ? B[0].size : '-'}`);
ck('Huge: every script cell sits inside the bottom margin',
   B.every(p => p.y >= P.m), `${B.filter(p => p.y < P.m).length} of ${B.length} cells below y=${P.m}; lowest y=${Math.min(...B.map(p => p.y))}`);
ck('Huge: every script cell sits inside the MediaBox (y >= 0 — a negative y is off the paper)',
   B.every(p => p.y >= 0), `lowest y=${Math.min(...B.map(p => p.y))}`);

ck('no page exceptions', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
const ok = checks.every(c => c[1]);
console.log(`\n${checks.filter(c => c[1]).length}/${checks.length} checks`);
verdict('TX-10b deep column', ok);
await browser.close(); await srv.close();
