// cf-PR-4 (triage evidence for st-offline-network.mjs) — the BOOT path.
// st-offline-network.mjs recorded two fonts.googleapis.com request EVENTS in a
// session that never imports a codex. Source: the embedded Codex Omnilingua
// (<script id="codex-embed">, step1.html L886) whose first CSS rule is
//   @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono...')
// and which is hosted in the srcdoc omni-host iframe at boot.
// omniPatchHTML (step1.html L3578-3585) injects a CSP with `default-src 'none'`
// and a style-src of 'unsafe-inline' only, precisely to seal that @import.
// vp-pr4-csp-blocked.mjs settled this for the IMPORT path; nobody probed BOOT,
// where the embedded codex installs itself with no user action.
// Assertion: on a plain boot + reload, ZERO external RESPONSES arrive (no bytes
// on the wire), every external request event dies with a CSP/blocked failure,
// and the live omni-host iframe actually carries the injected CSP meta.
// Run: cd probes && node cf-pr4-boot-wire.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const local = u => u.startsWith(srv.url) || u.startsWith('data:') || u.startsWith('blob:');

const reqs = [], resps = [], fails = [], sockets = [];
page.on('request', r => { if (!local(r.url())) reqs.push(r.url()); });
page.on('response', r => { if (!local(r.url())) resps.push(r.url().slice(0, 70) + ' -> ' + r.status()); });
page.on('requestfailed', r => {
  if (!local(r.url())) fails.push(r.url().slice(0, 60) + ' :: ' + (r.failure() ? r.failure().errorText : '?'));
});
page.on('websocket', ws => sockets.push(ws.url()));

await page.goto(srv.url + 'step1.html');
await T(4500); // embedded codex wake + forge

// engine really is up (so we are not proving "no requests" by proving "no codex")
// tonguesList()/resolveTranslate() are async — await the seam, don't stringify the promise
const woke = await page.evaluate(async () => {
  const t = await window.tenebrae.langs();
  return t && t.langs ? t.langs.length : 0;
});
const eng = await page.evaluate(async () => {
  try { const r = await window.tenebrae.translate2('celan_high', 'the sea remembers');
        return r ? String(r.romanization || r.rom || JSON.stringify(r)).slice(0, 60) : 'NULL'; }
  catch (e) { return 'ERR ' + e.message; }
});
console.log('engine awake (tongues):', woke, '| translate2 sample:', JSON.stringify(eng));

// the host iframe's own document must carry the injected CSP
const host = await page.evaluate(() => {
  const fr = document.querySelector('iframe#omni-host');
  if (!fr) return { iframe: false };
  let csp = null, sheets = [];
  try {
    const d = fr.contentDocument;
    const m = d.querySelector('meta[http-equiv="Content-Security-Policy"]');
    csp = m ? m.getAttribute('content') : null;
    sheets = [...d.styleSheets].map(s => s.href).filter(Boolean);
  } catch (e) { csp = 'ACCESS-ERROR ' + e.message; }
  return { iframe: true, csp, externalSheets: sheets };
});
console.log('omni-host:', JSON.stringify(host));

await page.reload();
await T(4500); // second boot observed too

console.log('external request EVENTS:', reqs.length, reqs.map(u => u.slice(0, 70)));
console.log('external RESPONSES (real wire traffic):', resps.length, resps);
console.log('external request FAILURES:', fails);
console.log('websockets:', sockets);
console.log('pageerrors:', errors.length ? errors : 'none');

const checks = [];
const ok = (l, c) => { checks.push(!!c); console.log((c ? 'ok  ' : 'FAIL'), l); };
ok('embedded codex engine woke at boot', woke >= 6 && !/^(ERR|NULL)/.test(eng));
ok('omni-host iframe carries the injected CSP (default-src none)',
   host.iframe && typeof host.csp === 'string' && /default-src 'none'/.test(host.csp));
ok('no external stylesheet ever loaded into the host document',
   host.iframe && host.externalSheets.length === 0);
ok('ZERO external responses — nothing came back over the wire', resps.length === 0);
ok('every external request event was blocked, not answered', reqs.length === 0 || fails.length >= reqs.length);
ok('no websockets', sockets.length === 0);
ok('no page exceptions', errors.length === 0);

console.log('cf-PR4-boot-wire VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
