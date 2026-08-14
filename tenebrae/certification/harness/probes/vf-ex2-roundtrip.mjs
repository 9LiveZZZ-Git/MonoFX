// vf-EX-2 — adversarial re-check of the two "specials escaped" partials.
// Two claims under test:
//   (a) '~' is not in mdEscape (L1916) although the exporter itself emits
//       ~~…~~ for strikethrough (L1931) and the app's own importer parses
//       ~~…~~ back to <s> (L3442) — so literal prose "~~word~~" round-trips
//       into strikethrough (delimiter asymmetry with * _ ` which ARE escaped).
//   (b) line-start "#" in prose exports verbatim and the app's OWN md importer
//       re-parses the exported book as corrupted structure (fake headings).
// Method: type the prose through the real keyboard, export book .md through
// the real share sheet, assert on the bytes, then feed the exported .md back
// through the real Import-manuscript flow and inspect preview + committed doc.
// PASS = prose survives its own round-trip unchanged. Run: node vf-ex2-roundtrip.mjs
import { writeFile } from 'node:fs/promises';
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Tilde Book');
await page.click('#ed-title');
await page.keyboard.type('Only Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sign read ~~KEEP OUT~~ in red paint');
await page.keyboard.press('Enter');
await page.keyboard.type('# hashtag opens this prose line');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.click('#bk-share');
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- exported book.md ---\n' + md.text + '\n------------------------');

// (a) tilde asymmetry: * _ ` are escaped by mdEscape; ~ is not
checks.push(has('literal ~~…~~ escaped in .md (like * _ `)', !/~~KEEP OUT~~/.test(md.text)));
// (b) line-start # leaks as a live heading line
checks.push(has('line-start "#" neutralized in .md', !/^# hashtag/m.test(md.text)));

// --- round-trip: feed the app's own export back through its own importer
const rt = SCRATCH + '/vf-ex2-roundtrip.md';
await writeFile(rt, md.text);
await page.click('#bk-back');
await wait(page, 400);
await page.click('#lib-more');
await wait(page, 400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(rt);
await page.waitForSelector('#imp-go', { timeout: 10000 });
await wait(page, 400);
const stats = await page.locator('.imp-stats').innerText();
const tree = (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | ');
console.log('re-import preview stats:', JSON.stringify(stats));
console.log('re-import preview tree :', JSON.stringify(tree));
await page.click('#imp-go');
await wait(page, 900);

// open first scene of the re-imported book and inspect the committed doc
await page.click('#bk-list .row[data-scene]');
await wait(page, 600);
const doc = await page.$eval('#ed-content', el => el.innerHTML);
const strickenBack = await page.$eval('#ed-content', el => {
  const s = el.querySelector('s');
  return s ? s.textContent : null;
});
console.log('re-imported scene doc:', doc.slice(0, 400));
checks.push(has('round-trip keeps ~~KEEP OUT~~ literal (no <s>)', strickenBack === null));
const proseIntact = /~~KEEP OUT~~/.test(doc);
checks.push(has('round-trip keeps the tildes in the prose text', proseIntact));
if (strickenBack !== null)
  console.log(`LEAK: exporter left ~~…~~ raw and the app's own importer turned it into strikethrough <s>${strickenBack}</s>`);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('vf-EX-2 round-trip', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
