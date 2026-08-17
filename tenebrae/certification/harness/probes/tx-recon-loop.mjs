// RECON (scaffolding for TX-7/8/9): enumerate the engine's tongues + flows and
// dump the tap-sheet DOM shape, so the loop probes can address every tongue by
// its real UI label. Kept as a certification artifact: it records the tongue
// inventory the TX-7/8/9 probes were run against.
// Run: cd probes && node tx-recon-loop.mjs
import { launch, wait, createBook, insertTranslationSpan } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const inv = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const langs = window.tenebrae.langs ? await window.tenebrae.langs() : null;
  const trans = Object.keys(C.TRANS).map(id => {
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    return { id, name: (T.L && T.L.name) || id, flow: sc ? C.scriptDir(sc) : 'ltr',
             glyphs: sc ? (sc.glyphs || []).length : 0, script: sc ? sc.name : '' };
  });
  return { pack: window.tenebrae.codex ? await window.tenebrae.codex() : null, trans, langsSeam: langs };
});
console.log('pack:', JSON.stringify(inv.pack));
console.log('TRANS tongues:');
for(const t of inv.trans) console.log('  ', t.id.padEnd(14), t.name.padEnd(16), t.flow.padEnd(10), 'glyphs=' + t.glyphs, t.script);
console.log('langs seam:', JSON.stringify(inv.langsSeam));

// sheet DOM shape for one span
await createBook(page, 'Recon Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the old king tonight');
await wait(page, 700);
const uiLabels = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const t = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n; while((n = t.nextNode())){ const i = n.nodeValue.indexOf('old king'); if(i > -1){
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 8);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const el = n.parentElement; const b = r.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(10, b.left + 4), clientY: Math.max(10, b.top + 4) }));
    return true; } }
  return false;
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 900);
const sheetLabels = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item')].map(e => e.textContent.trim()));
console.log('translate sheet labels:', JSON.stringify(sheetLabels));
await page.evaluate(() => document.querySelector('#scrim').click());
await wait(page, 400);

await insertTranslationSpan(page, 'old king', 'Kildaren');
await wait(page, 800);
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 900);
const shape = await page.evaluate(() => {
  const sh = document.querySelector('#sheet');
  return { html: sh.innerHTML.slice(0, 2600), items: [...sh.querySelectorAll('.sh-item')].map(e => e.textContent.trim()) };
});
console.log('tap sheet items:', JSON.stringify(shape.items));
console.log('tap sheet html:\n', shape.html);
console.log('pageerrors:', errors);
await browser.close();
await srv.close();
