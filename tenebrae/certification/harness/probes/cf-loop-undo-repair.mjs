// cf-loop-undo-repair — TX-9 / TX-11d GAP PROBE: does UNDO reverse the parts of
// a span insertion that never went through execCommand?
//
// placeTSpan does three things. Only the FIRST is on the browser's undo stack:
//   1. edApplyHTML -> execCommand('insertHTML', span + NBSP)      [undoable]
//   2. the PLACEMENT REPAIR — hostBlock.appendChild(live) and the
//      wrap.replaceWith(...) mark rebuild                          [raw DOM]
//   3. the PAD RULE — pad.remove() / pad.nodeValue = ... / trimming the
//      author's following space                                    [raw DOM]
// s2-undo-translation and tx-undo-persist only ever insert into a plain
// paragraph mid-line, where neither (2) nor (3) fires. This probe forces both
// and then compares the block CODEPOINT FOR CODEPOINT with what the author had.
//
// Also: revert-to-plain on the same three shapes must hand the author's line
// back exactly, and redo must rebuild the repaired placement.
//
// Run: cd probes && node cf-loop-undo-repair.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');
const cps = t => [...String(t)].map(c => c.codePointAt(0).toString(16)).join(' ');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Loop Undo');
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
  await wait(page, 350);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  }, html);
  await wait(page, 400);
}
const applySel = (spec) => page.evaluate(s => {
  const ed = document.querySelector('#ed-content');
  const r = document.createRange();
  if(s.all){
    const el = ed.querySelector(s.all);
    if(!el) return 'no element ' + s.all;
    r.selectNodeContents(el);
  }else{
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, done = false;
    while((n = w.nextNode())){
      const i = n.nodeValue.indexOf(s.text);
      if(i > -1){ r.setStart(n, i); r.setEnd(n, i + s.text.length); done = true; break; }
    }
    if(!done) return 'text not found: ' + s.text;
  }
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return 'ok';
}, spec);
async function translateVia(label){
  const ok = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode;
    const el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
    return true;
  });
  if(!ok) return false;
  await wait(page, 350);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  return true;
}
// snapshot: the live DOM, the sanitized form persistEditor would store, and the
// scene doc actually written to state
const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return {
    html: ed.innerHTML, text: ed.textContent,
    sane: window.tenebrae._omni.probe.sanitize(ed.innerHTML),
    doc: window.tenebrae._omni.probe.sceneDoc(),
    spans: [...ed.querySelectorAll('.tspan')].map(s => ({
      lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, pad: s.dataset.pad ?? null,
      chain: (() => { const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName); return c; })(),
      pua: [...s.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
    })),
  };
});
// open the tap sheet on the first span and run a labelled action
async function sheetAction(label){
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 900);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1200);
  await closeSheets();
}

const CASES = [
  { id: 'R1 heading, selection to block end (hoist repair)', lang: 'Kildaren',
    html: '<h2>a <b id="sel">the old king</b></h2><p>tail</p>', sel: { all: '#sel' }, repair: 'hoist+B' },
  { id: 'R2 nested b>i>u (three wrappers rebuilt)', lang: 'Celan High',
    html: '<p>and <b><i><u>the sea remembers</u></i></b> now</p>', sel: { text: 'the sea remembers' }, repair: 'B,I,U' },
  { id: 'R3 whole list item (hand-placement path)', lang: 'Kerrackian',
    html: '<ul><li id="sel">the drover walks</li><li>second item</li></ul>', sel: { all: '#sel' }, repair: 'li' },
  { id: 'P1 pad dropped before a comma', lang: 'Kildaren',
    html: '<p>She said: my mana let it stand, and the road ran on.</p>', sel: { text: 'my mana let it stand' }, repair: 'pad-removed' },
  { id: 'P2 pad merged with the author’s own space', lang: 'Evernessian',
    html: '<p>at dusk the drover walks a long road and sleeps</p>', sel: { text: 'the drover walks' }, repair: 'pad-merged' },
  { id: 'P3 pad KEPT at end of block', lang: 'Celan High',
    html: '<p>before the sea remembers</p><p>next line</p>', sel: { text: 'the sea remembers' }, repair: 'pad-kept' },
];

for(const c of CASES){
  await setDoc(c.html);
  const before = await snap();
  const s = await applySel(c.sel);
  if(s !== 'ok'){ ck(c.id + ': selection made', false, s); continue; }
  const made = await translateVia(c.lang);
  const mid = await snap();
  console.log(`\n--- ${c.id}   [${c.repair}]`);
  console.log('    before :', show(before.html).slice(0, 200));
  console.log('    after  :', show(mid.html).slice(0, 240));
  ck(c.id + ': span was placed', made && mid.spans.length === 1, JSON.stringify(mid.spans.map(x => x.chain.join('>'))));
  if(!mid.spans.length) continue;
  console.log('    pad=' + mid.spans[0].pad + '  chain=' + mid.spans[0].chain.join('>'));

  await undo();
  const after = await snap();
  console.log('    undone :', show(after.html).slice(0, 200));
  ck(c.id + ': undo leaves no span', after.spans.length === 0, JSON.stringify(after.spans));
  ck(c.id + ': undo restores the text CODEPOINT for CODEPOINT', after.text === before.text,
     'was ' + cps(before.text) + '\n         now ' + cps(after.text));
  ck(c.id + ': undo restores the block STRUCTURE exactly', after.html === before.html,
     'was ' + show(before.html) + '\n         now ' + show(after.html));
  ck(c.id + ': the form that would be PERSISTED matches too', after.sane === before.sane,
     'was ' + show(before.sane) + '\n         now ' + show(after.sane));

  await redo();
  const re = await snap();
  ck(c.id + ': redo puts the span back, repair and all',
     re.spans.length === 1 && re.spans[0].pua > 0 &&
     re.spans[0].chain.join('>') === mid.spans[0].chain.join('>') &&
     re.spans[0].pad === mid.spans[0].pad,
     JSON.stringify(re.spans.map(x => [x.chain.join('>'), x.pad, x.pua])) + ' vs ' + JSON.stringify(mid.spans.map(x => [x.chain.join('>'), x.pad, x.pua])));
  ck(c.id + ': redo restores the exact post-insert text', re.text === mid.text,
     cps(mid.text) + ' vs ' + cps(re.text));
}

/* ===== Part B — revert hands the author's line back codepoint for codepoint,
        on the three pad shapes, and is itself undoable ===== */
for(const c of CASES.filter(x => /^P/.test(x.id))){
  await setDoc(c.html);
  const before = await snap();
  await applySel(c.sel);
  await translateVia(c.lang);
  const mid = await snap();
  if(!mid.spans.length){ ck(c.id + ' revert: span placed', false); continue; }
  await sheetAction('Revert to plain text');
  const rev = await snap();
  console.log(`\n--- REVERT ${c.id}`);
  console.log('    before :', show(before.text));
  console.log('    revert :', show(rev.text));
  ck(c.id + ' revert: no span left', rev.spans.length === 0, JSON.stringify(rev.spans));
  ck(c.id + ' revert: the author’s line comes back CODEPOINT for CODEPOINT', rev.text === before.text,
     'was ' + cps(before.text) + '\n         now ' + cps(rev.text));
  await undo();
  const back = await snap();
  ck(c.id + ' revert: undo puts the span back',
     back.spans.length === 1 && back.spans[0].pua > 0 && back.spans[0].src === mid.spans[0].src,
     JSON.stringify(back.spans));
}

/* ===== Part C — remove-span on a repaired placement, and its undo ===== */
{
  await setDoc('<h2>a <b id="sel">the old king</b></h2><p>tail</p>');
  const before = await snap();
  await applySel({ all: '#sel' });
  await translateVia('Kildaren');
  const mid = await snap();
  await sheetAction('Remove span');
  const gone = await snap();
  console.log('\n--- REMOVE on a repaired placement');
  console.log('    before :', show(before.html).slice(0, 200));
  console.log('    removed:', show(gone.html).slice(0, 200));
  ck('remove: span gone', gone.spans.length === 0, JSON.stringify(gone.spans));
  ck('remove: nothing of the author’s text was eaten with it',
     gone.text === before.text.replace('the old king', ''),
     cps(gone.text) + ' vs ' + cps(before.text.replace('the old king', '')));
  await undo();
  const back = await snap();
  ck('remove: undo restores the span, still inside its heading and its bold run',
     back.spans.length === 1 && back.spans[0].pua > 0 &&
     back.spans[0].chain.indexOf('H2') > -1 && back.spans[0].chain.indexOf('B') > -1,
     JSON.stringify(back.spans.map(x => x.chain.join('>'))));
}

ck('no page exception anywhere in the undo suite', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LOOP UNDO / PLACEMENT REPAIR / PAD RULE', checks.every(c => c[1]));
await browser.close(); await srv.close();
