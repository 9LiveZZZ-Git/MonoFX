// TX-12 — DEGENERATE SELECTIONS: the inputs most likely to drive a span into
// the Latin-fallback branch (step1.html L3190 `else el.textContent =
// r.romanization`) or into an empty, invisible, un-tappable span.
// Every case goes through the real ctx-menu → sheet path.
// Run: cd probes && node tx-hostile-degenerate.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { verdict } from './ex-lib.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : String(extra).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const wait = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await wait(600);
await page.click('#lib-new'); await wait(400);
await page.fill('#ps-input', 'Degenerate Book'); await page.click('#ps-save'); await wait(3800);

async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(400);
}
async function fresh(text){
  await closeSheets();
  await page.evaluate(t => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = '';
    ed.textContent = 'HEAD ' + t + ' TAIL';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  }, text);
  await wait(250);
}
async function selectMiddle(text){
  return page.evaluate(t => {
    const ed = document.querySelector('#ed-content');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while((n = w.nextNode())){
      const i = n.nodeValue.indexOf(t);
      if(i > -1){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
    }
    return false;
  }, text);
}
async function translateVia(lang){
  const opened = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
    return true;
  });
  await wait(300);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return { menu: false };
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(600);
  await page.locator('#sheet .sh-item', { hasText: lang }).click();
  await wait(1400);
  return { menu: true };
}
const dump = () => page.evaluate(() => {
  const F = window.tenebrae._forge.map() || {};
  const bases = {}; for(const [k, v] of Object.entries(F)) bases[k] = v.base;
  return [...document.querySelectorAll('#ed-content .tspan')].map(sp => {
    const txt = sp.textContent, base = bases[sp.dataset.lang];
    const b = sp.getBoundingClientRect();
    return { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, scr: sp.dataset.scr || null,
      text: txt, textLen: txt.length,
      latin: (txt.match(/[A-Za-z]/g) || []).length,
      pua: [...txt].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
      inRange: base == null ? 0 : [...txt].filter(c => c.charCodeAt(0) >= base && c.charCodeAt(0) < base + 0x80).length,
      w: Math.round(b.width), h: Math.round(b.height) };
  });
});

const CASES = [
  ['punctuation only', '... !!! ,,, ;;;'],
  ['digits only', '1234567890'],
  ['symbols only', '@#$%^*()+=[]{}|\\/~`'],
  ['single stopword', 'the'],
  ['dashes and quotes', '— – “ ” ‘ ’'],
  ['ellipsis + nbsp', '… …'],
  ['zero-width joiner run', 'a‍b‍c'],
  ['combining marks only', 'éàô'],
];
const LANGS = ['Celan High', 'Kildaren', 'Celan Basic'];

const rows = [];
for(const [name, text] of CASES){
  for(const lang of LANGS){
    await fresh(text);
    const sel = await selectMiddle(text);
    if(!sel){ rows.push({ name, lang, note: 'selection failed' }); continue; }
    const selText = await page.evaluate(() => getSelection().toString());
    const r = await translateVia(lang);
    const d = await dump();
    rows.push({ name, lang, sel: selText, menu: r.menu, spans: d.length, span: d[0] || null });
    const s = d[0];
    console.log(`  ${name.padEnd(22)} ${lang.padEnd(12)} menu=${r.menu ? 'y' : 'n'} spans=${d.length}` +
      (s ? ` text=${JSON.stringify(s.text).slice(0, 34)} latin=${s.latin} pua=${s.pua} box=${s.w}x${s.h} rom=${JSON.stringify(s.rom).slice(0, 24)}` : ''));
  }
}

const made = rows.filter(r => r.span);
ck('degenerate: no span ever renders Latin characters',
   made.every(r => r.span.latin === 0),
   JSON.stringify(made.filter(r => r.span.latin > 0).map(r => [r.name, r.lang, r.span.text.slice(0, 40)])));
ck('degenerate: no span is created empty / zero-size (invisible + un-tappable)',
   made.every(r => r.span.textLen > 0 && r.span.w > 0 && r.span.h > 0),
   JSON.stringify(made.filter(r => !(r.span.textLen > 0 && r.span.w > 0 && r.span.h > 0)).map(r => [r.name, r.lang, r.span.textLen, r.span.w, r.span.h])));
ck('degenerate: every created span keeps its exact source',
   made.every(r => r.span.src === r.sel),
   JSON.stringify(made.filter(r => r.span.src !== r.sel).map(r => [r.name, r.lang, [...r.sel].map(c => c.charCodeAt(0).toString(16)).join(','), [...r.span.src].map(c => c.charCodeAt(0).toString(16)).join(',')])));
ck('degenerate: no page exception across all cases', errors.length === 0, errors.slice(0, 3).join(' | '));

/* --- what an empty span actually does to the author's page --- */
{
  await fresh('the gate opened ... and then silence');
  await selectMiddle('...');
  await translateVia('Celan Basic');
  const after = await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    const sp = ed.querySelector('.tspan');
    const b = sp ? sp.getBoundingClientRect() : null;
    return { text: ed.innerText, spanText: sp ? sp.textContent : null, src: sp ? sp.dataset.src : null,
             rom: sp ? sp.dataset.rom : null, scr: sp ? (sp.dataset.scr ?? null) : null,
             w: b ? Math.round(b.width) : -1, h: b ? Math.round(b.height) : -1 };
  });
  console.log('  empty-span repro:', JSON.stringify(after));
  ck('empty-span: the selected characters are still visible somewhere in the page',
     after.text.includes('...') || (after.spanText || '').length > 0,
     `page text now: ${JSON.stringify(after.text)}`);
  // is the invisible span still reachable so the author can undo the damage?
  const tappable = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    if(!sp) return false;
    sp.click();
    return true;
  });
  await wait(1000);
  const sheetUp = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    return { open: !!s && s.classList.contains('show'), title: s ? (s.querySelector('.sheet-title') || {}).textContent : null };
  });
  console.log('  empty-span tap sheet:', JSON.stringify(sheetUp));
  // the fix is to never create the empty span: the author's characters stay put
  // and there is nothing to recover. If one IS created it must stay tappable.
  ck('empty-span: nothing was created, or what was created is still tappable',
     (!tappable && after.text.includes('...')) || (tappable && sheetUp.open),
     `spanCreated=${tappable} sheetOpen=${sheetUp.open} text=${JSON.stringify(after.text)}`);
  await closeSheets();
}

console.log(`\n${rows.length} case/tongue combinations driven through the real UI`);
const failed = checks.filter(c => !c[1]);
console.log(`${checks.length - failed.length}/${checks.length} checks ok`);
for(const f of failed) console.log('  FAILED:', f[0]);
verdict('TX-12 DEGENERATE SELECTIONS', failed.length === 0);
await browser.close();
await srv.close();
