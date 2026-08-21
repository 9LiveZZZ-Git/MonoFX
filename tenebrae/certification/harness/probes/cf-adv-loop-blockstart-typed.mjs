// cf-adv-loop-blockstart-typed — the leading-selection defect, re-earned on a
// document the author TYPED, so it cannot be blamed on a probe that assigned
// its own innerHTML. TX-11d / TX-8.
//
// The author types a paragraph, highlights the phrase it OPENS with, and asks
// for a translation. Where does the translation land, and what does the line
// read as afterwards?
//
// Run: cd probes && node cf-adv-loop-blockstart-typed.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 460)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Typed Head');
await wait(page, 3500);

await page.click('#ed-title');
await page.keyboard.type('Head Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers at the gate');
await wait(page, 600);

const base = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const p = ed.querySelector('p:last-of-type') || ed.lastElementChild;
  return { html: ed.innerHTML, block: p ? p.textContent : null };
});
console.log('typed:', show(base.html));
ck('the typed line is a block of its own', base.block === 'the sea remembers at the gate', show(String(base.block)));

// highlight the phrase the paragraph opens with
const sel = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const blocks = [...ed.querySelectorAll('p,div,h2,h3,blockquote,li')];
  const p = blocks.find(b => b.textContent.indexOf('the sea remembers at the gate') === 0);
  if(!p) return 'no block';
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const t = w.nextNode();
  const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 'the sea remembers'.length);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  return r.toString();
});
ck('the highlight is the opening phrase', sel === 'the sea remembers', JSON.stringify(sel));

await page.evaluate(() => {
  const s = getSelection();
  const r = s.getRangeAt(0).getBoundingClientRect();
  const a = s.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Kildaren' }).click();
await wait(page, 1600);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const d = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const s = ed.querySelector('.tspan');
  const blk = s ? s.parentElement : null;
  const kids = blk ? [...blk.childNodes] : [];
  return { html: ed.innerHTML, spans: ed.querySelectorAll('.tspan').length,
    blockText: blk ? blk.textContent : null, idx: blk ? kids.indexOf(s) : -1, kids: kids.length,
    tail: blk ? blk.textContent.indexOf('at the gate') : -1,
    firstPua: blk ? [...blk.textContent].findIndex(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF) : -1 };
});
console.log('after translate:', show(d.html));
console.log(`  block text: ${show(String(d.blockText))}  span at child ${d.idx}/${d.kids}  "at the gate" at ${d.tail}  script starts at ${d.firstPua}`);
ck('a span was made', d.spans === 1, d.spans);
ck('the translation reads where the author put it — ahead of the words that followed it',
   d.firstPua > -1 && d.tail > -1 && d.firstPua < d.tail,
   `script at ${d.firstPua}, the author's "at the gate" at ${d.tail} in ${show(String(d.blockText))}`);

// and now revert
await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
await wait(page, 1300);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
const r = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return { html: ed.innerHTML, text: ed.textContent, spans: ed.querySelectorAll('.tspan').length,
    pua: [...ed.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length };
});
console.log('after revert:', show(r.html));
ck('revert leaves no span behind', r.spans === 0, r.spans + ' — ' + show(r.html));
ck('revert leaves no script behind', r.pua === 0, r.pua);
ck('revert gives the author\'s paragraph back', r.text.indexOf('the sea remembers at the gate') > -1,
   show(r.text));

ck('no page exception', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('TYPED LEADING SELECTION', checks.every(c => c[1]));
await browser.close(); await srv.close();
