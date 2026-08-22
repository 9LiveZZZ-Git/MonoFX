// cf-loop-repair-residue — TX-9 / TX-11d: how much does a REPAIRED placement
// leave behind when the author changes their mind, and does it accumulate?
//
// cf-loop-undo-repair showed two things on a placement that needed repair
// (selection running to the end of a bold run inside a heading):
//   * undo restores the TEXT exactly but leaves the empty mark wrapper the
//     repair built (<b></b>) in the document — the repair is raw DOM, so the
//     browser's undo stack never saw it;
//   * remove-span leaves one extra space, because the repair moves the pad out
//     of `live.nextSibling` before the pad-ownership rule reads it, so
//     data-pad is never set and rangeAround(el, true) has nothing to absorb.
// This probe measures both across REPEATED cycles — the thing an author who
// keeps changing their mind actually does — and checks what reaches storage and
// the exported prose.
//
// Run: cd probes && node cf-loop-repair-residue.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 380)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Residue Book');
await wait(page, 3500);

const focusEd = () => page.evaluate(() => document.querySelector('#ed-content').focus());
const undo = async () => { await focusEd(); await page.keyboard.press('Control+z'); await wait(page, 500); };
async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 300);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  }, html);
  await wait(page, 1200);
}
const applySel = (spec) => page.evaluate(s => {
  const ed = document.querySelector('#ed-content');
  const r = document.createRange();
  if(s.all){ const el = ed.querySelector(s.all); if(!el) return 'no element'; r.selectNodeContents(el); }
  else{
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, done = false;
    while((n = w.nextNode())){ const i = n.nodeValue.indexOf(s.text);
      if(i > -1){ r.setStart(n, i); r.setEnd(n, i + s.text.length); done = true; break; } }
    if(!done) return 'text not found';
  }
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return 'ok';
}, spec);
async function translateVia(label){
  const ok = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
    return true;
  });
  if(!ok) return false;
  await wait(page, 320);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 650);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1400);
  return true;
}
async function sheetAction(label){
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 850);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1100);
  await closeSheets();
}
const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const empties = [...ed.querySelectorAll('b,i,u,s,strike,del,strong,em')].filter(e => e.textContent === '').map(e => e.tagName);
  return { html: ed.innerHTML, text: ed.textContent, empties,
           doc: window.tenebrae._omni.probe.sceneDoc(),
           spans: ed.querySelectorAll('.tspan').length };
});
// the app's own plain-text compile of the scene, as the author would export it
const plainExport = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const t = document.createElement('template');
  t.innerHTML = window.tenebrae._omni.probe.sceneDoc() || ed.innerHTML;
  return t.content.textContent;
});

const SHAPE = '<h2>a <b id="sel">the old king</b></h2><p>tail</p>';
const SEL = { all: '#sel' };

/* ===== A — insert / undo, five times ===== */
await setDoc(SHAPE);
const base = await snap();
console.log('\n=== A: insert -> undo, x5   base:', show(base.html));
const aRows = [];
for(let i = 1; i <= 5; i++){
  await applySel(SEL);
  const made = await translateVia('Kildaren');
  await undo();
  const s = await snap();
  aRows.push({ i, spans: s.spans, empties: s.empties.length, textOK: s.text === base.text, len: s.html.length });
  console.log(`  cycle ${i}: made=${made} spans=${s.spans} emptyMarks=${s.empties.length} textSame=${s.text === base.text} html=${show(s.html).slice(0, 150)}`);
}
ck('A: the author’s text is unchanged after every insert/undo cycle', aRows.every(r => r.textOK), JSON.stringify(aRows));
ck('A: no span is left behind by any cycle', aRows.every(r => r.spans === 0), JSON.stringify(aRows));
ck('A: undo leaves no empty mark wrapper behind (repair is undone too)',
   aRows.every(r => r.empties === base.empties.length), JSON.stringify(aRows.map(r => r.empties)));
ck('A: residue does not ACCUMULATE cycle over cycle',
   aRows[aRows.length - 1].empties <= aRows[0].empties, JSON.stringify(aRows.map(r => r.empties)));
{
  const s = await snap();
  ck('A: the persisted doc carries no empty mark wrappers either',
     !/<(b|i|u|s|strong|em|del|strike)><\/\1>/i.test(s.doc || ''), show(s.doc || ''));
  const p = await plainExport();
  ck('A: the exported prose is exactly the author’s line', p === base.text, show(p) + ' vs ' + show(base.text));
}

/* ===== B — insert / revert-to-plain, five times ===== */
await setDoc(SHAPE);
const bBase = await snap();
console.log('\n=== B: insert -> revert to plain text, x5   base text:', show(bBase.text));
const bRows = [];
for(let i = 1; i <= 5; i++){
  // by TEXT, not by the #sel element: a revert rewrites the block in one
  // command, so the author's words come back inside a bold run but not inside
  // the same <b> node they left. Element identity is not the contract; the
  // characters and the formatting are.
  await applySel({ text: 'the old king' });
  const made = await translateVia('Kildaren');
  if(!made){ bRows.push({ i, fail: 'no span' }); break; }
  await sheetAction('Revert to plain text');
  const s = await snap();
  bRows.push({ i, spans: s.spans, text: s.text, same: s.text === bBase.text });
  console.log(`  cycle ${i}: spans=${s.spans} same=${s.text === bBase.text} text=${show(s.text)}`);
}
ck('B: revert hands back the author’s line CODEPOINT for CODEPOINT, every cycle',
   bRows.every(r => r.same), JSON.stringify(bRows.map(r => r.text && show(r.text))));
ck('B: whitespace does not drift across repeated revert cycles',
   bRows.length && bRows[bRows.length - 1].text === bRows[0].text,
   JSON.stringify(bRows.map(r => r.text && show(r.text))));

/* ===== C — insert / remove-span, five times ===== */
await setDoc(SHAPE);
const cBase = await snap();
const cGone = cBase.text.replace('the old king', '');
console.log('\n=== C: insert -> remove span, x5   expected after removal:', show(cGone));
const cRows = [];
for(let i = 1; i <= 5; i++){
  await applySel(SEL);
  const made = await translateVia('Kildaren');
  if(!made){ cRows.push({ i, fail: 'no span' }); break; }
  await sheetAction('Remove span');
  const s = await snap();
  cRows.push({ i, spans: s.spans, text: s.text });
  console.log(`  cycle ${i}: spans=${s.spans} text=${show(s.text)}`);
  // put the words back for the next cycle
  await setDoc(SHAPE);
}
ck('C: remove takes the span and its pad, nothing of the author’s',
   cRows.every(r => r.text === cGone), JSON.stringify(cRows.map(r => r.text && show(r.text))) + '  expected ' + show(cGone));

/* ===== D — redo rebuilds the repaired placement ===== */
await setDoc(SHAPE);
await applySel(SEL);
await translateVia('Kildaren');
const dIns = await page.evaluate(() => {
  const s = document.querySelector('#ed-content .tspan');
  const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
  return { chain: c.join('>'), pad: s.dataset.pad ?? null, text: document.querySelector('#ed-content').textContent };
});
await undo();
await focusEd(); await page.keyboard.press('Control+Shift+z'); await wait(page, 700);
const dRe = await page.evaluate(() => {
  const s = document.querySelector('#ed-content .tspan');
  if(!s) return null;
  const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
  return { chain: c.join('>'), pad: s.dataset.pad ?? null, text: document.querySelector('#ed-content').textContent };
});
console.log('\n=== D: redo   inserted=' + JSON.stringify(dIns.chain) + '  redone=' + JSON.stringify(dRe && dRe.chain));
ck('D: redo puts the span back', !!dRe, 'no span after redo');
ck('D: redo keeps the span inside its heading', !!dRe && dRe.chain.indexOf('H2') > -1, dRe && dRe.chain);
ck('D: redo keeps the bold run it replaced', !!dRe && dRe.chain.indexOf('B') > -1, dRe && dRe.chain);
ck('D: redo reproduces the inserted document exactly', !!dRe && dRe.text === dIns.text,
   dRe && (show(dIns.text) + ' vs ' + show(dRe.text)));

ck('no page exception across the residue suite', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LOOP REPAIR RESIDUE', checks.every(c => c[1]));
await browser.close(); await srv.close();
