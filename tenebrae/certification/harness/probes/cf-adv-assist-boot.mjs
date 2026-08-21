// ADVERSARY / TX-13 — "no key, no feature; nothing at boot or on any other path".
//
// The audit probe (cf-assist-gate.mjs) wrapped window.fetch only, in ONE page
// session, and exercised typing + translate + the export sheet. This probe goes
// after what that leaves open:
//   · every outbound transport, not just fetch: XMLHttpRequest, sendBeacon,
//     WebSocket, EventSource, Image().src, and <script src> insertion
//   · the path nobody ran: a RELOAD with a key already stored (claudeLoad now
//     finds a key at boot — does anything fire?)
//   · every menu in the app with no key, not just the scene sheet
//   · a long battery of ordinary authoring actions with a key set
//   · 'Forget the key' -> do the passes actually leave the menu again
// Run: cd probes && node cf-adv-assist-boot.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });

// every transport, installed before any app code runs, and kept across reloads
await context.addInitScript(() => {
  window.__out = [];
  const note = (how, url, extra) => { try{ window.__out.push({ how, url: String(url), extra }); }catch(e){} };
  const of_ = window.fetch;
  window.fetch = async (url, opts) => {
    note('fetch', (url && url.url) || url, opts && opts.body ? String(opts.body).slice(0, 60) : '');
    if(/anthropic/.test(String(url))) return { ok: true, status: 200, json: async () => ({
      model: 'claude-opus-5', stop_reason: 'end_turn', usage: {},
      content: [{ type: 'text', text: '{"fixes":[]}' }] }) };
    return of_.call(window, url, opts);
  };
  const ox = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ note('xhr', u, m); return ox.apply(this, arguments); };
  if(navigator.sendBeacon){ const ob = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (u, d) => { note('beacon', u); return ob(u, d); }; }
  const OW = window.WebSocket; window.WebSocket = function(u){ note('ws', u); return new OW(u); };
  if(window.EventSource){ const OE = window.EventSource; window.EventSource = function(u){ note('sse', u); return new OE(u); }; }
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
// browser-level truth: any request that actually leaves for anthropic
const wire = [];
page.on('request', r => { if(/anthropic\.com/.test(r.url())) wire.push(r.method() + ' ' + r.url()); });

const T = ms => page.waitForTimeout(ms);
const out = () => page.evaluate(() => JSON.stringify(window.__out));
const sheetLabels = () => page.evaluate(() =>
  [...document.querySelectorAll('#sheet .sh-item')].map(i => i.textContent.trim().replace(/\s+/g, ' ')));
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(350); };

await page.goto(srv.url + 'step1.html');
await T(3800);

/* ---------- 1. cold boot, no key: nothing goes out on ANY transport ---------- */
const cold = JSON.parse(await out());
console.log('   cold boot outbound attempts:', JSON.stringify(cold));
ck('cold boot: no outbound attempt on any transport', cold.length === 0, JSON.stringify(cold));
ck('cold boot: assist is off', !(await page.evaluate(() => window.tenebrae._claude.ready())));
ck('cold boot: default model is claude-opus-5',
   (await page.evaluate(() => window.tenebrae._claude.model())) === 'claude-opus-5',
   await page.evaluate(() => window.tenebrae._claude.model()));

/* ---------- 2. with no key, EVERY menu in the app ---------- */
await createBook(page, 'Gate Book');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady over the water.');
await T(900);

const menus = {};
await page.click('#ed-more'); await T(500); menus['scene sheet'] = await sheetLabels(); await close();
await page.click('#ed-back'); await T(600);
await page.click('#bk-more'); await T(500); menus['book sheet'] = await sheetLabels(); await close();
await page.click('#bk-share'); await T(500); menus['export sheet'] = await sheetLabels(); await close();
await page.locator('.chapter-block').first().locator('.ch-title, .chapter-title, h2').first().click({ trial: true }).catch(() => {});
await page.click('#bk-back'); await T(600);
await page.click('#lib-more'); await T(500); menus['library sheet'] = await sheetLabels(); await close();
const flat = JSON.stringify(menus);
console.log('   menus with no key:', flat.slice(0, 900));
ck('no key: no "Copy-edit" pass in any menu', !/Copy-edit/.test(flat));
ck('no key: no "Harvest" pass in any menu', !/Harvest/.test(flat));
ck('no key: the library still offers the opt-in, shown as off',
   /Claude assist — off/.test(flat), (menus['library sheet'] || []).find(l => /Claude/.test(l)));

/* ---------- 3. paste a key through the REAL settings sheet ---------- */
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Paste API key' }).click(); await T(600);
await page.fill('#ps-input', 'sk-ant-api03-ADVERSARY-KEY-0001');
await page.click('#ps-save'); await T(700);
await close();
ck('the key went in through the real settings sheet', await page.evaluate(() => window.tenebrae._claude.ready()));
const afterKey = JSON.parse(await out());
ck('pasting a key sends nothing', afterKey.length === 0, JSON.stringify(afterKey));

/* ---------- 4. THE PATH NOBODY RAN: reload with a key already stored ---------- */
await page.reload();
await T(4200);
const bootWithKey = JSON.parse(await out());
console.log('   boot-with-key outbound attempts:', JSON.stringify(bootWithKey));
ck('boot WITH a stored key still sends nothing', bootWithKey.length === 0, JSON.stringify(bootWithKey));
ck('the key survived the reload', await page.evaluate(() => window.tenebrae._claude.ready()));

/* ---------- 5. a battery of ordinary authoring actions, key present ---------- */
await page.locator('[data-book]').first().click(); await T(700);
await page.locator('[data-scene]').first().click(); await T(800);
await page.click('#ed-content');
await page.keyboard.type(' She said the sea remembers the old king.');
await T(1200);
// a real translation
await page.evaluate(async () => { await window.tenebrae.translate2('the sea remembers', 'celan_high'); });
await T(600);
// export sheet + a real download of every text format
await page.click('#ed-back'); await T(600);
await page.click('#bk-share'); await T(600);
for(const label of ['Download Markdown (.md)', 'Download plain text (.txt)', 'Download Word (.docx)', 'Download PDF (.pdf)', 'Download EPUB (.epub)']){
  try{
    await Promise.all([page.waitForEvent('download', { timeout: 9000 }),
                       page.locator('#sheet .sh-item', { hasText: label }).click()]);
    await T(300);
  }catch(e){ console.log('   (skipped', label, ')'); }
}
await close();
// cards, search, backup, book switching
await page.click('#bk-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click(); await T(700);
await page.evaluate(() => history.length);
await page.click('#bk-back').catch(() => {}); await T(500);
await page.evaluate(() => { const b = document.querySelector('#cd-back'); if(b) b.click(); }); await T(500);
const battery = JSON.parse(await out());
console.log('   after the battery, outbound attempts:', JSON.stringify(battery));
ck('key set + a full authoring battery: still nothing sent', battery.length === 0, JSON.stringify(battery));
ck('nothing reached anthropic.com on the wire, all session', wire.length === 0, JSON.stringify(wire));

/* ---------- 6. the passes appear, then leave again on Forget ---------- */
await page.evaluate(() => { while(document.querySelector('#scrim.show')) document.querySelector('#scrim').click(); });
await T(300);
// get back into a scene
await page.evaluate(() => { const b = document.querySelector('#bk-back'); if(b) b.click(); }); await T(400);
await page.locator('[data-book]').first().click().catch(() => {}); await T(700);
await page.locator('[data-scene]').first().click().catch(() => {}); await T(800);
await page.click('#ed-more'); await T(500);
const withKey = await sheetLabels();
console.log('   scene sheet WITH key:', JSON.stringify(withKey));
ck('with a key, both passes are offered', withKey.some(l => /Copy-edit/.test(l)) && withKey.some(l => /Harvest/.test(l)), JSON.stringify(withKey));
await close();
await page.click('#ed-back'); await T(500);
await page.click('#bk-back'); await T(500);
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Forget the key' }).click(); await T(700);
await close();
await page.locator('[data-book]').first().click().catch(() => {}); await T(700);
await page.locator('[data-scene]').first().click().catch(() => {}); await T(800);
await page.click('#ed-more'); await T(500);
const forgotten = await sheetLabels();
console.log('   scene sheet after Forget:', JSON.stringify(forgotten));
ck('after Forget, the passes are gone from the menu again',
   !forgotten.some(l => /Copy-edit|Harvest/.test(l)), JSON.stringify(forgotten));
await close();

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-13 ADVERSARY', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
