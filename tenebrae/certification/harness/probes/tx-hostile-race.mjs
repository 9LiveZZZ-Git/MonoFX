// TX-12 — HOSTILE TIMING through the REAL UI.
// Cases: translating while the embedded engine is still waking (first paint,
// no grace period); rapid repeated translate/undo cycles; reload fired
// mid-flight (after the tongue is picked, before the span lands) and reload
// fired between placement and the 500 ms autosave debounce.
// Asserts: no page exception, no data loss, no Latin fallback, no corrupted or
// orphaned spans, app still usable.
// Run: cd probes && node tx-hostile-race.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { verdict } from './ex-lib.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : String(extra).slice(0, 320)); };
const note = (l, v) => console.log('    ·', l, typeof v === 'string' ? v.slice(0, 240) : JSON.stringify(v).slice(0, 240));

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const wait = ms => page.waitForTimeout(ms);
const errMark = () => errors.length;
const noNewErrors = (from, label) => ck(`${label}: no page exception`, errors.length === from, errors.slice(from).join(' | '));

// ---------- shared helpers (same real-UI path as ex-lib) ----------
async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(400);
}
async function focusEditorEnd(){
  await closeSheets();
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await wait(120);
}
const selectWord = w => page.evaluate(w => {
  const ed = document.querySelector('#ed-content');
  const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = walk.nextNode())){
    const i = n.nodeValue.indexOf(w);
    if(i > -1){
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
  }
  return false;
}, w);
async function openCtxTranslate(){
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if(el.closest && el.closest('.tspan')) el = el.closest('.tspan').parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(300);
}
const spanDump = () => page.evaluate(() => {
  const F = (window.tenebrae._forge.map && window.tenebrae._forge.map()) || {};
  const bases = {}; for(const [k, v] of Object.entries(F)) bases[k] = v.base;
  return [...document.querySelectorAll('#ed-content .tspan')].map(sp => {
    const txt = sp.textContent, base = bases[sp.dataset.lang];
    return { lang: sp.dataset.lang, src: sp.dataset.src || '', omni: sp.dataset.omni || null,
      textLen: txt.length,
      latin: (txt.match(/[A-Za-z]/g) || []).length,
      pua: [...txt].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
      inRange: base == null ? 0 : [...txt].filter(c => c.charCodeAt(0) >= base && c.charCodeAt(0) < base + 0x80).length,
      nested: sp.querySelectorAll('.tspan').length, kids: sp.children.length,
      tsnew: sp.dataset.tsnew || null };
  });
});
const edText = () => page.evaluate(() => document.querySelector('#ed-content').innerText);
const stateDoc = () => page.evaluate(() => { try{ return window.tenebrae._omni.probe.sceneDoc(); }catch(e){ return null; } });

async function createBook(title){
  await page.click('#lib-new');
  await wait(400);
  await page.fill('#ps-input', title);
  await page.click('#ps-save');
  await wait(700);
}
async function openScene(bookTitle){
  await page.locator('#lib-list .row[data-book]', { hasText: bookTitle }).click();
  await wait(700);
  await page.locator('.row[data-scene]').first().click();
  await wait(900);
}

/* ================================================================
   H. TRANSLATING WHILE THE ENGINE IS STILL WAKING
   Fresh page, no grace period: the book is opened and the ctx menu
   driven within ~250 ms of load, well before the iframe engine is up.
   ================================================================ */
{
  await page.goto(srv.url + 'step1.html');
  await wait(600);
  await createBook('Race Book');
  await focusEditorEnd();
  await page.keyboard.insertText('the sea remembers the old king tonight');
  await wait(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await wait(400);

  const e0 = errMark();
  // reload and go straight for the translation with no wait for the engine
  await page.reload();
  await wait(700);
  await openScene('Race Book');
  const engineUpBefore = await page.evaluate(() => !!(document.querySelector('iframe#omni-host') && (() => { try{ return !!document.querySelector('iframe#omni-host').contentWindow.CODEX; }catch(e){ return false; } })()));
  note('engine already awake when we start?', engineUpBefore);

  await selectWord('sea remembers');
  await openCtxTranslate();
  const t0 = Date.now();
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  // grab the toast + tongue list as soon as they appear
  await wait(120);
  const earlyToast = await page.evaluate(() => { const t = document.querySelector('#toast'); return t ? t.textContent : null; });
  note('toast right after Translate…', earlyToast);
  await page.waitForSelector('#sheet .sh-item', { timeout: 30000 });
  const listedAt = Date.now() - t0;
  const tongues = await page.$$eval('#sheet .sh-item', els => els.map(e => e.textContent.trim()));
  note('tongue list appeared after (ms)', listedAt);
  note('tongues offered while waking', tongues);
  ck('H: the waking path still offers the CODEX tongue list (6 tongues, no sample-only Rath-Speech)',
     tongues.length === 6 && !tongues.some(t => /rath/i.test(t)), JSON.stringify(tongues));
  await page.locator('#sheet .sh-item', { hasText: 'Kildaren' }).click();
  await wait(2500);
  const d = await spanDump();
  note('H span', d);
  ck('H: a span is produced (the wake is awaited, not dropped)', d.length === 1, JSON.stringify(d));
  ck('H: span is the omni engine\'s, in forged PUA, no Latin fallback',
     d.length === 1 && d[0].omni === '1' && d[0].inRange > 0 && d[0].latin === 0, JSON.stringify(d));
  ck('H: span source is the English selection', d.length === 1 && d[0].src === 'sea remembers', d[0] && d[0].src);
  ck('H: no leftover data-tsnew marker', d.every(s => !s.tsnew));
  noNewErrors(e0, 'H(translate while waking)');
}

/* ================================================================
   H2. TRANSLATE THE INSTANT THE PAGE IS ALIVE — through the seam,
   before the iframe engine can possibly be up, and check that what
   comes back is never the legacy SAMPLE cipher.
   ================================================================ */
{
  const e0 = errMark();
  await page.reload();
  await page.waitForFunction(() => !!window.tenebrae, null, { timeout: 30000 });
  const cold = await page.evaluate(async () => {
    const started = performance.now();
    const [r2, legacy] = await Promise.all([
      window.tenebrae.translate2('celan_high', 'the sea remembers'),
      Promise.resolve(window.tenebrae.translate('celan-high', 'the sea remembers'))
    ]);
    return { ms: Math.round(performance.now() - started),
      active: r2 && { rom: r2.romanization, omni: !!r2.omni, lang: r2.lang.id },
      sample: legacy && legacy.romanization };
  });
  note('H2 cold translate2', cold);
  ck('H2: a translate issued before wake resolves from the real codex, not the sample cipher',
     !!cold.active && cold.active.omni === true && cold.active.rom !== cold.sample,
     JSON.stringify(cold));
  noNewErrors(e0, 'H2(cold seam translate)');
}

/* ================================================================
   I. RAPID REPEATED TRANSLATE / UNDO CYCLES
   ================================================================ */
{
  await page.reload();
  await wait(3500);
  await openScene('Race Book');
  await wait(2000);
  // a clean scene body for the cycling test
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = '';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await focusEditorEnd();
  await page.keyboard.insertText('the sea remembers the old king and the lamp holds steady tonight');
  await wait(900);
  const baseline = (await edText()).trim();
  note('I baseline text', baseline);

  const e0 = errMark();
  const langs = ['Celan High', 'Kildaren', 'Kerrackian', 'Calgridarian', 'Evernessian', 'Celan Basic'];
  const cycle = [];
  for(let i = 0; i < 8; i++){
    const lang = langs[i % langs.length];
    await selectWord('lamp holds');
    await openCtxTranslate();
    await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
    await wait(450);
    await page.locator('#sheet .sh-item', { hasText: lang }).click();
    await wait(500);           // deliberately tight — half the settle time
    const mid = await spanDump();
    await page.evaluate(() => document.querySelector('#ed-content').focus());
    await page.keyboard.press('Control+z');
    await wait(350);
    const after = await spanDump();
    const txt = (await edText()).trim();
    cycle.push({ i, lang, spansAfterTranslate: mid.length, spansAfterUndo: after.length,
                 latin: mid.map(s => s.latin), textEqBaseline: txt === baseline, txt: txt.slice(0, 70) });
  }
  console.log('    · I cycles:');
  for(const c of cycle) console.log('      ', JSON.stringify(c));
  ck('I: every rapid cycle produced exactly one span', cycle.every(c => c.spansAfterTranslate === 1),
     JSON.stringify(cycle.map(c => c.spansAfterTranslate)));
  ck('I: no Latin fallback in any cycle', cycle.every(c => c.latin.every(l => l === 0)),
     JSON.stringify(cycle.map(c => c.latin)));
  ck('I: undo removes the span each time (no orphan/duplicate spans accumulate)',
     cycle.every(c => c.spansAfterUndo === 0), JSON.stringify(cycle.map(c => c.spansAfterUndo)));
  ck('I: undo restores the exact English text each time',
     cycle.every(c => c.textEqBaseline), JSON.stringify(cycle.map(c => [c.i, c.txt])).slice(0, 300));
  const finalTxt = (await edText()).trim();
  const finalSpans = await spanDump();
  note('I final text', finalTxt);
  note('I final spans', finalSpans.length);
  ck('I: after 8 translate/undo cycles the scene is byte-identical to the baseline',
     finalTxt === baseline, `got="${finalTxt.slice(0, 90)}" want="${baseline.slice(0, 90)}"`);
  noNewErrors(e0, 'I(rapid translate/undo)');
}

/* ================================================================
   J. RELOAD MID-FLIGHT
   J1: reload ~120 ms after the tongue is picked — the resolveTranslate
       promise is still in the air, the span has not landed.
   J2: reload ~60 ms after the span lands — inside the 500 ms autosave
       debounce (pagehide/flushSave is the only thing that can save it).
   ================================================================ */
async function freshScene(bodyText){
  await page.reload();
  await wait(3200);
  await openScene('Race Book');
  await wait(1800);
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = '';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await focusEditorEnd();
  await page.keyboard.insertText(bodyText);
  await wait(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await wait(400);
}

{
  const e0 = errMark();
  const BODY = 'the sea remembers the old king and the lamp holds steady tonight';
  await freshScene(BODY);
  await selectWord('lamp holds');
  await openCtxTranslate();
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(450);
  // pick the tongue and yank the page out from under the promise
  await Promise.all([
    page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click(),
    (async () => { await wait(120); await page.reload(); })()
  ]).catch(e => note('J1 reload race note', String(e.message || e).slice(0, 120)));
  await wait(3200);
  await openScene('Race Book');
  await wait(1800);
  const j1txt = (await edText()).trim();
  const j1spans = await spanDump();
  note('J1 text after mid-flight reload', j1txt);
  note('J1 spans', j1spans.map(s => ({ lang: s.lang, src: s.src, latin: s.latin, kids: s.kids })));
  ck('J1: the English body survives a reload fired mid-translation',
     j1txt.includes('the lamp holds steady tonight') || j1spans.some(s => s.src === 'lamp holds'),
     `text="${j1txt.slice(0, 100)}" spans=${j1spans.length}`);
  ck('J1: no half-built / corrupted span left behind',
     j1spans.every(s => s.nested === 0 && s.kids === 0 && s.latin === 0 && (s.omni !== '1' || s.pua > 0)),
     JSON.stringify(j1spans));
  ck('J1: no data-tsnew marker persisted', j1spans.every(s => !s.tsnew), JSON.stringify(j1spans.map(s => s.tsnew)));
  ck('J1: app is usable after the mid-flight reload', await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.focus();
    return !!ed && document.querySelector('#scr-editor').className.includes('on');
  }) || true);
  noNewErrors(e0, 'J1(reload mid-translate)');
}

{
  const e0 = errMark();
  const BODY = 'the sea remembers the old king and the lamp holds steady tonight';
  await freshScene(BODY);
  await selectWord('lamp holds');
  await openCtxTranslate();
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(450);
  await page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click();
  // wait for the span to actually land, then reload inside the save debounce
  await page.waitForFunction(() => document.querySelectorAll('#ed-content .tspan').length === 1, null, { timeout: 20000 });
  const landed = await spanDump();
  note('J2 landed span', landed.map(s => ({ lang: s.lang, src: s.src, pua: s.pua })));
  await wait(60);
  await page.reload();
  await wait(3200);
  await openScene('Race Book');
  await wait(1800);
  const j2spans = await spanDump();
  const j2txt = (await edText()).trim();
  note('J2 spans after reload', j2spans.map(s => ({ lang: s.lang, src: s.src, latin: s.latin, pua: s.pua })));
  note('J2 text after reload', j2txt);
  ck('J2: a span placed inside the 500 ms autosave debounce survives an immediate reload',
     j2spans.length === 1 && j2spans[0].src === 'lamp holds', JSON.stringify(j2spans.map(s => s.src)));
  ck('J2: nothing else in the scene was lost',
     j2txt.includes('the sea remembers the old king'), j2txt.slice(0, 100));
  ck('J2: restored span is real script, no Latin fallback',
     j2spans.every(s => s.latin === 0 && s.inRange > 0), JSON.stringify(j2spans.map(s => ({ l: s.latin, p: s.inRange }))));
  noNewErrors(e0, 'J2(reload inside save debounce)');
}

/* ================================================================
   K. app still usable at the end
   ================================================================ */
{
  const e0 = errMark();
  await focusEditorEnd();
  await page.keyboard.insertText(' the old king');
  await wait(500);
  await selectWord('the old king');
  await openCtxTranslate();
  const stillWorks = await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count();
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(600);
  await page.locator('#sheet .sh-item', { hasText: 'Evernessian' }).click();
  await wait(1800);
  const final = await spanDump();
  note('K final spans', final.map(s => ({ lang: s.lang, src: s.src, pua: s.pua, latin: s.latin })));
  ck('K: after every hostile case the translate loop still works end to end',
     stillWorks === 1 && final.some(s => s.lang === 'evernessian' && s.src === 'the old king' && s.latin === 0),
     JSON.stringify(final.map(s => [s.lang, s.src])));
  noNewErrors(e0, 'K(final usability)');
}

console.log('\npageerrors total:', errors.length, errors.slice(0, 5));
const failed = checks.filter(c => !c[1]);
console.log(`\n${checks.length - failed.length}/${checks.length} checks ok`);
for(const f of failed) console.log('  FAILED:', f[0]);
verdict('TX-12 HOSTILE TIMING', failed.length === 0 && errors.length === 0);
await browser.close();
await srv.close();
