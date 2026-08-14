// TR-3 + TR-6 — Selection → Translate inserts a span storing source text +
// language; tapping the span shows the interlinear gloss and the source line;
// "Edit source & retranslate" regenerates the span deterministically from the
// new source. All through the real UI (selection, context menu, sheets).
// Run: cd probes && node tr-span-flow.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Span Flow Book');
await page.click('#ed-title');
await page.keyboard.type('Gloss Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('and the night tide remembers everything');
await wait(page, 300);

// --- TR-3: selection → Translate → span appears with language + source ---
await insertTranslationSpan(page, 'night tide', 'Celan High');

const span = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom,
               text: t.textContent, editable: t.getAttribute('contenteditable') } : null;
});
const engine = await page.evaluate(() => {
  const r = window.tenebrae.translate('celan-high', 'night tide');
  return { rom: r.romanization, rendered: r.rendered,
           gloss: r.gloss.map(g => ({ s: g.s, o: g.o, k: g.k })) };
});
console.log('span:', JSON.stringify(span));
console.log('engine rom:', engine.rom, '| gloss:', JSON.stringify(engine.gloss));

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('span inserted', !!span),
  has('span stores language', span && span.lang === 'celan-high'),
  has('span stores source text', span && span.src === 'night tide'),
  has('span carries romanization matching engine', span && span.rom === engine.rom),
  has('span renders the scripted form', span && span.text === engine.rendered),
  has('span is contenteditable=false (atomic)', span && span.editable === 'false'),
];

// --- TR-6: tap the span → sheet shows gloss + source ---
await page.click('#ed-content .tspan');
await wait(page, 700);
const sheet = await page.evaluate(() => {
  const sh = document.querySelector('#sheet');
  const gloss = [...sh.querySelectorAll('.gloss .g')].map(g => ({
    s: g.querySelector('.gs') && g.querySelector('.gs').textContent,
    o: g.querySelector('.go') && g.querySelector('.go').textContent,
  }));
  const src = sh.querySelector('.ts-src') && sh.querySelector('.ts-src').textContent;
  return { title: sh.querySelector('.sheet-title') && sh.querySelector('.sheet-title').textContent,
           glossVisible: !!sh.querySelector('.gloss') && sh.querySelector('.gloss').offsetParent !== null,
           gloss, src, text: sh.innerText };
});
console.log('tap sheet:', JSON.stringify({ title: sheet.title, src: sheet.src, gloss: sheet.gloss }));
checks.push(
  has('sheet titled with the tongue name', sheet.title === 'Celan High'),
  has('gloss block is visible', sheet.glossVisible),
  has('gloss pairs every source word with its output',
      sheet.gloss.length === engine.gloss.length &&
      engine.gloss.every((g, i) => sheet.gloss[i].s === g.s && sheet.gloss[i].o.startsWith(g.o))),
  has('sheet shows the source line', !!sheet.src && sheet.src.includes('night tide')),
  has('sheet shows the romanization', sheet.text.includes(engine.rom)),
);

// --- TR-3: edit the source → deterministic regeneration ---
await page.locator('#sheet .sh-item', { hasText: 'Edit source & retranslate' }).click();
await wait(page, 600);
await page.fill('#ps-input', 'the fallen king sleeps');
await page.click('#ps-save');
await wait(page, 800);

const span2 = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom, text: t.textContent } : null;
});
const engine2 = await page.evaluate(() => {
  const r = window.tenebrae.translate('celan-high', 'the fallen king sleeps');
  return { rom: r.romanization, rendered: r.rendered };
});
console.log('span after edit:', JSON.stringify(span2));
console.log('engine for new source:', engine2.rom);
checks.push(
  has('edited source stored on the span', span2 && span2.src === 'the fallen king sleeps'),
  has('tongue kept across the edit', span2 && span2.lang === 'celan-high'),
  has('regenerated romanization equals a fresh engine call (deterministic)', span2 && span2.rom === engine2.rom),
  has('regenerated rendered form equals a fresh engine call', span2 && span2.text === engine2.rendered),
  has('output actually changed with the source', span2 && span2.rom !== engine.rom),
);

// regeneration survives a reload identically (debounced save first)
await wait(page, 1500);
await page.reload();
await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'Span Flow Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
const span3 = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom } : null;
});
console.log('span after reload:', JSON.stringify(span3));
checks.push(has('edited span survives reload with same source+rom',
  !!span3 && span3.src === 'the fallen king sleeps' && span3.rom === engine2.rom));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-3/TR-6', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
