// TX-9 VERIFIER — "nothing is trapped or lost", on the author actions the
// writer's tx-undo-persist probe never performs.
//
// That probe drives insert / change-tongue / edit-source / revert / remove
// through the sheet, then undo+redo. Real authors also delete with the keyboard,
// move text around, and come back to a document after a reload. So:
//
//   A. WHITESPACE DRIFT — 6 insert+remove cycles: does the prose come back to
//      what it was, or does each cycle leave residue behind?
//   B. KEYBOARD DELETE  — select the span and press Backspace, then Ctrl+Z:
//      does the span come back whole (lang/src/rom/scr, still PUA, not Latin)?
//   C. CUT AND PASTE    — Ctrl+X the span, paste it elsewhere: does it survive
//      as a live translated span, or does it degrade to Latin / lose data-src?
//   D. SELECT-ALL DELETE + UNDO — the nuclear case.
//   E. UNDO AFTER RELOAD — Ctrl+Z on a rehydrated document must not corrupt.
//   F. SCENE SWITCH     — leave the scene and come back.
//
// Run: cd probes && node tx-vp-span-lifecycle.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const PROSE = 'alpha beta the sea remembers gamma delta the old king omega';
const checks = [];
const ck = (label, ok, detail) => { checks.push({ label, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ' — ' + detail}`); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const sig = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const spans = [...ed.querySelectorAll('.tspan')].map(el => ({
    lang: el.dataset.lang, src: el.dataset.src, rom: el.dataset.rom, scr: el.dataset.scr,
    flow: el.dataset.flow || null, omni: el.dataset.omni || null, text: el.textContent,
    pua: [...el.textContent].filter(c => c >= '' && c <= '').length,
    latin: /[A-Za-z]/.test(el.textContent), svg: el.querySelectorAll('svg').length,
    font: getComputedStyle(el).fontFamily,
  }));
  return { prose: ed.textContent, html: ed.innerHTML.length, spans };
});
const selectSpan = () => page.evaluate(() => {
  const el = document.querySelector('#ed-content .tspan');
  if (!el) return false;
  const r = document.createRange(); r.selectNode(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  return true;
});
const removeViaSheet = async () => {
  await page.click('#ed-content .tspan');
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: 'Remove span' }).click();
  await wait(page, 600);
};

await createBook(page, 'TX9 Lifecycle');
await page.click('#ed-content');
await page.keyboard.type(PROSE);
await wait(page, 600);
const clean = await sig();
console.log('start prose:', JSON.stringify(clean.prose));

/* ---- A. whitespace drift over repeated insert+remove ---- */
const drift = [];
for (let i = 0; i < 6; i++) {
  await insertTranslationSpan(page, 'the sea remembers', 'Celan High');
  await wait(page, 300);
  await removeViaSheet();
  const s = await sig();
  drift.push({ cycle: i + 1, len: s.prose.length, nbsp: (s.prose.match(/ /g) || []).length, spans: s.spans.length });
  // put the English back so the next cycle has something to select
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, last = null; while ((n = w.nextNode())) last = n;
    if (last) last.nodeValue = last.nodeValue.replace(/\s*$/, ' the sea remembers ');
  });
  await wait(page, 200);
}
console.log('   drift per cycle:', JSON.stringify(drift));
const nbspGrowth = drift[drift.length - 1].nbsp - drift[0].nbsp;
ck('repeated insert+remove leaves no growing whitespace residue',
   nbspGrowth <= 0, `NBSP count grew from ${drift[0].nbsp} to ${drift[drift.length - 1].nbsp} over 6 cycles`);
ck('no orphan spans left behind by remove', drift.every(d => d.spans === 0), JSON.stringify(drift));

/* ---- reset to a clean two-span document ---- */
await page.evaluate(p => { document.querySelector('#ed-content').innerHTML = `<p>${p}</p>`; }, PROSE);
await page.click('#ed-content'); await wait(page, 400);
await insertTranslationSpan(page, 'the sea remembers', 'Celan High');
await insertTranslationSpan(page, 'the old king', 'Kildaren');
await wait(page, 800);
const two = await sig();
ck('two spans built for the lifecycle tests', two.spans.length === 2, JSON.stringify(two.spans.map(s => s.lang)));

/* ---- B. keyboard delete + undo ---- */
await selectSpan();
await page.keyboard.press('Backspace');
await wait(page, 500);
const afterDel = await sig();
ck('Backspace over a selected span deletes exactly that span', afterDel.spans.length === 1,
   `${afterDel.spans.length} spans left`);
await page.click('#ed-content');
await page.keyboard.press('Control+z');
await wait(page, 700);
const afterUndo = await sig();
const restored = afterUndo.spans.find(s => s.lang === 'celan_high');
ck('Ctrl+Z restores the keyboard-deleted span whole (lang/src/rom/scr all intact)',
   !!restored && restored.src === two.spans[0].src && restored.rom === two.spans[0].rom && restored.scr === two.spans[0].scr,
   JSON.stringify(restored));
ck('the restored span is still script, never Latin', !!restored && restored.pua > 0 && !restored.latin, JSON.stringify(restored && { pua: restored.pua, latin: restored.latin }));

/* ---- C. cut and paste the span elsewhere ---- */
let cutPasteNote = '';
await selectSpan();
await page.keyboard.press('Control+x');
await wait(page, 500);
const afterCut = await sig();
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, last = null; while ((n = w.nextNode())) last = n;
  const r = document.createRange();
  if (last) { r.setStart(last, last.nodeValue.length); r.collapse(true); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.keyboard.press('Control+v');
await wait(page, 800);
const afterPaste = await sig();
const moved = afterPaste.spans.find(s => s.lang === 'celan_high');
if (afterCut.spans.length === afterPaste.spans.length && afterCut.spans.length === 1 && !moved) {
  cutPasteNote = 'clipboard unavailable in this headless context — cut removed the span, paste restored nothing';
}
ck('a cut-and-pasted span survives as a live translated span (src/rom/scr intact, still PUA)',
   !!moved && moved.src === two.spans[0].src && moved.rom === two.spans[0].rom && moved.pua > 0 && !moved.latin,
   cutPasteNote || JSON.stringify({ afterCut: afterCut.spans.length, afterPaste: afterPaste.spans.map(s => ({ l: s.lang, latin: s.latin, pua: s.pua, src: s.src })) }));

/* ---- D. select-all delete + undo ---- */
await page.evaluate(() => { document.querySelector('#ed-content').focus(); });
await page.keyboard.press('Control+a');
await page.keyboard.press('Backspace');
await wait(page, 600);
const wiped = await sig();
await page.keyboard.press('Control+z');
await wait(page, 900);
const unwiped = await sig();
ck('select-all + delete then Ctrl+Z restores every span, still as script',
   unwiped.spans.length === afterPaste.spans.length &&
   unwiped.spans.every(s => s.pua > 0 && !s.latin && s.src && s.rom && s.scr),
   `wiped=${wiped.spans.length} restored=${unwiped.spans.length}/${afterPaste.spans.length} ${JSON.stringify(unwiped.spans.map(s => ({ l: s.lang, latin: s.latin })))}`);

/* ---- E. undo after reload, F. scene switch ---- */
await wait(page, 1600);
const preReload = await sig();
await page.reload();
await wait(page, 1400);
await page.locator('#lib-list .row', { hasText: 'TX9 Lifecycle' }).click();
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 3000);
const rehydrated = await sig();
ck('every span survives the reload byte-identically',
   JSON.stringify(rehydrated.spans) === JSON.stringify(preReload.spans),
   JSON.stringify(rehydrated.spans.map(s => ({ l: s.lang, latin: s.latin }))) + ' vs ' + JSON.stringify(preReload.spans.map(s => ({ l: s.lang, latin: s.latin }))));

await page.click('#ed-content');
for (let i = 0; i < 5; i++) { await page.keyboard.press('Control+z'); await wait(page, 200); }
await wait(page, 500);
const afterReloadUndo = await sig();
ck('Ctrl+Z on a rehydrated document corrupts nothing (no Latin, no half-spans)',
   afterReloadUndo.spans.every(s => s.pua > 0 && !s.latin && s.src && s.rom && s.scr && s.text === s.scr),
   JSON.stringify(afterReloadUndo.spans.map(s => ({ l: s.lang, latin: s.latin, textIsScr: s.text === s.scr }))));

await page.click('#ed-back');
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 2500);
const afterSwitch = await sig();
ck('leaving the scene and coming back keeps every span intact',
   afterSwitch.spans.length === afterReloadUndo.spans.length &&
   afterSwitch.spans.every(s => s.pua > 0 && !s.latin),
   JSON.stringify(afterSwitch.spans.map(s => ({ l: s.lang, latin: s.latin }))));

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
const bad = checks.filter(c => !c.ok).length;
console.log(`${checks.length - bad}/${checks.length} checks ok`);
verdict('SPAN LIFECYCLE', bad === 0 && errors.length === 0);
await browser.close();
await srv.close();
