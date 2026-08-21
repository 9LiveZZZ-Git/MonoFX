// cf-loop-decline — TX-11c GAP PROBE: "a selection the codex cannot write
// produces no span", tested with WORDS rather than punctuation.
//
// tx-hostile-degenerate presses punctuation / digits / symbols. The case an
// author actually hits is a line of REAL WORDS the lexicon does not know: the
// codex's own wing draws nothing (`if(cleanText)`), so the writer must decline,
// say so, and leave the characters exactly where they are.
//
// The oracle is the codex, not a guess: cleanText is rebuilt here from the
// engine's own token stream (every token that is neither unknown `u` nor a
// separator), and the writer's behaviour is required to agree with it —
// including Celan High, where the grammar ADDS known particles (dicu … thum.)
// to an all-unknown line and therefore CAN write it, and Celan Basic, whose
// word script has a loan device (TX-6c) and therefore writes loans.
//
// Part D applies the same rule to CHANGING TONGUE on an existing span.
//
// Run: cd probes && node cf-loop-decline.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 400)); };
const cps = t => [...String(t)].map(c => c.codePointAt(0).toString(16)).join(' ');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Decline Book');
await wait(page, 3500);

async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 350);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  }, html);
  await wait(page, 1200);   // let the debounced save land, so `before.doc` is this doc
}
const selectText = (t) => page.evaluate(s => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    const i = n.nodeValue.indexOf(s);
    if(i > -1){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + s.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; }
  }
  return false;
}, t);
async function translateVia(label){
  const ok = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode;
    const el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
    return true;
  });
  if(!ok) return false;
  await wait(page, 350);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  return true;
}
const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return { html: ed.innerHTML, text: ed.textContent,
           doc: window.tenebrae._omni.probe.sceneDoc(),
           empties: [...ed.querySelectorAll('*')].filter(e => !e.textContent && !/^(BR|HR)$/.test(e.tagName)).map(e => e.tagName + '.' + e.className),
           spans: [...ed.querySelectorAll('.tspan')].map(s => {
             const b = s.getBoundingClientRect();
             return { lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr ?? null,
                      text: s.textContent, w: Math.round(b.width), h: Math.round(b.height),
                      pua: [...s.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length };
           }) };
});
const toastText = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t ? t.textContent : null; });
// the codex's own cleanText for this line: tokens that are neither unknown nor separators
const codexClean = (lang, src) => page.evaluate(async ([l, s]) => {
  const r = await window.tenebrae.translate2(l, s);
  if(!r) return null;
  const parts = (r.toks || []).filter(t => !t.sep && !t.u && t.t).map(t => t.t);
  return { clean: parts.join(' '), rom: r.romanization, toks: (r.toks || []).length };
}, [lang, src]);

const UNKNOWN = 'zzqxwv frobnak';
const LANGS = [
  ['Celan Basic', 'celan_basic'],
  ['Celan High', 'celan_high'],
  ['Kerrackian', 'kerrackian'],
  ['Kildaren', 'kildaren'],
  ['Calgridarian', 'calgridarian'],
  ['Evernessian', 'evernessian'],
];

console.log('\n===== A/B: an all-unknown line, every tongue =====');
for(const [label, id] of LANGS){
  await setDoc(`<p>the gate ${UNKNOWN} closed</p>`);
  const before = await snap();
  const oracle = await codexClean(id, UNKNOWN);
  const sel = await selectText(UNKNOWN);
  if(!sel){ ck(label + ': selection made', false); continue; }
  await translateVia(label);
  const after = await snap();
  const toast = await toastText();
  // Celan Basic is the TX-6c exception: a WORD script whose composeWord has a
  // device for a borrowing (pseudo-rune + loan diamond), so it writes loans the
  // alphabets cannot. Its cleanText is empty and it still writes.
  const writable = id === 'celan_basic' ? true : !!(oracle && oracle.clean);
  console.log(`\n--- ${label}: codex cleanText=${JSON.stringify(oracle && oracle.clean)} rom=${JSON.stringify(oracle && oracle.rom)}`);
  console.log(`    spans=${after.spans.length} toast=${JSON.stringify(toast)}`);
  console.log(`    html=${after.html.slice(0, 200)}`);
  if(writable){
    ck(`${label}: the codex CAN write it, so a span is made`, after.spans.length === 1, JSON.stringify(after.spans));
    if(after.spans[0]) ck(`${label}: that span is real script, visible and tappable`,
      after.spans[0].pua > 0 && after.spans[0].w > 0 && after.spans[0].h > 0, JSON.stringify(after.spans[0]));
  }else{
    ck(`${label}: the codex writes NOTHING, so no span is made`, after.spans.length === 0, JSON.stringify(after.spans));
    ck(`${label}: the author’s characters are exactly where they were`, after.text === before.text,
       cps(before.text) + ' vs ' + cps(after.text));
    ck(`${label}: the document is untouched, byte for byte`, after.html === before.html,
       before.html + ' vs ' + after.html);
    ck(`${label}: nothing invisible was left behind`, after.empties.length === 0, JSON.stringify(after.empties));
    ck(`${label}: the writer says so`, !!toast && /no writing/i.test(toast), JSON.stringify(toast));
    ck(`${label}: the persisted scene doc is unchanged too`, after.doc === before.doc,
       JSON.stringify([before.doc, after.doc]));
  }
}

console.log('\n===== D: changing tongue on an existing span, to a tongue that cannot write it =====');
{
  await setDoc(`<p>the gate ${UNKNOWN} closed</p>`);
  await selectText(UNKNOWN);
  await translateVia('Celan Basic');   // the loan-writing word script
  const mid = await snap();
  ck('D: a Celan Basic span exists to change', mid.spans.length === 1 && mid.spans[0].pua > 0, JSON.stringify(mid.spans));
  if(mid.spans.length === 1){
    // tap the span -> Change tongue… -> Kildaren (an alphabet: nothing to write)
    await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await wait(page, 900);
    await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
    await wait(page, 800);
    await page.locator('#sheet .sh-item', { hasText: 'Kildaren' }).click();
    await wait(page, 1500);
    const after = await snap();
    const toast = await toastText();
    console.log('    after change-tongue:', after.html.slice(0, 240));
    console.log('    toast:', JSON.stringify(toast));
    ck('D: the span the author can see is still there', after.spans.length === 1, JSON.stringify(after.spans));
    ck('D: it did not become an empty/invisible Kildaren span',
       after.spans.length === 1 && after.spans[0].lang === 'celan_basic' &&
       after.spans[0].pua > 0 && after.spans[0].w > 0, JSON.stringify(after.spans));
    ck('D: source and romanization survive the refusal',
       after.spans.length === 1 && after.spans[0].src === mid.spans[0].src && after.spans[0].rom === mid.spans[0].rom,
       JSON.stringify([mid.spans[0], after.spans[0]]));
    ck('D: the writer says so', !!toast && /no writing/i.test(toast), JSON.stringify(toast));
    ck('D: the rest of the line is untouched', after.text === mid.text, cps(mid.text) + ' vs ' + cps(after.text));
  }
  await closeSheets();
}

ck('no page exception across the decline suite', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('LOOP DECLINE (TX-11c)', checks.every(c => c[1]));
await browser.close(); await srv.close();
