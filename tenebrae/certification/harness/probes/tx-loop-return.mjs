// TX-7/8/9 adversarial tail: the three edges the main loop probes do not press.
//
//  1. WHITESPACE ROUND-TRIP. placeTSpan inserts the span followed by a NBSP so
//     the caret has somewhere to land after an atomic node. Does "revert to
//     plain text" therefore hand back a paragraph that differs from the one the
//     author typed? Compared codepoint-for-codepoint, before insert vs after
//     revert.
//  2. THE RETURN HOP. Every change-tongue chain so far moves INTO the scripted
//     tongues. Changing back to Celan Basic (the one tongue with no codex glyph
//     table, drawn in the legacy sample face) must clear data-flow, the dir
//     attribute and the vertical writing-mode — a stale vertical flow would
//     leave the span rendering sideways in a horizontal tongue.
//  3. OPERABILITY AFTER RELOAD. A span rehydrated from storage is a different
//     DOM node than the one the app created. It must still open its sheet with
//     every pane, still change tongue, and still revert to the exact English.
//
// Run: cd probes && node tx-loop-return.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, ok ? '' : (extra === undefined ? '' : extra)); };
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s) s.click(); }); await wait(page, 350); };
const tapSpan = async (i = 0) => { await page.evaluate(n => document.querySelectorAll('#ed-content .tspan')[n].click(), i); await wait(page, 800); };
const sheetItem = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 850); };
const codepoints = s => [...s].map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? 'U+' + c.charCodeAt(0).toString(16).toUpperCase() : c).join('');
// the paragraph that holds (or held) the span
const paraText = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('#ed-content p, #ed-content div')];
  const hit = ps.find(p => /dusk/.test(p.textContent));
  return hit ? hit.textContent : document.querySelector('#ed-content').textContent;
});

/* ---------- 1. whitespace round-trip ---------- */
const LINE = 'at dusk the drover walks a long road and sleeps';
await createBook(page, 'TX Return Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type(LINE);
await wait(page, 1000);
const beforeInsert = await paraText();

await insertTranslationSpan(page, 'the drover walks', 'Kildaren');
await wait(page, 700);
const withSpan = await paraText();
await tapSpan(); await sheetItem('Revert to plain text');
const afterRevert = await paraText();

console.log('before insert :', JSON.stringify(beforeInsert), '\n              ', codepoints(beforeInsert));
console.log('after revert  :', JSON.stringify(afterRevert), '\n              ', codepoints(afterRevert));
ck('revert restores the source words in the right place', afterRevert.includes('the drover walks'), JSON.stringify(afterRevert));
ck('revert leaves no script characters behind', ![...afterRevert].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF));
const exact = afterRevert === beforeInsert;
const collapsed = afterRevert.replace(/[\s ]+/g, ' ') === beforeInsert.replace(/[\s ]+/g, ' ');
ck('revert returns the paragraph codepoint-for-codepoint', exact,
   `diff: ${codepoints(afterRevert)} vs ${codepoints(beforeInsert)}`);
ck('revert returns the paragraph up to whitespace collapsing', collapsed,
   `${codepoints(afterRevert)} vs ${codepoints(beforeInsert)}`);
if(!exact && collapsed){
  const extra = [...afterRevert].filter((c, i) => c !== beforeInsert[i]).slice(0, 3).map(c => 'U+' + c.charCodeAt(0).toString(16));
  console.log('   NOTE: difference is whitespace only, introduced at INSERT time (span + NBSP):', extra.join(','),
              '\n         with-span text was:', JSON.stringify(withSpan));
}

/* ---------- 1b. does the whitespace artifact COMPOUND over cycles? ---------- */
// If each translate->revert round leaves a residue, an author who changes their
// mind repeatedly accumulates junk. Measure the paragraph length per cycle.
const lens = [ (await paraText()).length ];
for(let i = 0; i < 3; i++){
  await closeSheet();
  await insertTranslationSpan(page, 'the drover walks', 'Kerrackian');
  await wait(page, 600);
  await tapSpan(); await sheetItem('Revert to plain text');
  lens.push((await paraText()).length);
}
console.log('paragraph length per translate->revert cycle:', JSON.stringify(lens));
const deltas = lens.slice(1).map((n, i) => n - lens[i]);
ck('translate->revert does not compound whitespace over repeated cycles', deltas.every(d => d === 0),
   `lengths=${JSON.stringify(lens)} deltas=${JSON.stringify(deltas)}`);
const finalPara = await paraText();
ck('after three translate->revert cycles the words are still exactly right',
   finalPara.replace(/[\s\u00a0]+/g, ' ').trim() === LINE, JSON.stringify(finalPara));
// and what reaches storage / a plain-text export
const persistedTxt = await page.evaluate(() => window.tenebrae._omni.probe.sceneDoc());
console.log('persisted doc tail:', JSON.stringify(persistedTxt.slice(-160)));
ck('the persisted doc carries no span after revert', !/tspan/.test(persistedTxt));

/* ---------- 2. the return hop: vertical tongue -> Celan Basic ---------- */
await page.evaluate(() => { const ed = document.querySelector('#ed-content');
  const p = document.createElement('p'); p.textContent = 'the sea remembers the old king'; ed.appendChild(p); });
await wait(page, 400);
await closeSheet();
await insertTranslationSpan(page, 'the old king', 'Celan High'); // cols-rtl
await wait(page, 700);
const readSpan = () => page.evaluate(async () => {
  const sp = document.querySelectorAll('#ed-content .tspan')[0];
  await document.fonts.ready;
  const cs = getComputedStyle(sp);
  const txt = sp.textContent;
  return { lang: sp.dataset.lang, flow: sp.dataset.flow || null, dir: sp.getAttribute('dir'),
           scr: sp.dataset.scr || null, rom: sp.dataset.rom, src: sp.dataset.src, text: txt,
           family: cs.fontFamily, writingMode: cs.writingMode, direction: cs.direction,
           latin: /[A-Za-z]/.test(txt), svg: sp.querySelectorAll('svg').length,
           pua: [...txt].filter(c => /\S/.test(c)).every(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF) };
});
const vertical = await readSpan();
ck('setup: vertical Celan High span in place', vertical.flow === 'cols-rtl' && vertical.writingMode === 'vertical-lr' && vertical.dir !== 'rtl',
   JSON.stringify(vertical));

await tapSpan(); await sheetItem('Change tongue'); await sheetItem('Celan Basic');
const returned = await readSpan();
console.log('after return hop:', JSON.stringify(returned));
ck('return hop: tongue is Celan Basic', returned.lang === 'celan_basic', returned.lang);
ck('return hop: vertical flow attribute is cleared', returned.flow === null, `data-flow=${returned.flow}`);
ck('return hop: rtl dir attribute is cleared', returned.dir === null, `dir=${returned.dir}`);
ck('return hop: writing-mode is back to horizontal', returned.writingMode === 'horizontal-tb', returned.writingMode);
ck('return hop: direction is back to ltr', returned.direction === 'ltr', returned.direction);
ck('return hop: drawn in the Auric rune face, not a Latin serif', /Tenebrae Celan Runes/.test(returned.family), returned.family);
ck('return hop: still script text, never Latin', returned.pua && !returned.latin && returned.svg === 0, JSON.stringify(returned.text));
const cbTruth = await page.evaluate(async src => {
  const w = await window.tenebrae.engine();
  const kept = w.translateE2C(String(src)).filter(p => p.cel && !p.drop);
  return kept.map(p => p.cel).join(' ');
}, 'the old king');
ck('return hop: romanization is the codex Celan Basic compiler output', returned.rom === cbTruth, `${returned.rom} != ${cbTruth}`);

/* ---------- 3. operability after reload ---------- */
await wait(page, 1600);
await page.reload();
await wait(page, 1200);
await page.locator('#lib-list .row', { hasText: 'TX Return Book' }).click();
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 1000);
await page.waitForFunction(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp && sp.dataset.scr && sp.textContent === sp.dataset.scr;
}, null, { timeout: 30000 }).catch(() => {});
await wait(page, 900);
const rehydrated = await readSpan();
ck('reload: the span came back with all four stored fields',
   rehydrated.lang === 'celan_basic' && rehydrated.src === 'the old king' && rehydrated.rom === cbTruth && !!rehydrated.scr,
   JSON.stringify(rehydrated));

await tapSpan();
const sheetAfterReload = await page.evaluate(() => {
  const sh = document.querySelector('#sheet');
  return { title: sh.querySelector('.sheet-title').textContent,
           big: !!sh.querySelector('.sheet-note .tspan'),
           src: (sh.querySelector('.ts-src') || {}).textContent || null,
           rom: (sh.querySelector('.ts-rom') || {}).textContent || null,
           gloss: sh.querySelectorAll('.gloss .g').length,
           items: [...sh.querySelectorAll('.sh-item')].map(e => e.textContent.trim()) };
});
console.log('sheet after reload:', JSON.stringify(sheetAfterReload));
ck('reload: the rehydrated span still opens a complete sheet',
   sheetAfterReload.title === 'Celan Basic' && sheetAfterReload.big && sheetAfterReload.src === '“the old king”' &&
   sheetAfterReload.rom === cbTruth && sheetAfterReload.gloss === 3 && sheetAfterReload.items.length === 7,
   JSON.stringify(sheetAfterReload));

await sheetItem('Change tongue'); await sheetItem('Kerrackian');
const changedAfterReload = await readSpan();
ck('reload: change tongue still works on a rehydrated span',
   changedAfterReload.lang === 'kerrackian' && changedAfterReload.flow === 'rtl' && changedAfterReload.src === 'the old king' &&
   changedAfterReload.pua && !changedAfterReload.latin, JSON.stringify(changedAfterReload));

await tapSpan(); await sheetItem('Revert to plain text');
const revertedAfterReload = await page.evaluate(() => ({
  spans: document.querySelectorAll('#ed-content .tspan').length,
  text: document.querySelector('#ed-content').textContent,
}));
ck('reload: revert on a rehydrated span restores the exact English',
   revertedAfterReload.spans === 0 && revertedAfterReload.text.includes('the sea remembers the old king'),
   JSON.stringify(revertedAfterReload.text));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-7/8/9 adversarial tail', checks.every(c => c[1]));
console.log(`${checks.filter(c => c[1]).length}/${checks.length} checks passed`);
await browser.close();
await srv.close();
