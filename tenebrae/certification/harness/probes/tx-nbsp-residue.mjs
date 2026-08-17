// TX-8/TX-9 defect isolation: the NBSP residue left by every span insertion.
//
// placeTSpan (step1.html:3302) inserts the span AND a trailing NBSP:
//     placed = edApplyHTML(range, spanOuterHTML(span) + ' ');
// The NBSP is a caret landing spot after an atomic contenteditable=false node.
// But "Revert to plain text" and "Remove span" both operate on rangeAround(el)
// — the span node alone (step1.html:3355, 3361) — so the NBSP is never taken
// back. Each translate/undo-your-mind cycle therefore leaves one extra NBSP in
// the author's paragraph, and they accumulate.
//
// This probe is the minimal reproduction: it measures the residue for BOTH
// exit paths (revert and remove), and confirms it reaches the persisted doc.
// Ctrl+Z is measured too — undo is the one exit that is clean.
//
// Run: cd probes && node tx-nbsp-residue.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, ok ? '' : (extra === undefined ? '' : extra)); };
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s) s.click(); }); await wait(page, 350); };
const tapSpan = async () => { await page.evaluate(() => document.querySelectorAll('#ed-content .tspan')[0].click()); await wait(page, 800); };
const sheetItem = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 850); };
const para = () => page.evaluate(() => {
  const p = [...document.querySelectorAll('#ed-content p')].find(x => /dusk/.test(x.textContent));
  return p ? p.textContent : '';
});
const nbsp = s => [...s].filter(c => c === ' ').length;
const focusEditor = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content'); ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});

const LINE = 'at dusk the drover walks a long road and sleeps';
await createBook(page, 'NBSP Residue');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type(LINE);
await wait(page, 1000);

const base = await para();
ck('baseline: the typed paragraph has no NBSP', nbsp(base) === 0 && base === LINE, JSON.stringify(base));

// --- exit path 1: revert to plain text ---
await insertTranslationSpan(page, 'the drover walks', 'Kerrackian');
await wait(page, 500);
const inserted = await para();
await tapSpan(); await sheetItem('Revert to plain text');
const reverted = await para();
console.log('revert:', JSON.stringify(reverted));
ck('revert: the English words are exactly right', reverted.replace(/[\s ]+/g, ' ') === LINE, JSON.stringify(reverted));
ck('revert: leaves NO whitespace residue behind', nbsp(reverted) === 0,
   `NBSP count: baseline 0 -> inserted ${nbsp(inserted)} -> reverted ${nbsp(reverted)}; paragraph is now ` +
   JSON.stringify(reverted));

// --- exit path 2: remove span ---
const beforeRemove = await para();
await closeSheet();
await insertTranslationSpan(page, 'the drover walks', 'Kerrackian');
await wait(page, 500);
await tapSpan(); await sheetItem('Remove span');
const removed = await para();
console.log('remove:', JSON.stringify(removed));
ck('remove: leaves NO whitespace residue behind', nbsp(removed) === nbsp(beforeRemove),
   `NBSP count: ${nbsp(beforeRemove)} before -> ${nbsp(removed)} after; paragraph is now ` + JSON.stringify(removed));

// --- exit path 3: Ctrl+Z (the clean one) ---
await closeSheet();
const beforeUndo = await para();   // note: 'the drover walks' was consumed by the remove above
await insertTranslationSpan(page, 'long road', 'Kerrackian');
await wait(page, 500);
await closeSheet(); await focusEditor();
await page.keyboard.press('Control+z');
await wait(page, 600);
const undone = await para();
console.log('undo:', JSON.stringify(undone));
ck('undo: restores the paragraph codepoint-for-codepoint (no residue)', undone === beforeUndo,
   `${JSON.stringify(undone)} vs ${JSON.stringify(beforeUndo)}`);

// --- the residue reaches storage ---
await wait(page, 1400);
const doc = await page.evaluate(() => window.tenebrae._omni.probe.sceneDoc());
console.log('persisted doc:', JSON.stringify(doc.slice(-140)));
ck('the residue does not reach the persisted manuscript', !/&nbsp;/.test(doc), doc.slice(-140));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-8/9 NBSP residue', checks.every(c => c[1]));
console.log(`${checks.filter(c => c[1]).length}/${checks.length} checks passed`);
await browser.close();
await srv.close();
