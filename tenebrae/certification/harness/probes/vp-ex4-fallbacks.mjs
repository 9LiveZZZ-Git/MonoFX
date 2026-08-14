// vp-EX4-fallbacks — adversarial functional check of EX-4's FALLBACK claims,
// which the static pass asserted but no probe had demonstrated:
//   (a) rich copy degrades to plain-text copy when ClipboardItem is missing
//       (copyRich throws -> copyPlain), with the explanatory toast;
//   (b) Share… degrades to copy when navigator.share is unavailable, with the
//       "Sharing unavailable — copied instead" toast and the .md text in the
//       clipboard.
// Run: cd probes && node vp-ex4-fallbacks.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const origin = srv.url.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
await context.addInitScript(() => {
  // kill the rich-clipboard and native-share surfaces before the app boots
  try { delete window.ClipboardItem; Object.defineProperty(window, 'ClipboardItem', { value: undefined, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch (e) {}
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Fallback Book');
await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#ed-content');
await page.keyboard.type('the salt wind waits');
await page.waitForTimeout(600);
await page.click('#ed-back');
await page.waitForTimeout(500);

const checks = [];
const ok = (label, cond) => { checks.push([label, !!cond]); console.log((cond ? 'ok  ' : 'FAIL'), label); };

// (a) rich copy with no ClipboardItem -> plain fallback
await page.click('#bk-share');
await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'Copy for Apple Notes' }).click();
await page.waitForTimeout(600);
let toast = await page.locator('#toast').innerText();
console.log('copy toast:', JSON.stringify(toast));
let clip = await page.evaluate(() => navigator.clipboard.readText());
console.log('clipboard after copy fallback:', JSON.stringify(clip.slice(0, 120)));
ok('fallback toast says plain text', /plain text/i.test(toast));
ok('clipboard got the compiled plain text', /FALLBACK BOOK/.test(clip) && /the salt wind waits/.test(clip));
ok('clipboard is txt-compile output (uppercased chapter)', /CHAPTER 1/.test(clip));

// (b) share with no navigator.share -> copied instead
await page.waitForTimeout(2400); // let the old toast die
await page.click('#bk-share');
await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'Share…' }).click();
await page.waitForTimeout(600);
toast = await page.locator('#toast').innerText();
console.log('share toast:', JSON.stringify(toast));
clip = await page.evaluate(() => navigator.clipboard.readText());
console.log('clipboard after share fallback:', JSON.stringify(clip.slice(0, 120)));
ok('share fallback toast', /Sharing unavailable/i.test(toast));
ok('clipboard got the markdown compile', /# Fallback Book/.test(clip) && /## Chapter 1/.test(clip));
ok('no page exceptions', errors.length === 0);

const pass = checks.every(c => c[1]);
console.log('vp-EX4-fallbacks VERDICT:', pass ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
