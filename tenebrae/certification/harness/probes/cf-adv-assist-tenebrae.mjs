// ADVERSARY / TX-14 — "no PUA codepoint may appear in any request body".
//
// The audit probe synthesised the script it pasted. This probe never types a
// PUA character of its own: it takes whatever the APP ITSELF puts on the system
// clipboard when the author selects a rendered translated line and presses
// Ctrl+C, and pastes that back the two ways a real clipboard offers:
//   (a) the rich path  — text/html is present, the span comes back whole
//   (b) the plain path — "paste and match style": text/plain only
// Then it runs the real 'Copy-edit this scene' menu item and reads the request
// body. It also checks the second request (cards) with a card title the author
// made from that same clipboard through the real card UI.
// Run: cd probes && node cf-adv-assist-tenebrae.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';

const PUA_G = /[-]/g;
const puaOf = s => Array.from(String(s).match(PUA_G) || []).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase());
const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
await context.addInitScript(() => {
  window.__bodies = [];
  window.__reply = { fixes: [], cards: [] };
  window.fetch = async (url, opts) => {
    window.__bodies.push(String(opts && opts.body || ''));
    return { ok: true, status: 200, json: async () => ({
      model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify(window.__reply) }] }) };
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };
const lastBody = () => page.evaluate(() => window.__bodies[window.__bodies.length - 1] || '');
const runPass = async label => { await page.click('#ed-more'); await T(500);
  await page.locator('#sheet .sh-item', { hasText: label }).click(); await T(1600); await close(); };

await page.goto(srv.url + 'step1.html');
await T(3800);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-ADVERSARY-TENEBRAE'));
await createBook(page, 'Tenebrae Send Book');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady. She said the sea remembers the old king.');
await T(700);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Kildaren');
await T(800); await close();

const span = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t && { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom, text: t.textContent };
});
console.log('   span:', JSON.stringify(span));
ck('the span really renders script (teeth)', !!span && PUA_RE.test(span.text), puaOf(span.text).length + ' PUA');

/* ---------- 0. baseline: an intact span goes as English ---------- */
await runPass('Copy-edit this scene');
const b0 = await lastBody();
console.log('   body#1:', JSON.stringify(JSON.parse(b0).messages[0].content));
ck('an intact span is sent as the author’s English', b0.includes('the sea remembers the old king'));
ck('body#1 carries no PUA', !PUA_RE.test(b0), puaOf(b0).join(' '));
ck('body#1 carries no romanization', !b0.includes(span.rom), span.rom);

/* ---------- 1. what the APP puts on the real system clipboard ---------- */
await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  const r = document.createRange(); r.selectNode(t);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('copy');
});
await T(400);
const clip = await page.evaluate(() => navigator.clipboard.readText());
console.log('   clipboard text after the app’s own Ctrl+C:', JSON.stringify(clip.slice(0, 40)), puaOf(clip).length, 'PUA');
ck('the app’s own copy puts the SCRIPT on the clipboard (nothing synthesised here)',
   PUA_RE.test(clip), puaOf(clip).slice(0, 6).join(' '));

/* ---------- 2. the rich paste path (text/html present) ---------- */
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>A clean opening line.</p>';
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.keyboard.press('Control+V');
await T(900);
const richDoc = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
console.log('   after the rich paste, tspan kept?', /tspan/.test(richDoc), ' PUA in doc:', puaOf(richDoc).length);
await runPass('Copy-edit this scene');
const b2 = await lastBody();
console.log('   body#2:', JSON.stringify(JSON.parse(b2).messages[0].content).slice(0, 200));
ck('after an ordinary in-app copy/paste, the body still carries no PUA', !PUA_RE.test(b2),
   'leaked ' + puaOf(b2).length + ': ' + puaOf(b2).slice(0, 8).join(' '));

/* ---------- 3. the plain path: "paste and match style" ---------- */
// text/plain only — exactly the clipboard flavour the OS hands over when the
// author pastes without formatting, or comes back in from another app.
await page.evaluate(txt => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>A clean opening line.</p>';
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/plain', ' ' + txt);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, clip);
await T(900);
const plainDoc = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
console.log('   after the plain paste, tspan?', /tspan/.test(plainDoc), ' PUA in doc:', puaOf(plainDoc).length);
// The clipboard really does hold the script (asserted above, from the app's own
// copy) — but the editor will not take it as prose. Script pasted as plain
// characters carries no tongue, no source and no font: it cannot be tapped back
// to English, cannot be re-rendered when the codex changes, and would ride into
// every export as raw codepoints. It is refused at the door, with a reason,
// rather than absorbed and stripped somewhere the author cannot see.
ck('a paste-and-match-style of the app\u2019s own clipboard is refused, not absorbed',
   !PUA_RE.test(plainDoc), puaOf(plainDoc).length + ' PUA landed');
await runPass('Copy-edit this scene');
const b3 = await lastBody();
console.log('   body#3 user msg:', JSON.stringify(JSON.parse(b3).messages[0].content));
console.log('   body#3 PUA:', puaOf(b3).join(' '));
ck('NO PUA codepoint in the request body after a paste-and-match-style of the app’s own clipboard',
   !PUA_RE.test(b3), 'leaked ' + puaOf(b3).length + ': ' + puaOf(b3).slice(0, 10).join(' '));

/* ---------- 4. the cards request: a card title made from that clipboard ---------- */
const cardTitle = clip.slice(0, 12);
await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = '<p>The gate stands open tonight.</p>'; });
await page.click('#ed-back'); await T(600);
await page.click('#bk-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click(); await T(800);
// the real New-card flow: #cd-new -> promptSheet -> Create
await page.click('#cd-new'); await T(600);
await page.fill('#ps-input', cardTitle);
await page.click('#ps-save'); await T(900);
const cardNow = await page.evaluate(() => {
  const t = document.querySelector('#cc-title');
  return t ? t.textContent : null;
});
console.log('   card title as filed:', JSON.stringify(cardNow), puaOf(cardNow || '').length, 'PUA');
ck('the card title really carries script (teeth)', PUA_RE.test(cardNow || ''), puaOf(cardNow || '').length);
await page.click('#cc-back'); await T(600);
await page.click('#cd-back'); await T(600);
await page.locator('[data-scene]').first().click(); await T(900);
await runPass('Harvest cards from this scene');
const b4 = await lastBody();
console.log('   body#4 user msg:', JSON.stringify(JSON.parse(b4).messages[0].content).slice(0, 260));
console.log('   body#4 PUA:', puaOf(b4).join(' '));
ck('NO PUA codepoint in the cards request body (existing card titles included)',
   !PUA_RE.test(b4), 'leaked ' + puaOf(b4).length + ': ' + puaOf(b4).slice(0, 10).join(' '));

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-14 ADVERSARY', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
