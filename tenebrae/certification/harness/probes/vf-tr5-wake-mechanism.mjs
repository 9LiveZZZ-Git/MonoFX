// vf-TR-5 wake mechanism — resolves WHY the pure-UI wake of the real 3.4MB
// codex failed in the earlier tr-codex-import.mjs run (~10s failure toast)
// while vf-pr4-codex-network.mjs woke it in 0.6s.
// Hypothesis: the codex HTML's @import of fonts.googleapis.com (blocked
// external host in this environment) HANGS when nothing aborts it; a pending
// parser-blocking stylesheet delays the srcdoc engine's script execution past
// ensureOmni's poll budget (~7.5s effective: two interleaved 60ms poll chains
// share the 250-try counter, L2321-2337). When the fetch fails FAST (abort or
// real offline), the engine boots almost instantly.
// Run A: external requests left alone (hang) — expect wake failure toast.
// Run B: external requests aborted instantly (true-offline) — expect awake.
// Run: cd probes && node vf-tr5-wake-mechanism.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

async function run(mode){
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const external = [];
  if (mode === 'abort-external') {
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(srv.url)) return route.continue();
      external.push(url); return route.abort();
    });
  } else {
    context.on('request', r => { if (!r.url().startsWith(srv.url)) external.push(r.url()); });
  }
  const page = await context.newPage();
  page.on('pageerror', e => console.log(`[${mode}] PAGE EXCEPTION:`, e.message));
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
  const t0 = Date.now();
  await chooser.setFiles(CODEX);
  let final = '';
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => document.querySelector('#toast').textContent);
    if (t && t !== final) { final = t; console.log(`[${mode}] toast @ ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(t)); }
    if (/awake|didn.t wake|Couldn/.test(t)) break;
  }
  console.log(`[${mode}] external attempts:`, external.length ? external.map(u => u.slice(0, 70)) : 'none');
  await browser.close();
  await srv.close();
  return final;
}

const a = await run('hang-external');
const b = await run('abort-external');
console.log('---');
console.log('hang-external outcome: ', JSON.stringify(a));
console.log('abort-external outcome:', JSON.stringify(b));
const confirmed = /didn.t wake/.test(a) && /awake/.test(b);
console.log('MECHANISM ' + (confirmed
  ? 'CONFIRMED: wake failure is caused by the codex’s external @import hanging (network-dependent), not by intrinsic engine boot cost; a fast-failing (truly offline) network wakes in <1s.'
  : 'NOT CONFIRMED as hypothesized — see outcomes above.'));
