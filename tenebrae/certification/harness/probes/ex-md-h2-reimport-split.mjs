// EX-2 anomaly evidence — in-scene H2 exports as "###" (step1.html L1964),
// the SAME level compile() uses for scene titles (L2029). The app's own md
// importer assigns sceneLevel to the second heading rank present (L3862-3899),
// so re-importing an exported book splits a scene at every in-scene H2 and
// promotes the heading text to a scene title. The exported markdown itself is
// valid (EX-2 holds); this probe documents the round-trip structure drift for
// the import/no-lock-in reviewers.
// Run: cd probes && node ex-md-h2-reimport-split.mjs
import { writeFile } from 'node:fs/promises';
import { launch, wait, createBook, caretIn, downloadFromSheet, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

const { srv, browser, page, errors } = await launch();

// one scene whose body contains an in-scene H2 heading
await createBook(page, 'Split Book');
await page.click('#ed-title');
await page.keyboard.type('Only Scene');
await page.click('#ed-content');
await page.keyboard.type('opening prose line');
await page.keyboard.press('Enter');
await page.keyboard.type('midpoint heading');
await page.keyboard.press('Enter');
await page.keyboard.type('closing prose line');
await wait(page, 300);
await page.click('#fb-aa');
await wait(page, 250);
await caretIn(page, 'midpoint');
await page.click('#aa-panel [data-block="h2"]');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.click('#bk-share');
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- exported book.md ---\n' + md.text + '\n------------------------');
checks.push(has('in-scene H2 exported as "### midpoint heading"', /^### midpoint heading$/m.test(md.text)));

// feed it back through the app's own importer
const rt = SCRATCH + '/ex-md-h2-reimport.md';
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

const oneScene = /1 scene/.test(stats);
const headingBecameScene = /midpoint heading/.test(tree);
console.log('round-trip kept 1 scene:', oneScene, '| heading promoted to scene title:', headingBecameScene);
checks.push(has('round-trip preserves the 1-scene structure (in-scene H2 stays a heading)', oneScene && !headingBecameScene));

console.log('pageerrors:', errors.length ? errors : 'none');
// PASS = no structure drift; FAIL documents the anomaly
verdict('EX-2 h2-reimport-split (anomaly doc)', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
