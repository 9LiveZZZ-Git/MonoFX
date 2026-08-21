// TX-16 — failure says something true.
//
// The green probe covers 401 / 429 / refusal / non-JSON. This probe covers the
// failures nobody wrote a probe for, and it reads the message the AUTHOR sees
// (the toast) rather than only the thrown Error:
//   · the connection dropping (fetch itself throwing)
//   · a 5xx, and a 4xx whose body is not JSON at all
//   · stop_reason "max_tokens" (a truncated answer is not an answer)
//   · a well-formed JSON answer of the WRONG SHAPE — {"fixes":"none"}, {} —
//     which is malformed, not a result
//   · a 200 whose content carries no text block
// Run: cd probes && node cf-assist-failures.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 240)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const wire = [];
page.on('request', r => { if(/anthropic/.test(r.url())) wire.push(r.url()); });
const T = ms => page.waitForTimeout(ms);
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };
await page.goto(srv.url + 'step1.html');
await T(3600);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-probe-fail'));
await createBook(page, 'Failure Book');
await page.click('#ed-content');
await page.keyboard.type('The gate stands open tonight and the drover walks home.');
await T(900);

/* ---------- 1. the thrown message for each failure ---------- */
const errs = await page.evaluate(async () => {
  const run = async (impl) => {
    window.fetch = impl;
    try{ const r = await window.tenebrae._claude.grammar('The gate stands open tonight.'); return { ok: true, value: JSON.stringify(r) }; }
    catch(e){ return { ok: false, msg: e.message }; }
  };
  const reply = (obj, extra) => async () => ({ ok: true, status: 200, json: async () => Object.assign({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(obj) }] }, extra || {}) });
  return {
    offline:   await run(async () => { throw new TypeError('Failed to fetch'); }),
    server500: await run(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'overloaded' } }) })),
    html400:   await run(async () => ({ ok: false, status: 400, json: async () => { throw new SyntaxError('not json'); } })),
    apimsg:    await run(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'max_tokens: must be > 0' } }) })),
    truncated: await run(reply({ fixes: [] }, { stop_reason: 'max_tokens' })),
    notext:    await run(async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hm' }] }) })),
    wrongShape:await run(reply({ fixes: 'none at all' })),
    emptyObj:  await run(reply({})),
    nullFixes: await run(reply({ fixes: null })),
  };
});
console.log('   ' + JSON.stringify(errs, null, 1).replace(/\n\s*/g, ' '));
ck('a dropped connection says the connection dropped', !errs.offline.ok && /reach the API|connection/i.test(errs.offline.msg), JSON.stringify(errs.offline));
ck('a 5xx says the API is in trouble', !errs.server500.ok && /API is having trouble/i.test(errs.server500.msg), JSON.stringify(errs.server500));
ck('a 4xx with an unreadable body still surfaces the status', !errs.html400.ok && /HTTP 400/.test(errs.html400.msg), JSON.stringify(errs.html400));
ck("a 4xx with an API message surfaces the API's own words", !errs.apimsg.ok && /max_tokens/.test(errs.apimsg.msg), JSON.stringify(errs.apimsg));
ck('a truncated answer is reported, not used', !errs.truncated.ok && /cut short/i.test(errs.truncated.msg), JSON.stringify(errs.truncated));
ck('a 200 with no text block is reported, not used', !errs.notext.ok, JSON.stringify(errs.notext));
ck('valid JSON of the WRONG SHAPE is reported, not treated as a result',
   !errs.wrongShape.ok, JSON.stringify(errs.wrongShape));
ck('an answer with no "fixes" key at all is reported, not treated as a result',
   !errs.emptyObj.ok, JSON.stringify(errs.emptyObj));
ck('"fixes": null is reported, not treated as a result', !errs.nullFixes.ok, JSON.stringify(errs.nullFixes));

/* ---------- 2. the same for the cards pass ---------- */
const cerrs = await page.evaluate(async () => {
  const run = async (impl) => {
    window.fetch = impl;
    try{ const r = await window.tenebrae._claude.cards('The gate stands open tonight.', []); return { ok: true, value: JSON.stringify(r) }; }
    catch(e){ return { ok: false, msg: e.message }; }
  };
  const reply = obj => async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(obj) }] }) });
  return {
    wrongShape: await run(reply({ cards: 'lots' })),
    emptyObj:   await run(reply({})),
    refusal:    await run(async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) })),
  };
});
console.log('   cards:', JSON.stringify(cerrs));
ck('cards: valid JSON of the wrong shape is reported, not treated as a result', !cerrs.wrongShape.ok, JSON.stringify(cerrs.wrongShape));
ck('cards: an answer with no "cards" key is reported, not treated as a result', !cerrs.emptyObj.ok, JSON.stringify(cerrs.emptyObj));
ck('cards: a refusal is reported', !cerrs.refusal.ok && /declined/i.test(cerrs.refusal.msg), JSON.stringify(cerrs.refusal));

/* ---------- 3. what the AUTHOR is actually told ---------- */
const toastFor = async (impl) => {
  await page.evaluate(implSrc => {
    window.__toasts = [];
    const t = document.querySelector('#toast');
    if(t && !window.__obs){
      window.__obs = new MutationObserver(() => { const v = t.textContent.trim(); if(v && window.__toasts[window.__toasts.length - 1] !== v) window.__toasts.push(v); });
      window.__obs.observe(t, { childList: true, characterData: true, subtree: true });
    }
    window.__toasts = [];
    window.fetch = eval('(' + implSrc + ')');
  }, impl);
  await page.click('#ed-more'); await T(500);
  await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
  await T(1500);
  const out = await page.evaluate(() => window.__toasts.slice());
  await closeSheet();
  return out;
};

const tRate = await toastFor("async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate' } }) })");
console.log('   toasts (429):', JSON.stringify(tRate));
ck('the author sees the rate-limit message', tRate.some(t => /Rate limited/i.test(t)), JSON.stringify(tRate));

const tOffline = await toastFor("async () => { throw new TypeError('Failed to fetch'); }");
console.log('   toasts (offline):', JSON.stringify(tOffline));
ck('the author sees the connection message', tOffline.some(t => /reach the API/i.test(t)), JSON.stringify(tOffline));

const tShape = await toastFor("async () => ({ ok: true, status: 200, json: async () => ({ model: 'm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{\"fixes\":\"none\"}' }] }) })");
console.log('   toasts (valid JSON, wrong shape):', JSON.stringify(tShape));
ck('a malformed answer is NOT reported to the author as a clean scene',
   !tShape.some(t => /reads clean/i.test(t)), JSON.stringify(tShape));

const tRefusal = await toastFor("async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) })");
console.log('   toasts (refusal):', JSON.stringify(tRefusal));
ck('the author sees the refusal', tRefusal.some(t => /declined/i.test(t)), JSON.stringify(tRefusal));

const tClean = await toastFor("async () => ({ ok: true, status: 200, json: async () => ({ model: 'm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{\"fixes\":[]}' }] }) })");
console.log('   toasts (a genuinely clean scene):', JSON.stringify(tClean));
ck('a real empty answer still reads as a clean scene (the message means something)',
   tClean.some(t => /reads clean/i.test(t)), JSON.stringify(tClean));

ck('nothing ever reached the wire', wire.length === 0, wire.join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`TX-16 FAILURES VERDICT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
