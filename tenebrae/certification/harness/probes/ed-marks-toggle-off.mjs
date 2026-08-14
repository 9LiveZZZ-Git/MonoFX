// ED-2 (adversarial round) — marks are toggles, not one-way stamps.
// Applies bold and small-caps to words, then re-selects and applies the same
// control again: the mark must come OFF (bold via queryCommandState path,
// small-caps via the insideSC unwrap branch of toggleSmallCaps, step1.html
// L1522-L1529). Verifies live DOM and the persisted doc after reload.
// Run: cd probes && node ed-marks-toggle-off.mjs
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
await page.fill('#ps-input', 'ToggleOff Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('alpha bravo');
await T(300);

const selectWord = word => page.evaluate(w => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf(w);
    if (i > -1) {
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + w.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
  }
  return false;
}, word);

const state = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const has = (sel, word) => [...ed.querySelectorAll(sel)].some(el => el.textContent.includes(word));
  return { html: ed.innerHTML, boldAlpha: has('b,strong', 'alpha'), scBravo: has('span.sc', 'bravo') };
});

// bold ON then OFF on "alpha"
console.log('select alpha:', await selectWord('alpha'));
await page.click('[data-cmd="bold"]');
await T(250);
const afterBoldOn = await state();
console.log('after bold ON: boldAlpha=%s | %s', afterBoldOn.boldAlpha, afterBoldOn.html);
console.log('re-select alpha:', await selectWord('alpha'));
await page.click('[data-cmd="bold"]');
await T(250);
const afterBoldOff = await state();
console.log('after bold OFF: boldAlpha=%s | %s', afterBoldOff.boldAlpha, afterBoldOff.html);

// small-caps ON then OFF on "bravo"
console.log('select bravo:', await selectWord('bravo'));
await page.click('#fb-sc');
await T(250);
const afterScOn = await state();
console.log('after sc ON: scBravo=%s | %s', afterScOn.scBravo, afterScOn.html);
console.log('re-select bravo:', await selectWord('bravo'));
await page.click('#fb-sc');
await T(250);
const afterScOff = await state();
console.log('after sc OFF: scBravo=%s | %s', afterScOff.scBravo, afterScOff.html);

// persist + reload: the plain text must be stored without residual mark wrappers
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'ToggleOff Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await state();
console.log('STORED: boldAlpha=%s scBravo=%s | %s', stored.boldAlpha, stored.scBravo, stored.html);

const ok =
  afterBoldOn.boldAlpha && !afterBoldOff.boldAlpha &&
  afterScOn.scBravo && !afterScOff.scBravo &&
  !stored.boldAlpha && !stored.scBravo &&
  stored.html.includes('alpha') && stored.html.includes('bravo');
console.log(ok ? 'ED-2-TOGGLE-OFF VERDICT: PASS' : 'ED-2-TOGGLE-OFF VERDICT: FAIL');

await browser.close();
await srv.close();
