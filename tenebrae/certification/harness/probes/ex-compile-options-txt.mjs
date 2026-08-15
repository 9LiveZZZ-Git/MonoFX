// EX-1 (gap-closer) — compile options must govern the PLAIN-TEXT compile
// path too, not just markdown (compile() shares `o`/`sep` across kinds,
// step1.html L2011-2041, but only the .md path had functional coverage).
// Builds a 2-scene book, downloads book.txt at defaults, then with
// {sceneTitles:on, asterism:off}, and verifies the txt output tracks the
// options; a reload then re-checks the persisted combination in txt.
// Run: cd probes && node ex-compile-options-txt.mjs
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

await createBook(page, 'Txt Options Book');
await page.click('#ed-title');  await page.keyboard.type('T1');
await page.click('#ed-content'); await page.keyboard.type('alpha one');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');  await page.keyboard.type('T2');
await page.click('#ed-content'); await page.keyboard.type('beta two');
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);

const openSheet = async () => { await page.click('#bk-share'); await wait(page, 450); };
const grabTxt = () => downloadFromSheet(page, 'Download plain text (.txt)');
const stats = t => ({
  ch: (t.match(/^CHAPTER 1$/gm) || []).length,
  sc: (t.match(/^T\d$/gm) || []).length,
  ast: (t.match(/^⁂$/gm) || []).length,
});

// defaults: chapter title (uppercased) on, scene titles off, ⁂ on
await openSheet();
const d1 = stats((await grabTxt()).text);
console.log('txt defaults:', JSON.stringify(d1));
checks.push(has('txt defaults: chapter heading, no scene titles, 1 separator',
  d1.ch === 1 && d1.sc === 0 && d1.ast === 1));

// flip: scene titles on, asterism off
await openSheet();
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: '⁂ between scenes' }).click();
await wait(page, 450);
const d2raw = await grabTxt();
const d2 = stats(d2raw.text);
console.log('txt flipped:', JSON.stringify(d2));
console.log('--- book.txt (flipped) ---\n' + d2raw.text + '\n---------------');
checks.push(has('txt honors {sceneTitles:on, asterism:off}',
  d2.ch === 1 && d2.sc === 2 && d2.ast === 0));

// persisted across reload, still honored by the txt path
await wait(page, 1500);
await page.reload(); await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'Txt Options Book' }).click();
await wait(page, 500);
await openSheet();
const d3 = stats((await grabTxt()).text);
console.log('txt after reload:', JSON.stringify(d3));
checks.push(has('txt options persist across reload', d3.ch === 1 && d3.sc === 2 && d3.ast === 0));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-1 txt-path options', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
