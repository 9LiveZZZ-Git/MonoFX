// cf-loop-realui — TX-8 / TX-11d: the same two defects cf-loop-sheet-inplace and
// cf-loop-repair-residue found, reproduced on a document built ENTIRELY through
// the real UI — typed prose, the toolbar's bold button, the Aa panel's H2 — so
// nothing here depends on a probe-injected DOM.
//
//   1. translate a bold phrase that ends a heading  -> span lands inside <b> in
//      the <h2> (TX-11d's promise, kept)
//   2. change its tongue from the tap sheet          -> is it still bold?
//   3. remove the span                               -> is the heading the
//                                                       author's line again?
//
// Run: cd probes && node cf-loop-realui.mjs
import { launch, wait, createBook, selectWord, caretIn, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 380)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Real UI Loop');
await wait(page, 3500);

// --- type a scene, then style it with the toolbar -----------------------
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('a the old king');
await wait(page, 400);
await selectWord(page, 'the old king');
await page.click('[data-cmd="bold"]');
await wait(page, 350);
await page.click('#fb-aa');
await wait(page, 300);
await caretIn(page, 'old');
await page.click('#aa-panel [data-block="h2"]');
await wait(page, 400);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const built = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
console.log('built by the toolbar:', built);
ck('setup: the toolbar produced a bold run at the end of a heading',
   /<h2[^>]*>[^<]*<b>the old king<\/b><\/h2>/i.test(built), built);
const before = await page.evaluate(() => {
  const h = document.querySelector('#ed-content h2');
  return { h2: h ? h.textContent : null, html: document.querySelector('#ed-content').innerHTML };
});

// --- 1. translate it ----------------------------------------------------
await selectWord(page, 'the old king');
await page.evaluate(() => {
  const sel = getSelection();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const a = sel.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Kildaren' }).click();
await wait(page, 1600);

const info = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const s = ed.querySelector('.tspan');
  const h = ed.querySelector('h2');
  if(!s) return { none: true, h2: h ? h.textContent : null, html: ed.innerHTML };
  const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
  return { chain: c.join('>'), lang: s.dataset.lang, src: s.dataset.src, pad: s.dataset.pad ?? null,
           bold: !!s.closest('b,strong'),
           weight: getComputedStyle(s).fontWeight,
           h2: h ? h.textContent : null, html: ed.innerHTML };
});
const ins = await info();
console.log('\nafter translate :', ins.chain, 'bold=' + ins.bold, 'weight=' + ins.weight);
console.log('   ', show(ins.html).slice(0, 240));
ck('1: the span landed inside the bold run inside the heading',
   !ins.none && ins.chain.indexOf('B') > -1 && ins.chain.indexOf('H2') > -1, ins.chain);
ck('1: and it renders bold', !ins.none && ins.bold && +ins.weight >= 600, ins.weight);

// --- 2. change tongue from the tap sheet --------------------------------
await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
await wait(page, 800);
await page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click();
await wait(page, 1700);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
const ct = await info();
console.log('\nafter change tongue :', ct.chain, 'bold=' + ct.bold, 'weight=' + ct.weight);
console.log('   ', show(ct.html).slice(0, 240));
ck('2: change tongue kept the span inside its heading', !ct.none && ct.chain.indexOf('H2') > -1, ct.chain);
ck('2: change tongue kept the author’s BOLD run', !ct.none && ct.bold, ct.chain + ' weight=' + (ct.weight || ''));

// --- 3. remove the span -------------------------------------------------
await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Remove span' }).click();
await wait(page, 1300);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
const rm = await info();
console.log('\nafter remove :', JSON.stringify(show(rm.h2)), ' expected', JSON.stringify(show(before.h2.replace('the old king', ''))));
ck('3: removing the span leaves the heading as the author’s own line',
   rm.h2 === before.h2.replace('the old king', ''),
   'now ' + JSON.stringify(show(rm.h2)) + ' expected ' + JSON.stringify(show(before.h2.replace('the old king', ''))));

ck('no page exception in the real-UI loop', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('REAL-UI LOOP', checks.every(c => c[1]));
await browser.close(); await srv.close();
