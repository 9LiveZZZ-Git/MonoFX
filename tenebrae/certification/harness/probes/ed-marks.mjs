// ED-2 — Marks: bold, italic, underline, strikethrough, small-caps.
// Creates a book (auto-opens editor), types text, selects ranges (keyboard
// shift+arrows for bold, Selection API for the rest), applies each mark via
// the real format-bar buttons, verifies the DOM in #ed-content, then reloads
// and verifies the marks survived the sanitizer/persist round-trip.
// Run: cd probes && node ed-marks.mjs
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

// create a book -> editor opens on an empty scene
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Marks Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('alpha bravo charlie delta echo');
await T(300);

// --- bold via KEYBOARD selection: shift+arrow-left over the last word "echo"
for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
await page.click('[data-cmd="bold"]');
await T(250);

// helper: select a word inside #ed-content via the Selection API
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

console.log('select alpha:', await selectWord('alpha'));
await page.click('[data-cmd="italic"]');
await T(250);
console.log('select bravo:', await selectWord('bravo'));
await page.click('[data-cmd="underline"]');
await T(250);
console.log('select charlie:', await selectWord('charlie'));
await page.click('[data-cmd="strikeThrough"]');
await T(250);
console.log('select delta:', await selectWord('delta'));
await page.click('#fb-sc'); // small caps
await T(250);

const inspect = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const has = (sel, word) => [...ed.querySelectorAll(sel)].some(el => el.textContent.includes(word));
  return {
    html: ed.innerHTML,
    bold: has('b,strong', 'echo'),
    italic: has('i,em', 'alpha'),
    underline: has('u', 'bravo'),
    strike: has('strike,s,del', 'charlie'),
    smallcaps: has('span.sc', 'delta'),
  };
});

const live = await inspect();
console.log('LIVE DOM:', live.html);
console.log('live marks: bold=%s italic=%s underline=%s strike=%s smallcaps=%s',
  live.bold, live.italic, live.underline, live.strike, live.smallcaps);

// persist (debounced) then reload and reopen the scene
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Marks Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await inspect();
console.log('STORED DOM:', stored.html);
console.log('stored marks: bold=%s italic=%s underline=%s strike=%s smallcaps=%s',
  stored.bold, stored.italic, stored.underline, stored.strike, stored.smallcaps);

const ok = ['bold','italic','underline','strike','smallcaps']
  .every(k => live[k] && stored[k]);
console.log(ok ? 'ED-2 VERDICT: PASS' : 'ED-2 VERDICT: FAIL');

await browser.close();
await srv.close();
