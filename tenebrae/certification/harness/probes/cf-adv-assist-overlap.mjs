// ADVERSARY / TX-15 — independent re-derivation of the apply-time overlap the
// audit reported, with the anchor that actually collides (cf-adv-assist-apply.mjs
// used a two-word anchor and therefore could not collide — kept as a negative
// control: not every chained pair misfires).
//
// Scene:   line 1 "The reeve stands at the gate."   line 3 "The drover walks…"
// fix 1    reeve  -> drover        (unique in the manuscript the model read)
// fix 2    drover -> ferryman      (also unique in the manuscript the model read)
// After fix 1 the word "drover" exists twice; claudeApplyFix (L4664-4670) takes
// the FIRST document-order match with no re-check, so fix 2 must be shown to
// land on the drover in line 3 — the one it was quoted against — or the
// guarantee "checked against the manuscript" does not survive to apply time.
// Run: cd probes && node cf-adv-assist-overlap.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.__reply = { fixes: [], cards: [] };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {},
    content: [{ type: 'text', text: JSON.stringify(window.__reply) }] }) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };

await page.goto(srv.url + 'step1.html');
await T(3800);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-ADVERSARY-OVERLAP'));
await createBook(page, 'Overlap Book');
await page.click('#ed-content');
await page.keyboard.type('The reeve stands at the gate.');
await page.keyboard.press('Enter');
await page.keyboard.type('The lamp holds steady over the water.');
await page.keyboard.press('Enter');
await page.keyboard.type('The drover walks the long road home.');
await T(900);

await page.evaluate(() => { window.__reply = { fixes: [
  { before: 'reeve',  after: 'drover',   why: 'the character is a drover', kind: 'spelling' },
  { before: 'drover', after: 'ferryman', why: 'and in fact a ferryman',    kind: 'spelling' } ] }; });

await page.click('#ed-more'); await T(450);
// what the model was actually shown, and how unique each anchor was there
// the PERSISTED doc is what claudeGrammarSheet compiles (#ed-more persists
// first, L1912), not the live DOM — the live DOM still holds the first typed
// line as a bare top-level run, which sanitizeHTML wraps in <p> on persist.
const payload = await page.evaluate(() =>
  window.tenebrae._claude.sceneText(window.tenebrae._omni.probe.sceneDoc()));
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1400);
const start = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   manuscript as sent (persisted doc):', JSON.stringify(payload));
console.log('   doc before:', JSON.stringify(start));
ck('both anchors were unique in the manuscript the model read (so both are offered)',
   payload.split('reeve').length - 1 === 1 && payload.split('drover').length - 1 === 1, payload);

await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click(); await T(900);
const mid = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 1 (reeve -> drover):', JSON.stringify(mid));
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click(); await T(900);
const end = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 2 (drover -> ferryman):', JSON.stringify(end));
await close();

const line3Fixed = /ferryman walks the long road home/.test(end);
const line1Hit   = /ferryman stands at the gate/.test(end);
console.log('   fix 2 landed on line 3?', line3Fixed, '  on line 1 instead?', line1Hit);
ck('fix 2 landed on the drover it was quoted against (line 3)', line3Fixed, end);
ck('fix 2 did NOT land on the word fix 1 manufactured (line 1)', !line1Hit, end);

// and the persisted doc agrees with what the author sees
const persisted = await page.evaluate(() => JSON.parse(JSON.stringify(
  window.tenebrae.state ? {} : {})) && document.querySelector('#ed-content').innerHTML);
console.log('   editor html at the end:', JSON.stringify(persisted));

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-15 OVERLAP', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
