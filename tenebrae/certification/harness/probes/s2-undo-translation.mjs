// X2-13: translation operations join the NATIVE undo stack.
// Insert → Ctrl+Z restores the selected source text exactly; redo re-inserts;
// edit-source retranslate, revert-to-plain, and remove-span are all undoable.
// Run: cd probes && node s2-undo-translation.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

const edState = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const sp = ed.querySelector('.tspan');
  return {
    text: ed.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
    spans: ed.querySelectorAll('.tspan').length,
    span: sp ? { src: sp.dataset.src, lang: sp.dataset.lang, rom: sp.dataset.rom } : null,
  };
});
const focusEditor = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const undo = async () => { await focusEditor(); await page.keyboard.press('Control+z'); await wait(page, 500); };
const redo = async () => { await focusEditor(); await page.keyboard.press('Control+Shift+z'); await wait(page, 500); };

await createBook(page, 'Undo Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the harbor keeps its old promises tonight');
await wait(page, 1500);

const before = await edState();
console.log('before:', JSON.stringify(before));

// ---- insert, then undo, then redo ----
await insertTranslationSpan(page, 'old promises', 'Celan Basic');
const inserted = await edState();
console.log('inserted:', JSON.stringify(inserted));
ck('span inserted with source kept', inserted.spans === 1 && inserted.span && inserted.span.src === 'old promises');

await undo();
const afterUndo = await edState();
console.log('after undo:', JSON.stringify(afterUndo));
ck('undo removes the span', afterUndo.spans === 0);
ck('undo restores the original text exactly', afterUndo.text === before.text, JSON.stringify(afterUndo.text));

await redo();
const afterRedo = await edState();
ck('redo re-inserts the span', afterRedo.spans === 1 && afterRedo.span && afterRedo.span.src === 'old promises');

// ---- undone state persists across reload ----
await undo();
await wait(page, 1400);
await page.reload();
await wait(page, 800);
// back into the scene: library -> book -> scene row
await page.locator('#lib-list .row', { hasText: 'Undo Book' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
const persisted = await edState();
ck('undone state persists across reload', persisted.spans === 0 && persisted.text === before.text, JSON.stringify(persisted.text));

// ---- edit-source retranslate is undoable ----
await insertTranslationSpan(page, 'old promises', 'Celan Basic');
const v1 = await edState();
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Edit source & retranslate' }).click();
await wait(page, 500);
await page.fill('#ps-input', 'new promises spoken');
await page.click('#ps-save');
await wait(page, 900);
const v2 = await edState();
ck('retranslate replaced the span', v2.spans === 1 && v2.span.src === 'new promises spoken', JSON.stringify(v2.span));
await undo();
const v3 = await edState();
ck('undo restores the previous span (old source)', v3.spans === 1 && v3.span && v3.span.src === 'old promises', JSON.stringify(v3.span));

// ---- revert to plain text is undoable ----
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
await wait(page, 700);
const r1 = await edState();
ck('revert produces plain source text, no span', r1.spans === 0 && /old promises/.test(r1.text));
await undo();
const r2 = await edState();
ck('undo restores the span after revert', r2.spans === 1 && r2.span && r2.span.src === 'old promises');

// ---- remove span is undoable ----
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Remove span' }).click();
await wait(page, 700);
const d1 = await edState();
ck('remove deletes the span', d1.spans === 0);
await undo();
const d2 = await edState();
ck('undo restores the removed span', d2.spans === 1 && d2.span && d2.span.src === 'old promises');

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-13 undo-translation', checks.every(c => c[1]));
await browser.close();
await srv.close();
