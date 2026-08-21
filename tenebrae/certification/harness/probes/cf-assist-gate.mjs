// TX-13 — Claude assist does not exist until the author opts in.
//
// The green probe tx-claude-assist.mjs asserts the cold seam (ready()===false,
// default model, no boot request). This probe goes after the parts it does NOT
// cover:
//   · the REAL menus: the two passes must be absent from the scene sheet with
//     no key and present with one; the library sheet must say "off"
//   · window.fetch is wrapped BEFORE boot and counted for the whole session, so
//     "no request on any other path" is measured across boot, typing,
//     translating, exporting and backing up — not just at boot
//   · calling the passes with no key must throw before any fetch
//   · a bogus model persisted in kv must not be adopted; the author's own
//     choice must be
// Run: cd probes && node cf-assist-gate.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 220)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const netReq = [];
page.on('request', r => { if(!r.url().startsWith(srv.url)) netReq.push(r.url()); });

// wrap fetch before ANY app code runs: every call the app makes is recorded and
// answered locally, so nothing can reach the wire and nothing goes unseen.
await context.addInitScript(() => {
  window.__fetchCalls = [];
  const real = window.fetch;
  window.__realFetch = real;
  window.fetch = async (url, opts) => {
    window.__fetchCalls.push({ url: String(url), body: opts && opts.body ? String(opts.body) : '' });
    return { ok: true, status: 200, json: async () => ({
      model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ fixes: [], cards: [] }) }] }) };
  };
});
const T = ms => page.waitForTimeout(ms);
await page.goto(srv.url + 'step1.html');
await T(3800);

const calls = () => page.evaluate(() => window.__fetchCalls.map(c => c.url));

/* ---------- 1. cold ---------- */
const cold = await page.evaluate(() => ({ ready: window.tenebrae._claude.ready(), model: window.tenebrae._claude.model() }));
ck('cold: no key', cold.ready === false, JSON.stringify(cold));
ck('cold: default model is Opus 5', cold.model === 'claude-opus-5', cold.model);
ck('cold: app made no fetch at all at boot', (await calls()).length === 0, JSON.stringify(await calls()));
ck('cold: nothing addressed to Anthropic on the wire', !netReq.some(u => /anthropic/.test(u)), netReq.join(' | '));

/* ---------- 2. the passes are absent from the real menus ---------- */
await page.click('#lib-new'); await T(400);
await page.fill('#ps-input', 'Gate Book'); await page.click('#ps-save'); await T(800);
await page.click('#ed-content');
await page.keyboard.type('The harbor keeps the night watch. The tide keeps the ledger.');
await T(900);
await page.click('#ed-more'); await T(500);
const sheetOff = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
console.log('   scene sheet (no key):', JSON.stringify(sheetOff));
ck('no key: "Copy-edit this scene" is absent from the scene sheet', !sheetOff.some(t => /Copy-edit/i.test(t)));
ck('no key: "Harvest cards" is absent from the scene sheet', !sheetOff.some(t => /Harvest cards/i.test(t)));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await T(350);

/* ---------- 3. calling a pass with no key cannot reach fetch ---------- */
const noKey = await page.evaluate(async () => {
  const out = {};
  try{ await window.tenebrae._claude.grammar('x'); out.g = 'NO THROW'; }catch(e){ out.g = e.message; }
  try{ await window.tenebrae._claude.cards('x', []); out.c = 'NO THROW'; }catch(e){ out.c = e.message; }
  out.calls = window.__fetchCalls.length;
  return out;
});
console.log('   no-key calls:', JSON.stringify(noKey));
ck('grammar with no key throws before any request', /No API key/i.test(noKey.g), noKey.g);
ck('cards with no key throws before any request', /No API key/i.test(noKey.c), noKey.c);
ck('still zero fetches', noKey.calls === 0, noKey.calls);

/* ---------- 4. with a key: still nothing until a pass is tapped ---------- */
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-probe-gate'));
await T(300);
// ordinary authoring work: type, translate, export, back up
await page.click('#ed-content');
await page.keyboard.press('End');
await page.keyboard.type(' A second line for the ledger.');
await T(800);
const tr = await page.evaluate(async () => {
  const ls = (await window.tenebrae.langs()).langs;
  const r = await window.tenebrae.translate2(ls[0].id, 'the tide keeps the ledger');
  return { lang: ls[0].id, ok: !!r };
});
await T(600);
await page.click('#ed-share'); await T(500);
const shareItems = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await T(350);
const afterWork = await calls();
ck('key set + typing + real translate + export sheet: still zero requests', afterWork.length === 0, JSON.stringify(afterWork) + ' / translate ' + JSON.stringify(tr) + ' / share ' + shareItems.length);

/* ---------- 5. the passes appear once the key is in, and only then fire ---------- */
await page.click('#ed-more'); await T(500);
const sheetOn = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
console.log('   scene sheet (key set):', JSON.stringify(sheetOn));
ck('key set: "Copy-edit this scene" appears', sheetOn.some(t => /Copy-edit/i.test(t)));
ck('key set: "Harvest cards from this scene" appears', sheetOn.some(t => /Harvest cards/i.test(t)));
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1500);
const afterTap = await page.evaluate(() => window.__fetchCalls.map(c => ({ url: c.url, model: JSON.parse(c.body).model })));
console.log('   after tapping the pass:', JSON.stringify(afterTap));
ck('the author tapping a pass is what makes the one request', afterTap.length === 1 && /api\.anthropic\.com/.test(afterTap[0].url), JSON.stringify(afterTap));
ck('that request names the default model, not a cheaper one chosen for them', afterTap.length === 1 && afterTap[0].model === 'claude-opus-5', JSON.stringify(afterTap));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await T(400);

/* ---------- 6. the library sheet reports the state honestly ---------- */
await page.click('#ed-back'); await T(400);
await page.click('#bk-back'); await T(400);
await page.click('#lib-more'); await T(450);
const libOn = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
ck('library sheet says assist is on once a key exists', libOn.some(t => /Claude assist — on/.test(t)), JSON.stringify(libOn.filter(t => /Claude/.test(t))));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await T(300);

/* ---------- 7. a model persisted in kv is validated, not trusted ---------- */
const put = (k, v) => page.evaluate(({ k, v }) => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(true); };
}), { k, v });
await put('claudeModel', 'evil-model-9');
await page.reload(); await T(3600);
const bogus = await page.evaluate(() => ({ model: window.tenebrae._claude.model(), ready: window.tenebrae._claude.ready(), calls: window.__fetchCalls.length }));
console.log('   after bogus kv model:', JSON.stringify(bogus));
ck('a model not on the offered list is ignored', bogus.model === 'claude-opus-5', bogus.model);
ck('the key survives a reload (kv, not state)', bogus.ready === true, bogus.ready);
ck('reload with a key present still makes no request', bogus.calls === 0, bogus.calls);
await put('claudeModel', 'claude-haiku-4-5');
await page.reload(); await T(3600);
const chosen = await page.evaluate(() => window.tenebrae._claude.model());
ck("the author's own choice is honoured", chosen === 'claude-haiku-4-5', chosen);

ck('no external request reached the wire all session', !netReq.some(u => /anthropic/.test(u)), netReq.slice(0, 4).join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`TX-13 GATE VERDICT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
