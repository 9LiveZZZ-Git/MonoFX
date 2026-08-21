// DIAGNOSTIC (no VERDICT): trace every non-local request during boot + reload,
// with the requesting frame and the elapsed time, to locate the source of the
// fonts.googleapis.com request seen by tr-determinism.mjs / st-offline-network.mjs.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const t0 = Date.now();
const log = [];
page.on('request', r => {
  if (r.url().startsWith('http://127.0.0.1')) return;
  let fu = '?'; try { fu = r.frame() ? (r.frame().url() || '(srcdoc)') : '(none)'; } catch (e) {}
  log.push({ ms: Date.now() - t0, url: r.url().slice(0, 90), type: r.resourceType(), frame: fu.slice(0, 60) });
});
page.on('requestfailed', r => {
  if (r.url().startsWith('http://127.0.0.1')) return;
  log.push({ ms: Date.now() - t0, FAILED: r.url().slice(0, 60), err: (r.failure() || {}).errorText });
});
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (/Content Security|Refused/i.test(m.text())) console.log('CONSOLE:', m.text().slice(0, 160)); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(6000);
console.log('after boot:', JSON.stringify(log, null, 1));
console.log('frames:', page.frames().map(f => f.url().slice(0, 50)));
const mark = log.length;
await page.reload();
await page.waitForTimeout(6000);
console.log('after reload (new entries):', JSON.stringify(log.slice(mark), null, 1));
await browser.close(); await srv.close();
