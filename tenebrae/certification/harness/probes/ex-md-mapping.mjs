// EX-2 — Markdown export mapping, book and single scene.
// Builds the rich book (2 chapters / 3 scenes, every mark + block, ⁂ break,
// literal * _ ` in prose, one Celan Basic translation span), enables scene
// titles, downloads the book .md and a single-scene .md, and verifies:
//   # book / ## chapter / ### scene structure,
//   in-scene H2→###, H3→####, blockquote→">", ul→"- ", ol→"1. ",
//   **bold**, *italic*, <u>underline</u>, ~~strike~~, ⁂ separator lines,
//   markdown specials * _ ` escaped in prose,
//   translation span serialized as romanization (checked in detail by EX-5).
// Run: cd probes && node ex-md-mapping.mjs
import { launch, wait, buildRichBook, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await buildRichBook(page, 'Probe MD Book');

// book screen → export sheet; turn scene titles on (default off) so the
// ### scene level is exercised
await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 450);
const book = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('book file:', book.name);
console.log('--- book.md ---\n' + book.text + '\n---------------');

const md = book.text;
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('# book title',            /^# Probe MD Book$/m.test(md)),
  has('## chapter 1',            /^## Chapter 1$/m.test(md)),
  has('## chapter 2',            /^## The Second Gate$/m.test(md)),
  has('### scene titles',        /^### First Light$/m.test(md) && /^### Second Scene$/m.test(md) && /^### Third Scene$/m.test(md)),
  has('in-scene H2 -> ###',      /^### heading line$/m.test(md)),
  has('in-scene H3 -> ####',     /^#### sub line$/m.test(md)),
  has('blockquote -> ">"',       /^> quote line$/m.test(md)),
  has('ul -> "- "',              /^- bullet item$/m.test(md)),
  has('ol -> "1. "',             /^1\. numbered item$/m.test(md)),
  has('bold -> **',              md.includes('**bold**')),
  has('italic -> *',             md.includes('*italic*')),
  has('underline -> <u>',        md.includes('<u>under</u>')),
  has('strike -> ~~',            md.includes('~~strike~~')),
  has('marked paragraph intact', /^intro \*\*bold\*\* \*italic\* <u>under<\/u> ~~strike~~ caps end$/m.test(md)),
  has('small caps text kept',    md.includes('caps end') && !md.includes('<span')),
  has('escaped *',               md.includes('\\*stars\\*')),
  has('escaped _',               md.includes('\\_unders\\_')),
  has('escaped `',               md.includes('\\`ticks\\`')),
  has('⁂ separator + in-scene break (2 lines)', (md.match(/^⁂$/gm) || []).length === 2),
  has('tspan -> romanization marker', md.includes('<!--tenebrae:begin') && md.includes('<!--tenebrae:end-->')),
  has('no PUA glyphs in md',     !PUA_RE.test(md)),
];

// single-scene markdown from the editor
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
await page.click('#ed-share');
await wait(page, 450);
const scene = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('scene file:', scene.name);
console.log('--- scene.md (first 400) ---\n' + scene.text.slice(0, 400) + '\n---------------');
checks.push(
  has('scene file named after scene', scene.name === 'First Light.md'),
  has('scene md titled ###',          /^### First Light$/m.test(scene.text)),
  has('scene md carries marks',       scene.text.includes('**bold**') && scene.text.includes('*italic*')),
  has('scene md escapes specials',    scene.text.includes('\\*stars\\*')),
);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-2', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
