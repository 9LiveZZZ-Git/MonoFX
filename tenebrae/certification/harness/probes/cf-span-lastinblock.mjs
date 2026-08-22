// cf-span-lastinblock — TX-8 / TX-9: removing or reverting a span that is the
// LAST RENDERED THING in its block.
//
// Found by the refuter on tx-vp-span-lifecycle. Chromium's editing commands
// need a rendered caret position after an atomic contenteditable="false" box.
// When there is none the selection canonicalises away: execCommand('delete')
// does nothing and STILL RETURNS TRUE, or insertHTML lands at the collapsed
// caret and duplicates the paragraph. The app used to read that return value as
// success, so its own fallback never fired.
//
// The state is reachable two ways, and only the first was ever covered:
//   A. translate a phrase that ENDS a block (padPlan decides the pad up front)
//   B. translate mid-sentence, then BACKSPACE away the words that followed —
//      the span becomes last in its block long after it was placed, so nothing
//      decided at insert time can help. This case was broken at 036f133 too;
//      the certified baseline never tested it.
// Everything here is typed through the keyboard. No injected DOM.
// Run: cd probes && node cf-span-lastinblock.mjs
import { launch, wait, createBook, selectWord, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Last In Block');
await wait(page, 3500);

const text = () => page.evaluate(() => document.querySelector('#ed-content').textContent || '');
const html = () => page.evaluate(() => document.querySelector('#ed-content').innerHTML);
const spans = () => page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length);

async function typeScene(line){
  await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = ''; ed.focus(); });
  await wait(page, 250);
  await page.click('#ed-content');
  await page.keyboard.type('opening line');
  await page.keyboard.press('Enter');
  await page.keyboard.type(line);
  await wait(page, 500);
}
async function translate(phrase, tongue){
  await selectWord(page, phrase);
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode, el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(page, 400);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: tongue }).click();
  await wait(page, 1500);
}
async function sheet(label){
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 900);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1300);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 400);
}
// backspace N times from the end of the scene
async function trimTail(n){
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  for(let i = 0; i < n; i++) await page.keyboard.press('Backspace');
  await wait(page, 500);
}

for(const C of [
  { id: 'A remove, span ends the block',  line: 'She said the sea remembers', trim: 0,  act: 'Remove span',           tongue: 'Celan High' },
  { id: 'A revert, span ends the block',  line: 'She said the sea remembers', trim: 0,  act: 'Revert to plain text',  tongue: 'Celan High' },
  { id: 'A remove, trailing space',       line: 'She said the sea remembers ', trim: 0, act: 'Remove span',           tongue: 'Kildaren' },
  { id: 'B remove, tail typed then cut',  line: 'She said the sea remembers today', trim: 6, act: 'Remove span',      tongue: 'Kildaren' },
  { id: 'B revert, tail typed then cut',  line: 'She said the sea remembers today', trim: 6, act: 'Revert to plain text', tongue: 'Evernessian' },
]){
  console.log('\n=== ' + C.id);
  await typeScene(C.line);
  const before = await text();
  await translate('the sea remembers', C.tongue);
  if(!(await spans())){ ck(C.id + ': span was created', false, await html()); continue; }
  if(C.trim) await trimTail(C.trim);
  const mid = await text();
  console.log('    before :', JSON.stringify(show(before)));
  console.log('    armed  :', JSON.stringify(show(mid)));
  await sheet(C.act);
  const after = await text();
  const h = await html();
  console.log('    after  :', JSON.stringify(show(after)));

  ck(C.id + ': the span is gone', (await spans()) === 0, show(h).slice(0, 260));
  // the author's prose, with the span's own text taken out and (for revert) the
  // English put back — never duplicated, never partly eaten
  const head = before.slice(0, before.indexOf('the sea remembers'));
  const tail = C.trim ? '' : before.slice(before.indexOf('the sea remembers') + 'the sea remembers'.length);
  const want = C.act === 'Remove span' ? (head + tail) : (head + 'the sea remembers' + tail);
  const norm = t => String(t).replace(/[\s ]+/g, ' ').replace(/\s+$/, '');
  ck(C.id + ': the block reads exactly what the author has left',
     norm(after) === norm(want), 'got ' + JSON.stringify(show(after)) + '  want ' + JSON.stringify(show(want)));
  ck(C.id + ': the prose is not duplicated',
     (after.match(/She said/g) || []).length === 1, (after.match(/She said/g) || []).length);
  ck(C.id + ': no raw script left in the prose', !/[-]/.test(after), show(after));
}

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('SPAN LAST IN BLOCK', checks.every(c => c[1]) && errors.length === 0);
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
