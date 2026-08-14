// EX-2 (adversarial) — line-leading markdown specials in prose.
// mdEscape (step1.html L1916) escapes \ ` * _ anywhere, but NOT the
// line-start-sensitive constructs # > - + and "1." — a prose paragraph that
// begins with one of those exports verbatim and re-parses as a heading /
// blockquote / list item, corrupting the "# book / ## chapter" structure the
// export builds. This probe types four such paragraphs through the real
// keyboard and inspects the compiled .md.
// PASS = every construct is neutralized (escaped or otherwise inert).
// Run: cd probes && node ex-md-linestart-specials.mjs
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Linestart Book');
await page.click('#ed-content');
await page.keyboard.type('plain opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('# hashtag opens this line');
await page.keyboard.press('Enter');
await page.keyboard.type('> she said, quoting');
await page.keyboard.press('Enter');
await page.keyboard.type('- a dash opens this line');
await page.keyboard.press('Enter');
await page.keyboard.type('1. the year it began');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.click('#bk-share');
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md ---\n' + md.text + '\n---------------');

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
// A markdown parser treats these line-initial forms as structure:
const fakeHeading = /^# hashtag/m.test(md.text);
const fakeQuote   = /^> she said/m.test(md.text);
const fakeBullet  = /^- a dash/m.test(md.text);
const fakeOrdered = /^1\. the year/m.test(md.text);
const checks = [
  has('line-start "#" neutralized',  !fakeHeading),
  has('line-start ">" neutralized',  !fakeQuote),
  has('line-start "-" neutralized',  !fakeBullet),
  has('line-start "1." neutralized', !fakeOrdered),
];
if (fakeHeading) console.log('LEAK: prose line exports as an H1, outranking the book\'s own "# title"');
if (fakeQuote)   console.log('LEAK: prose line exports as a blockquote');
if (fakeBullet)  console.log('LEAK: prose line exports as a list item');
if (fakeOrdered) console.log('LEAK: prose line exports as an ordered-list item');

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('EX-2 line-start specials', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
