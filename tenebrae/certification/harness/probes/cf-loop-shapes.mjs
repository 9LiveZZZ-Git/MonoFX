// cf-loop-shapes — TX-7 / TX-11d GAP PROBE: the selection shapes no existing
// probe makes.
//
// tx-vp-selection-shapes already covers a word inside a bold run, inside a
// heading, inside a blockquote and inside a list item. What nobody selects:
//
//   A  a selection that IS an entire block (heading / paragraph / li /
//      blockquote contents, start-to-end) — the exact shape that makes
//      execCommand('insertHTML') hoist the span out of its block (TX-11d).
//   B  NESTED marks — b > i > u — where placeTSpan's inlineChain has to
//      rebuild three wrappers, not one.
//   C  a selection that SPANS AN EXISTING SPAN (text + tspan + text): the new
//      span's source must be the author's English throughout, the swallowed
//      span must be gone, and no tspan may nest inside a tspan.
//   D  a selection with LEADING AND TRAILING WHITESPACE on both edges.
//
// Every case goes through the real UI path: selection -> contextmenu ->
// "Translate ..." -> tongue in the action sheet.
//
// Run: cd probes && node cf-loop-shapes.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 400)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Loop Shapes');
await wait(page, 3500);

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
  await wait(page, 300);
}
// sel: {all:'#sel'}  -> selectNodeContents of the element matching that marker id
//      {text:'x'}    -> exact substring inside the first text node containing it
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
  if(!ok) return { opened: false };
  await wait(page, 350);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return { opened: false };
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  return { opened: true };
}

// full structural read of the editor
const readDoc = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const spans = [...ed.querySelectorAll('.tspan')].map(sp => {
    const chain = [];
    for(let n = sp.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) chain.push(n.tagName);
    const txt = sp.textContent;
    return {
      lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom,
      scr: sp.dataset.scr ?? null, flow: sp.dataset.flow ?? null, pad: sp.dataset.pad ?? null,
      text: txt,
      latin: (txt.match(/[A-Za-z]/g) || []).length,
      pua: [...txt].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
      chain, host: chain[chain.length - 1] || null, parent: chain[0] || null,
      nested: !!sp.parentElement.closest('.tspan'),
      w: Math.round(sp.getBoundingClientRect().width),
      h: Math.round(sp.getBoundingClientRect().height),
    };
  });
  return { html: ed.innerHTML, text: ed.textContent, spans,
           blocks: [...ed.children].map(c => c.tagName + (c.className ? '.' + c.className : '')) };
});
const codexRom = (lang, src) => page.evaluate(async ([l, s]) => {
  const r = await window.tenebrae.translate2(l, s);
  return r ? r.romanization : null;
}, [lang, src]);

const CASES = [
  { id: 'A1 whole H2 block',      lang: 'Kildaren',   langId: 'kildaren',
    html: '<h2 id="sel">the sea remembers</h2><p>after line</p>', sel: { all: '#sel' }, host: 'H2', marks: [] },
  { id: 'A2 whole P block',       lang: 'Celan High', langId: 'celan_high',
    html: '<p>before line</p><p id="sel">the old king walks</p>', sel: { all: '#sel' }, host: 'P', marks: [] },
  { id: 'A3 whole LI block',      lang: 'Kerrackian', langId: 'kerrackian',
    html: '<ul><li id="sel">the drover walks</li><li>second item</li></ul>', sel: { all: '#sel' }, host: 'LI', marks: [] },
  { id: 'A4 whole blockquote',    lang: 'Evernessian', langId: 'evernessian',
    html: '<blockquote id="sel">the sea remembers</blockquote><p>tail</p>', sel: { all: '#sel' }, host: 'BLOCKQUOTE', marks: [] },
  { id: 'B1 nested b>i>u',        lang: 'Kildaren',   langId: 'kildaren',
    html: '<p>and <b><i><u>the sea remembers</u></i></b> now</p>', sel: { text: 'sea remembers' },
    host: 'P', marks: ['U', 'I', 'B'] },
  { id: 'B2 bold run to block end', lang: 'Celan High', langId: 'celan_high',
    html: '<h2>a <b id="sel">the old king</b></h2>', sel: { all: '#sel' }, host: 'H2', marks: ['B'] },
  { id: 'D1 leading+trailing ws', lang: 'Kildaren',   langId: 'kildaren',
    html: '<p>look   the sea remembers   now</p>', sel: { text: '  the sea remembers  ' }, host: 'P', marks: [] },
];

for(const c of CASES){
  await setDoc(c.html);
  const s = await applySel(c.sel);
  if(s !== 'ok'){ ck(c.id + ': selection made', false, s); continue; }
  const selText = await page.evaluate(() => getSelection().toString());
  const rawSel = await page.evaluate(() => {
    const r = getSelection().getRangeAt(0);
    const h = document.createElement('div'); h.appendChild(r.cloneContents());
    return h.textContent;
  });
  // the writer normalizes runs of ordinary whitespace to one space (the same
  // collapse the browser already applies when it RENDERS the line) and spares
  // the NBSP — selTextFromRange, step1.html L3895
  const expectSrc = rawSel.replace(/[^\S\u00A0]+/g, ' ');
  const r = await translateVia(c.lang);
  const d = await readDoc();
  const sp = d.spans[0];
  console.log(`\n--- ${c.id}  sel=${JSON.stringify(show(selText))}`);
  console.log('    html:', d.html.slice(0, 260));
  if(!sp){ ck(c.id + ': span created', false, 'no span; html=' + d.html.slice(0, 200)); continue; }
  console.log(`    span src=${JSON.stringify(show(sp.src))} rom=${JSON.stringify(sp.rom)} chain=${sp.chain.join('>')} pua=${sp.pua} latin=${sp.latin} box=${sp.w}x${sp.h}`);
  ck(c.id + ': exactly one span', d.spans.length === 1, d.spans.length);
  const nearestBlock = sp.chain.find(t => /^(P|H2|H3|BLOCKQUOTE|LI|DIV)$/.test(t)) || null;
  ck(c.id + ': span stayed in its ' + c.host, nearestBlock === c.host, sp.chain.join('>'));
  ck(c.id + ': inline marks rebuilt ' + JSON.stringify(c.marks),
     c.marks.every(m => sp.chain.indexOf(m) > -1) &&
     sp.chain.filter(t => /^(B|STRONG|I|EM|U|S|STRIKE|DEL)$/.test(t)).length === c.marks.length,
     sp.chain.join('>'));
  ck(c.id + ': source is the author’s selection (ws-collapsed, NBSP spared)', sp.src === expectSrc,
     'stored=' + show(sp.src) + '  expected=' + show(expectSrc) + '  raw=' + show(rawSel));
  const rom = await codexRom(c.langId, sp.src);
  ck(c.id + ': romanization is the codex’s own', sp.rom === rom, JSON.stringify([sp.rom, rom]));
  ck(c.id + ': script form is PUA, no Latin', sp.pua > 0 && sp.latin === 0 && sp.text === sp.scr,
     `pua=${sp.pua} latin=${sp.latin}`);
  ck(c.id + ': span is visible + tappable', sp.w > 0 && sp.h > 0, `${sp.w}x${sp.h}`);
}

/* ---- C: a selection that spans an existing span ---- */
{
  await setDoc('<p id="sel">the sea remembers the old king</p>');
  await applySel({ text: 'sea remembers' });
  await translateVia('Kildaren');
  const before = await readDoc();
  console.log('\n--- C spanning-an-existing-span, after first span:', before.html.slice(0, 300));
  ck('C: first span present', before.spans.length === 1, before.spans.length);
  // now select the WHOLE paragraph, swallowing that span
  await applySel({ all: '#sel' });
  const selText = await page.evaluate(() => getSelection().toString());
  await translateVia('Kerrackian');
  const after = await readDoc();
  const sp = after.spans[0];
  console.log('    html:', after.html.slice(0, 320));
  console.log('    selection.toString():', JSON.stringify(show(selText)));
  ck('C: one span replaces both', after.spans.length === 1, after.spans.length);
  if(sp){
    console.log(`    span lang=${sp.lang} src=${JSON.stringify(show(sp.src))} rom=${JSON.stringify(sp.rom)} nested=${sp.nested}`);
    ck('C: no tspan nested inside a tspan', !sp.nested && after.html.indexOf('tspan') === after.html.lastIndexOf('tspan') - 0 || !sp.nested, sp.nested);
    ck('C: swallowed span contributes ENGLISH, not romanization',
       sp.src.indexOf('sea remembers') > -1 && sp.src.indexOf('meanma') === -1, show(sp.src));
    ck('C: no PUA leaked into the new source',
       ![...sp.src].some(ch => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF), show(sp.src));
    ck('C: new span is the new tongue', sp.lang === 'kerrackian', sp.lang);
    const rom = await codexRom('kerrackian', sp.src);
    ck('C: romanization is the codex’s own for the merged source', sp.rom === rom, JSON.stringify([sp.rom, rom]));
    ck('C: script is PUA, not Latin', sp.pua > 0 && sp.latin === 0, `pua=${sp.pua} latin=${sp.latin}`);
    ck('C: span still inside its paragraph', sp.host === 'P', sp.chain.join('>'));
  }
}

ck('no page exception across every shape', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LOOP SELECTION SHAPES', checks.every(c => c[1]));
await browser.close(); await srv.close();
