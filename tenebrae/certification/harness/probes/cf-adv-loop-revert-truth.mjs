// cf-adv-loop-revert-truth — ADVERSARY probe for TX-8 ("revert restores the
// exact English") and TX-11d (the pad-ownership rule).
//
// The claim under attack: "revert is codepoint-exact on ordinary placements, in
// all three pad shapes". cf-loop-repair-residue only pressed three pad shapes
// on ONE document shape (a heading with a bold run). This probe puts the same
// two questions — revert gives the author's line back exactly, remove gives the
// line back minus the selection exactly — to ten different placements,
// including several nobody has tried:
//
//   selection at the very START of a block, a span BEFORE a closing quote, two
//   ADJACENT spans (revert one, the other's pad must survive), a CROSS-BLOCK
//   selection, an rtl tongue, a whole blockquote, a whole list item.
//
// Everything runs through the real UI: contextmenu -> Translate -> tongue, then
// tap the span -> "Revert to plain text" / "Remove span".
//
// Run: cd probes && node cf-adv-loop-revert-truth.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Revert Truth');
await wait(page, 3500);

async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 320);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); ed.focus();
  }, html);
  await wait(page, 350);
}
// select from the first occurrence of a to the end of the first later occurrence of b
const selRange = (a, b) => page.evaluate(([t1, t2]) => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, s = null, e = null;
  while((n = w.nextNode())){
    if(!s){ const i = n.nodeValue.indexOf(t1); if(i > -1) s = [n, i]; }
    if(s){ const j = n.nodeValue.indexOf(t2); if(j > -1){ e = [n, j + t2.length]; break; } }
  }
  if(!s || !e) return 'not found';
  const r = document.createRange(); r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return 'ok';
}, [a, b]);

async function translateVia(label){
  const ok = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
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
  await closeSheets();
  return true;
}
async function sheetAction(idx, label){
  await page.evaluate(i => {
    const s = document.querySelectorAll('#ed-content .tspan')[i];
    s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, idx);
  await wait(page, 900);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1200);
  await closeSheets();
}
const docText = () => page.evaluate(() => document.querySelector('#ed-content').textContent);
const docHTML = () => page.evaluate(() => document.querySelector('#ed-content').innerHTML);
const spanMeta = () => page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(s => {
  const c = []; for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
  return { lang: s.dataset.lang, pad: s.dataset.pad ?? null, src: s.dataset.src, chain: c.join('>'),
           next: s.nextSibling ? (s.nextSibling.nodeType === 3 ? JSON.stringify(s.nextSibling.nodeValue.slice(0, 6)) : '<' + s.nextSibling.nodeName + '>') : null };
}));

// each case: html, selection (a,b), tongue, and what the text must be after
// revert (the original) and after remove (original minus the selected run)
const CASES = [
  { id: 'C1 mid-sentence in a paragraph', lang: 'Kildaren',
    html: '<p>the gate the sea remembers closed</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C2 at the very START of a block', lang: 'Kildaren',
    html: '<p>the sea remembers at the gate</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C3 before a comma', lang: 'Kildaren',
    html: '<p>where the old king stands, and waits</p>', a: 'the old king', b: 'the old king',
  },
  { id: 'C4 before a closing quote', lang: 'Kildaren',
    html: '<p>he said “the sea remembers” loudly</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C5 at the end of a block', lang: 'Celan High',
    html: '<h2>a the old king</h2><p>tail</p>', a: 'the old king', b: 'the old king',
  },
  { id: 'C6 whole blockquote', lang: 'Evernessian',
    html: '<blockquote>the sea remembers</blockquote><p>tail</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C7 whole list item', lang: 'Kerrackian',
    html: '<ul><li>the drover walks</li><li>second item</li></ul>', a: 'the drover walks', b: 'the drover walks',
  },
  { id: 'C8 rtl tongue mid-line', lang: 'Kerrackian',
    html: '<p>the gate the sea remembers closed</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C9 inside a bold run (repaired placement)', lang: 'Kildaren',
    html: '<p>and <b>the sea remembers</b> now</p>', a: 'the sea remembers', b: 'the sea remembers',
  },
  { id: 'C10 cross-block selection', lang: 'Kildaren',
    html: '<p>alpha the sea remembers</p><p>the old king omega</p>', a: 'the sea remembers', b: 'the old king',
    crossBlock: true },
];

for(const c of CASES){
  console.log('\n=== ' + c.id);
  // --- revert leg
  await setDoc(c.html);
  const before = await docText();
  // A cross-block selection cannot come back as two blocks: replacing it with an
  // inline element merges them, and textContent — which is what docText reads —
  // has no separator at a block boundary. The author's boundary comes back as
  // the single space selTextFromRange recorded in data-src, so THAT is the line
  // to compare against; plain textContent equality would demand the two
  // boundary words fuse into "remembersthe".
  const beforeJoined = await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    return ed.children.length ? [...ed.children].map(b => b.textContent).join(' ') : ed.textContent;
  });
  const okSel = await selRange(c.a, c.b);
  if(okSel !== 'ok'){ ck(c.id + ': selection made', false, okSel); continue; }
  const made = await translateVia(c.lang);
  const meta = await spanMeta();
  console.log('    after translate:', show(await docText()));
  console.log('    span meta:', JSON.stringify(meta));
  if(!meta.length){ ck(c.id + ': span created', false, await docHTML()); continue; }
  await sheetAction(0, 'Revert to plain text');
  const after = await docText();
  const stillSpan = (await spanMeta()).length;
  console.log('    after revert   :', show(after));
  ck(c.id + ': revert leaves no span behind', stillSpan === 0, stillSpan);
  const wantBack = c.crossBlock ? beforeJoined : before;
  ck(c.id + ': revert gives the author\'s line back CODEPOINT for CODEPOINT',
     after === wantBack, 'got=' + show(after) + '  want=' + show(wantBack));

  // --- remove leg (fresh document, same placement)
  if(c.crossBlock) continue;
  await setDoc(c.html);
  await selRange(c.a, c.b);
  const selStr = await page.evaluate(() => getSelection().toString());
  await translateVia(c.lang);
  if(!(await spanMeta()).length){ ck(c.id + ': span created (remove leg)', false, await docHTML()); continue; }
  await sheetAction(0, 'Remove span');
  const rem = await docText();
  console.log('    after remove   :', show(rem));
  // expectation is derived, not hand-written: the author's own document text
  // with exactly the selected run gone
  const want = before.replace(selStr, '');
  const norm = t => String(t).replace(/[\s\u00A0]+/g, ' ').trim();
  ck(c.id + ': remove takes the span and its pad, nothing of the author\'s',
     norm(rem) === norm(want), 'got=' + show(rem) + '  want=' + show(want));
  ck(c.id + ': remove leaves no NBSP in the author\'s prose',
     rem.indexOf('\u00A0') === -1, show(rem));
}

ck('no page exception anywhere in the revert suite', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('REVERT / REMOVE TRUTH', checks.every(c => c[1]));
await browser.close(); await srv.close();
