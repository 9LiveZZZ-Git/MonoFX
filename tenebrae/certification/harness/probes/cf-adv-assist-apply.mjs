// ADVERSARY / TX-15 — "checked against the manuscript before it is offered;
// nothing applied without the author accepting it".
//
// The audit probe found the chained-anchor misfire with two hostile fixes.
// This probe re-derives that independently AND goes after the parts of the
// verification path nobody has probed:
//   · what claudeSceneText actually compiles from a REAL editor doc — the
//     uniqueness count is taken on that string, so anything it duplicates or
//     omits corrupts the count
//   · whether a fix anchored inside a blockquote survives the count
//   · the quote guard's normaliser: it collapses the '\n\n' block joiner, so a
//     "quote" that spans two paragraphs — text that exists nowhere in the
//     manuscript as one run — passes the verbatim test
//   · what is STORED after a curly-quote fold
// Run: cd probes && node cf-adv-assist-apply.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await context.addInitScript(() => {
  window.__bodies = [];
  window.__reply = { fixes: [], cards: [] };
  window.fetch = async (url, opts) => {
    window.__bodies.push(String(opts && opts.body || ''));
    return { ok: true, status: 200, json: async () => ({
      model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 },
      content: [{ type: 'text', text: JSON.stringify(window.__reply) }] }) };
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };

await page.goto(srv.url + 'step1.html');
await T(3800);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-ADVERSARY-APPLY'));
await createBook(page, 'Apply Book');

/* ---------- 1. what the counter actually sees, from a REAL doc ---------- */
await page.click('#ed-content');
await page.keyboard.type('The reeve stands at the gate.');
await page.keyboard.press('Enter');
await page.keyboard.type('He said the road is long.');
await page.keyboard.press('Enter');
await page.keyboard.type('The drover walks the long road home.');
await T(700);
// make the middle line a blockquote through the real Aa panel
await page.click('#fb-aa'); await T(300);
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n; while((n = w.nextNode())) if(n.nodeValue.includes('the road is long')){
    const r = document.createRange(); r.setStart(n, 3); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return;
  }
});
await page.click('#aa-panel [data-block="blockquote"]');
await T(500);
await page.click('#ed-more'); await T(500); await close();  // forces persistEditor
const seen = await page.evaluate(() => {
  const s = window.tenebrae._omni && window.tenebrae._omni.probe ? null : null;
  const doc = document.querySelector('#ed-content').innerHTML;
  return { doc, text: window.tenebrae._claude.sceneText(doc) };
});
console.log('   live editor html:', JSON.stringify(seen.doc));
console.log('   compiled scene text:', JSON.stringify(seen.text));
const dupes = seen.text.split('\n\n').filter((l, i, a) => a.indexOf(l) !== i);
ck('the compiled payload repeats no block', dupes.length === 0, JSON.stringify(dupes));
const bqCount = seen.text.split('the road is long').length - 1;
console.log('   occurrences of the blockquote sentence in the payload:', bqCount);
ck('a sentence in a blockquote occurs exactly once in the payload', bqCount === 1, bqCount);

/* the operational consequence: is a fix anchored in the blockquote offered? */
const bqFix = await page.evaluate(async () => {
  window.__reply = { fixes: [{ before: 'the road is long', after: 'the road is longer', why: 'x', kind: 'grammar' }] };
  const text = window.tenebrae._claude.sceneText(document.querySelector('#ed-content').innerHTML);
  return await window.tenebrae._claude.grammar(text);
});
console.log('   blockquote fix kept?', JSON.stringify(bqFix));
ck('a copy-edit inside a blockquote is offered, not silently dropped', bqFix.length === 1, JSON.stringify(bqFix));

/* ---------- 2. chained anchors, re-derived independently, through the real menu ---------- */
await page.evaluate(() => {
  window.__reply = { fixes: [
    { before: 'reeve', after: 'drover', why: 'the character is a drover', kind: 'spelling' },
    { before: 'drover walks', after: 'reeve walks', why: 'and back again', kind: 'spelling' }
  ] };
});
const before2 = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   doc before:', JSON.stringify(before2));
await page.click('#ed-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
await T(1500);
const offered = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item, #sheet .sh-note')].map(e => e.textContent.trim().replace(/\s+/g, ' ')));
console.log('   sheet:', JSON.stringify(offered).slice(0, 300));
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const mid = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 1:', JSON.stringify(mid));
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click();
await T(900);
const after2 = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('   after accepting fix 2:', JSON.stringify(after2));
await close();
// fix 2 was quoted against "The drover walks the long road home." — the ONLY
// "drover walks" in the manuscript the model read. If it landed there, the
// last line changed and the first line still says "drover stands".
const landedRight = /drover stands at the gate/.test(after2) && /reeve walks the long road home/.test(after2);
ck('an accepted fix lands on the text it was quoted against, not on text an earlier fix manufactured',
   landedRight, after2);

/* ---------- 3. the quote guard: a "quote" that spans two paragraphs ---------- */
const crossPara = await page.evaluate(async () => {
  const doc = '<p>She said the sea remembers the old king.</p><p>The lamp held steady over the water.</p>';
  const text = window.tenebrae._claude.sceneText(doc);
  window.__reply = { cards: [{ title: 'The Old King', type: 'person', aliases: [], keywords: [],
    quotes: ['the sea remembers the old king. The lamp held steady'], notes: '' }] };
  const cards = await window.tenebrae._claude.cards(text, []);
  return { text, kept: cards[0] ? cards[0].quotes : [], inText: text.indexOf('the sea remembers the old king. The lamp held steady') > -1 };
});
console.log('   compiled two-paragraph scene:', JSON.stringify(crossPara.text));
console.log('   quote spanning the paragraph break, kept:', JSON.stringify(crossPara.kept));
ck('a "quote" that exists nowhere in the manuscript as one run is dropped',
   crossPara.kept.length === 0, JSON.stringify(crossPara.kept) + ' / literally present in payload: ' + crossPara.inText);

/* ---------- 4. what is STORED after the curly-quote fold ---------- */
const stored = await page.evaluate(async () => {
  const doc = '<p>She said, “the sea remembers the old king,” and the lamp held steady.</p>';
  const text = window.tenebrae._claude.sceneText(doc);
  window.__reply = { cards: [{ title: 'The Sea', type: 'place', aliases: [], keywords: [],
    quotes: ['"the sea remembers the old king,"'], notes: '' }] };
  const cards = await window.tenebrae._claude.cards(text, []);
  const q = cards[0] ? cards[0].quotes[0] : null;
  return { text, q, verbatim: q ? text.indexOf(q) > -1 : null };
});
console.log('   scene:', JSON.stringify(stored.text));
console.log('   stored quote:', JSON.stringify(stored.q), 'verbatim in the scene?', stored.verbatim);
ck('a kept quote is stored verbatim as it stands in the manuscript',
   stored.q === null || stored.verbatim === true, JSON.stringify(stored.q));

/* ---------- 5. confirm the apply guard still refuses to enter a span ---------- */
const spanGuard = await page.evaluate(async () => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>A quiet opening.</p><p><span class="tspan" contenteditable="false" data-lang="celan_high" data-src="the gate stood open" data-rom="x">the gate stood open</span></p>';
  const before = ed.innerHTML;
  const ok = window.tenebrae._claude.applyFix
    ? window.tenebrae._claude.applyFix({ before: 'the gate stood open', after: 'INTRUDER' })
    : null;
  return { supported: ok !== null, ok, changed: ed.innerHTML !== before, html: ed.innerHTML };
});
if(spanGuard.supported){
  console.log('   apply into a span:', JSON.stringify(spanGuard));
  ck('a fix whose only match is inside a span is not applied', !spanGuard.changed, spanGuard.html);
}else{
  console.log('   (no applyFix seam exposed — covered end to end by cf-assist-nosend.mjs)');
}

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-15 ADVERSARY', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
