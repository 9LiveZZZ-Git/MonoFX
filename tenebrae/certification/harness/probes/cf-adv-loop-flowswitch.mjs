// cf-adv-loop-flowswitch — ADVERSARY probe for TX-8: "change-tongue re-renders
// correctly ACROSS FLOWS".
//
// tx-readback-sheet and cf-loop-sheet-inplace both change tongue, but neither
// walks a single span through every flow the codex has. The failure this probe
// hunts is a STALE attribute: a span that was Kerrackian (horizontal rtl, so it
// carries dir="rtl") and is then re-rendered as Celan High (cols-rtl) or
// Kildaren (btt-stave) must NOT keep dir="rtl" — inside a vertical writing mode
// direction reverses the inline axis and stands the column on its head. The
// reverse case matters too: an ltr tongue re-rendered as Kerrackian must GAIN
// dir="rtl" and lose data-flow of the previous tongue.
//
// After every hop the span is checked against the engine's own answer for the
// SAME source, and the tap sheet is re-opened to confirm the read-back panes
// (source line, romanization, gloss) followed the tongue. The walk ends with a
// revert, which must still hand back the author's exact line.
//
// Run: cd probes && node cf-adv-loop-flowswitch.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Flow Switch');
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
const selText = (t) => page.evaluate(s => {
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
const openSheet = async () => {
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 1000);
};
// read the four informational panes out of the open sheet
const sheetPanes = () => page.evaluate(() => {
  const sh = document.querySelector('#sheet');
  if(!sh) return null;
  const big = sh.querySelector('.tsr .tspan') || sh.querySelector('.sh-note .tspan');
  return {
    title: (sh.querySelector('.sheet-title') || {}).textContent || '',
    big: big ? big.textContent : null,
    bigFlow: big ? (big.dataset.flow ?? null) : null,
    bigDir: big ? big.getAttribute('dir') : null,
    bigLang: big ? big.dataset.lang : null,
    src: (sh.querySelector('.ts-src') || {}).textContent || '',
    rom: (sh.querySelector('.ts-rom b') || {}).textContent || '',
    gloss: [...sh.querySelectorAll('.gloss .g .gs')].map(g => g.textContent).join('|'),
    glossOut: [...sh.querySelectorAll('.gloss .g .go')].map(g => g.textContent).join('|'),
  };
});
async function changeTongue(label){
  await openSheet();
  await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
  await wait(page, 800);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1600);
  await closeSheets();
}
const spanInfo = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const s = ed.querySelector('.tspan');
  if(!s) return null;
  const cs = getComputedStyle(s);
  const t = s.textContent;
  return { lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr ?? null,
    flow: s.dataset.flow ?? null, dir: s.getAttribute('dir'), text: t,
    attrs: [...s.attributes].map(a => a.name).sort().join(','),
    latin: (t.match(/[A-Za-z]/g) || []).length,
    pua: [...t].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
    count: ed.querySelectorAll('.tspan').length,
    wm: cs.writingMode, direction: cs.direction, font: cs.fontFamily,
    w: Math.round(s.getBoundingClientRect().width), h: Math.round(s.getBoundingClientRect().height) };
});
const oracle = (lang, src) => page.evaluate(async ([l, s]) => {
  const r = await window.tenebrae.translate2(l, s);
  return r ? { rom: r.romanization, flow: r.flow, dir: r.dir, name: r.lang.name,
               gloss: r.gloss.map(g => g.s).join('|') } : null;
}, [lang, src]);

const SRC = 'the sea remembers';
await setDoc(`<p>the gate ${SRC} closed</p>`);
const before = await page.evaluate(() => document.querySelector('#ed-content').textContent);
ck('selection made', (await selText(SRC)) === 'ok');
await translateVia('Kerrackian');

// hop through every flow, ending back on the one we started with
const HOPS = ['Celan High', 'Kildaren', 'Evernessian', 'Celan Basic', 'Kerrackian', 'Kildaren'];
const IDS = { 'Celan High': 'celan_high', 'Kildaren': 'kildaren', 'Evernessian': 'evernessian',
              'Celan Basic': 'celan_basic', 'Kerrackian': 'kerrackian' };

let step = 0;
for(const label of ['Kerrackian', ...HOPS]){
  if(step > 0) await changeTongue(label);
  const id = IDS[label];
  const s = await spanInfo();
  const o = await oracle(id, SRC);
  const tag = `hop${step} ${label}`;
  step++;
  if(!s){ ck(tag + ': the span survives the hop', false, 'no span'); continue; }
  console.log(`\n--- ${tag}: lang=${s.lang} flow=${s.flow} dir=${s.dir} wm=${s.wm} direction=${s.direction} pua=${s.pua} latin=${s.latin} box=${s.w}x${s.h}`);
  console.log(`    attrs=${s.attrs}`);
  console.log(`    rom=${JSON.stringify(s.rom)}  oracle=${JSON.stringify(o.rom)}`);
  ck(tag + ': exactly one span', s.count === 1, s.count);
  ck(tag + ': the tongue is the one the author chose', s.lang === id, s.lang);
  ck(tag + ': the English source is untouched', s.src === SRC, show(s.src));
  ck(tag + ': romanization is the codex\'s own', s.rom === o.rom, JSON.stringify([s.rom, o.rom]));
  ck(tag + ': script is PUA, no Latin, and is the span\'s text', s.pua > 0 && s.latin === 0 && s.text === s.scr,
     `pua=${s.pua} latin=${s.latin}`);
  ck(tag + ': data-flow is this tongue\'s flow, with no stale one left',
     o.flow === 'ltr' ? s.flow === null : s.flow === o.flow, JSON.stringify([s.flow, o.flow]));
  ck(tag + ': dir="rtl" iff this tongue is the horizontal rtl one',
     o.flow === 'rtl' ? s.dir === 'rtl' : s.dir === null, JSON.stringify([s.dir, o.flow]));
  ck(tag + ': the vertical tongues get a vertical writing mode, the others do not',
     (o.flow === 'cols-rtl' || o.flow === 'btt-stave') ? /vertical/.test(s.wm) : s.wm === 'horizontal-tb',
     s.wm + ' for ' + o.flow);
  ck(tag + ': a column is never stood on its head (no rtl direction in a vertical mode)',
     !(/vertical/.test(s.wm) && o.flow === 'cols-rtl' && s.direction === 'rtl'),
     s.wm + '/' + s.direction);
  ck(tag + ': rendered in this tongue\'s forged face', /Tenebrae/i.test(s.font), s.font);
  ck(tag + ': visible and tappable', s.w > 0 && s.h > 0, `${s.w}x${s.h}`);

  // the read-back panes must have followed the tongue too
  await openSheet();
  const p = await sheetPanes();
  await closeSheets();
  console.log(`    sheet: title=${JSON.stringify(p && p.title)} rom=${JSON.stringify(p && p.rom)} bigFlow=${p && p.bigFlow} bigDir=${p && p.bigDir}`);
  ck(tag + ': the sheet names this tongue', !!p && p.title.indexOf(o.name) > -1, p && p.title);
  ck(tag + ': the sheet\'s romanization pane is this tongue\'s', !!p && p.rom === o.rom, JSON.stringify([p && p.rom, o.rom]));
  ck(tag + ': the sheet still shows the author\'s English source', !!p && p.src.indexOf(SRC) > -1, p && p.src);
  ck(tag + ': the sheet\'s gloss is this tongue\'s, word for word', !!p && p.gloss === o.gloss, JSON.stringify([p && p.gloss, o.gloss]));
  ck(tag + ': the big render carries the same flow/dir as the span',
     !!p && (p.bigFlow ?? null) === (s.flow ?? null) && (p.bigDir ?? null) === (s.dir ?? null),
     JSON.stringify([p && p.bigFlow, s.flow, p && p.bigDir, s.dir]));
}

// and after all that, revert must still hand the author's line back
await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
await wait(page, 1200);
await closeSheets();
const after = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('\nafter revert:', show(after), ' want:', show(before));
ck('after six tongue changes, revert still gives the author\'s line back exactly', after === before,
   'got=' + show(after) + '  want=' + show(before));

ck('no page exception across the flow walk', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('CHANGE TONGUE ACROSS FLOWS', checks.every(c => c[1]));
await browser.close(); await srv.close();
