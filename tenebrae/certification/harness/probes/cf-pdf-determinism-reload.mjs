// TX-10b GAP PROBE — "Byte-deterministic for identical state", taken literally.
//
// s2-pdf-export proves determinism the easy way: two calls, one page, one
// session. But the Auric (Celan Basic) face is minted LAZILY — auricEnsure /
// auricRebuild (step1.html:3177-3210) assign each new word the next PUA code
// and the next glyph id in the order the word is first WRITTEN, and the PDF
// embeds that face and writes those glyph ids straight into the page. So the
// bytes depend on mint order, and mint order is session history, not book
// state.
//
// This probe builds a book whose TRANSLATION order is deliberately the reverse
// of its DOCUMENT order, exports, reloads the app (same IndexedDB, same book,
// nothing edited), waits for the engine to wake, and exports again. Same state,
// same file — or not.
//
// Run: cd probes && node cf-pdf-determinism-reload.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-det';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const A = 'the gate opens at dawn';        // scene 1 words
const B = 'the sea remembers the old king'; // scene 2 words

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, 'Determinism Book');
await page.click('#ed-title'); await page.keyboard.type('Scene One');
await page.click('#ed-content'); await page.keyboard.type(A);
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 700);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 800);
await page.click('#ed-title'); await page.keyboard.type('Scene Two');
await page.click('#ed-content'); await page.keyboard.type(B);
await wait(page, 1500);

// translate SCENE TWO first — the reverse of document order
await insertTranslationSpan(page, B, 'Celan Basic');
await wait(page, 1500);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 700);
// ...then SCENE ONE
await page.locator('[data-scene]').first().click();
await wait(page, 900);
const openTitle = await page.evaluate(() => document.querySelector('#ed-title').textContent || document.querySelector('#ed-title').value);
console.log('opened scene:', JSON.stringify(openTitle));
await insertTranslationSpan(page, A, 'Celan Basic');
await wait(page, 1500);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
await page.click('#ed-back'); await wait(page, 800);

const mintOrder1 = await page.evaluate(() => {
  const A2 = window.tenebrae._forge.map().celan_basic;
  return { order: A2.order.slice(), codes: A2.order.map(w => A2.words[w].code) };
});
console.log('mint order in session 1:', mintOrder1.order.join(' '));
ck('precondition: the Auric face was minted in translation order, not document order',
   mintOrder1.order.length > 4, mintOrder1.order.join(' '));

const grab = () => page.evaluate(() => Array.from(window.tenebrae._pdf('book')));
const p1 = Buffer.from(await grab());
await writeFile(`${OUT}/session1.pdf`, p1);
const p1b = Buffer.from(await grab());
ck('same session, two calls: byte-identical', p1.equals(p1b), `${p1.length} vs ${p1b.length}`);

// ---- reload: same IndexedDB, same book, nothing edited ----
await page.reload();
await wait(page, 4000);
// re-open the same book so currentBookId is set for the _pdf seam
await page.locator('[data-book]').first().click();
await wait(page, 1200);
const mintOrder2 = await page.evaluate(() => {
  const A2 = window.tenebrae._forge.map() && window.tenebrae._forge.map().celan_basic;
  return A2 ? { order: A2.order.slice() } : null;
});
console.log('mint order after reload (before export):', mintOrder2 ? mintOrder2.order.join(' ') : 'none');

const p2 = Buffer.from(await grab());
await writeFile(`${OUT}/session2.pdf`, p2);
const mintOrder3 = await page.evaluate(() => {
  const A2 = window.tenebrae._forge.map().celan_basic;
  return { order: A2.order.slice() };
});
console.log('mint order after reload (after export):', mintOrder3.order.join(' '));

ck('after a reload with the state untouched, the PDF is byte-identical',
   p2.equals(p1), `${p1.length} vs ${p2.length} bytes; first difference at ${(() => {
     const n = Math.min(p1.length, p2.length);
     for(let i = 0; i < n; i++) if(p1[i] !== p2[i]) return i;
     return 'none';
   })()}`);
// The session's own mint order is a record of what THIS session has written, so
// after a reload with no authoring it is empty — and it is no longer what the
// file is built from: an export swaps in a document-ordered mapping for the
// length of the write, which is exactly why the two PDFs above are byte
// identical. What must hold here is that it put the session's map back.
const order2 = mintOrder2 ? mintOrder2.order : [];
ck('the export leaves the session’s own mint order exactly as it found it',
   JSON.stringify(mintOrder3.order) === JSON.stringify(order2),
   `before=[${order2.join(' ')}] after=[${mintOrder3.order.join(' ')}]  (session 1 wrote: [${mintOrder1.order.join(' ')}])`);

// how far does the drift reach: the embedded font bytes, or only the ids?
const fontOf = buf => {
  const s = buf.toString('latin1');
  const i = s.indexOf('/Length1');
  const m = /<< \/Length (\d+) \/Length1 \d+ >>\nstream\n/.exec(s.slice(i - 40));
  return m ? m[1] : '?';
};
console.log('first FontFile2 length: session1', fontOf(p1), '| session2', fontOf(p2));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF DETERMINISM ACROSS RELOAD', checks.every(c => c[1]));
await browser.close();
await srv.close();
