// cf-adv-loop-alltongues — ADVERSARY probe for TX-7 ("for EVERY tongue") and
// TX-11d, plus the cross-block selection nobody makes.
//
// cf-loop-shapes covers 4 of the 6 tongues (kildaren, celan_high, kerrackian,
// evernessian) on a plain LTR contract check. The two it never drives through
// the real selection->contextmenu->sheet path are CELAN BASIC (the lazy-minted
// word script) and CALGRIDARIAN. And no probe checks, per tongue, that the
// span carries the RIGHT dir/data-flow — dir="rtl" belongs to the horizontal
// rtl tongue alone; a cols-rtl or btt-stave span that carried dir would stand
// its column on its head.
//
// Part A: every tongue, same selection inside an H2, through the real UI.
// Part B: a selection that CROSSES TWO BLOCKS (end of one paragraph into the
//         next) — selTextFromRange injects separators there and placeTSpan's
//         hostBlock is only the START block. Does the author lose the second
//         paragraph's text?
//
// Run: cd probes && node cf-adv-loop-alltongues.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 400)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'All Tongues');
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
const selText_ = (a, b) => page.evaluate(([t1, t2]) => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, s = null, e = null;
  while((n = w.nextNode())){
    if(!s){ const i = n.nodeValue.indexOf(t1); if(i > -1) s = [n, i]; }
    if(s){ const j = n.nodeValue.indexOf(t2); if(j > -1){ e = [n, j + t2.length]; break; } }
  }
  if(!s || !e) return 'not found';
  const r = document.createRange();
  r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return 'ok';
}, [a, b]);

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
  await wait(page, 350);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1600);
  await closeSheets();
  return true;
}
const readSpans = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return {
    html: ed.innerHTML, text: ed.textContent,
    spans: [...ed.querySelectorAll('.tspan')].map(s => {
      const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
      const t = s.textContent;
      return { lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr ?? null,
        flow: s.dataset.flow ?? null, dir: s.getAttribute('dir'), omni: s.dataset.omni ?? null,
        ce: s.getAttribute('contenteditable'), text: t,
        latin: (t.match(/[A-Za-z]/g) || []).length,
        pua: [...t].filter(ch => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF).length,
        chain: c.join('>'), w: Math.round(s.getBoundingClientRect().width),
        h: Math.round(s.getBoundingClientRect().height),
        font: getComputedStyle(s).fontFamily, wm: getComputedStyle(s).writingMode };
    })
  };
});
const oracle = (lang, src) => page.evaluate(async ([l, s]) => {
  const r = await window.tenebrae.translate2(l, s);
  if(!r) return null;
  return { rom: r.romanization, flow: r.flow, dir: r.dir, lang: r.lang.id, name: r.lang.name };
}, [lang, src]);

const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => ({ id: l.id, name: l.name })));
console.log('tongues:', JSON.stringify(LANGS));
ck('all six tongues are offered by the engine', LANGS.length === 6, LANGS.map(l => l.id).join(','));

/* ---------- Part A: every tongue, same selection, real UI ---------- */
const PHRASE = 'the sea remembers';
for(const L of LANGS){
  await setDoc(`<p>before line</p><h2>a ${PHRASE} tail</h2><p>after line</p>`);
  const s = await selText_(PHRASE, PHRASE);
  if(s !== 'ok'){ ck(`${L.name}: selection made`, false, s); continue; }
  const made = await translateVia(L.name);
  const d = await readSpans();
  const sp = d.spans[0];
  const o = await oracle(L.id, PHRASE);
  console.log(`\n--- ${L.name} (${L.id})  oracle flow=${o && o.flow} dir=${o && o.dir}`);
  if(!sp){ ck(`${L.name}: a span was created`, false, 'made=' + made + ' html=' + d.html.slice(0, 200)); continue; }
  console.log(`    span lang=${sp.lang} chain=${sp.chain} flow=${sp.flow} dir=${sp.dir} pua=${sp.pua} latin=${sp.latin} box=${sp.w}x${sp.h} wm=${sp.wm}`);
  console.log(`    rom=${JSON.stringify(sp.rom)}`);
  ck(`${L.name}: exactly one span`, d.spans.length === 1, d.spans.length);
  ck(`${L.name}: tongue recorded`, sp.lang === L.id, sp.lang);
  ck(`${L.name}: English source stored`, sp.src === PHRASE, show(sp.src));
  ck(`${L.name}: romanization is the codex's own`, o && sp.rom === o.rom, JSON.stringify([sp.rom, o && o.rom]));
  ck(`${L.name}: script form is the span's own text, all PUA, no Latin`,
     sp.scr !== null && sp.text === sp.scr && sp.pua > 0 && sp.latin === 0, `pua=${sp.pua} latin=${sp.latin}`);
  ck(`${L.name}: contenteditable=false`, sp.ce === 'false', sp.ce);
  ck(`${L.name}: data-flow matches the codex (${o && o.flow})`,
     (o.flow === 'ltr' ? sp.flow === null : sp.flow === o.flow), JSON.stringify([sp.flow, o.flow]));
  ck(`${L.name}: dir="rtl" only for the horizontal rtl tongue`,
     (o.flow === 'rtl') ? sp.dir === 'rtl' : sp.dir === null, JSON.stringify([sp.dir, o.flow]));
  ck(`${L.name}: stayed inside the author's H2`, sp.chain.split('>')[0] === 'H2', sp.chain);
  ck(`${L.name}: visible and tappable`, sp.w > 0 && sp.h > 0, `${sp.w}x${sp.h}`);
  ck(`${L.name}: rendered in a forged face, not a fallback`,
     /Tenebrae/i.test(sp.font), sp.font);
  ck(`${L.name}: the author's other blocks are untouched`,
     d.html.indexOf('before line') > -1 && d.html.indexOf('after line') > -1 &&
     /a\s*[\s ]?/.test(d.text) && d.text.indexOf('tail') > -1, show(d.text).slice(0, 120));
}

/* ---------- Part B: a selection that crosses two blocks ---------- */
{
  await setDoc('<p id="p1">alpha the sea remembers</p><p id="p2">the old king omega</p>');
  const s = await selText_('the sea remembers', 'the old king');
  ck('B: cross-block selection made', s === 'ok', s);
  const selStr = await page.evaluate(() => getSelection().toString());
  const made = await translateVia('Kildaren');
  const d = await readSpans();
  const sp = d.spans[0];
  console.log('\n--- B cross-block  sel=' + JSON.stringify(show(selStr)));
  console.log('    html:', show(d.html).slice(0, 320));
  ck('B: a span was created', !!sp, made + ' ' + d.html.slice(0, 160));
  if(sp){
    console.log(`    span src=${JSON.stringify(show(sp.src))} chain=${sp.chain} pua=${sp.pua} latin=${sp.latin}`);
    const o = await oracle('kildaren', sp.src);
    ck('B: exactly one span', d.spans.length === 1, d.spans.length);
    ck('B: romanization is the codex\'s own for the stored source', o && sp.rom === o.rom, JSON.stringify([sp.rom, o && o.rom]));
    ck('B: script is PUA, no Latin', sp.pua > 0 && sp.latin === 0, `pua=${sp.pua} latin=${sp.latin}`);
    ck('B: the words OUTSIDE the selection all survive', d.text.indexOf('alpha') > -1 && d.text.indexOf('omega') > -1,
       show(d.text));
    ck('B: no English of the selection is left stranded beside the span',
       d.text.indexOf('sea remembers') === -1 && d.text.indexOf('old king') === -1, show(d.text));
    ck('B: the span is inside a block, not a bare child of #ed-content',
       /^(P|H2|H3|BLOCKQUOTE|LI|DIV)$/.test(sp.chain.split('>')[0] || ''), sp.chain);
  }
}

ck('no page exception anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('ALL-TONGUE LOOP CONTRACT', checks.every(c => c[1]));
await browser.close(); await srv.close();
