// EX-5 — Translation spans survive export legibly.
// Inserts a Celan Basic span over "sea remembers" via the real selection →
// context menu → Translate sheet flow (span in a wrapped <p>, the working
// case; the first-line bare-run case is probed by ex-md-firstline.mjs).
// Verifies: .md and .txt book exports carry the romanization and no raw PUA
// glyphs; after reload the span still carries data-src/data-lang/data-rom in
// the editor and tapping it opens the sheet showing the source text.
// Run: cd probes && node ex-translation-export.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Span Book');
await page.click('#ed-title');
await page.keyboard.type('Tide Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');       // bare first line stays plain
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight'); // wrapped <p>
await wait(page, 300);

await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');

const spanInfo = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom,
               text: t.textContent, inP: t.parentElement.tagName } : null;
});
console.log('span after insert:', JSON.stringify(spanInfo));
// translate() is the legacy sample-cipher seam; translate2() is the real
// resolver, which under the embedded codex is what the export actually holds
const rom = await page.evaluate(async () => (await window.tenebrae.translate2('celan_basic', 'sea remembers')).romanization);
const romPUA = spanInfo && PUA_RE.test(spanInfo.text);
console.log('engine romanization:', rom, '| editor span shows PUA glyphs (expected):', romPUA);

await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.click('#bk-share');
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md ---\n' + md.text + '\n---------------');
await page.click('#bk-share');
await wait(page, 450);
const txt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- book.txt ---\n' + txt.text + '\n---------------');

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('span landed in a wrapped block', !!spanInfo && spanInfo.inP === 'P'),
  has('span stores source + lang + rom', !!spanInfo && spanInfo.src === 'sea remembers' && spanInfo.lang === 'celan_basic' && spanInfo.rom === rom),
  has('md carries romanization', md.text.includes(rom)),
  has('md keeps source in marker', md.text.includes('"source":"sea remembers"')),
  has('md free of PUA glyphs', !PUA_RE.test(md.text)),
  has('txt carries romanization', txt.text.includes(rom)),
  has('txt free of PUA glyphs', !PUA_RE.test(txt.text)),
];

// reload → the span in the editor still carries its source text
await page.reload();
await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'Span Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
const after = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom } : null;
});
console.log('span after reload:', JSON.stringify(after));
checks.push(has('source survives reload', !!after && after.src === 'sea remembers' && after.lang === 'celan_basic' && after.rom === rom));

// tap the span → sheet shows the source line and the romanization
await page.click('#ed-content .tspan');
await wait(page, 700);
const sheetText = await page.locator('#sheet').innerText();
console.log('span sheet (first 300):', JSON.stringify(sheetText.slice(0, 300)));
checks.push(
  has('tap sheet shows source text', sheetText.includes('sea remembers')),
  has('tap sheet shows romanization', sheetText.includes(rom)),
);

// determinism of the re-translation path across the reload
const det = await page.evaluate(async () => {
  const a = await window.tenebrae.translate2('celan_basic', 'sea remembers');
  const b = await window.tenebrae.translate2('celan_basic', 'sea remembers');
  return a.romanization === b.romanization;
});
checks.push(has('repeat translate identical', det));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-5 (wrapped-span path)', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
