// IM-3 (+ IM-1 txt route, IM-2 commit) — chapter-heading detection on plausible
// manuscript plain text: bare "Prologue" / "Chapter 1" / "Chapter 2" lines with
// no markdown syntax must be detected as chapter boundaries.
//
// Fixture: fixtures/harbor-tide.txt. Expected (hand-counted):
//   title "harbor tide" (from filename), 3 chapters (Prologue, Chapter 1,
//   Chapter 2), 3 scenes, 46 words (12 + 21 + 13).
// Run: cd probes && node im-txt-chapter-detection.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'harbor-tide.txt');

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let pageErrors = 0;
page.on('pageerror', e => { pageErrors++; console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// The hidden #import-input is the app's one import entry point (the menu item
// and the empty-state button both .click() it); setInputFiles fires its real
// change handler.
await page.setInputFiles('#import-input', FIXTURE);
await page.waitForSelector('#imp-go', { timeout: 10000 });
await T(400);

const preview = {
  src: await page.locator('.imp-src').innerText(),
  title: await page.inputValue('#imp-title'),
  stats: await page.locator('.imp-stats').innerText(),
  tree: (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '),
};
console.log('preview:', JSON.stringify(preview, null, 2));

const previewOK =
  /harbor-tide\.txt/.test(preview.src) && /Plain text/.test(preview.src) &&
  preview.title === 'harbor tide' &&
  /3 chapters/.test(preview.stats) && /3 scenes/.test(preview.stats) && /46 words/.test(preview.stats) &&
  /Prologue/.test(preview.tree) && /Chapter 1/.test(preview.tree) && /Chapter 2/.test(preview.tree);
console.log('chapter-heading detection in preview OK:', previewOK);

// Commit; the created book must carry the detected chapters.
await page.click('#imp-go');
await T(900);

const book = {
  title: await page.locator('#bk-title').innerText(),
  sub: await page.locator('#bk-sub').innerText(),
  stat: await page.locator('#bk-stat').innerText(),
  chapters: await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent)),
};
console.log('book after commit:', JSON.stringify(book, null, 2));

const commitOK =
  book.title === 'harbor tide' &&
  /3 chapters/.test(book.sub) && /3 scenes/.test(book.sub) && /46 words/.test(book.stat) &&
  book.chapters.join('|') === 'Prologue|Chapter 1|Chapter 2';
console.log('commit matches detection:', commitOK);

// Spot-check the prologue body landed in scene 1.
await page.click('#bk-list .row[data-scene]');
await T(600);
const edText = await page.locator('#ed-content').innerText();
const bodyOK = /The tide refused to turn that night and every lantern guttered out\./.test(edText);
console.log('prologue body intact:', bodyOK);

const ok = previewOK && commitOK && bodyOK && pageErrors === 0;
console.log(ok ? 'IM-TXT VERDICT: PASS' : 'IM-TXT VERDICT: FAIL');

await browser.close();
await srv.close();
