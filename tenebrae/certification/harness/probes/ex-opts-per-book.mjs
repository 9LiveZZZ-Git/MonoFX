// EX-1 (adversarial) — export options are per BOOK, not global.
// Book A gets the non-default combination {chapterTitles:off, sceneTitles:on,
// asterism:off}; Book B is created afterwards and must still compile with the
// defaults {chapterTitles:on, sceneTitles:off, asterism:on}, both before and
// after a reload. A global (shared) options object would fail this.
// Run: cd probes && node ex-opts-per-book.mjs
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

// Book A: 2 scenes so the separator has something to separate
await createBook(page, 'Alpha Book');
await page.click('#ed-title');  await page.keyboard.type('A1');
await page.click('#ed-content'); await page.keyboard.type('alpha one');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');  await page.keyboard.type('A2');
await page.click('#ed-content'); await page.keyboard.type('alpha two');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

// flip all three options on Book A
await page.click('#bk-share'); await wait(page, 450);
for (const label of ['Include chapter titles', 'Include scene titles', '⁂ between scenes']) {
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 450);
}
const grab = () => downloadFromSheet(page, 'Download Markdown (.md)');
const stats = md => ({
  ch: (md.match(/^## /gm) || []).length,
  sc: (md.match(/^### [AB]\d$/gm) || []).length,
  ast: (md.match(/^⁂$/gm) || []).length,
});
const a1 = stats((await grab()).text);
console.log('Book A (flipped):', JSON.stringify(a1));
checks.push(has('Book A honors flipped options', a1.ch === 0 && a1.sc === 2 && a1.ast === 0));
await page.click('#bk-back'); await wait(page, 500);

// Book B afterwards: must have untouched defaults
await createBook(page, 'Beta Book');
await page.click('#ed-title');  await page.keyboard.type('B1');
await page.click('#ed-content'); await page.keyboard.type('beta one');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');  await page.keyboard.type('B2');
await page.click('#ed-content'); await page.keyboard.type('beta two');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

await page.click('#bk-share'); await wait(page, 450);
const b1 = stats((await grab()).text);
console.log('Book B (defaults):', JSON.stringify(b1));
checks.push(has('Book B keeps defaults after A was flipped', b1.ch === 1 && b1.sc === 0 && b1.ast === 1));

// reload → both books keep their own options
await wait(page, 1500);
await page.reload(); await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'Alpha Book' }).click(); await wait(page, 500);
await page.click('#bk-share'); await wait(page, 450);
const a2 = stats((await grab()).text);
console.log('Book A after reload:', JSON.stringify(a2));
checks.push(has('Book A options survive reload', a2.ch === 0 && a2.sc === 2 && a2.ast === 0));
await page.click('#bk-back'); await wait(page, 500);
await page.locator('#lib-list .row', { hasText: 'Beta Book' }).click(); await wait(page, 500);
await page.click('#bk-share'); await wait(page, 450);
const b2 = stats((await grab()).text);
console.log('Book B after reload:', JSON.stringify(b2));
checks.push(has('Book B defaults survive reload', b2.ch === 1 && b2.sc === 0 && b2.ast === 1));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-1 per-book options', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
