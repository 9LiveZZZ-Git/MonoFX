// cf-adv-loop-blockstart — ADVERSARY probe for TX-11d ("a span lands where the
// author put it") and TX-8 ("revert restores the exact English").
//
// Every existing loop probe selects a phrase in the MIDDLE of a block, or a
// whole block, or a run that reaches the block's END. Nobody selects a phrase
// that starts at the block's very FIRST character and stops short of its end —
// the mirror image of the hoist case the repair was written for.
//
// placeTSpan remembers hostBlock and, if insertHTML drops the span outside it,
// puts it back with hostBlock.appendChild(live) — the END of the block. That is
// the right home only when the selection ran to the block's end. This probe
// asks where the span actually lands, and what the author's line reads as
// afterwards, for a leading selection in a paragraph, a heading, a blockquote
// and a list item — then reverts and asks for the line back.
//
// Run: cd probes && node cf-adv-loop-blockstart.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 460)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Block Start');
await wait(page, 3500);

async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 320);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); ed.focus();
  }, html);
  await wait(page, 350);
}
// select the first `len` characters of the block matching `sel`
const selHead = (selector, len) => page.evaluate(([q, n]) => {
  const el = document.querySelector('#ed-content ' + q);
  if(!el) return 'no block';
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const t = w.nextNode();
  if(!t) return 'no text';
  const r = document.createRange();
  r.setStart(t, 0); r.setEnd(t, n);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  return r.toString();
}, [selector, len]);

async function translateVia(label){
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(page, 350);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  await closeSheets();
}
async function sheetAction(label){
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 900);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1300);
  await closeSheets();
}
const read = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const s = ed.querySelector('.tspan');
  let pos = null, sibs = null, blockText = null;
  if(s && s.parentElement){
    const kids = [...s.parentElement.childNodes];
    pos = kids.indexOf(s);
    sibs = kids.length;
    blockText = s.parentElement.textContent;
  }
  return { html: ed.innerHTML, text: ed.textContent,
    count: ed.querySelectorAll('.tspan').length,
    pos, sibs, blockText,
    src: s ? s.dataset.src : null, pad: s ? (s.dataset.pad ?? null) : null,
    parent: s && s.parentElement ? s.parentElement.tagName : null };
});

const CASES = [
  { id: 'S1 head of the first paragraph', q: 'p', lang: 'Kildaren',
    html: '<p>the sea remembers at the gate</p>', phrase: 'the sea remembers' },
  { id: 'S2 head of a later paragraph', q: 'p:nth-of-type(2)', lang: 'Kildaren',
    html: '<p>first line</p><p>the sea remembers at the gate</p>', phrase: 'the sea remembers' },
  { id: 'S3 head of a heading', q: 'h2', lang: 'Celan High',
    html: '<h2>the old king walks alone</h2><p>tail</p>', phrase: 'the old king' },
  { id: 'S4 head of a blockquote', q: 'blockquote', lang: 'Evernessian',
    html: '<blockquote>the sea remembers at the gate</blockquote><p>tail</p>', phrase: 'the sea remembers' },
  { id: 'S5 head of a list item', q: 'li', lang: 'Kerrackian',
    html: '<ul><li>the drover walks by night</li><li>second item</li></ul>', phrase: 'the drover walks' },
];

for(const c of CASES){
  console.log('\n=== ' + c.id);
  await setDoc(c.html);
  const before = await page.evaluate(q => document.querySelector('#ed-content ' + q).textContent, c.q);
  const got = await selHead(c.q, c.phrase.length);
  ck(c.id + ': the leading selection is the phrase', got === c.phrase, JSON.stringify(got));
  await translateVia(c.lang);
  const d = await read();
  console.log('    block before  :', show(before));
  console.log('    after translate:', show(d.text));
  console.log('    html          :', show(d.html).slice(0, 300));
  console.log(`    span at child index ${d.pos} of ${d.sibs} in <${d.parent}>  pad=${d.pad}`);
  ck(c.id + ': a span was created', d.count === 1, d.count);
  if(!d.count) continue;
  // the author put the translation FIRST in the line: the script must come
  // before the English that followed it, not after it
  const tail = before.slice(c.phrase.length).trim();      // what followed the selection
  const blockNow = (d.blockText || '').replace(/[\s ]+/g, ' ').trim();
  const puaFirst = [...blockNow].findIndex(ch => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF);
  const tailAt = blockNow.indexOf(tail);
  ck(c.id + ': the span reads where the author put it — before the words that followed it',
     puaFirst > -1 && tailAt > -1 && puaFirst < tailAt,
     `script starts at ${puaFirst}, the author's "${tail}" at ${tailAt} in ${show(blockNow)}`);
  ck(c.id + ': the span is still inside the author\'s block', d.parent === c.q.replace(/:.*/, '').toUpperCase(), d.parent);

  await sheetAction('Revert to plain text');
  const r = await read();
  console.log('    after revert  :', show(r.text));
  ck(c.id + ': revert leaves no span behind', r.count === 0, r.count + ' — ' + show(r.html).slice(0, 200));
  ck(c.id + ': revert gives the author\'s line back CODEPOINT for CODEPOINT',
     r.text.indexOf(before) > -1 && r.count === 0, 'got=' + show(r.text) + '  want to contain=' + show(before));
}

ck('no page exception anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LEADING SELECTION PLACEMENT', checks.every(c => c[1]));
await browser.close(); await srv.close();
