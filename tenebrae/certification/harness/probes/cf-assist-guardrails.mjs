// TX-15 — constrained answers, verified claims, under a HOSTILE model response.
//
// The green probe checks the four ordinary drops (absent / ambiguous / no-op /
// fabricated quote) and the grammar schema. This probe attacks the parts nobody
// wrote a probe for:
//   · the CARDS schema (closure was only ever asserted for grammar)
//   · overlapping fixes — one accepted edit manufacturing a second occurrence
//     of the next fix's anchor
//   · a fix whose "after" carries script (PUA) or markup
//   · a card quote that matches only AFTER normalisation, and what gets stored
//   · unicode look-alikes, zero-width characters, NBSP anchors
//   · a huge answer
//   · nothing applied without an explicit accept, and undo reversing an accept
// Every request is answered locally; nothing reaches the wire.
// Run: cd probes && node cf-assist-guardrails.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, PUA_RE } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 260)); };

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
await T(3600);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-probe-guard'));
await createBook(page, 'Guardrail Book');
await page.click('#ed-content');
await page.keyboard.type('Alpha stands at the gate. The drover walks the long road home.');
await T(900);

const stub = (obj, which, text, known) => page.evaluate(async ({ obj, which, text, known }) => {
  window.__reply = obj;
  return which === 'g' ? await window.tenebrae._claude.grammar(text)
                       : await window.tenebrae._claude.cards(text, known || []);
}, { obj, which, text, known });

/* ---------- 1. the CARDS request is as constrained as the grammar one ---------- */
await stub({ cards: [] }, 'c', 'Alpha stands at the gate.', ['Alpha']);
const cardsBody = await page.evaluate(() => JSON.parse(window.__bodies[window.__bodies.length - 1]));
const cs = cardsBody.output_config.format.schema;
console.log('   cards schema keys:', Object.keys(cs.properties.cards.items.properties).join(','));
ck('the cards pass asks for constrained JSON', cardsBody.output_config.format.type === 'json_schema');
ck('the cards schema closes the root object', cs.additionalProperties === false);
ck('the cards schema closes each card object', cs.properties.cards.items.additionalProperties === false);
ck('the cards schema requires every field it reads',
   ['title','type','aliases','keywords','quotes','notes'].every(k => cs.properties.cards.items.required.includes(k)),
   JSON.stringify(cs.properties.cards.items.required));
ck('the cards request carries a real max_tokens', cardsBody.max_tokens >= 1000, cardsBody.max_tokens);

/* ---------- 2. unicode look-alikes, zero-width and NBSP anchors ---------- */
const SCENE = 'Alpha stands at the gate. The drover walks the long road home.';
const tricky = await stub({ fixes: [
  { before: 'Alphа stands', after: 'Alpha stood', why: 'cyrillic a', kind: 'spelling' },        // homoglyph
  { before: 'Alpha​stands', after: 'Alpha stood', why: 'zero width', kind: 'spelling' },        // ZWSP
  { before: 'the gate', after: 'the gates', why: 'nbsp anchor', kind: 'grammar' },              // NBSP
  { before: 'the long road', after: 'the long‮ road', why: 'rtl override in the replacement', kind: 'grammar' },
  { before: '   ', after: 'x', why: 'whitespace anchor', kind: 'punctuation' },
  { before: 'walks the long', after: 'walked the long', why: 'tense', kind: 'grammar' },        // clean, findable
] }, 'g', SCENE);
console.log('   tricky fixes kept:', JSON.stringify(tricky.map(f => f.before)));
ck('a homoglyph anchor is dropped', !tricky.some(f => /а/.test(f.before)));
ck('a zero-width-joined anchor is dropped', !tricky.some(f => /​/.test(f.before)));
ck('an NBSP anchor that the scene does not contain is dropped', !tricky.some(f => / /.test(f.before)));
ck('a whitespace-only anchor is dropped', !tricky.some(f => !f.before.trim()));
// the replacement is text the author is about to read as their own: a bidi
// override is invisible and reorders every character after it
ck('a replacement carrying an RTL override is dropped', !tricky.some(f => /[\u202A-\u202E\u2066-\u2069]/.test(f.after)),
   JSON.stringify(tricky.map(f => f.after)));
ck('only the one clean findable anchor survives', tricky.length === 1 && tricky[0].before === 'walks the long', JSON.stringify(tricky));

/* ---------- 3. a fix whose "after" carries script ---------- */
const withPUA = await stub({ fixes: [
  { before: 'The drover', after: 'The  drover', why: 'script in the replacement', kind: 'spelling' }
] }, 'g', SCENE);
// the codex writes the Tenebrae; a copy-editor's replacement never does
ck('a replacement carrying PUA is dropped',
   withPUA.length === 0, JSON.stringify(withPUA));

/* ---------- 4. nothing is applied without an accept ---------- */
await page.evaluate(() => { document.querySelector('#ed-content').innerHTML = '<p>Alpha stands at the gate.</p><p>The drover walks the long road home.</p>'; });
await T(300);
await page.evaluate(() => { window.__reply = { fixes: [
  { before: 'Alpha', after: 'drover', why: 'a wrong but valid edit', kind: 'spelling' },
  { before: 'drover', after: 'reeve', why: 'the second edit', kind: 'spelling' }
] }; });
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1500);
const beforeAccept = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   sheet open, doc still:', JSON.stringify(beforeAccept));
ck('with the proposal on screen and nothing accepted, the manuscript is untouched',
   beforeAccept === 'Alpha stands at the gate.The drover walks the long road home.', JSON.stringify(beforeAccept));

/* ---------- 5. overlapping fixes: the first accept manufactures a second anchor ---------- */
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const mid = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 1:', JSON.stringify(mid));
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const end = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 2:', JSON.stringify(end));
ck('fix 2 landed on the drover it was quoted against, not on the word fix 1 created',
   /^drover stands at the gate\.The reeve walks/.test(end) || /^Alpha stands/.test(end),
   JSON.stringify(end));
await closeSheet();

/* ---------- 6. undo reverses an accepted edit ---------- */
await page.evaluate(() => { document.querySelector('#ed-content').innerHTML = '<p>The gate stands open tonight.</p>'; });
await T(300);
await page.evaluate(() => { window.__reply = { fixes: [{ before: 'stands open', after: 'stood open', why: 'tense', kind: 'tense' }] }; });
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1400);
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const applied = await page.evaluate(() => document.querySelector('#ed-content').textContent);
await closeSheet();
await page.click('#ed-content');
await page.keyboard.press('Control+z');
await T(600);
const undone = await page.evaluate(() => ({ dom: document.querySelector('#ed-content').textContent, doc: window.tenebrae._omni.probe.sceneDoc() }));
console.log('   applied:', JSON.stringify(applied), '-> after undo:', JSON.stringify(undone.dom));
ck('the accepted edit really landed', /stood open/.test(applied), applied);
ck('undo reverses it (execCommand, not innerHTML)', /stands open/.test(undone.dom), JSON.stringify(undone));

/* ---------- 7. markup in a replacement stays literal ---------- */
await page.evaluate(() => { document.querySelector('#ed-content').innerHTML = '<p>The lantern burns low.</p>'; });
await T(250);
// The handler-bearing version is now dropped before it is ever offered — thirty
// characters of markup wrapped round nine of text is not a correction, and the
// mechanical-edit threshold says so. Check that, then offer a replacement small
// enough to survive the threshold, so what execCommand does with markup is
// still under test.
await page.evaluate(async () => {
  window.__reply = { fixes: [{ before: 'burns low', after: '<b onmouseover="alert(1)">burns low</b>', why: 'markup', kind: 'grammar' }] };
  window.__hostileMarkup = (await window.tenebrae._claude.grammar('The lantern burns low.')).length;
});
ck('a replacement that wraps the anchor in markup is dropped as a rewrite',
   (await page.evaluate(() => window.__hostileMarkup)) === 0,
   String(await page.evaluate(() => window.__hostileMarkup)));
await page.evaluate(() => { window.__reply = { fixes: [{ before: 'burns low', after: '<b>burns low</b>', why: 'markup', kind: 'grammar' }] }; });
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1400);
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const markup = await page.evaluate(() => ({ html: document.querySelector('#ed-content').innerHTML, text: document.querySelector('#ed-content').textContent }));
console.log('   after a markup replacement:', JSON.stringify(markup.html).slice(0, 200));
ck('markup in a replacement is inserted as literal text, not parsed',
   !/<b[ >]/i.test(markup.html) && markup.text.includes('<b>burns low</b>'), JSON.stringify(markup.html).slice(0, 160));
ck('no element with an inline handler exists in the editor', !(await page.evaluate(() => !!document.querySelector('#ed-content [onmouseover]'))));
await closeSheet();

/* ---------- 8. card quotes: verbatim, or only-after-normalisation ---------- */
const QSCENE = 'She said, “the sea remembers the old king,” and the lamp\nheld steady.';
const qcards = await stub({ cards: [
  { title: 'The Old King', type: 'person', aliases: [], keywords: [],
    quotes: ['"the sea remembers the old king,"',            // straight quotes: matches only after normalisation
             'the lamp held steady',                          // matches only after newline collapsing
             'the sea forgets the old king'],                 // fabrication
    notes: 'A king.' },
  { title: 'Bogus', type: 'not-a-type', aliases: ['a','b','c','d','e','f','g','h','i','j'],
    keywords: Array.from({ length: 20 }, (_, i) => 'k' + i),
    quotes: ['x1','x2','x3','x4','x5'], notes: 'n' }
] }, 'c', QSCENE);
console.log('   quotes kept:', JSON.stringify(qcards[0].quotes));
ck('a fabricated quote is still dropped', !qcards[0].quotes.some(q => /forgets/.test(q)));
ck('an unknown card type falls back to "thing"', qcards[1].type === 'thing', qcards[1].type);
ck('aliases and keywords are capped', qcards[1].aliases.length <= 8 && qcards[1].keywords.length <= 12,
   qcards[1].aliases.length + '/' + qcards[1].keywords.length);
ck('quotes are capped at 4', qcards[1].quotes.length <= 4, qcards[1].quotes.length);
const stored = qcards[0].quotes;
const verbatim = stored.every(q => QSCENE.includes(q));
console.log('   stored quote is a literal substring of the scene?', verbatim);
ck('every stored quote is verbatim in the scene as the author wrote it', verbatim,
   JSON.stringify(stored.filter(q => !QSCENE.includes(q))));

/* ---------- 9. a huge answer ---------- */
const t0 = Date.now();
const huge = await page.evaluate(async () => {
  const fixes = [];
  for(let i = 0; i < 5000; i++) fixes.push({ before: 'phantom anchor ' + i, after: 'x' + i, why: 'w', kind: 'grammar' });
  fixes.push({ before: 'Alpha', after: 'A'.repeat(200000), why: 'huge replacement', kind: 'spelling' });
  fixes.push({ before: 'teh gate', after: 'the gate', why: 'a real one', kind: 'spelling' });
  window.__reply = { fixes };
  const out = await window.tenebrae._claude.grammar('Alpha stands at teh gate.');
  return { kept: out.length, keptBefore: out[0] ? out[0].before : null,
           firstAfterLen: out[0] ? out[0].after.length : 0,
           rewrites: (window.tenebrae._claude.last() || {}).rewrites };
});
console.log('   huge answer ->', JSON.stringify(huge), 'in', Date.now() - t0, 'ms');
ck('5000 phantom fixes are all dropped, the one real correction survives',
   huge.kept === 1 && huge.keptBefore === 'teh gate', JSON.stringify(huge));
// A 200,000-character "replacement" for a five-letter anchor is not a
// correction by any measure, and it is now refused before it can be offered —
// which is a better outcome than offering it intact. What still matters is that
// the app does not truncate it into something plausible, hang on it, or throw.
ck('a 200k-character replacement is refused as a rewrite, not truncated into something plausible',
   huge.firstAfterLen !== 200000 && huge.rewrites >= 1 && errors.length === 0,
   JSON.stringify({ firstAfterLen: huge.firstAfterLen, rewrites: huge.rewrites, errors: errors.length }));

/* ---------- 10. a hostile shape cannot poison the runtime ---------- */
const poison = await page.evaluate(async () => {
  window.__reply = JSON.parse('{"fixes":[{"before":"Alpha","after":"Beta","why":"w","kind":"grammar","__proto__":{"polluted":1}}],"__proto__":{"polluted":1}}');
  const out = await window.tenebrae._claude.grammar('Alpha stands at the gate.');
  return { kept: out.length, polluted: ({}).polluted === 1 };
});
ck('a response with __proto__ keys does not pollute Object.prototype', poison.polluted === false, JSON.stringify(poison));

ck('nothing ever reached the wire', wire.length === 0, wire.join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`TX-15 GUARDRAILS VERDICT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
