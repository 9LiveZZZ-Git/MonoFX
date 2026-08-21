// cf-adv-loop-residue-real — ADVERSARY re-test of the two TX-9 defects another
// agent reported, on a document built ENTIRELY through the real UI (typed
// prose, the toolbar's bold button) rather than assigned innerHTML. A probe
// that seeds its own markup can produce structures Chromium would never build,
// so a defect only ever seen that way has to be re-earned.
//
// A: five translate/undo cycles on a phrase the author bolded with the toolbar.
//    The claim: undo does not reverse placeTSpan's raw-DOM mark rebuild, so one
//    empty <b> is left behind per cycle and reaches storage.
// B: a span inserted directly before a comma, where the pad-ownership rule
//    DELETES the NBSP insertHTML wrote. The claim: redo replays only the
//    insertHTML, so the NBSP comes back and the author gets "king , and".
//
// Run: cd probes && node cf-adv-loop-residue-real.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');
const hex = t => [...String(t)].map(c => c.charCodeAt(0).toString(16)).join(' ');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Residue Real');
await wait(page, 3500);

const focusEd = () => page.evaluate(() => document.querySelector('#ed-content').focus());
const undo = async () => { await focusEd(); await page.keyboard.press('Control+z'); await wait(page, 550); };
const redo = async () => { await focusEd(); await page.keyboard.press('Control+Shift+z'); await wait(page, 550); };
async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 300);
}
const selWord = (t) => page.evaluate(s => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    const i = n.nodeValue.indexOf(s);
    if(i > -1){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + s.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return 'ok'; }
  }
  return 'not found';
}, t);
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
const read = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return { html: ed.innerHTML, text: ed.textContent, spans: ed.querySelectorAll('.tspan').length,
    emptyMarks: [...ed.querySelectorAll('b,i,u,s,strong,em')].filter(e => !e.textContent.length).length };
});
const saved = () => page.evaluate(() => {
  const d = window.tenebrae._omni.probe.sceneDoc();
  return d ? String(d) : null;
});

/* ================= A: five translate/undo cycles on a toolbar-bolded run ===== */
console.log('\n=== A translate/undo cycles on an author-bolded run (real toolbar)');
await page.click('#ed-title');
await page.keyboard.type('Residue');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('and the sea remembers now');
await wait(page, 400);
await selWord('the sea remembers');
await page.click('[data-cmd="bold"]');
await wait(page, 400);
const base = await read();
console.log('    base html:', show(base.html));
ck('A: the toolbar really bolded the phrase', /<b>|<strong>/i.test(base.html), show(base.html).slice(0, 200));
ck('A: no empty marks to begin with', base.emptyMarks === 0, base.emptyMarks);

const counts = [];
for(let i = 1; i <= 5; i++){
  await selWord('the sea remembers');
  await translateVia('Kildaren');
  const ins = await read();
  await undo();
  const und = await read();
  counts.push(und.emptyMarks);
  console.log(`    cycle ${i}: after insert spans=${ins.spans}, after undo spans=${und.spans} emptyMarks=${und.emptyMarks} text=${show(und.text)}`);
  ck(`A cycle ${i}: undo restores the author's text exactly`, und.text === base.text,
     'got=' + show(und.text) + '  want=' + show(base.text));
  ck(`A cycle ${i}: undo leaves no span`, und.spans === 0, und.spans);
}
console.log('    empty marks after each cycle:', JSON.stringify(counts));
ck('A: undo leaves no empty mark wrappers behind', counts.every(c => c === 0), JSON.stringify(counts));
ck('A: and whatever it leaves does not ACCUMULATE cycle over cycle',
   counts.every(c => c === counts[0]), JSON.stringify(counts));
await wait(page, 1400);
const doc = await saved();
console.log('    saved doc:', show(String(doc)));
ck('A: the persisted doc carries no empty mark wrappers either',
   !!doc && !/<(b|i|u|strong|em)><\/(b|i|u|strong|em)>/.test(doc), show(String(doc)).slice(0, 240));

/* ================= B: redo across the pad rule (span before a comma) ======== */
console.log('\n=== B redo of an insert whose pad the rule deleted');
await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = ''; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); });
await wait(page, 600);
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('where the old king, and waits');
await wait(page, 500);
const bBase = await read();
await selWord('the old king');
await translateVia('Kildaren');
const inserted = await read();
console.log('    inserted:', show(inserted.text));
ck('B: the pad rule left no gap before the comma',
   inserted.text.indexOf(' ,') === -1, hex(inserted.text.slice(-24)));
await undo();
const undone = await read();
console.log('    undone  :', show(undone.text));
ck('B: undo gives the author\'s line back exactly', undone.text === bBase.text,
   'got=' + show(undone.text) + '  want=' + show(bBase.text));
await redo();
const redone = await read();
console.log('    redone  :', show(redone.text));
console.log('    inserted hex:', hex(inserted.text.slice(-20)));
console.log('    redone   hex:', hex(redone.text.slice(-20)));
ck('B: redo reproduces the insert CODEPOINT for CODEPOINT', redone.text === inserted.text,
   'got=' + show(redone.text) + '  want=' + show(inserted.text));
ck('B: redo does not put a gap back before the comma', redone.text.indexOf(' ,') === -1,
   hex(redone.text.slice(-24)));

ck('no page exception anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('UNDO RESIDUE, REAL UI', checks.every(c => c[1]));
await browser.close(); await srv.close();
