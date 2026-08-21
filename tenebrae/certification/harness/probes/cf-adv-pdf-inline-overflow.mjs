// TX-10b ADVERSARY PROBE — the INLINE script run against the right edge.
//
// The audit reported the vertical BLOCK flows (cols-rtl / btt-stave) walking off
// the page, and an unbreakable 193-char Latin word doing the same. It did not
// test the third path: a horizontal script span (rtl kerrackian, ltr
// calgridarian / evernessian / celan_basic) is laid inline by putAtom
// (step1.html:2810) as ONE atom of width pdfScriptWidth() — a span is never
// split between lines. If that single atom is wider than the 437pt text column,
// putAtom pushes it anyway (`if(cur + a.w > avail && atoms.length)` — the
// atoms.length guard) and drawScriptInline (step1.html:2747) walks cx to the
// right with no edge test.
//
// Questions:
//   A. one ordinary translated SENTENCE per horizontal tongue — how much of it
//      lands past the right margin / outside the MediaBox?
//   B. what is the shortest such sentence that loses ink off the paper?
//   C. does the same span survive in the EPUB/DOCX sense, i.e. is the loss
//      PDF-only? (compared against the app's own span, which reflows on screen)
//
// Every number is read from the content stream: word placements (Tm) plus the
// advance the PDF itself declares for those gids (/W).
//
// Run: cd probes && node cf-adv-pdf-inline-overflow.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-inline';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 400)); };
const P = { w: 595.28, h: 841.89, m: 72 };

function parse(buf){
  const s = buf.toString('latin1');
  const objs = {};
  for(const m of s.matchAll(/(\d+) 0 obj\n/g)){
    const id = +m[1], start = m.index + m[0].length;
    objs[id] = { body: s.slice(start, s.indexOf('endobj', start)), start };
  }
  // /W per lang, from the first page's resources
  const pageBody = Object.values(objs).find(o => /\/Type \/Page[^s]/.test(o.body)).body;
  const W = {};
  for(const m of pageBody.matchAll(/\/S_([a-z_]+) (\d+) 0 R/g)){
    const t0 = objs[+m[2]].body;
    const cid = objs[+(/\/DescendantFonts \[(\d+) 0 R\]/.exec(t0))[1]].body;
    const wm = /\/W \[(.*?)\] \/CIDToGIDMap/s.exec(cid);
    const tab = {};
    for(const q of (wm ? wm[1] : '').matchAll(/(\d+) \[(-?\d+)\]/g)) tab[+q[1]] = +q[2];
    W[m[1]] = tab;
  }
  const runs = [];
  for(const m of s.matchAll(/BT \/(S_[a-z_]+) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]+)> Tj ET/g)){
    const lang = m[1].slice(2), size = +m[2], x = +m[3], y = +m[4];
    const gids = m[5].match(/.{4}/g).map(h => parseInt(h, 16));
    const wdt = gids.reduce((n, g) => n + (W[lang][g] || 0) / 1000 * size, 0);
    runs.push({ lang, size, x, y, gids, end: x + wdt });
  }
  return { runs, W };
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => ({ id: l.id, name: l.name })));
const nameOf = id => (LANGS.find(l => l.id === id) || {}).name;

// One ordinary sentence per horizontal tongue. Nothing pathological: no
// repetition, no 193-char word — the kind of line an author writes.
const S = {
  kerrackian:   'the stone gate is open and the winter wind comes down from the north country',
  calgridarian: 'the river runs to the sea and the sea remembers the old king of the water',
  celan_basic:  'the sea remembers the old king and the light upon the water is not gone',
};
await createBook(page, 'Inline Overflow');
await page.click('#ed-title'); await page.keyboard.type('Straight Lines');
await page.click('#ed-content');
const ids = Object.keys(S);
for(let i = 0; i < ids.length; i++){ if(i) await page.keyboard.press('Enter'); await page.keyboard.type(S[ids[i]]); }
await wait(page, 600);
for(const id of ids){
  await insertTranslationSpan(page, S[id], nameOf(id));
  await wait(page, 1300);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 300);
}
const spans = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(sp => ({
  lang: sp.dataset.lang, flow: sp.dataset.flow || 'ltr', words: (sp.dataset.rom || '').split(/\s+/).filter(Boolean).length,
  cells: [...(sp.dataset.scr || '')].filter(c => c !== ' ' && c !== '\n').length,
  onScreenWidth: Math.round(sp.getBoundingClientRect().width),
})));
console.log('spans:', JSON.stringify(spans));
ck('precondition: three horizontal script spans, all inline flows',
   spans.length === 3 && spans.every(s => s.flow === 'ltr' || s.flow === 'rtl'), JSON.stringify(spans.map(s => s.flow)));

const buf = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/inline.pdf`, buf);
const { runs } = parse(buf);
for(const id of ids){
  const r = runs.filter(x => x.lang === id);
  if(!r.length){ ck(`${id}: painted at all`, false); continue; }
  const maxEnd = Math.max(...r.map(x => x.end));
  const pastMargin = r.filter(x => x.end > P.w - P.m + 1);
  const offPaper = r.filter(x => x.x > P.w);
  console.log(`   ${id}: ${r.length} word-runs, x ${Math.min(...r.map(x=>x.x)).toFixed(1)}..${maxEnd.toFixed(1)}, ` +
              `past margin ${pastMargin.length}, off the MediaBox ${offPaper.length}`);
  ck(`${id}: an ordinary translated sentence stays inside the right margin`,
     pastMargin.length === 0, `rightmost ink ends at ${maxEnd.toFixed(2)}, right margin ${P.w - P.m}, ${pastMargin.length}/${r.length} word-runs past it`);
  ck(`${id}: none of the sentence is painted outside the MediaBox`,
     maxEnd <= P.w, `rightmost ink ends at ${maxEnd.toFixed(2)}, page width ${P.w}`);
}

/* ---- B: how short a sentence already loses ink? ---- */
await page.click('#ed-back'); await wait(page, 700);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 800);
await page.click('#ed-title'); await page.keyboard.type('Threshold');
await page.click('#ed-content');
const UNIT = ['the', 'sea', 'remembers', 'the', 'old', 'king', 'and', 'the', 'stone', 'gate', 'is', 'open', 'in', 'winter', 'water', 'light', 'north', 'fire', 'night', 'name'];
const lines = [];
for(let n = 4; n <= 16; n += 2){ lines.push(UNIT.slice(0, n).join(' ')); }
for(let i = 0; i < lines.length; i++){ if(i) await page.keyboard.press('Enter'); await page.keyboard.type(lines[i]); }
await wait(page, 600);
for(const l of lines){
  await insertTranslationSpan(page, l, nameOf('kerrackian'));
  await wait(page, 1100);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 250);
}
const buf2 = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('scene'))));
await writeFile(`${OUT}/threshold.pdf`, buf2);
const r2 = parse(buf2).runs.filter(x => x.lang === 'kerrackian');
// group runs by baseline y = one laid line
const byLine = {};
for(const r of r2) (byLine[r.y.toFixed(2)] = byLine[r.y.toFixed(2)] || []).push(r);
const rows = Object.entries(byLine).map(([y, v]) => ({ y: +y, n: v.length, end: Math.max(...v.map(z => z.end)) }))
                    .sort((a, b) => b.y - a.y);
rows.forEach(r => console.log(`   line y=${r.y} words=${r.n} rightmost ink ${r.end.toFixed(1)} ${r.end > P.w - P.m ? '<-- past margin' : ''}${r.end > P.w ? ' OFF PAPER' : ''}`));
const firstBad = rows.find(r => r.end > P.w - P.m);
ck('B: no ordinary-length translated sentence spills past the right margin',
   !firstBad, firstBad ? `a ${firstBad.n}-word line already ends at ${firstBad.end.toFixed(1)} (margin ${P.w - P.m})` : '');
ck('B: no ordinary-length translated sentence is painted off the paper',
   !rows.some(r => r.end > P.w), `worst line ends at ${Math.max(...rows.map(r => r.end)).toFixed(1)} of ${P.w}`);

/* ---- C: the same spans reflow correctly on screen ---- */
const screenOk = spans.every(s => s.onScreenWidth <= 400);
ck('C: the same spans fit the screen column, so this is a PDF-only loss',
   screenOk, JSON.stringify(spans.map(s => s.onScreenWidth)));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b INLINE SCRIPT OVERFLOW', checks.every(c => c[1]));
await browser.close();
await srv.close();
