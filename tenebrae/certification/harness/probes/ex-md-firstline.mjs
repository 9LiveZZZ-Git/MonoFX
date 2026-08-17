// EX-2 / EX-5 anomaly evidence — the first typed line of a fresh scene stays
// a bare top-level text run in #ed-content (Chromium never wraps it in <p>,
// and the sanitizer keeps top-level inline nodes). mdFromDoc then:
//   (a) emits each top-level inline node as its own paragraph and DROPS the
//       mark syntax (fallback `mdInline(n)` maps a node's children, never the
//       node's own tag — step1.html L1950),
//   (b) serializes a top-level translation span via that same fallback, so
//       the raw PUA glyph text leaks into the .md instead of the
//       <!--tenebrae:begin …-->romanization form (L1909 only fires for
//       tspans nested inside a block).
// Plain-text export is unaffected (plainFromDoc replaces .tspan at any depth).
// Run: cd probes && node ex-md-firstline.mjs
import { launch, wait, createBook, selectWord, insertTranslationSpan, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Firstline Book');
await page.click('#ed-content');
// everything on the FIRST line only — the bare-run case
await page.keyboard.type('alpha bravo the ocean waits charlie');
await wait(page, 300);

await selectWord(page, 'bravo');
await page.click('[data-cmd="bold"]');
await wait(page, 300);
console.log('editor DOM:', await page.evaluate(() => document.querySelector('#ed-content').innerHTML));

await insertTranslationSpan(page, 'ocean waits', 'Celan Basic');
console.log('editor DOM with tspan:', await page.evaluate(() => document.querySelector('#ed-content').innerHTML));

// translate() is the legacy sample-cipher seam; the embedded codex is the
// engine, so the export carries translate2()'s romanization
const rom = await page.evaluate(async () => (await window.tenebrae.translate2('celan_basic', 'ocean waits')).romanization);
console.log('expected romanization:', rom);

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

const boldKept   = md.text.includes('**bravo**');
const oneLine    = /^alpha .*charlie$/m.test(md.text.replace(/ /g, ' '));
const mdHasPUA   = PUA_RE.test(md.text);
const mdHasRom   = md.text.includes(rom);
const txtHasPUA  = PUA_RE.test(txt.text);
const txtHasRom  = txt.text.includes(rom);

console.log(`first-line bold kept in md: ${boldKept}`);
console.log(`first-line kept as one paragraph in md: ${oneLine}`);
console.log(`md leaks PUA glyphs: ${mdHasPUA} | md carries romanization: ${mdHasRom}`);
console.log(`txt leaks PUA glyphs: ${txtHasPUA} | txt carries romanization: ${txtHasRom}`);
console.log('pageerrors:', errors.length ? errors : 'none');

// PASS here means "the first-line defect is absent"
verdict('EX-2/EX-5 first-line', boldKept && oneLine && !mdHasPUA && mdHasRom && !txtHasPUA && txtHasRom && errors.length === 0);

await browser.close();
await srv.close();
