// cf-adv-loop-li-leak — ADVERSARY probe: script text left in the prose OUTSIDE
// any span. TX-7 (the span is what carries the script), TX-9 (nothing trapped
// or lost) and, downstream, TX-11 (exports carry romanization, never raw PUA).
//
// placeTSpan has a fallback for the case where execCommand('insertHTML')
// "reported success but dropped the element (seen inside list items)"
// (step1.html L4023-4032): it re-inserts the span by hand at the caret. What it
// never checks is whether insertHTML kept the span's TEXT while dropping its
// element — in which case the script is now in the document twice: once as a
// bare, un-tappable PUA run with no data-src, and once as the real span.
//
// The document here is built entirely with the real toolbar (typing + the
// bullet-list button), and the selection is the head of the list item.
//
// Run: cd probes && node cf-adv-loop-li-leak.mjs
import { launch, wait, createBook, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'List Leak');
await wait(page, 3500);

await page.click('#ed-title');
await page.keyboard.type('Drover Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the drover walks by night');
await wait(page, 400);
// real toolbar: make that line a bullet
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())) if(n.nodeValue.indexOf('drover') > -1){
    const r = document.createRange(); r.setStart(n, 1); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return;
  }
});
await page.click('[data-cmd="insertUnorderedList"]');
await wait(page, 400);
const liHTML = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
console.log('list built:', show(liHTML));
ck('the toolbar really made a list item', liHTML.indexOf('<li>') > -1 || liHTML.indexOf('<li ') > -1, show(liHTML).slice(0, 200));

// select the HEAD of the list item: "the drover walks"
const sel = await page.evaluate(() => {
  const li = document.querySelector('#ed-content li');
  if(!li) return 'no li';
  const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  const t = w.nextNode();
  const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 'the drover walks'.length);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  return r.toString();
});
ck('the leading selection is the phrase', sel === 'the drover walks', JSON.stringify(sel));

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
await page.locator('#sheet .sh-item', { hasText: 'Kerrackian' }).click();
await wait(page, 1600);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const d = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  // every PUA character in the editor, and whether it sits inside a .tspan
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, inside = 0, outside = 0, strayText = '';
  while((n = w.nextNode())){
    const pua = [...n.nodeValue].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length;
    if(!pua) continue;
    if(n.parentElement && n.parentElement.closest('.tspan')) inside += pua;
    else { outside += pua; strayText += n.nodeValue; }
  }
  return { html: ed.innerHTML, text: ed.textContent, spans: ed.querySelectorAll('.tspan').length,
           inside, outside, strayText };
});
console.log('after translate html:', show(d.html));
console.log(`PUA inside spans=${d.inside}  PUA loose in the prose=${d.outside}  stray=${JSON.stringify(show(d.strayText))}`);
ck('exactly one span was created', d.spans === 1, d.spans);
ck('every script character in the document lives inside a span',
   d.outside === 0, `${d.outside} loose PUA characters: ${show(d.strayText)}`);

// and the author's own words are all still there
ck('the author\'s words survive', d.text.indexOf('by night') > -1 && d.text.indexOf('opening line') > -1, show(d.text));

// exports must never carry raw PUA (TX-11) — this is where a loose run lands
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 600);
await page.click('#bk-share');
await wait(page, 500);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
await page.click('#bk-share');
await wait(page, 500);
const txt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- md ---\n' + show(md.text) + '\n--- txt ---\n' + show(txt.text));
ck('the Markdown export carries no raw script characters', !PUA_RE.test(md.text),
   show((md.text.match(/[-]+/g) || []).join(' ')));
ck('the plain-text export carries no raw script characters', !PUA_RE.test(txt.text),
   show((txt.text.match(/[-]+/g) || []).join(' ')));

ck('no page exception', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LOOSE SCRIPT IN A LIST ITEM', checks.every(c => c[1]));
await browser.close(); await srv.close();
