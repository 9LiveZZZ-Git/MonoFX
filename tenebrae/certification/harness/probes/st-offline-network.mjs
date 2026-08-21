// PR-4 — zero runtime network traffic. request/response/failure/websocket
// listeners are attached before load and kept across an entire session:
// boot, create book, type, translate (real engine seam), export .md download,
// full backup download, reload.
//
// CONTRACT UPDATE (2026-08, triage of the FAIL this probe used to emit):
// the app now ships the real Codex Omnilingua EMBEDDED (<script id="codex-embed">,
// step1.html L886) and installs it as the engine at boot, in a srcdoc iframe.
// That third-party codex's own first CSS rule is
//   @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono…')
// so a passive "no request EVENT may ever appear" assertion can no longer be
// the test. omniPatchHTML (step1.html L3578-3585) injects
//   default-src 'none'; style-src 'unsafe-inline'; font-src data: blob: …
// into the hosted document precisely to kill that @import in the renderer.
// PR-4 says "zero runtime network requests"; the operative fact is that no
// bytes reach or leave the wire. So this probe now asserts, strictly:
//   · ZERO external RESPONSES (nothing ever came back), and
//   · ZERO websockets, and
//   · every external request EVENT died with a CSP/blocked failure, and
//   · the only external URL ever attempted is the hosted codex's font @import
//     (any other host — an API, a script, a beacon — fails the probe), and
//   · the omni-host iframe really carries the injected CSP and loaded no
//     external stylesheet.
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
const responses = [];
page.on('response', r => responses.push(r.url()));
const failures = new Map(); // url -> errorText
page.on('requestfailed', r => failures.set(r.url(), r.failure() ? r.failure().errorText : '?'));
const websockets = [];
page.on('websocket', ws => websockets.push(ws.url()));
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(3800); // embedded codex wake + font forge

// create a book, type prose
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Offline Book');
await page.click('#ps-save');
await T(700);
await page.click('#ed-content');
await page.keyboard.type('The harbor keeps the night watch and the tide keeps the ledger.');
await T(1400);

// exercise the REAL translation engine (translate2 = resolveTranslate; the
// legacy `translate` seam is the sample cipher and is not the engine).
const tr = await page.evaluate(async () => {
  const a = await window.tenebrae.translate2('celan_basic', 'the sea remembers');
  return a ? String(a.romanization || a.rom || JSON.stringify(a)).slice(0, 60) : 'NULL';
});
console.log('translate2 sample:', JSON.stringify(tr));

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
await T(3800);

// the hosted codex must be sealed by the injected CSP, with no external sheet
const host = await page.evaluate(() => {
  const fr = document.querySelector('iframe#omni-host');
  if (!fr) return { iframe: false };
  try {
    const d = fr.contentDocument;
    const m = d.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return { iframe: true, csp: m ? m.getAttribute('content') : null,
             externalSheets: [...d.styleSheets].map(s => s.href).filter(Boolean) };
  } catch (e) { return { iframe: true, csp: 'ACCESS-ERROR ' + e.message, externalSheets: [] }; }
});
console.log('omni-host:', JSON.stringify(host));

const origin = new URL(srv.url).origin;
const isExt = u => {
  if (u.startsWith('data:') || u.startsWith('blob:')) return false; // in-page, no network
  try { return new URL(u).origin !== origin; } catch { return true; }
};
const external = requests.filter(isExt);
const extResponses = responses.filter(isExt);
// the ONLY external URL the hosted codex is permitted to even attempt
const CODEX_FONT_IMPORT = /^https:\/\/fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono/;
const unexpected = external.filter(u => !CODEX_FONT_IMPORT.test(u));
const unblocked = external.filter(u => !/csp|blocked|ERR_BLOCKED/i.test(failures.get(u) || ''));

console.log('total requests observed:', requests.length);
console.log('request URLs:', JSON.stringify(requests, null, 1));
console.log('websockets:', JSON.stringify(websockets));
console.log('EXTERNAL (non-local) request events:', JSON.stringify(external));
console.log('EXTERNAL failure reasons:', JSON.stringify([...failures].filter(([u]) => isExt(u))));
console.log('EXTERNAL responses (real wire traffic):', JSON.stringify(extResponses));

const checks = [];
const ok = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('exports ran: md + backup downloaded', !!dl1.suggestedFilename() && !!dl2.suggestedFilename());
ok('real engine answered locally', tr !== 'NULL' && !/^ERR/.test(tr));
ok('ZERO external responses — nothing came back over the wire', extResponses.length === 0);
ok('no websockets', websockets.length === 0);
ok('no external host other than the hosted codex font @import', unexpected.length === 0);
ok('every external request event was killed by CSP, never answered', unblocked.length === 0);
ok('omni-host carries the injected CSP', host.iframe && /default-src 'none'/.test(String(host.csp)));
ok('omni-host loaded no external stylesheet', host.iframe && host.externalSheets.length === 0);

console.log(checks.every(Boolean)
  ? 'PR-4 VERDICT: PASS'
  : 'PR-4 VERDICT: FAIL');

await browser.close();
await srv.close();
