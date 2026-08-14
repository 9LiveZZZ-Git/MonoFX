// PR-4 — zero runtime network requests. page.on('request') + websocket
// listeners are attached before load and kept across an entire session:
// boot, create book, type, translate (public seam), export .md download,
// full backup download, reload. Every observed request URL must be the
// local probe server origin (favicon included).
// Run: cd probes && node st-offline-network.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const requests = [];
page.on('request', r => requests.push(r.url()));
const websockets = [];
page.on('websocket', ws => websockets.push(ws.url()));
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(800);

// create a book, type prose
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Offline Book');
await page.click('#ps-save');
await T(700);
await page.click('#ed-content');
await page.keyboard.type('The harbor keeps the night watch and the tide keeps the ledger.');
await T(1400);

// exercise the translation engine (public seam; must be local-deterministic)
const tr = await page.evaluate(() => {
  const a = window.tenebrae.translate('celan-basic', 'the sea remembers');
  return a && (a.rom || a.romanization || JSON.stringify(a)).slice(0, 60);
});
console.log('translate sample:', JSON.stringify(tr));

// export the book as markdown (blob-anchor download)
await page.click('#ed-back');
await T(500);
await page.click('#bk-share');
await T(400);
const dl1p = page.waitForEvent('download');
await page.locator('#sheet button', { hasText: 'Download Markdown (.md)' }).click();
const dl1 = await dl1p;
console.log('md download:', dl1.suggestedFilename());
await T(600);

// full backup json from the library menu
await page.click('#bk-back');
await T(500);
await page.click('#lib-more');
await T(400);
const dl2p = page.waitForEvent('download');
await page.locator('#sheet button', { hasText: 'Back up everything' }).click();
const dl2 = await dl2p;
console.log('backup download:', dl2.suggestedFilename());
await T(600);

// reload (second boot also observed)
await page.reload();
await T(800);

const origin = new URL(srv.url).origin;
const external = requests.filter(u => {
  if (u.startsWith('data:') || u.startsWith('blob:')) return false; // in-page, no network
  try { return new URL(u).origin !== origin; } catch { return true; }
});
console.log('total requests observed:', requests.length);
console.log('request URLs:', JSON.stringify(requests, null, 1));
console.log('websockets:', JSON.stringify(websockets));
console.log('EXTERNAL (non-local) requests:', JSON.stringify(external));
console.log((external.length === 0 && websockets.length === 0)
  ? 'PR-4 VERDICT: PASS — every request stayed on ' + origin
  : 'PR-4 VERDICT: FAIL');

await browser.close();
await srv.close();
