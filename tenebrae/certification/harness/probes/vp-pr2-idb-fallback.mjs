// vp-PR-2 — adversarial re-test of a STATIC-ONLY pass: in-memory fallback when
// IndexedDB is unavailable. The static claim says idbOpen() never rejects, the
// app boots on the mem Map, and the user is told storage is not durable
// (#banner at boot + 'Preview mode — not saved' in #lib-stat).
// This probe actually removes indexedDB and demands all of it at runtime:
//   1. boot completes with no page exception
//   2. #banner is shown with the memory-only disclosure
//   3. #lib-stat says 'Preview mode — not saved'
//   4. the app still WORKS: create a book, type prose, live word count updates,
//      library row shows the book
//   5. reload really loses the data (proof the session truly ran on memory)
// Run: cd probes && node vp-pr2-idb-fallback.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  // make `indexedDB` resolve to undefined so idbOpen()'s try{} throws
  Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(1200); // boot; idbOpen resolves immediately via catch

const idbGone = await page.evaluate(() => window.indexedDB === undefined);
console.log('indexedDB removed:', idbGone);

const banner = await page.evaluate(() => {
  const b = document.querySelector('#banner');
  return { shown: !!b && b.classList.contains('show'), text: b ? b.textContent.trim() : '(no #banner)' };
});
console.log('banner shown:', banner.shown, '| text:', JSON.stringify(banner.text.slice(0, 90)));

const libStat = await page.locator('#lib-stat').innerText().catch(() => '(missing)');
console.log('#lib-stat:', JSON.stringify(libStat));

// the app must still function on the mem Map
await page.click('#lib-new');
await T(450);
await page.fill('#ps-input', 'Memory Book');
await page.click('#ps-save');
await T(700);
const inEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
await page.click('#ed-content');
await page.keyboard.type('five words typed in memory');
await T(900);
const count = await page.locator('#ed-count').innerText();
await page.click('#ed-back');
await T(500);
await page.click('#bk-back');
await T(500);
const libRow = await page.locator('#lib-list').innerText();
console.log('editor opened:', inEditor, '| #ed-count:', JSON.stringify(count),
  '| library shows book:', libRow.includes('Memory Book'));

// memory-only proof: a reload starts from nothing
await T(1400);
await page.reload();
await T(1200);
const afterReload = await page.locator('#lib-list').innerText().catch(() => '');
const gone = !afterReload.includes('Memory Book');
console.log('after reload book gone (memory-only):', gone);

const ok = idbGone && banner.shown && /memory only/i.test(banner.text) &&
  libStat === 'Preview mode — not saved' &&
  inEditor && count === '5 words' && libRow.includes('Memory Book') &&
  gone && errors.length === 0;
console.log('pageerrors:', errors.length);
console.log(ok ? 'vp-PR-2 VERDICT: PASS' : 'vp-PR-2 VERDICT: FAIL');

await browser.close();
await srv.close();
