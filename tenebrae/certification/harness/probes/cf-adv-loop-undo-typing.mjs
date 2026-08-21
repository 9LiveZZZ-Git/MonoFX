// cf-adv-loop-undo-typing — ADVERSARY probe for TX-9: "every span operation is
// undoable and redoable, INCLUDING MIXED SEQUENCES INTERLEAVED WITH TYPING".
//
// cf-loop-undo-repair drives undo/redo on a document built with innerHTML and
// never types a character between the span operations. The clause the standard
// spells out — typing, translating, typing again, then walking the undo stack
// back through all of it — has no probe at all. That is the sequence a real
// author produces, and it is where a raw-DOM repair that the undo stack does
// not own is most likely to eat a keystroke.
//
// Part A: type a line, translate part of it, type more, then Ctrl+Z back to the
//         empty scene one step at a time, watching for a keystroke that never
//         comes back or a span that will not go away.
// Part B: the same, with two translations and typing between them.
// Part C: after the whole undo walk, does what the app SAVES match what the
//         editor shows? (An undo that leaves DOM behind reaches storage.)
//
// Run: cd probes && node cf-adv-loop-undo-typing.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Undo Typing');
await wait(page, 3500);

const focusEd = () => page.evaluate(() => document.querySelector('#ed-content').focus());
const undo = async () => { await focusEd(); await page.keyboard.press('Control+z'); await wait(page, 500); };
const redo = async () => { await focusEd(); await page.keyboard.press('Control+Shift+z'); await wait(page, 500); };
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
  return { html: ed.innerHTML, text: ed.textContent,
    spans: ed.querySelectorAll('.tspan').length,
    empties: [...ed.querySelectorAll('b,i,u,s,strong,em')].filter(e => !e.textContent.length).length,
    pua: [...ed.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length };
});
const caretEnd = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});

/* ---------- Part A: type, translate, type, then undo it all ---------- */
console.log('\n=== A type -> translate -> type -> undo walk');
await page.click('#ed-content');
await page.keyboard.type('the gate the sea remembers closed');
await wait(page, 700);
const typed = await read();
console.log('    typed  :', show(typed.text));
ck('A: the typed line is there', typed.text.indexOf('the sea remembers') > -1, show(typed.text));

ck('A: selection made', (await selWord('the sea remembers')) === 'ok');
await translateVia('Kildaren');
const afterT = await read();
console.log('    after translate:', show(afterT.text));
ck('A: the translation landed', afterT.spans === 1 && afterT.pua > 0, JSON.stringify([afterT.spans, afterT.pua]));

await caretEnd();
await page.keyboard.type(' and again');
await wait(page, 700);
const afterType2 = await read();
console.log('    after more typing:', show(afterType2.text));
ck('A: typing after a translation works', afterType2.text.indexOf('and again') > -1 && afterType2.spans === 1,
   show(afterType2.text));

// walk the undo stack back, one press at a time
const stages = [];
for(let i = 0; i < 14; i++){
  await undo();
  const d = await read();
  stages.push({ i, text: d.text, spans: d.spans, pua: d.pua, empties: d.empties });
  if(!d.text.trim() && !d.spans) break;
}
console.log('    undo stages:');
for(const s of stages) console.log(`      ${s.i}: spans=${s.spans} pua=${s.pua} empties=${s.empties} text=${show(s.text)}`);

const reachedTyped = stages.find(s => s.spans === 0 && s.pua === 0 && s.text === typed.text);
ck('A: somewhere in the undo walk the author\'s typed line comes back EXACTLY, with no span and no script',
   !!reachedTyped, JSON.stringify(stages.map(s => [s.spans, s.pua, show(s.text)]).slice(0, 6)));
const last = stages[stages.length - 1];
ck('A: the undo walk ends with an empty scene, not a stranded span',
   last.spans === 0 && last.pua === 0 && !last.text.trim(), JSON.stringify([last.spans, last.pua, show(last.text)]));
ck('A: no script is ever stranded in the prose while the span is gone',
   stages.every(s => s.spans > 0 || s.pua === 0), JSON.stringify(stages.map(s => [s.spans, s.pua])));

/* ---------- Part B: two translations with typing between them ---------- */
console.log('\n=== B two translations, typing between');
await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = ''; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); });
await wait(page, 700);
await page.click('#ed-content');
await page.keyboard.type('the old king walks');
await wait(page, 500);
await selWord('the old king');
await translateVia('Kerrackian');
await caretEnd();
await page.keyboard.type(' and the sea remembers');
await wait(page, 700);
await selWord('the sea remembers');
await translateVia('Celan High');
const two = await read();
console.log('    both in :', show(two.text));
ck('B: two spans live side by side', two.spans === 2, two.spans);

await undo();
const b1 = await read();
console.log('    undo 1  :', show(b1.text), 'spans=' + b1.spans);
ck('B: the first undo takes the SECOND translation, not the first',
   b1.spans === 1 && b1.text.indexOf('the sea remembers') > -1, JSON.stringify([b1.spans, show(b1.text)]));
await undo();
const b2 = await read();
console.log('    undo 2  :', show(b2.text), 'spans=' + b2.spans);
ck('B: the second undo takes back the typing, leaving the first translation alone',
   b2.spans === 1, JSON.stringify([b2.spans, show(b2.text)]));

// redo forward again — the standard asks for redoable, not just undoable
await redo();
const r1 = await read();
await redo();
const r2 = await read();
console.log('    redo 1  :', show(r1.text), 'spans=' + r1.spans);
console.log('    redo 2  :', show(r2.text), 'spans=' + r2.spans);
ck('B: redo rebuilds what undo took, span and all', r2.spans === two.spans && r2.text === two.text,
   'got spans=' + r2.spans + ' text=' + show(r2.text) + '  want spans=' + two.spans + ' text=' + show(two.text));

/* ---------- Part C: what gets saved after an undo walk ---------- */
console.log('\n=== C the saved doc after an undo');
await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = ''; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); });
await wait(page, 700);
await page.click('#ed-content');
await page.keyboard.type('the gate the sea remembers closed');
await wait(page, 600);
const cBefore = (await read()).html;
await selWord('the sea remembers');
await translateVia('Kildaren');
await undo();
await wait(page, 1400);
const cAfter = await read();
const saved = await page.evaluate(() => {
  const d = window.tenebrae._omni.probe.sceneDoc();
  return d ? JSON.stringify(d) : null;
});
console.log('    editor after undo :', show(cAfter.html).slice(0, 240));
console.log('    saved doc         :', show(String(saved)).slice(0, 240));
ck('C: after undo the editor holds the author\'s line and nothing else',
   cAfter.spans === 0 && cAfter.pua === 0, JSON.stringify([cAfter.spans, cAfter.pua]));
ck('C: the saved doc carries no script and no span after the undo',
   !!saved && saved.indexOf('tspan') === -1 && ![...saved].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF),
   show(String(saved)).slice(0, 200));
ck('C: the saved doc still has the author\'s words', !!saved && saved.indexOf('the sea remembers') > -1,
   show(String(saved)).slice(0, 200));

ck('no page exception anywhere in the typing/undo suite', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('UNDO INTERLEAVED WITH TYPING', checks.every(c => c[1]));
await browser.close(); await srv.close();
