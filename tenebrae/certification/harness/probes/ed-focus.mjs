// ED-5 — Focus (zen) mode toggle: #ed-focusbtn enters zen (body.zen class,
// top bar slides away, editor meta hidden, #zen-exit floating button shown);
// #zen-exit leaves it; navigating away from the editor also clears zen.
// Run: cd probes && node ed-focus.mjs
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

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Zen Book');
await page.click('#ps-save');
await T(700);

const uiState = () => page.evaluate(() => ({
  zen: document.body.classList.contains('zen'),
  exitBtnDisplay: getComputedStyle(document.querySelector('#zen-exit')).display,
  barTransform: getComputedStyle(document.querySelector('#scr-editor .bar')).transform,
  metaOpacity: getComputedStyle(document.querySelector('#scr-editor .ed-meta')).opacity,
}));

const before = await uiState();
console.log('before:', JSON.stringify(before));

// enter focus mode via the real toolbar button
await page.click('#ed-focusbtn');
await T(500);
const during = await uiState();
console.log('during:', JSON.stringify(during));

// exit via the floating ⁂ button
await page.click('#zen-exit');
await T(500);
const after = await uiState();
console.log('after exit:', JSON.stringify(after));

// re-enter, then leave the editor: applyNav must clear zen on non-editor screens
await page.click('#ed-focusbtn');
await T(400);
const reentered = await page.evaluate(() => document.body.classList.contains('zen'));
await page.evaluate(() => document.querySelector('#ed-back').click()); // bar is off-screen in zen; drive the handler
await T(500);
const afterNav = await page.evaluate(() => ({
  zen: document.body.classList.contains('zen'),
  onBook: document.querySelector('#scr-book').classList.contains('on'),
}));
console.log('re-entered zen:', reentered, '| after back-nav:', JSON.stringify(afterNav));

const ok =
  !before.zen && before.exitBtnDisplay === 'none' &&
  during.zen && during.exitBtnDisplay === 'flex' &&
  during.barTransform !== 'none' && during.metaOpacity === '0' &&
  !after.zen && after.exitBtnDisplay === 'none' && after.metaOpacity === '1' &&
  reentered && afterNav.onBook && !afterNav.zen;
console.log(ok ? 'ED-5 VERDICT: PASS' : 'ED-5 VERDICT: FAIL');

await browser.close();
await srv.close();
