// TX-14 — the Tenebrae is never sent, and no accepted edit lands in a span.
//
// tx-claude-assist.mjs checks the happy span (data-src intact). This probe goes
// after the edges the briefing names and the green probe does not touch:
//   · a span whose data-src is EMPTY — both while it is still a span and after
//     the app's own sanitizeHTML/persistEditor has had it
//   · script that is loose PROSE rather than span content (which is exactly what
//     the app's own sanitizer makes of a src-less span)
//   · the SECOND request body: claudeCards puts existing CARD TITLES into the
//     user message, and nothing scrubs them
//   · the apply guard: a fix whose anchor exists only inside a .tspan
// Every request is answered locally; nothing reaches the wire.
// Run: cd probes && node cf-assist-nosend.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, PUA_RE } from './ex-lib.mjs';

const PUA_G = /[-]/g;
const puaOf = s => Array.from(String(s).match(PUA_G) || []).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase());
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
const T = ms => page.waitForTimeout(ms);
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };
await page.goto(srv.url + 'step1.html');
await T(3800);

await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-probe-nosend'));
await createBook(page, 'No-Send Book');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady over the water. She said the sea remembers the old king.');
await T(800);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Celan High');
await T(900);
await closeSheet();

const span = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom, scr: t.dataset.scr || '', text: t.textContent } : null;
});
console.log('   span lang/src/rom:', JSON.stringify({ lang: span.lang, src: span.src, rom: span.rom }));
console.log('   span script codepoints:', puaOf(span.scr).slice(0, 10).join(' '), `(${puaOf(span.scr).length} total)`);
ck('the span really carries script (teeth for what follows)', PUA_RE.test(span.scr) && PUA_RE.test(span.text), puaOf(span.scr).length + ' PUA chars');

/* ---------- 1. baseline: the real request body carries English only ---------- */
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1500);
const b0 = await page.evaluate(() => window.__bodies[window.__bodies.length - 1]);
console.log('   body#1 user msg:', JSON.stringify(JSON.parse(b0).messages[0].content));
ck('an intact span is sent as the English', b0.includes('the sea remembers the old king'));
ck('no PUA in the request body', !PUA_RE.test(b0), puaOf(b0).join(' '));
ck('no romanization in the request body', !b0.includes(span.rom), span.rom);
await closeSheet();

/* ---------- 2. a span whose data-src is empty ---------- */
const emptySrc = await page.evaluate(({ lang, rom, scr }) => {
  const html = `<p>Prologue line.</p><p><span class="tspan" contenteditable="false" data-lang="${lang}" data-omni="1" data-src="" data-rom="${rom}" data-scr="${scr}">${scr}</span></p>`;
  const asSpan = window.tenebrae._claude.sceneText(html);
  const sanitized = window.tenebrae._omni.probe.sanitize(html);
  const afterSanitize = window.tenebrae._claude.sceneText(sanitized);
  return { asSpan, sanitized, afterSanitize };
}, span);
console.log('   src-less span, as a span   -> PUA:', puaOf(emptySrc.asSpan).length, JSON.stringify(emptySrc.asSpan));
console.log('   src-less span, sanitized   -> tspan kept?', /tspan/.test(emptySrc.sanitized), 'PUA:', puaOf(emptySrc.sanitized).length);
console.log('   sanitized, then sceneText  -> PUA:', puaOf(emptySrc.afterSanitize).length, puaOf(emptySrc.afterSanitize).slice(0, 8).join(' '));
ck('a src-less span, while still a span, contributes nothing to the payload',
   !PUA_RE.test(emptySrc.asSpan) && !emptySrc.asSpan.includes(span.rom), JSON.stringify(emptySrc.asSpan));
ck("the app's own sanitizer keeps the script when it drops the src-less span (teeth)",
   PUA_RE.test(emptySrc.sanitized) && !/tspan/.test(emptySrc.sanitized), 'PUA ' + puaOf(emptySrc.sanitized).length + ' / tspan ' + /tspan/.test(emptySrc.sanitized));
ck('script the sanitizer left as prose is NOT put in the payload', !PUA_RE.test(emptySrc.afterSanitize),
   'leaked ' + puaOf(emptySrc.afterSanitize).length + ': ' + puaOf(emptySrc.afterSanitize).slice(0, 8).join(' '));

/* ---------- 3. end to end: paste such a span, run the pass, read the body ---------- */
await page.evaluate(({ lang, rom, scr }) => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/html', `<p><span class="tspan" data-lang="${lang}" data-omni="1" data-src="" data-rom="${rom}" data-scr="${scr}">${scr}</span></p>`);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, span);
await T(900);
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1600);
const b1 = await page.evaluate(() => ({ body: window.__bodies[window.__bodies.length - 1], doc: window.tenebrae._omni.probe.sceneDoc() }));
console.log('   scene doc after paste: tspan?', /tspan/.test(b1.doc), 'PUA:', puaOf(b1.doc).length);
console.log('   body#2 user msg:', JSON.stringify(JSON.parse(b1.body).messages[0].content));
console.log('   body#2 PUA codepoints:', puaOf(b1.body).join(' '));
ck('the pasted script really landed in the scene (teeth)', PUA_RE.test(b1.doc), 'doc PUA ' + puaOf(b1.doc).length);
ck('NO PUA codepoint in the request body after a pasted src-less span', !PUA_RE.test(b1.body),
   'leaked ' + puaOf(b1.body).length + ': ' + puaOf(b1.body).join(' '));
await closeSheet();

/* ---------- 3b. the same, with an ORDINARY plain-text paste ---------- */
// no crafted markup at all: this is what the clipboard holds when an author
// copies a rendered translated line and pastes it as plain text.
await page.evaluate(async () => {
  const b = document.querySelector('#bk-back'); // no-op guard
  const s = document.querySelector('#ed-content');
  return !!s;
});
await page.evaluate(({ scr }) => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>A clean opening line.</p>';
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/plain', ' ' + scr);   // text/plain ONLY — the plain-paste path
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, span);
await T(900);
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1600);
const b1b = await page.evaluate(() => ({ body: window.__bodies[window.__bodies.length - 1], doc: window.tenebrae._omni.probe.sceneDoc() }));
console.log('   plain-paste doc: tspan?', /tspan/.test(b1b.doc), 'PUA:', puaOf(b1b.doc).length);
console.log('   body#2b PUA codepoints:', puaOf(b1b.body).slice(0, 12).join(' '), '(' + puaOf(b1b.body).length + ')');
ck('the plain-text paste really landed (teeth)', PUA_RE.test(b1b.doc), 'doc PUA ' + puaOf(b1b.doc).length);
ck('NO PUA codepoint in the request body after an ordinary plain-text paste of script',
   !PUA_RE.test(b1b.body), 'leaked ' + puaOf(b1b.body).length + ': ' + puaOf(b1b.body).slice(0, 12).join(' '));
await closeSheet();
// restore the pasted-span scene for the card step
await page.evaluate(({ lang, rom, scr }) => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>The lamp holds steady over the water.</p><p>' + scr + '</p>';
}, span);
await T(500);

/* ---------- 4. the cards body: existing card titles ---------- */
const picked = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    if(/[-]/.test(n.nodeValue) && !(n.parentElement && n.parentElement.closest('.tspan'))){
      const end = Math.min(n.nodeValue.length, 20); // <= 42 chars: promptNewCard prefills the title
      const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, end);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return n.nodeValue.slice(0, end);
    }
  }
  return null;
});
console.log('   selected loose run:', puaOf(picked || '').length, 'PUA chars');
ck('a loose run of script can be selected (teeth for the card path)', !!picked && PUA_RE.test(picked || ''), puaOf(picked || '').join(' '));
await page.click('#ed-more'); await T(600);
await page.locator('#sheet .sh-item', { hasText: 'to a card' }).first().click();
await T(600);
await page.locator('#sheet .sh-item', { hasText: 'New card' }).click();
await T(700);
const guess = await page.inputValue('#ps-input').catch(() => '');
console.log('   new-card title prefilled with:', puaOf(guess).length, 'PUA chars:', puaOf(guess).join(' '));
await page.click('#ps-save').catch(() => {});
await T(900);
await closeSheet();
// promptNewCard opens the card screen — walk back until the editor is on top
for(let i = 0; i < 4; i++){
  const onEditor = await page.evaluate(() => {
    const scr = document.querySelector('#scr-editor');
    return !!scr && scr.classList.contains('on') && !document.querySelector('#scr-card.on') && !document.querySelector('#scr-cards.on');
  });
  if(onEditor) break;
  await page.evaluate(() => {
    const b = document.querySelector('#scr-card.on #cc-back') || document.querySelector('#scr-cards.on #cd-back');
    if(b) b.click();
  });
  await T(600);
}
const cardTitles = await page.evaluate(() => Array.from(document.querySelectorAll('#cc-title, #cd-list')).length);
await page.click('#ed-more'); await T(600);
await page.locator('#sheet .sh-item', { hasText: 'Harvest cards from this scene' }).click();
await T(1700);
const b2 = await page.evaluate(() => window.__bodies[window.__bodies.length - 1]);
console.log('   body#3 user msg:', JSON.stringify(JSON.parse(b2).messages[0].content).slice(0, 300));
console.log('   body#3 PUA codepoints:', puaOf(b2).join(' '));
ck('NO PUA codepoint in the cards request body (card titles included)', !PUA_RE.test(b2),
   'leaked ' + puaOf(b2).length + ': ' + puaOf(b2).join(' '));
await closeSheet();

/* ---------- 5. an accepted fix may not land inside a span ---------- */
const applyGuard = await page.evaluate(async ({ lang }) => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = `<p>Opening prose here.</p><p><span class="tspan" contenteditable="false" data-lang="${lang}" data-src="the lamp holds steady" data-rom="the lamp holds steady">the lamp holds steady</span></p>`;
  window.__reply = { fixes: [{ before: 'the lamp holds steady', after: 'THE LAMP HELD STEADY', why: 'tense', kind: 'tense' }] };
  const scene = window.tenebrae._claude.sceneText(ed.innerHTML);
  const fixes = await window.tenebrae._claude.grammar(scene);
  return { scene, offered: fixes.length };
}, span);
console.log('   crafted scene:', JSON.stringify(applyGuard.scene), 'offered:', applyGuard.offered);
ck('the crafted fix survives the filter, so the apply guard is what is under test', applyGuard.offered === 1, JSON.stringify(applyGuard));
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1700);
const sheetTxt = await page.evaluate(() => (document.querySelector('#sheet') || {}).textContent || '');
console.log('   copy-edit sheet:', JSON.stringify(sheetTxt.replace(/\s+/g, ' ').slice(0, 180)));
await page.evaluate(() => {
  window.__toasts = [];
  const t = document.querySelector('#toast');
  if(t) new MutationObserver(() => { const v = t.textContent.trim(); if(v && window.__toasts[window.__toasts.length - 1] !== v) window.__toasts.push(v); })
        .observe(t, { childList: true, characterData: true, subtree: true });
});
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(1200);
const toasts = await page.evaluate(() => window.__toasts || []);
console.log('   toasts after accept:', JSON.stringify(toasts));
const after = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return { spanExists: !!t, spanText: t ? t.textContent : null,
           html: document.querySelector('#ed-content').innerHTML, toast: (document.querySelector('#toast') || {}).textContent || '' };
});
console.log('   after accept:', JSON.stringify(after).slice(0, 320));
ck('the span survived the accepted fix untouched', after.spanExists && after.spanText === 'the lamp holds steady', JSON.stringify(after).slice(0, 200));
ck('the edit did not land inside the span', !/THE LAMP HELD STEADY/.test(after.html), after.html.slice(0, 220));
ck('the author is told plainly that it could not be applied', toasts.some(t => /Couldn|could not/i.test(t)), JSON.stringify(toasts));

ck('nothing ever reached the wire', wire.length === 0, wire.join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`TX-14 NO-SEND VERDICT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
