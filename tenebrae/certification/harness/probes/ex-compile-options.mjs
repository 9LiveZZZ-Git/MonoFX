// EX-1 — Book compile honors options (chapter titles / scene titles / ⁂
// separators) and the options persist per book across reload.
// Builds a lean 2-chapter, 3-scene book (S1+S2 in Chapter 1, S3 in "Gate"),
// downloads the compiled .md at each option state, then reloads and checks
// both the sheet's checked state and a final download against the persisted
// non-default combination {chapterTitles:off, sceneTitles:on, asterism:off}.
// Run: cd probes && node ex-compile-options.mjs
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

// --- build: S1/S2 under Chapter 1, S3 under "Gate"
await createBook(page, 'Options Book');
await page.click('#ed-title');  await page.keyboard.type('S1');
await page.click('#ed-content'); await page.keyboard.type('alpha one');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');  await page.keyboard.type('S2');
await page.click('#ed-content'); await page.keyboard.type('beta two');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

await page.click('#bk-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
await wait(page, 500);
await page.fill('#ps-input', 'Gate'); await page.click('#ps-save');
await wait(page, 600);
await page.locator('.chapter-block', { hasText: 'Gate' }).locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');  await page.keyboard.type('S3');
await page.click('#ed-content'); await page.keyboard.type('gamma three');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

const openSheet = async () => { await page.click('#bk-share'); await wait(page, 450); };
const toggle = async label => {
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 450); // keepOpen re-render
};
const grab = () => downloadFromSheet(page, 'Download Markdown (.md)');
const stats = md => ({
  ch: (md.match(/^## /gm) || []).length,
  sc: (md.match(/^### S\d$/gm) || []).length,
  ast: (md.match(/^⁂$/gm) || []).length,
});
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

// 1) defaults: chapters on, scene titles off, ⁂ on
await openSheet();
const d1 = stats((await grab()).text);
console.log('defaults:', JSON.stringify(d1));
checks.push(has('defaults: 2 chapter titles, 0 scene titles, 1 separator', d1.ch === 2 && d1.sc === 0 && d1.ast === 1));

// 2) + scene titles
await openSheet(); await toggle('Include scene titles');
const d2 = stats((await grab()).text);
console.log('+sceneTitles:', JSON.stringify(d2));
checks.push(has('scene titles appear when toggled on', d2.ch === 2 && d2.sc === 3 && d2.ast === 1));

// 3) − chapter titles
await openSheet(); await toggle('Include chapter titles');
const d3 = stats((await grab()).text);
console.log('-chapterTitles:', JSON.stringify(d3));
checks.push(has('chapter titles vanish when toggled off', d3.ch === 0 && d3.sc === 3 && d3.ast === 1));

// 4) − asterism
await openSheet(); await toggle('⁂ between scenes');
const d4 = stats((await grab()).text);
console.log('-asterism:', JSON.stringify(d4));
checks.push(has('⁂ separators vanish when toggled off', d4.ch === 0 && d4.sc === 3 && d4.ast === 0));

// 5) persistence: reload, sheet state + compiled output must match the
// non-default combination
await wait(page, 1500);
await page.reload();
await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'Options Book' }).click();
await wait(page, 500);
await openSheet();
const checked = await page.$$eval('#sheet .sh-item.checked .lbl', els => els.map(e => e.textContent));
console.log('checked after reload:', JSON.stringify(checked));
checks.push(has('sheet remembers toggles after reload',
  checked.includes('Include scene titles') && !checked.includes('Include chapter titles') && !checked.some(l => l.includes('between scenes'))));
const d5 = stats((await grab()).text);
console.log('after reload:', JSON.stringify(d5));
checks.push(has('compiled output matches persisted options', d5.ch === 0 && d5.sc === 3 && d5.ast === 0));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-1', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
