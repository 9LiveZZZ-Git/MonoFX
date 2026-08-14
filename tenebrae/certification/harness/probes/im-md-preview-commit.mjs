// IM-1 (md route) / IM-2 — import a Markdown manuscript through the real UI:
// library menu -> "Import manuscript…" -> file chooser. Verify the preview
// (title, chapter/scene counts, word count, per-chapter rows), commit, and
// verify the created book matches the preview exactly. Then reload to prove
// the imported book persisted.
//
// Fixture: fixtures/ember-crown.md — # title / ## chapters / ### scenes.
// Expected (hand-counted with the app's countWords rules):
//   title "The Ember Crown", 2 chapters, 3 scenes, 29 words
//   Chapter One: Ashfall = The Kiln (17 w) + The Ridge (6 w)
//   Chapter Two: Emberlight = The Gate (6 w)
// Run: cd probes && node im-md-preview-commit.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'ember-crown.md');

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let pageErrors = 0;
page.on('pageerror', e => { pageErrors++; console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// --- library menu -> Import manuscript… (real menu entry, real file chooser)
await page.click('#lib-more');
await T(400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(FIXTURE);
await page.waitForSelector('#imp-go', { timeout: 10000 });
await T(400);

// --- preview assertions
const preview = {
  sheetTitle: await page.locator('#sheet .sheet-title').innerText(),
  src: await page.locator('.imp-src').innerText(),
  title: await page.inputValue('#imp-title'),
  stats: await page.locator('.imp-stats').innerText(),
  tree: (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '),
};
console.log('preview:', JSON.stringify(preview, null, 2));

const previewOK =
  preview.sheetTitle === 'Import Manuscript' &&
  /ember-crown\.md/.test(preview.src) && /Markdown/.test(preview.src) &&
  preview.title === 'The Ember Crown' &&
  /2 chapters/.test(preview.stats) && /3 scenes/.test(preview.stats) && /29 words/.test(preview.stats) &&
  /Chapter One: Ashfall/.test(preview.tree) && /2 scenes · 23 w/.test(preview.tree) &&
  /Chapter Two: Emberlight/.test(preview.tree) && /1 scene · 6 w/.test(preview.tree);
console.log('preview OK:', previewOK);

// --- commit
await page.click('#imp-go');
await T(900); // closeSheet + 120ms deferred commit + render

const book = {
  title: await page.locator('#bk-title').innerText(),
  sub: await page.locator('#bk-sub').innerText(),
  stat: await page.locator('#bk-stat').innerText(),
  chapters: await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent)),
  scenes: await page.$$eval('#bk-list .row[data-scene] .t', els => els.map(e => e.textContent)),
};
console.log('book after commit:', JSON.stringify(book, null, 2));

const commitOK =
  book.title === 'The Ember Crown' &&
  /2 chapters/.test(book.sub) && /3 scenes/.test(book.sub) &&
  /29 words/.test(book.stat) &&
  book.chapters.join('|') === 'Chapter One: Ashfall|Chapter Two: Emberlight' &&
  book.scenes.join('|') === 'The Kiln|The Ridge|The Gate';
console.log('commit matches preview:', commitOK);

// --- open the first scene, spot-check body text + inline bold survived
await page.click('#bk-list .row[data-scene]');
await T(600);
const edText = await page.locator('#ed-content').innerText();
const boldKept = await page.$eval('#ed-content', el => !!el.querySelector('b'));
const bodyOK = /Body text para one with bold words here now\./.test(edText) &&
  /More words in the same scene for counting\./.test(edText) && boldKept;
console.log('scene body intact:', bodyOK, '| <b> preserved:', boldKept);

// --- persistence: reload, book still in library
await T(1400);
await page.reload();
await T(800);
const lib = await page.locator('#lib-list').innerText();
const persisted = /The Ember Crown/.test(lib) && /29 words/.test(lib);
console.log('library row after reload:', JSON.stringify(lib.replace(/\n+/g, ' | ')));
console.log('persisted:', persisted);

const ok = previewOK && commitOK && bodyOK && persisted && pageErrors === 0;
console.log(ok ? 'IM-MD VERDICT: PASS' : 'IM-MD VERDICT: FAIL');

await browser.close();
await srv.close();
