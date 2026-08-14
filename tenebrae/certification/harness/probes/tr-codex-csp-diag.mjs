// TR-5/PR-4 diagnostic — does the CSP meta injected by omniPatchHTML actually
// block the codex's external @import inside the srcdoc iframe?
// tr-codex-import.mjs observed two request ATTEMPTS to fonts.googleapis.com
// during codex import + reload. This probe pins down: which frame issues them,
// whether they hit the network stack (request event = CSP did NOT block), and
// whether they succeed or fail (requestfailed/requestfinished), plus whether
// the iframe document actually carries the injected CSP meta.
// Run: cd probes && node tr-codex-csp-diag.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const events = [];
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
page.on('request', r => {
  if (r.url().startsWith('http://127.0.0.1')) return;
  events.push(`[${stamp()}] REQUEST ${r.url().slice(0, 90)} frame=${r.frame().url().slice(0, 60)}`);
});
page.on('requestfailed', r => {
  if (r.url().startsWith('http://127.0.0.1')) return;
  events.push(`[${stamp()}] FAILED ${r.url().slice(0, 60)} err=${r.failure() && r.failure().errorText}`);
});
page.on('requestfinished', r => {
  if (r.url().startsWith('http://127.0.0.1')) return;
  events.push(`[${stamp()}] FINISHED ${r.url().slice(0, 60)}`);
});

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);
await page.click('#lib-more');
await page.waitForTimeout(400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await page.waitForTimeout(800);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX);
await sleep(8000);

const state = await page.evaluate(() => {
  const fr = document.querySelector('iframe#omni-host');
  if (!fr) return { iframe: false };
  const doc = fr.contentDocument;
  const meta = doc && doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  let sheetHosts = [];
  try { sheetHosts = [...doc.styleSheets].map(s => s.href).filter(Boolean); } catch (e) {}
  return { iframe: true, csp: meta ? meta.getAttribute('content').slice(0, 120) : null,
           externalSheets: sheetHosts };
});
console.log('iframe state:', JSON.stringify(state, null, 1));
console.log('toast:', await page.evaluate(() => document.querySelector('#toast').textContent));
console.log('network events:');
events.forEach(e => console.log(' ', e));
console.log(events.some(e => e.includes('REQUEST'))
  ? 'CSP DID NOT SUPPRESS the request attempt (it reached the network stack).'
  : 'No external request attempts — CSP suppressed the @import.');

await browser.close();
await srv.close();
