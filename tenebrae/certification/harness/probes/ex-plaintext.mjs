// EX-3 — Plain-text export, book and single scene.
// Builds the rich book (see ex-lib.mjs), downloads the book .txt (default
// options) and a single-scene .txt, and verifies: uppercase book/chapter
// headings, scene titles absent by default, mark syntax stripped but words
// kept, markdown specials NOT escaped, ⁂ separators present, romanization
// (no PUA) for the translation span, and that paragraphs stay separated —
// i.e. adjacent paragraphs must not fuse into one word run.
// Run: cd probes && node ex-plaintext.mjs
import { launch, wait, buildRichBook, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await buildRichBook(page, 'Probe TXT Book');

await page.click('#bk-share');
await wait(page, 450);
const book = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('book file:', book.name);
console.log('--- book.txt ---\n' + book.text + '\n---------------');

const t = book.text;
const rom = await page.evaluate(() => window.tenebrae.translate('celan-basic', 'sea remembers').romanization);
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('book title uppercased',    /^PROBE TXT BOOK$/m.test(t)),
  has('chapter titles uppercased',/^CHAPTER 1$/m.test(t) && /^THE SECOND GATE$/m.test(t)),
  has('scene titles off by default', !t.includes('First Light') && !t.includes('Second Scene')),
  has('mark words kept',          t.includes('bold') && t.includes('italic') && t.includes('under') && t.includes('strike') && t.includes('caps')),
  has('no markdown syntax',       !t.includes('**') && !t.includes('<u>') && !t.includes('~~') && !/^#/m.test(t)),
  has('specials NOT escaped',     t.includes('*stars*') && t.includes('_unders_') && t.includes('`ticks`') && !t.includes('\\*')),
  has('block text present',       ['heading line','sub line','quote line','bullet item','numbered item'].every(x => t.includes(x))),
  has('⁂ break + separator',      (t.match(/⁂/g) || []).length === 2),
  has('romanization present',     t.includes(rom)),
  has('no PUA glyphs',            !PUA_RE.test(t)),
  has('scene bodies all present', t.includes('second body words') && t.includes('third body words')),
  // paragraph separation: the words at each paragraph boundary must not fuse
  has('paragraphs not fused',     !/lineintro/.test(t) && !/endheading/.test(t) && !/itemkeep/.test(t) && !/safetail/.test(t)),
];

// single-scene plain text from the editor
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
await page.click('#ed-share');
await wait(page, 450);
const scene = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('scene file:', scene.name);
console.log('--- scene.txt ---\n' + scene.text + '\n---------------');
checks.push(
  has('scene file named after scene', scene.name === 'First Light.txt'),
  has('scene txt titled',             /^First Light$/m.test(scene.text)),
  has('scene txt plain body',         scene.text.includes('opening line') && scene.text.includes('quote line') && !scene.text.includes('**')),
  has('scene txt paragraphs not fused', !/lineintro/.test(scene.text) && !/endheading/.test(scene.text)),
);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-3', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
