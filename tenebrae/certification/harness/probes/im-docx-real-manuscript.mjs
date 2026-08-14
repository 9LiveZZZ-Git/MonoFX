// IM-4 (+ IM-1 docx route) — real-world proof: import the author's actual
// manuscript (SurvivingTheSpiralCascade_4.docx, 1.2 MB) through the real UI.
// Reports detected structure, word count and import duration; commits; then
// spot-checks that distinctive body passages survived into scenes (found via
// the persisted IndexedDB state, then confirmed in the editor UI); reloads to
// prove the imported book persists.
//
// The manuscript lives OUTSIDE the repo (author's private file) — referenced
// from the session scratchpad only, never committed. Ground truth measured
// with python against word/document.xml: 2097 paragraphs, 18 Heading1
// chapters, 29 "* * *" separator lines, ~49.7k whitespace-split words.
// Run: cd probes && node im-docx-real-manuscript.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { existsSync } from 'node:fs';

const MANUSCRIPT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/SurvivingTheSpiralCascade_4.docx';
if (!existsSync(MANUSCRIPT)) {
  console.log('BLOCKED: manuscript not found at', MANUSCRIPT);
  console.log('(copy scratchpad/manuscript.docx to that name first)');
  process.exit(2);
}

// Distinctive passages verified (grep) to occur exactly once in document.xml.
const PHRASES = [
  'we have been given an opportunity to observe',
  'Can I at least take you to a healer',
];

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let pageErrors = 0;
page.on('pageerror', e => { pageErrors++; console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// library menu -> Import manuscript… -> real file chooser
await page.click('#lib-more');
await T(400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
const t0 = Date.now();
await chooser.setFiles(MANUSCRIPT);
await page.waitForSelector('#imp-go', { timeout: 60000 });
const parseMs = Date.now() - t0;
await T(400);

const preview = {
  src: await page.locator('.imp-src').innerText(),
  title: await page.inputValue('#imp-title'),
  stats: await page.locator('.imp-stats').innerText(),
  tree: (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '),
};
console.log('import preview reached in', parseMs, 'ms');
console.log('preview:', JSON.stringify(preview, null, 2));

const nums = preview.stats.replace(/,/g, '').match(/(\d+) chapters? · (\d+) scenes? · (\d+) words/) || [];
const [chN, scN, words] = [+nums[1], +nums[2], +nums[3]];
console.log('parsed: chapters =', chN, '| scenes =', scN, '| words =', words);

// Sanity vs. ground truth: 18 Heading1 chapters (+ possible front-matter
// chapter), scenes split at the 29 "* * *" separators, ~49.7k words.
const structureOK =
  /Word document/.test(preview.src) &&
  chN >= 18 && chN <= 20 &&
  scN >= 40 && scN <= 60 &&
  words >= 45000 && words <= 55000 &&
  /Chapter 1:/.test(preview.tree) && /The Story/.test(preview.tree);
console.log('structure sane vs ground truth:', structureOK);

// Commit and verify the created book matches the preview numbers.
await page.click('#imp-go');
await T(1200);
const book = {
  title: await page.locator('#bk-title').innerText(),
  sub: await page.locator('#bk-sub').innerText(),
  stat: await page.locator('#bk-stat').innerText(),
  chapters: await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent)),
};
console.log('book title:', JSON.stringify(book.title));
console.log('book sub/stat:', JSON.stringify(book.sub), '/', JSON.stringify(book.stat));
console.log('chapters (' + book.chapters.length + '):', JSON.stringify(book.chapters));
const commitOK =
  book.sub.replace(/,/g, '') === `${chN} chapters · ${scN} scenes` &&
  book.stat.replace(/,/g, '') === `${words} words` &&
  book.chapters.includes('The Shattervast') &&
  book.chapters.includes('The Hall of the Mountain King') &&
  book.chapters.includes('Veilwalker (1)');
console.log('commit matches preview:', commitOK);

// Let the debounced save land, then locate the spot-check passages in the
// persisted state (IndexedDB is the app's storage, read directly for search).
await T(1600);
const search = await page.evaluate(async phrases => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('tenebrae-writer', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const state = await new Promise((res, rej) => {
    const g = db.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
  });
  const strip = h => String(h || '').replace(/<[^>]+>/g, '');
  const found = [];
  for (const b of state.books) for (const ch of b.chapters) for (const s of ch.scenes) {
    for (const p of phrases) {
      if (strip(s.doc).includes(p)) found.push({ phrase: p, chapter: ch.title, sceneId: s.id, sceneWords: s.words });
    }
  }
  return found;
}, PHRASES);
console.log('passages found in persisted scenes:', JSON.stringify(search, null, 2));
const foundAll = PHRASES.every(p => search.some(f => f.phrase === p));

// Confirm the first passage through the real editor UI.
let uiPhraseOK = false;
if (search.length) {
  const row = page.locator(`#bk-list .row[data-scene="${search[0].sceneId}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await T(800);
  const edText = await page.locator('#ed-content').innerText();
  uiPhraseOK = edText.includes(search[0].phrase);
  console.log('passage visible in editor UI:', uiPhraseOK, '| scene chapter:', JSON.stringify(search[0].chapter));
  await page.click('#ed-back'); await T(400);
  await page.click('#bk-back'); await T(400);
}

// Reload — the 1.2 MB import must survive persistence.
await T(1200);
await page.reload();
await T(1000);
const lib = (await page.locator('#lib-list').innerText()).replace(/\n+/g, ' | ');
const persisted = lib.replace(/,/g, '').includes(`${words} words`);
console.log('library after reload:', JSON.stringify(lib.slice(0, 160)));
console.log('persisted with same word count:', persisted);

const ok = structureOK && commitOK && foundAll && uiPhraseOK && persisted && pageErrors === 0;
console.log('page errors:', pageErrors);
console.log(ok ? 'IM-DOCX-REAL VERDICT: PASS' : 'IM-DOCX-REAL VERDICT: FAIL');

await browser.close();
await srv.close();
