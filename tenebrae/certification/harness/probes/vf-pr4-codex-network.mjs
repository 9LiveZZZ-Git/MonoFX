// vf-PR-4 — adversarial extension of the offline check to the codex-import
// flow. The real codex HTML (3.4MB) contains
//   @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono...')
// and the app hosts an imported codex in a srcdoc iframe (step1.html
// L3600-3634) — a host that does NOT restrict network by itself. If the iframe
// fetched the @import, the app would issue an external runtime request during
// an advertised first-party flow.
//
// The interception here is the assertion: context.route('**/*') sits on the
// network stack, so anything that reaches it has escaped the renderer. The CSP
// injected by omniPatchHTML (step1.html L3578-3585, default-src 'none';
// style-src 'unsafe-inline') kills the @import BEFORE the network stack, so a
// correct app produces ZERO external route hits. (Passive page.on('request')
// still reports the CSP-killed attempt — see vp-pr4-csp-blocked.mjs and
// cf-pr4-boot-wire.mjs, which pin the failure reason to 'csp' with zero
// responses. Both views agree: nothing reaches the wire.)
// External requests are also aborted, so we never actually phone out.
// Also logs the wake toast + timing as TR-5 budget corroboration.
// Verdict line is machine-readable PASS/FAIL for the suite runner.
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

const checks = [];
const ok = (l, c) => { checks.push(!!c); console.log((c ? 'ok  ' : 'FAIL'), l); };
ok('the codex engine actually woke (we are not proving offline by proving nothing ran)',
   /tongues awake/i.test(toast));
ok('ZERO external requests reached the network stack while hosting the imported codex',
   external.length === 0);
ok('no page exceptions', errors.length === 0);
if (external.length) console.log('escaped to the wire:', external.join(', '));
console.log('vf-PR-4 (codex-import flow) VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
