// vp-EX5 — adversarial re-verification of EX-5 (translation spans survive
// export legibly). The original EX-5 pass rested on static evidence only;
// this probe demonstrates it functionally, and goes wider than the existing
// ex-translation-export.mjs: BOTH book-level and scene-level md/txt exports,
// TWO tongues (Celan Basic + the RTL tongue Kerrackian), the md metadata
// comment carrying the source, zero PUA glyphs in any output, and source
// retention in-app across a reload.
// Run: cd probes && node vp-ex5-span-export.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'VP Span Book');
await page.click('#ed-title');
await page.keyboard.type('Tide Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight');
await page.keyboard.press('Enter');
await page.keyboard.type('the dark harbor waits below');
await wait(page, 300);

await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await insertTranslationSpan(page, 'dark harbor', 'Kerrackian');

const langs = (await page.evaluate(() => window.tenebrae.langs())).langs;
const idOf = label => (langs.find(l => l.name === label) || {}).id;
const roms = await page.evaluate(([a, b]) => ({
  celan: window.tenebrae.translate(a, 'sea remembers').romanization,
  kerr: window.tenebrae.translate(b, 'dark harbor').romanization,
}), [idOf('Celan Basic') || 'celan-basic', idOf('Kerrackian') || 'kerrackian']);
console.log('engine romanizations:', JSON.stringify(roms));

const spans = await page.evaluate(() =>
  [...document.querySelectorAll('#ed-content .tspan')].map(t => ({
    lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom, dir: t.getAttribute('dir') })));
console.log('spans in editor:', JSON.stringify(spans));

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('two spans inserted with source+rom', spans.length === 2 &&
      spans.some(s => s.src === 'sea remembers' && s.rom === roms.celan) &&
      spans.some(s => s.src === 'dark harbor' && s.rom === roms.kerr)),
];

// --- scene-level exports (from the editor, #ed-share) ---
await page.click('#ed-share');
await wait(page, 450);
const sceneMd = await downloadFromSheet(page, 'Download Markdown (.md)');
await page.click('#ed-share');
await wait(page, 450);
const sceneTxt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- scene.md ---\n' + sceneMd.text + '\n--- scene.txt ---\n' + sceneTxt.text + '\n----------');

checks.push(
  has('scene md carries both romanizations', sceneMd.text.includes(roms.celan) && sceneMd.text.includes(roms.kerr)),
  has('scene md carries tenebrae source metadata', sceneMd.text.includes('tenebrae:begin') &&
      sceneMd.text.includes('"source":"sea remembers"') && sceneMd.text.includes('"source":"dark harbor"')),
  has('scene md free of PUA glyphs', !PUA_RE.test(sceneMd.text)),
  has('scene txt carries both romanizations', sceneTxt.text.includes(roms.celan) && sceneTxt.text.includes(roms.kerr)),
  has('scene txt free of PUA glyphs', !PUA_RE.test(sceneTxt.text)),
);

// --- book-level exports ---
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-share');
await wait(page, 450);
const bookMd = await downloadFromSheet(page, 'Download Markdown (.md)');
await page.click('#bk-share');
await wait(page, 450);
const bookTxt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- book.md ---\n' + bookMd.text + '\n--- book.txt ---\n' + bookTxt.text + '\n----------');

checks.push(
  has('book md carries both romanizations', bookMd.text.includes(roms.celan) && bookMd.text.includes(roms.kerr)),
  has('book md carries tenebrae source metadata for both spans',
      bookMd.text.includes('"source":"sea remembers"') && bookMd.text.includes('"source":"dark harbor"')),
  has('book md free of PUA glyphs', !PUA_RE.test(bookMd.text)),
  has('book txt carries both romanizations', bookTxt.text.includes(roms.celan) && bookTxt.text.includes(roms.kerr)),
  has('book txt free of PUA glyphs', !PUA_RE.test(bookTxt.text)),
);

// --- source retained in-app across reload ---
await page.reload();
await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'VP Span Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
const after = await page.evaluate(() =>
  [...document.querySelectorAll('#ed-content .tspan')].map(t => ({ src: t.dataset.src, rom: t.dataset.rom })));
console.log('spans after reload:', JSON.stringify(after));
checks.push(has('sources retained in-app after reload', after.length === 2 &&
  after.some(s => s.src === 'sea remembers' && s.rom === roms.celan) &&
  after.some(s => s.src === 'dark harbor' && s.rom === roms.kerr)));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('vp-EX-5', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
