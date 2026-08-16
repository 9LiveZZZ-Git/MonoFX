// X2-13 (gap coverage): undo across MIXED operations.
// type prose -> insert translation span -> type more prose -> change tongue
// (retranslate) -> ONE Ctrl+Z sequence must walk the whole thing back cleanly:
// tongue change undone first, then the extra typing, then the insertion
// (restoring the source text), then the original typing — with NO state in the
// walk showing corrupted prose (lost words, duplicated source, split spans).
// Then a full redo walk must land back on the exact final state.
// Run: cd probes && node s2-ux-undo-mixed.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const clone = ed.cloneNode(true);
  clone.querySelectorAll('.tspan').forEach(t => t.remove());
  const norm = s => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return {
    text: norm(ed.textContent),
    prose: norm(clone.textContent), // prose only, spans stripped
    spans: [...ed.querySelectorAll('.tspan')].map(sp => ({
      lang: sp.dataset.lang, src: sp.dataset.src,
      pua: [...sp.textContent].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF),
      svg: sp.querySelectorAll('svg').length,
    })),
  };
});
const focusEditor = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const undo = async () => { await focusEditor(); await page.keyboard.press('Control+z'); await wait(page, 400); };
const redo = async () => { await focusEditor(); await page.keyboard.press('Control+Shift+z'); await wait(page, 400); };

await createBook(page, 'Mixed Undo Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the harbor keeps its old promises tonight');
await wait(page, 1500);
const A0 = await snap();
console.log('A0 (typed):', JSON.stringify(A0));

// op 2: insert a translation span over "old promises" (Celan Basic)
await insertTranslationSpan(page, 'old promises', 'Celan Basic');
const B0 = await snap();
console.log('B0 (span inserted):', JSON.stringify(B0));
ck('insert: one PUA text span, src kept', B0.spans.length === 1 && B0.spans[0].src === 'old promises' && B0.spans[0].pua && B0.spans[0].svg === 0);

// op 3: type MORE prose after the span
await focusEditor();
await page.keyboard.type(' and extra tail words');
await wait(page, 900);
const C0 = await snap();
console.log('C0 (extra typed):', JSON.stringify(C0));
ck('extra prose landed after the span', /extra tail words/.test(C0.prose) && C0.spans.length === 1);

// op 4: retranslate by changing tongue (span sheet -> Change tongue -> Kerrackian)
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Kerrackian' }).click();
await wait(page, 900);
const D0 = await snap();
console.log('D0 (tongue changed):', JSON.stringify(D0));
ck('change tongue replaced the span in place', D0.spans.length === 1 && D0.spans[0].lang === 'kerrackian' && D0.spans[0].src === 'old promises' && /extra tail words/.test(D0.prose));

// ---- the single Ctrl+Z walk ----
const MUST_KEEP = ['padding opener line', 'the harbor keeps its']; // prose that no undo state may lose
const states = [D0];
const MAX = 14;
for(let i = 0; i < MAX; i++){
  await undo();
  const s = await snap();
  states.push(s);
  const last = states[states.length - 2];
  if(JSON.stringify(s) === JSON.stringify(last) && i > 0) break; // undo stack exhausted
}
console.log('undo walk:', states.map(s => `${s.spans.length}sp:${s.spans[0] ? s.spans[0].lang : '-'}${/extra tail words/.test(s.prose) ? '+x' : ''}`).join(' -> '));

// milestones: kerrackian span -> celan span -> span gone w/ source restored
const iC = states.findIndex(s => s.spans.length === 1 && /celan/.test(s.spans[0].lang));
const iA = states.findIndex(s => s.spans.length === 0);

// (1) no state corrupts prose. Up to and including the span-restoration state
// (iA) every anchor must survive; beyond iA the walk is legitimately undoing
// the ORIGINAL typing, so each state must be a clean prefix of the typed text
// (chunk boundaries land mid-word — that is native typing undo, not damage).
const corrupt = states.findIndex((s, i) => {
  if(s.spans.length > 1 || s.spans.some(sp => !sp.src || sp.svg > 0)) return true;
  if((s.text.match(/old promises/g) || []).length > 1) return true;
  if(iA === -1 || i <= iA) return !MUST_KEEP.every(k => s.text.includes(k));
  return !A0.text.startsWith(s.text); // undoing the original typing itself
});
ck('no undo state corrupts prose (anchors kept, then clean typing prefixes)', corrupt === -1,
   corrupt !== -1 ? `state ${corrupt}: ${JSON.stringify(states[corrupt])}` : '');
ck('undo #1 reverts the tongue change (back to Celan span)', iC === 1, `first celan state at ${iC}`);
ck('undo walk reaches span-gone with "old promises" restored', iA > iC && iA !== -1 && states[iA].text.includes('old promises'),
   `iA=${iA} text=${iA !== -1 ? JSON.stringify(states[iA].text) : ''}`);
const lastKerr = states.map((s, i) => (s.spans[0] && s.spans[0].lang === 'kerrackian') ? i : -1).filter(i => i >= 0).pop();
ck('milestone order kerrackian -> celan -> none is monotone', lastKerr < iC && iC < iA, `lastKerr=${lastKerr} iC=${iC} iA=${iA}`);
// extra typing must be gone by the time the span goes (typing undone between C and B)
ck('extra typed prose is undone before the insertion is undone', !/extra tail words/.test(states[iA].prose));
// walk continues into the original typing without corruption (already covered by (1))
const undosDone = states.length - 1;

// ---- full redo walk back to D0 ----
for(let i = 0; i < undosDone; i++) await redo();
const R = await snap();
console.log('after redo walk:', JSON.stringify(R));
ck('redo walk restores the exact final state (text + span)', JSON.stringify(R) === JSON.stringify(D0),
   JSON.stringify(R.text) + ' vs ' + JSON.stringify(D0.text));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-13 undo-mixed', checks.every(c => c[1]));
await browser.close();
await srv.close();
