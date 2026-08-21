// ADVERSARY / TX-14 — "no accepted edit may land inside a span", tested against
// a REAL span made by the real translate path (the audit probe crafted a .tspan
// with Latin visible text; this one is the codex's own, carrying script).
//
// The trap: the English the model is shown for the span comes from data-src, so
// an anchor quoted from it is unique in the payload and passes the offer-time
// filter — yet its ONLY occurrence in the document is inside the span. The
// TreeWalker (L4657-4662) must refuse it, the span must survive byte-identical,
// and the author must be told the line could not be found.
// Run: cd probes && node cf-adv-assist-spanguard.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.__toasts = [];
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
await page.evaluate(() => {
  const t = document.querySelector('#toast');
  new MutationObserver(() => { const s = t.textContent; if(s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); })
    .observe(t, { childList: true, characterData: true, subtree: true });
});
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-ADVERSARY-SPANGUARD'));
await createBook(page, 'Span Guard Book');
await page.click('#ed-content');
await page.keyboard.type('A quiet opening. She said the sea remembers the old king.');
await T(700);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Kerrackian');
await T(800); await close();

const before = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return { html: document.querySelector('#ed-content').innerHTML,
           span: t ? t.outerHTML : null, src: t ? t.dataset.src : null, text: t ? t.textContent : '' };
});
ck('a real codex span, carrying script (teeth)', !!before.span && PUA_RE.test(before.text), before.src);

await page.click('#ed-more'); await T(450);
const payload = await page.evaluate(() => window.tenebrae._claude.sceneText(window.tenebrae._omni.probe.sceneDoc()));
console.log('   payload:', JSON.stringify(payload));
ck('the span’s English is in the payload exactly once (so the anchor passes the filter)',
   payload.split('the sea remembers the old king').length - 1 === 1, payload);
await close();

await page.evaluate(() => { window.__toasts = []; window.__reply = { fixes: [
  { before: 'the sea remembers the old king', after: 'THE MODEL WROTE HERE', why: 'x', kind: 'grammar' } ] }; });
await page.click('#ed-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1500);
const offered = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item')].map(e => e.textContent.trim()));
console.log('   sheet:', JSON.stringify(offered));
ck('the fix was actually offered (teeth: the guard is the apply, not the filter)',
   offered.some(l => /Accept this change/.test(l)), JSON.stringify(offered));
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(1000);
const after = await page.evaluate(() => ({
  html: document.querySelector('#ed-content').innerHTML,
  span: (document.querySelector('#ed-content .tspan') || {}).outerHTML || null,
  toasts: window.__toasts.slice(),
  doc: window.tenebrae._omni.probe.sceneDoc()
}));
await close();
console.log('   toasts:', JSON.stringify(after.toasts));
console.log('   span after:', JSON.stringify((after.span || '').slice(0, 120)));
ck('the span is byte-identical after the accept', after.span === before.span, after.span);
ck('the editor is unchanged', after.html === before.html);
ck('the model’s text is nowhere in the scene', !/THE MODEL WROTE HERE/.test(after.html + after.doc));
ck('the author is told the line could not be found',
   after.toasts.some(t => /Couldn’t find that line any more/.test(t)), JSON.stringify(after.toasts));

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-14 SPAN GUARD', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
