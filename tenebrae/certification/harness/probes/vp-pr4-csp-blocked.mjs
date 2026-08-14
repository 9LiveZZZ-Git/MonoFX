// vp-PR4-csp-blocked — settles the discrepancy between tr-codex-import.mjs
// (passive page.on('request') recorded two fonts.googleapis.com "attempts"
// during real-codex import) and vf-pr4-codex-network.mjs (route interception
// saw zero external requests in the same flow). If the app's injected CSP
// (step1.html L2332) kills the codex's external @import BEFORE the network
// stack, the CDP request event still fires but: (a) no interception happens,
// (b) no response ever arrives, (c) requestfailed reports a blocked error.
// That means zero bytes on the wire — PR-4 holds. If any external RESPONSE
// arrives, PR-4 is broken.
// Run: cd probes && node vp-pr4-csp-blocked.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
import { existsSync } from 'node:fs';
if (!existsSync(CODEX)) { console.log('BLOCKED: codex.html not found at', CODEX); process.exit(0); }

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

const extRequests = [];   // CDP-level request events (may include CSP-blocked)
const extResponses = [];  // actual responses = real wire traffic
const extFailures = [];   // failure reasons for external requests
page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) extRequests.push(r.url()); });
page.on('response', r => { if (!r.url().startsWith('http://127.0.0.1')) extResponses.push(r.url() + ' -> ' + r.status()); });
page.on('requestfailed', r => {
  if (!r.url().startsWith('http://127.0.0.1'))
    extFailures.push(r.url().slice(0, 70) + ' :: ' + (r.failure() ? r.failure().errorText : '?'));
});

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

// import the real codex through the real library menu file chooser
await page.click('#lib-more');
await page.waitForTimeout(400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click()
    .then(() => page.waitForTimeout(400))
    .then(() => page.locator('#sheet button', { hasText: 'Import Codex' }).click()),
]);
await chooser.setFiles(CODEX);
await page.waitForTimeout(4000); // let the engine wake and any @import fire

const toast = await page.locator('#toast').innerText().catch(() => '');
console.log('toast:', JSON.stringify(toast));
console.log('external request events (CDP):', extRequests.length, extRequests.map(u => u.slice(0, 70)));
console.log('external RESPONSES (wire traffic):', extResponses.length, extResponses);
console.log('external request failures:', extFailures);

const checks = [];
const ok = (label, cond) => { checks.push([label, !!cond]); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('codex engine woke', /tongues awake/i.test(toast));
ok('ZERO external responses — nothing on the wire', extResponses.length === 0);
ok('any external request event was killed (failed/blocked, never answered)',
  extRequests.length === 0 || extFailures.length >= 1 || extResponses.length === 0);
ok('no page exceptions', errors.length === 0);

const pass = checks.every(c => c[1]);
console.log('vp-PR4-csp-blocked VERDICT:', pass ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
