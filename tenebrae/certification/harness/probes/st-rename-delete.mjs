// ST-3 — rename book / chapter / scene through the real sheets; delete each
// level and verify the destructive confirmation guard appears (and that
// Cancel actually cancels) before anything is removed.
// Run: cd probes && node st-rename-delete.mjs
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

// create a book (lands in editor), go back to book screen
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Rename Me');
await page.click('#ps-save');
await T(700);
await page.click('#ed-back');
await T(500);

// --- rename book
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Rename book' }).click();
await T(400);
console.log('rename-book prefill:', JSON.stringify(await page.inputValue('#ps-input')));
await page.fill('#ps-input', 'Renamed Book');
await page.click('#ps-save');
await T(600);
const bkTitle = await page.locator('#bk-title').innerText();
console.log('book title after rename:', JSON.stringify(bkTitle));

// --- rename chapter (tap chapter head -> chapter sheet)
await page.locator('#bk-list .ch-head .name').first().click();
await T(400);
await page.locator('#sheet button', { hasText: 'Rename chapter' }).click();
await T(400);
await page.fill('#ps-input', 'First Chapter');
await page.click('#ps-save');
await T(600);
// NOTE: .ch-head .name is uppercased by CSS; compare case-insensitively.
const chName = await page.locator('#bk-list .ch-head .name').first().innerText();
console.log('chapter after rename:', JSON.stringify(chName));

// --- rename scene (edit mode -> row tap opens scene sheet)
await page.click('#bk-edit');
await T(400);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(400);
await page.locator('#sheet button', { hasText: 'Rename scene' }).click();
await T(400);
await page.fill('#ps-input', 'Opening');
await page.click('#ps-save');
await T(600);
const scName = await page.locator('#bk-list .row[data-scene] .t').first().innerText();
console.log('scene after rename:', JSON.stringify(scName));

// --- delete scene: guard must appear; Cancel must cancel
await page.locator('#bk-list .row[data-scene] .del').first().click();
await T(400);
let sheetTxt = await page.locator('#sheet').innerText();
console.log('scene delete guard:', JSON.stringify(sheetTxt.replace(/\n/g, ' | ')));
const guardScene = /Delete this scene\?/.test(sheetTxt) && /can.t be undone/i.test(sheetTxt);
await page.click('#cs-no'); // cancel
await T(500);
const stillThere = await page.locator('#bk-list .row[data-scene]').count();
console.log('after cancel, scene rows:', stillThere);
await page.locator('#bk-list .row[data-scene] .del').first().click();
await T(400);
await page.click('#cs-yes');
await T(600);
const afterDel = await page.locator('#bk-list .row[data-scene]').count();
console.log('after confirm, scene rows:', afterDel);

// --- delete chapter: guard must appear
await page.locator('#bk-list .ch-head .name').first().click();
await T(400);
await page.locator('#sheet button', { hasText: 'Delete chapter' }).click();
await T(400);
sheetTxt = await page.locator('#sheet').innerText();
console.log('chapter delete guard:', JSON.stringify(sheetTxt.replace(/\n/g, ' | ')));
const guardCh = /Delete .First Chapter.\?/.test(sheetTxt) && /can.t be undone/i.test(sheetTxt);
await page.click('#cs-yes');
await T(600);
const chCount = await page.locator('#bk-list .chapter-block').count();
console.log('chapters after confirm:', chCount);

// --- delete book: guard must appear; Cancel first, then confirm
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Delete book' }).click();
await T(400);
sheetTxt = await page.locator('#sheet').innerText();
console.log('book delete guard:', JSON.stringify(sheetTxt.replace(/\n/g, ' | ')));
const guardBook = /Delete .Renamed Book.\?/.test(sheetTxt) && /can.t be undone/i.test(sheetTxt);
await page.click('#cs-no');
await T(500);
const bookStill = await page.locator('#bk-title').innerText();
console.log('after cancel, book title still:', JSON.stringify(bookStill));
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Delete book' }).click();
await T(400);
await page.click('#cs-yes');
await T(700);
const onLibrary = await page.evaluate(() => document.querySelector('#scr-library').classList.contains('on'));
const libEmpty = await page.locator('#lib-empty').innerText();
console.log('after confirm: on library =', onLibrary, '| empty state =', JSON.stringify(libEmpty.slice(0, 40)));

const ok =
  bkTitle === 'Renamed Book' && chName.toLowerCase() === 'first chapter' && scName === 'Opening' &&
  guardScene && stillThere === 1 && afterDel === 0 &&
  guardCh && chCount === 0 &&
  guardBook && bookStill === 'Renamed Book' && onLibrary && /Nothing written yet/.test(libEmpty);
console.log(ok ? 'ST-3 VERDICT: PASS' : 'ST-3 VERDICT: FAIL');

await browser.close();
await srv.close();
