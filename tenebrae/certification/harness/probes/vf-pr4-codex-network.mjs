// vf-PR-4 — adversarial extension of the offline check to the codex-import
// flow, which st-offline-network.mjs never exercised. The real codex HTML
// (tenebraecodex_14.html, 3.4MB, in the session uploads) contains
//   @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono...')
// and the app hosts an imported codex in <iframe sandbox="allow-scripts
// allow-same-origin"> via srcdoc (step1.html L2316-2336) — a sandbox that
// does NOT restrict network. If the iframe fetches the @import, the app
// issues an external runtime request during an advertised first-party flow.
// All requests are recorded AND aborted-if-external (we never actually phone
// out). Also logs the wake toast + timing as TR-5 budget corroboration.
// Run: cd probes && node vf-pr4-codex-network.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

const requests = [];
await context.route('**/*', route => {
  const url = route.request().url();
  requests.push(url);
  if (url.startsWith(srv.url)) return route.continue();
  return route.abort(); // record external attempts, never let them out
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// import the real codex through the real library menu
await page.click('#lib-more');
await T(400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await T(800);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
const t0 = Date.now();
await chooser.setFiles(CODEX);

// wait out the wake (poll budget ~15s max) + a margin
let toast = '';
for (let i = 0; i < 60; i++) {
  await T(500);
  const t = await page.evaluate(() => document.querySelector('#toast').textContent);
  if (t && t !== toast) { toast = t; console.log(`toast @ ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(t)); }
  if (/awake|didn.t wake|Couldn/.test(t)) break;
}
await T(2000);

const external = requests.filter(u => !u.startsWith(srv.url));
console.log('total requests:', requests.length);
console.log('external request attempts:', external.length ? external : 'none');
console.log('pageerrors:', errors.length ? errors : 'none');

const offline = external.length === 0;
console.log('vf-PR-4 (codex-import flow) VERDICT:', offline
  ? 'PASS — no external requests even while hosting the imported codex'
  : 'FAIL — the codex-import flow attempts external requests: ' + external.join(', '));

await browser.close();
await srv.close();
