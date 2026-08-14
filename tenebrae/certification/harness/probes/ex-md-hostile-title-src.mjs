// EX-2 / EX-5 (adversarial) — markdown specials in book/scene titles, and a
// translation SOURCE containing `--` and double quotes (an attempt to break
// the <!--tenebrae:begin {json}--> export marker from inside its own comment;
// step1.html L1934 escapes `--` in the meta JSON as --).
// Verifies: titles are mdEscape'd in the compiled .md (L2016/L2032), the
// tenebrae comment stays well-formed (the app's own reimport regex L3457
// extracts parseable meta whose source round-trips exactly), romanization is
// present, and no PUA glyphs leak into md or txt.
// Run: cd probes && node ex-md-hostile-title-src.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

const BOOK = '*Gate* -- [Draft] #1';
const SRC  = 'falls -- "twice" tonight';

await createBook(page, BOOK);
await page.click('#ed-title');
await page.keyboard.type('_Under_ Score');
await page.click('#ed-content');
await page.keyboard.type('padding first line');
await page.keyboard.press('Enter');
await page.keyboard.type('night ' + SRC + ' again');
await wait(page, 300);

await insertTranslationSpan(page, SRC, 'Celan Basic');
const spanInfo = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { src: t.dataset.src, lang: t.dataset.lang, rom: t.dataset.rom } : null;
});
console.log('span:', JSON.stringify(spanInfo));
checks.push(has('span stores hostile source verbatim', !!spanInfo && spanInfo.src === SRC));

await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// scene titles ON so the scene-title escaping path is exercised
await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md ---\n' + md.text + '\n---------------');
await page.click('#bk-share');
await wait(page, 450);
const txt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- book.txt ---\n' + txt.text + '\n---------------');

// 1) titles escaped in md
checks.push(
  has('book title specials escaped', /^# \\\*Gate\\\* -- \\\[Draft\\\] #1$/m.test(md.text)),
  has('scene title specials escaped', /^### \\_Under\\_ Score$/m.test(md.text)),
);

// 2) the tenebrae marker survives a `--`/quote-laden source: the app's own
// reimport regex must find it and the meta JSON must round-trip the source
const m = md.text.match(/<!--tenebrae:begin\s+({.*?})-->(.*?)<!--tenebrae:end-->/);
console.log('marker match:', m ? JSON.stringify({ meta: m[1], body: m[2] }) : 'NONE');
let metaOK = false, srcRT = null;
if (m) {
  try { srcRT = JSON.parse(m[1]).source; metaOK = true; } catch (e) { console.log('meta JSON.parse failed:', e.message); }
}
checks.push(
  has('marker present and regex-extractable', !!m),
  has('meta JSON parses', metaOK),
  has('source round-trips through meta', srcRT === SRC),
  has('no raw --> inside meta (comment unbroken)', !!m && !m[1].includes('-->')),
);

// 3) romanization legible, no PUA
const rom = spanInfo && spanInfo.rom;
checks.push(
  has('md carries romanization', !!rom && md.text.includes(rom)),
  has('md free of PUA glyphs', !PUA_RE.test(md.text)),
  has('txt carries romanization', !!rom && txt.text.includes(rom)),
  has('txt free of PUA glyphs', !PUA_RE.test(txt.text)),
  has('txt keeps title specials verbatim', txt.text.includes('*GATE* -- [DRAFT] #1')),
);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-2/EX-5 hostile titles + source', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
