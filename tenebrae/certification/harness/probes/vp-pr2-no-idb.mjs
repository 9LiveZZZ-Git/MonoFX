// vp-PR2 — adversarial functional check of the in-memory fallback (PR-2 was
// certified on static evidence; the requirement is not (F), but the claim is
// cheap to demonstrate for real). indexedDB is removed before the app boots;
// the app must still run (create a book, type, counts update) and must tell
// the user storage is not durable (the boot banner).
// Run: cd probes && node vp-pr2-no-idb.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(900);

const idb = await page.evaluate(() => typeof window.indexedDB);
console.log('window.indexedDB is:', idb);

const banner = await page.evaluate(() => {
  const b = document.querySelector('#banner');
  return { shown: !!b && b.classList.contains('show'), text: b ? b.textContent : null };
});
console.log('banner:', JSON.stringify(banner));

// the app still runs: create a book, type, watch the word count
await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Memory Book');
await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#ed-content');
await page.keyboard.type('words live in memory now');
await page.waitForTimeout(900);
const count = await page.locator('#ed-count').innerText();
await page.click('#ed-back');
await page.waitForTimeout(400);
await page.click('#bk-back');
await page.waitForTimeout(400);
const lib = await page.locator('#lib-list').innerText();
console.log('editor count:', JSON.stringify(count), '| library row:', JSON.stringify(lib.replace(/\s+/g, ' ').slice(0, 120)));

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('indexedDB absent for the app', idb === 'undefined'),
  has('banner shown at boot', banner.shown),
  has('banner says memory-only (not durable)', !!banner.text && banner.text.includes('memory only')),
  has('app still runs: word count live', count.includes('5 words')),
  has('app still runs: library lists the book', lib.includes('Memory Book') && lib.includes('5 words')),
  has('no page exceptions', errors.length === 0),
];
console.log('vp-PR-2 VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
