// TX-10b GAP PROBE — the vertical script BLOCK against the edges of the page.
//
// TX-10b requires cols-rtl and btt-stave to be set as their own blocks "because
// an inline column nine ems tall would wreck a printed page". drawScriptBlock
// (step1.html:2766) lays the columns out at `x + ci * pitch` with no wrap rule
// and no right-edge test, and calls `need(box.h + 10)` for the vertical extent
// only. This probe asks three questions nothing else asks:
//
//   A. a long cols-rtl span (72 source words) — does the block stay inside the
//      1in right margin, or does it walk off the page?
//   B. the same block at Script size = Huge (scale 2.3)
//   C. a vertical block that arrives with the page nearly full — does the
//      block page-break land it inside the text area?
//
// Measured straight from the content stream: every `BT /S_lang <size> Tf
// 1 0 0 1 x y Tm` placement, against MediaBox 595.28 x 841.89 and margin 72.
//
// Run: cd probes && node cf-pdf-block-overflow.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-block';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const UNIT = 'the sea remembers the old king ';
const LONG = UNIT.repeat(12).trim();  // 72 words, all of them translatable

const P = { w: 595.28, h: 841.89, m: 72 };
function placements(buf){
  const d = buf.toString('latin1');
  const out = {};
  for(const m of d.matchAll(/BT \/(S_[a-z_]+) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)){
    (out[m[1]] = out[m[1]] || []).push({ size: +m[2], x: +m[3], y: +m[4] });
  }
  return out;
}
const report = (tag, pl) => {
  for(const [f, v] of Object.entries(pl)){
    const xs = v.map(p => p.x), ys = v.map(p => p.y);
    console.log(`   [${tag}] ${f}: ${v.length} cells  x ${Math.min(...xs)}..${Math.max(...xs)}  y ${Math.min(...ys)}..${Math.max(...ys)}  size ${v[0].size}`);
  }
};

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => ({ id: l.id, name: l.name })));
const flows = await page.evaluate(() => Object.fromEntries(Object.entries(window.tenebrae._forge.map() || {}).map(([k, v]) => [k, v.flow])));
const COLS = Object.keys(flows).find(k => flows[k] === 'cols-rtl');
const COLSNAME = (LANGS.find(l => l.id === COLS) || {}).name;
console.log('cols-rtl tongue:', COLS, COLSNAME);

/* ---- A: a 72-word cols-rtl block ---- */
await createBook(page, 'Block Overflow');
await page.click('#ed-title'); await page.keyboard.type('Wide Block');
await page.click('#ed-content');
await page.keyboard.type('lead in line');
await page.keyboard.press('Enter');
await page.keyboard.type(LONG);
await wait(page, 500);
await insertTranslationSpan(page, LONG, COLSNAME);
await wait(page, 1800);
const spanInfo = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  const scr = sp.dataset.scr || '';
  return { flow: sp.dataset.flow, words: scr.split(/[\s\n]+/).filter(Boolean).length, cells: [...scr].filter(c => c.charCodeAt(0) >= 0xE000).length };
});
console.log('span:', JSON.stringify(spanInfo));
ck('precondition: the span really is a cols-rtl block with many words',
   spanInfo.flow === 'cols-rtl' && spanInfo.words >= 40, JSON.stringify(spanInfo));

await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
const bufA = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/wide.pdf`, bufA);
const plA = placements(bufA); report('A', plA);
const cellsA = Object.values(plA).flat();
const maxXA = Math.max(...cellsA.map(c => c.x));
ck('A: a 72-word cols-rtl block stays inside the right margin',
   maxXA <= P.w - P.m, `rightmost column x = ${maxXA}, right margin = ${P.w - P.m}`);
ck('A: a 72-word cols-rtl block stays inside the MediaBox at all',
   maxXA <= P.w, `rightmost column x = ${maxXA}, page width = ${P.w}`);
ck('A: every cell of the block is inside the top/bottom margins',
   cellsA.every(c => c.y >= P.m && c.y <= P.h - P.m), JSON.stringify(cellsA.filter(c => c.y < P.m || c.y > P.h - P.m).slice(0, 4)));

/* ---- B: the same block at Script size = Huge ---- */
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 800);
await page.locator('#sheet .sh-item', { hasText: 'Script size' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Huge' }).click();
await wait(page, 1200);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 500);
const size = await page.evaluate(() => document.querySelector('#ed-content .tspan').dataset.size || '');
console.log('span data-size =', JSON.stringify(size));
const bufB = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/huge.pdf`, bufB);
const plB = placements(bufB); report('B', plB);
const cellsB = Object.values(plB).flat();
ck('precondition: Huge really changed the PDF type size', cellsB[0].size > cellsA[0].size, `${cellsA[0].size} -> ${cellsB[0].size}`);
const maxXB = Math.max(...cellsB.map(c => c.x));
ck('B: the Huge block stays inside the right margin', maxXB <= P.w - P.m, `rightmost column x = ${maxXB}`);
ck('B: the Huge block stays inside the MediaBox', maxXB <= P.w, `rightmost column x = ${maxXB}, page width ${P.w}`);
ck('B: every cell of the Huge block is inside the top/bottom margins',
   cellsB.every(c => c.y >= P.m && c.y <= P.h - P.m), JSON.stringify(cellsB.filter(c => c.y < P.m || c.y > P.h - P.m).slice(0, 4)));

/* ---- C: a vertical block arriving on a nearly full page ---- */
await page.click('#ed-back'); await wait(page, 700);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 800);
await page.click('#ed-title'); await page.keyboard.type('Boundary Block');
await page.click('#ed-content');
await page.keyboard.type('boundary filler line 0');
for(let i = 1; i < 40; i++){ await page.keyboard.press('Enter'); await page.keyboard.type(`boundary filler line ${i}`); }
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the old king');
await wait(page, 600);
await insertTranslationSpan(page, 'the sea remembers the old king', COLSNAME);
await wait(page, 1800);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 500);
const bufC = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/boundary.pdf`, bufC);
const plC = placements(bufC); report('C', plC);
const cellsC = Object.values(plC).flat();
const low = cellsC.filter(c => c.y < P.m);
ck('C: the block that lands at a page boundary is not painted below the bottom margin',
   low.length === 0, `${low.length} cells below y=72, lowest ${Math.min(...cellsC.map(c => c.y))}`);
ck('C: no cell of it falls off the bottom of the MediaBox', cellsC.every(c => c.y >= 0),
   `lowest y = ${Math.min(...cellsC.map(c => c.y))}`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF BLOCK OVERFLOW', checks.every(c => c[1]));
await browser.close();
await srv.close();
