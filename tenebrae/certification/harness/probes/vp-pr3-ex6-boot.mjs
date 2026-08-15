// vp-PR3+EX6 — two cheap functional demonstrations of statically-certified claims:
//   PR-3: navigator.storage.persist() is actually INVOKED at boot (spy installed
//         before the app script runs).
//   EX-6 (as amended by step 2 / X2-11): DOCX+EPUB now EXIST as export items;
//   the honest scope disclosure now names PDF + true-glyph typesetting, in BOTH
//         export-sheet scopes — book scope AND scene scope (the static evidence
//         says the note is appended unconditionally; prove it for each).
// Run: cd probes && node vp-pr3-ex6-boot.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.__persistCalls = 0;
  const orig = navigator.storage && navigator.storage.persist
    ? navigator.storage.persist.bind(navigator.storage) : null;
  if (navigator.storage) {
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: function () { window.__persistCalls++; return orig ? orig() : Promise.resolve(false); }
    });
  }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(800);

const checks = [];
const ok = (label, cond) => { checks.push([label, !!cond]); console.log((cond ? 'ok  ' : 'FAIL'), label); };

const calls = await page.evaluate(() => window.__persistCalls);
console.log('navigator.storage.persist() calls at boot:', calls);
ok('PR-3: persist() invoked at boot', calls >= 1);

// book + scene, then check both export sheets for the disclosure
await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Disclosure Book');
await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#ed-content');
await page.keyboard.type('a line');
await page.waitForTimeout(400);

// scene scope: editor share button
await page.click('#ed-share');
await page.waitForTimeout(450);
let sheetText = await page.locator('#sheet').innerText();
ok('EX-6/X2-11: scene sheet offers Word (.docx) and carries the PDF disclosure',
  /Word \(\.docx\)/.test(sheetText) && /PDF and true-glyph typesetting arrive in a later step/.test(sheetText));
const sceneHasOpts = /Include chapter titles/.test(sheetText);
console.log('scene sheet shows book options (expected false):', sceneHasOpts);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#scrim').click());
await page.waitForTimeout(400);

// book scope
await page.click('#ed-back');
await page.waitForTimeout(500);
await page.click('#bk-share');
await page.waitForTimeout(450);
sheetText = await page.locator('#sheet').innerText();
ok('EX-6/X2-11: book sheet offers Word (.docx) + EPUB (.epub) and carries the PDF disclosure',
  /Word \(\.docx\)/.test(sheetText) && /EPUB \(\.epub\)/.test(sheetText) && /PDF and true-glyph typesetting arrive in a later step/.test(sheetText));
ok('no page exceptions', errors.length === 0);

const pass = checks.every(c => c[1]);
console.log('vp-PR3-EX6 VERDICT:', pass ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
