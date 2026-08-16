// Reproduce the user's environment: open the app via file:// (double-clicked
// from disk), import the codex, translate — does the engine wake? Do spans
// render script?
import { chromium } from 'playwright-core';
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file:///home/user/MonoFX/tenebrae/step1.html');
await page.waitForTimeout(800);
console.log('storage label:', await page.evaluate(() => document.querySelector('#banner') ? document.querySelector('#banner').textContent : '(no banner)'));

await page.click('#lib-more'); await page.waitForTimeout(400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click(); await page.waitForTimeout(900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX);
await page.waitForFunction(() => {
  const t = document.querySelector('#toast');
  return t && /tongues awake|didn.t wake|too large|isn.t a Tenebrae/.test(t.textContent);
}, null, { timeout: 40000 }).catch(() => {});
console.log('import toast:', await page.locator('#toast').innerText().catch(() => '(none)'));

// insert a translation through the UI
await page.click('#lib-new'); await page.waitForTimeout(400);
await page.fill('#ps-input', 'File Test'); await page.click('#ps-save'); await page.waitForTimeout(700);
await page.click('#ed-content');
await page.keyboard.type('first line pad');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight');
await page.waitForTimeout(400);
const { insertTranslationSpan } = await import('./ex-lib.mjs');
await insertTranslationSpan(page, 'sea remembers', 'Celan High').catch(e => console.log('insert failed:', e.message.slice(0, 120)));
await page.waitForTimeout(600);
const span = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return null;
  const pua = [...sp.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length;
  return { lang: sp.dataset.lang, pua, latin: /[a-z]{3,}/i.test(sp.textContent), family: getComputedStyle(sp).fontFamily.slice(0, 40), wm: getComputedStyle(sp).writingMode };
});
console.log('span:', JSON.stringify(span));
console.log('pageerrors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
