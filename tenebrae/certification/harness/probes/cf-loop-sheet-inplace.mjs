// cf-loop-sheet-inplace — TX-8 / TX-11d GAP PROBE: the tap sheet's own two
// rewriting actions, performed on a span that needed a PLACEMENT REPAIR.
//
// tx-readback-sheet drives "edit source & retranslate" and "change tongue" on a
// span sitting in a plain paragraph, where nothing can be hoisted. But
// retranslateSpan (step1.html L3850) replaces the span with
// edApplyHTML(rangeAround(el), ...) and — unlike insertTranslation — never runs
// the hostBlock / inlineChain repair that placeTSpan does. So the question this
// probe asks is: after the author changes the tongue of a translation that
// lives inside a bold run in a heading, is it still inside that heading and
// still bold?
//
// Cases: bold-in-heading, nested b>i>u, whole list item. For each: change
// tongue, then edit source, checking the ancestor chain, the block text and the
// span's own fields after every hop, plus undo.
//
// Run: cd probes && node cf-loop-sheet-inplace.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 380)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Sheet In Place');
await wait(page, 3500);

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
    ed.innerHTML = h; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); ed.focus();
  }, html);
  await wait(page, 600);
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
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return 'ok';
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
const openSheet = async () => {
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 900);
};
async function changeTongue(label){
  await openSheet();
  await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
  await wait(page, 800);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  await closeSheets();
}
async function editSource(newText){
  await openSheet();
  await page.locator('#sheet .sh-item', { hasText: 'Edit source' }).click();
  await wait(page, 700);
  await page.fill('#ps-input', newText);
  await page.click('#ps-save');
  await wait(page, 1600);
  await closeSheets();
}
const spanInfo = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const s = ed.querySelector('.tspan');
  if(!s) return { none: true, html: ed.innerHTML, text: ed.textContent };
  const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
  return { chain: c.join('>'), lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom,
           flow: s.dataset.flow ?? null, dir: s.getAttribute('dir'), pad: s.dataset.pad ?? null,
           pua: [...s.textContent].filter(ch => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF).length,
           latin: (s.textContent.match(/[A-Za-z]/g) || []).length,
           count: ed.querySelectorAll('.tspan').length, html: ed.innerHTML, text: ed.textContent };
});
const codexRom = (lang, src) => page.evaluate(async ([l, s]) => {
  const r = await window.tenebrae.translate2(l, s); return r ? r.romanization : null;
}, [lang, src]);

const CASES = [
  { id: 'S1 bold run inside a heading', html: '<h2>a <b id="sel">the old king</b></h2><p>tail</p>',
    sel: { all: '#sel' }, need: ['H2', 'B'] },
  { id: 'S2 nested b>i>u', html: '<p>and <b><i><u>the sea remembers</u></i></b> now</p>',
    sel: { text: 'the sea remembers' }, need: ['P', 'B', 'I', 'U'] },
  { id: 'S3 whole list item', html: '<ul><li id="sel">the drover walks</li><li>second item</li></ul>',
    sel: { all: '#sel' }, need: ['LI'] },
];

for(const c of CASES){
  await setDoc(c.html);
  await applySel(c.sel);
  const made = await translateVia('Kildaren');
  const ins = await spanInfo();
  console.log(`\n--- ${c.id}`);
  console.log('    inserted :', ins.chain, JSON.stringify(ins.src), '  html=', show(ins.html).slice(0, 160));
  ck(c.id + ': span placed where the author put it',
     made && !ins.none && c.need.every(t => ins.chain.split('>').indexOf(t) > -1), ins.chain);
  if(ins.none) continue;

  await changeTongue('Celan High');
  const ct = await spanInfo();
  console.log('    tongue-> :', ct.chain, ct.lang, '  html=', show(ct.html).slice(0, 160));
  ck(c.id + ': change tongue actually re-rendered', !ct.none && ct.lang === 'celan_high' && ct.pua > 0 && ct.latin === 0,
     JSON.stringify([ct.lang, ct.pua, ct.latin]));
  ck(c.id + ': change tongue kept the span in ' + c.need.join('+'),
     !ct.none && c.need.every(t => ct.chain.split('>').indexOf(t) > -1), ct.chain + '  (was ' + ins.chain + ')');
  ck(c.id + ': change tongue kept exactly one span', !ct.none && ct.count === 1, ct.count);
  if(!ct.none){
    const rom = await codexRom('celan_high', ct.src);
    ck(c.id + ': change tongue romanization is the codex’s own', ct.rom === rom, JSON.stringify([ct.rom, rom]));
    ck(c.id + ': change tongue kept the English source', ct.src === ins.src, JSON.stringify([ins.src, ct.src]));
  }

  await editSource('the sea remembers');
  const es = await spanInfo();
  console.log('    edit-src :', es.chain, JSON.stringify(es.src), '  html=', show(es.html).slice(0, 160));
  ck(c.id + ': edit source retranslated', !es.none && es.src === 'the sea remembers' && es.pua > 0 && es.latin === 0,
     JSON.stringify([es.src, es.pua, es.latin]));
  ck(c.id + ': edit source kept the span in ' + c.need.join('+'),
     !es.none && c.need.every(t => es.chain.split('>').indexOf(t) > -1), es.chain + '  (was ' + ins.chain + ')');
  if(!es.none){
    const rom = await codexRom(es.lang, 'the sea remembers');
    ck(c.id + ': edit source romanization is the codex’s own', es.rom === rom, JSON.stringify([es.rom, rom]));
  }
}

ck('no page exception across the sheet-in-place suite', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('SHEET ACTIONS IN PLACE', checks.every(c => c[1]));
await browser.close(); await srv.close();
