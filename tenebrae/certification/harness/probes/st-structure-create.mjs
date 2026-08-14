// ST-1 / ST-2 — create a book through the real UI; verify library metadata
// (word counts, chapter/scene counts); build Book → Chapter → Scene hierarchy
// (add a chapter, add a scene to that chapter).
// Run: cd probes && node st-structure-create.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// --- ST-1: create a book via the library "+" button
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Alpha Book');
await page.click('#ps-save');
await T(700);

// promptNewBook creates Chapter 1 + an empty scene and opens the editor
const inEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
console.log('after create: editor open =', inEditor);

// type 5 words so the library has a non-zero word count to show
await page.click('#ed-content');
await page.keyboard.type('one two three four five');
await T(1400); // debounce (450) + save (500)

// back to book screen
await page.click('#ed-back');
await T(500);
const bkSub = await page.locator('#bk-sub').innerText();
const bkStat = await page.locator('#bk-stat').innerText();
console.log('book screen sub:', JSON.stringify(bkSub), '| stat:', JSON.stringify(bkStat));

// --- ST-2: add a second chapter via the book "more" sheet
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Add chapter' }).click();
await T(400);
const chPrefill = await page.inputValue('#ps-input');
console.log('new-chapter prompt prefill:', JSON.stringify(chPrefill));
await page.fill('#ps-input', 'The Second Gate');
await page.click('#ps-save');
await T(600);
const chNames = await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent));
console.log('chapters after add:', JSON.stringify(chNames));

// --- ST-2: add a scene to the new chapter via its + button (opens editor)
const ch2 = page.locator('.chapter-block', { hasText: 'The Second Gate' });
await ch2.locator('.add').click();
await T(600);
const inEditor2 = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
console.log('after add-scene: editor open =', inEditor2);
await page.click('#ed-title');
await page.keyboard.type('Gate Scene');
await page.click('#ed-content');
await page.keyboard.type('six seven eight');
await T(1400);
await page.click('#ed-back');
await T(500);

// hierarchy check: chapter 2 now contains the scene row
const ch2rows = await page.locator('.chapter-block', { hasText: 'The Second Gate' }).locator('.row[data-scene] .t').allInnerTexts();
console.log('scenes under "The Second Gate":', JSON.stringify(ch2rows));
const bkSub2 = await page.locator('#bk-sub').innerText();
console.log('book sub after adds:', JSON.stringify(bkSub2));

// --- ST-1: library lists the book with metadata + word count
await page.click('#bk-back');
await T(500);
const libSub = await page.locator('#lib-sub').innerText();
const row = await page.locator('#lib-list .row', { hasText: 'Alpha Book' }).innerText();
console.log('library sub:', JSON.stringify(libSub));
console.log('library row:', JSON.stringify(row.replace(/\n/g, ' | ')));

const ok =
  inEditor && inEditor2 &&
  chNames.length === 2 && chNames[1] === 'The Second Gate' &&
  ch2rows.length === 1 && ch2rows[0] === 'Gate Scene' &&
  /2 chapters/.test(row) && /2 scenes/.test(row) && /8 words/.test(row) &&
  /1 book/.test(libSub) && /8 words/.test(libSub);
console.log(ok ? 'ST-1/ST-2 VERDICT: PASS' : 'ST-1/ST-2 VERDICT: FAIL');

await browser.close();
await srv.close();
