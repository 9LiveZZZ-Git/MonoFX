// ST-5 — scene status draft/revised/final (editor chip + edit-mode scene
// sheet, reflected on the scene row dot) and per-book word goal with
// progress display (book header thread + library minibar), surviving reload.
// Run: cd probes && node st-status-goal.mjs
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

// book with one scene of exactly 10 words
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Status Book');
await page.click('#ps-save');
await T(700);
await page.click('#ed-content');
await page.keyboard.type('alpha beta gamma delta epsilon zeta eta theta iota kappa');
await T(1400);
console.log('editor count:', JSON.stringify(await page.locator('#ed-count').innerText()));

// --- status via the editor chip
console.log('status before:', JSON.stringify(await page.locator('#ed-statuslabel').innerText()));
await page.click('#ed-status');
await T(400);
const statusChoices = await page.locator('#sheet .sh-item .lbl').allInnerTexts();
console.log('status sheet options:', JSON.stringify(statusChoices));
await page.locator('#sheet button', { hasText: 'Revised' }).click();
await T(500);
const statusAfter = await page.locator('#ed-statuslabel').innerText();
const dotClass = await page.getAttribute('#ed-dot', 'class');
console.log('status after:', JSON.stringify(statusAfter), '| dot class:', JSON.stringify(dotClass));

// row dot reflects it on the book screen
await page.click('#ed-back');
await T(500);
const rowDot1 = await page.getAttribute('#bk-list .row[data-scene] .dot', 'class');
console.log('scene row dot after Revised:', JSON.stringify(rowDot1));

// --- status via edit-mode scene sheet -> Final
await page.click('#bk-edit');
await T(400);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(400);
await page.locator('#sheet button', { hasText: 'Final' }).click();
await T(500);
const rowDot2 = await page.getAttribute('#bk-list .row[data-scene] .dot', 'class');
console.log('scene row dot after Final:', JSON.stringify(rowDot2));
await page.click('#bk-edit'); // leave edit mode
await T(400);

// --- word goal
const threadHidden = await page.evaluate(() => document.querySelector('#bk-thread').style.display === 'none');
console.log('goal thread hidden before goal:', threadHidden);
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Set a word goal' }).click();
await T(400);
await page.fill('#ps-input', '100');
await page.click('#ps-save');
await T(600);
const threadShown = await page.evaluate(() => document.querySelector('#bk-thread').style.display !== 'none');
const cap = await page.locator('#bk-cap').innerText();
const fillW = await page.evaluate(() => document.querySelector('#bk-fill').style.width);
console.log('goal thread shown:', threadShown, '| cap:', JSON.stringify(cap), '| fill width:', JSON.stringify(fillW));

// book "more" sheet now labels the goal
await page.click('#bk-more');
await T(400);
const goalLabel = await page.locator('#sheet .sh-item', { hasText: 'Word goal' }).innerText();
console.log('sheet goal label:', JSON.stringify(goalLabel.trim()));
await page.locator('#scrim').click({ position: { x: 10, y: 10 } }); // dismiss (top corner, clear of the sheet)
await T(500);

// library minibar
await page.click('#bk-back');
await T(500);
const minibar = await page.evaluate(() => {
  const i = document.querySelector('#lib-list .row .minibar i');
  return i ? i.style.width : null;
});
console.log('library minibar width:', JSON.stringify(minibar));

// --- status + goal survive reload
await T(1200);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Status Book' }).click();
await T(600);
const rowDotReload = await page.getAttribute('#bk-list .row[data-scene] .dot', 'class');
const capReload = await page.locator('#bk-cap').innerText();
console.log('after reload — row dot:', JSON.stringify(rowDotReload), '| cap:', JSON.stringify(capReload));

const ok =
  JSON.stringify(statusChoices) === JSON.stringify(['Draft', 'Revised', 'Final']) &&
  statusAfter === 'Revised' && /revised/.test(rowDot1) &&
  /final/.test(rowDot2) &&
  threadShown && /10 of 100 words/.test(cap) && /10%/.test(cap) && fillW === '10%' &&
  /Word goal — 100/.test(goalLabel) &&
  minibar === '10%' &&
  /final/.test(rowDotReload) && /10 of 100 words/.test(capReload);
console.log(ok ? 'ST-5 VERDICT: PASS' : 'ST-5 VERDICT: FAIL');

await browser.close();
await srv.close();
