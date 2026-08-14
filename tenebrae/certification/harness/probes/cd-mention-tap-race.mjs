// CD-3 anomaly reproduction — first tap on a "Mentioned in" row is swallowed
// when #cc-notes still holds focus: the tap's mousedown blurs the notes field,
// blur fires renderCardLinks() (step1.html L3219 -> L3156) which rebuilds
// #cc-mentions innerHTML, so the click completes on a detached node and no
// navigation happens. A second tap works. This probe measures both taps.
// Run: cd probes && node cd-mention-tap-race.mjs
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

// book + prose mentioning the card
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Race Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Gate');
await page.click('#ed-content');
await page.keyboard.type('Serane stood at the gate.');
await T(1400);
await page.click('#ed-back');
await T(500);

// card whose title matches the prose
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Serane');
await page.click('#ps-save');
await T(700);

// leave focus in the notes field, then tap the mention row ONCE
await page.click('#cc-notes');
await page.keyboard.type('Watcher of the gate.');
await T(700);
const focusIsNotes = await page.evaluate(() => document.activeElement && document.activeElement.id === 'cc-notes');
await page.click('#cc-mentions .ment');
await T(700);
const afterFirst = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
console.log('notes focused before tap:', focusIsNotes, '| first tap navigated:', afterFirst);

let afterSecond = afterFirst;
if(!afterFirst){
  await page.click('#cc-mentions .ment');
  await T(700);
  afterSecond = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
  console.log('second tap navigated:', afterSecond);
}

console.log(!afterFirst && afterSecond
  ? 'ANOMALY REPRODUCED: first tap swallowed while notes focused; second tap works'
  : (afterFirst ? 'NOT REPRODUCED: first tap navigated fine' : 'WORSE: second tap also failed'));

await browser.close();
await srv.close();
