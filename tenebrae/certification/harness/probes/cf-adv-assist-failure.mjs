// ADVERSARY / TX-16 — "a rejected key, a rate limit, a refusal and a malformed
// answer each surface a distinct, plain message; none is swallowed or treated
// as a result."
//
// The audit probe covered offline / 5xx / 4xx / truncation / refusal / no-text.
// This probe goes at what it did not:
//   · 401 specifically — "a rejected key" is one of the four named classes and
//     the code overrides the API's own message for it (L4515)
//   · are the four messages actually DISTINCT from each other and from the
//     success toasts (a message that repeats the clean-scene toast is not a
//     failure message)
//   · a 200 whose JSON parses but whose shape is wrong, re-derived through the
//     REAL menu on both passes, with the clean-scene toast measured beside it
//   · a request that never resolves: no AbortController, no timeout anywhere in
//     the artifact — what does the author see?
// Run: cd probes && node cf-adv-assist-failure.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.__mode = 'ok';
  window.__toasts = [];
  window.fetch = async () => {
    const m = window.__mode;
    if(m === 'hang') return new Promise(() => {});
    if(m === 'offline') throw new TypeError('Failed to fetch');
    const reply = body => ({ ok: true, status: 200, json: async () => body });
    if(m === '401') return { ok: false, status: 401, json: async () => ({ error: { message: 'authentication_error: invalid x-api-key' } }) };
    if(m === '429') return { ok: false, status: 429, json: async () => ({ error: { message: 'rate_limit_error' } }) };
    if(m === 'refusal') return reply({ model: 'claude-opus-5', stop_reason: 'refusal', content: [] });
    if(m === 'cut')     return reply({ model: 'claude-opus-5', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"fix' }] });
    if(m === 'notjson') return reply({ model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'I had a look and it reads fine.' }] });
    if(m === 'wrongshape') return reply({ model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{"fixes":"none at all","cards":"none"}' }] });
    if(m === 'emptyobj')   return reply({ model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{}' }] });
    if(m === 'nullfix')    return reply({ model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{"fixes":null,"cards":null}' }] });
    return reply({ model: 'claude-opus-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{"fixes":[],"cards":[]}' }] });
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(350); };

await page.goto(srv.url + 'step1.html');
await T(3800);
// record every toast the author is shown, from here on
await page.evaluate(() => {
  const t = document.querySelector('#toast');
  new MutationObserver(() => { const s = t.textContent; if(s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); })
    .observe(t, { childList: true, characterData: true, subtree: true });
});
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-ADVERSARY-FAIL'));
await createBook(page, 'Failure Book');
await page.click('#ed-content');
await page.keyboard.type('The gate stands open tonight and the lamp holds steady.');
await T(900);

const runPass = async (mode, label) => {
  await page.evaluate(m => { window.__mode = m; window.__toasts = []; }, mode);
  await page.click('#ed-more'); await T(450);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await T(1800);
  const toasts = await page.evaluate(() => window.__toasts.slice());
  await close();
  return toasts;
};

const seen = {};
for(const [mode, label] of [['401','Copy-edit'], ['429','Copy-edit'], ['refusal','Copy-edit'],
                            ['cut','Copy-edit'], ['notjson','Copy-edit'], ['offline','Copy-edit'],
                            ['ok','Copy-edit'], ['wrongshape','Copy-edit'], ['emptyobj','Copy-edit'],
                            ['nullfix','Copy-edit'],
                            ['ok','Harvest'], ['wrongshape','Harvest'], ['emptyobj','Harvest']]){
  const t = await runPass(mode, label);
  const key = mode + ' · ' + label;
  seen[key] = t;
  console.log('  ', key.padEnd(22), JSON.stringify(t));
}

const last = k => (seen[k] || []).slice(-1)[0] || '';
ck('401 says the key was rejected, in the app’s own words', last('401 · Copy-edit') === 'That API key was rejected', last('401 · Copy-edit'));
ck('429 says rate limited', /Rate limited/.test(last('429 · Copy-edit')), last('429 · Copy-edit'));
ck('a refusal says so', /declined/.test(last('refusal · Copy-edit')), last('refusal · Copy-edit'));
ck('a truncated answer says so', /cut short/.test(last('cut · Copy-edit')), last('cut · Copy-edit'));
ck('a non-JSON answer says so', /expected shape/.test(last('notjson · Copy-edit')), last('notjson · Copy-edit'));
ck('offline says so', /connection/.test(last('offline · Copy-edit')), last('offline · Copy-edit'));
const four = [last('401 · Copy-edit'), last('429 · Copy-edit'), last('refusal · Copy-edit'), last('notjson · Copy-edit')];
ck('the four named failure classes are distinct from each other', new Set(four).size === 4, JSON.stringify(four));

const clean = last('ok · Copy-edit');
console.log('   clean-scene toast:', JSON.stringify(clean));
for(const bad of ['wrongshape · Copy-edit', 'emptyobj · Copy-edit', 'nullfix · Copy-edit']){
  ck(`a malformed answer (${bad.split(' ·')[0]}) is not reported as a clean read`,
     last(bad) !== clean, last(bad) + '   vs clean: ' + clean);
}
const cleanCards = last('ok · Harvest');
for(const bad of ['wrongshape · Harvest', 'emptyobj · Harvest']){
  ck(`a malformed cards answer (${bad.split(' ·')[0]}) is not reported as nothing to file`,
     last(bad) !== cleanCards, last(bad) + '   vs clean: ' + cleanCards);
}

/* ---------- a request that never resolves ---------- */
await page.evaluate(() => { window.__mode = 'hang'; window.__toasts = []; });
await page.click('#ed-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit' }).click();
await T(15000);
const hung = await page.evaluate(() => window.__toasts.slice());
console.log('   after 15s on a request that never answers, toasts:', JSON.stringify(hung));
ck('a request that never answers eventually says something', hung.length > 1, JSON.stringify(hung));
await close();

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-16 ADVERSARY', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
