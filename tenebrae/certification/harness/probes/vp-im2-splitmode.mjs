// vp-IM-2 (adversarial skeptic): the recorded IM-2 pass never exercised the
// split-rule segment control (#imp-seg). Requirement: "commit creates the book
// as previewed" — that must hold for a TOGGLED preview too, not just the
// default one. This probe imports a manuscript with ⁂ separators, toggles the
// split rule Headings -> Don't split -> Separators, checks the preview stats
// re-render each time, then commits and verifies the created book matches the
// LAST toggled preview (not the first).
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { writeFile } from 'node:fs/promises';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => { errs.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

// Manuscript: 2 markdown chapters; chapter 1 has an H3 heading AND a ⁂
// separator so both 'sep' and 'h' split modes are offered and give DIFFERENT
// scene counts. sep-split: ch1 = 2 scenes; h-split: ch1 = 2 scenes at "### "
// boundaries; none: 1 scene per chapter.
const md = `# Vellum Test

## Chapter One

Opening paragraph of the first scene with several words.

### Named Scene

Middle passage carries seven more words here.

⁂

After the asterism a third passage runs.

## Chapter Two

Second chapter has a single scene only.
`;
const tmp = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vp-im2-vellum.md';
await writeFile(tmp, md);

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(700);

// open library menu -> Import manuscript…
await page.click('#lib-more');
await page.waitForTimeout(400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(tmp);
await page.waitForTimeout(900);

const readPreview = async () => ({
  stats: (await page.locator('.imp-stats').innerText()).trim(),
  seg: await page.$$eval('#imp-seg button', bs => bs.map(b => ({ mode: b.dataset.mode, on: b.classList.contains('on') }))),
  tree: (await page.locator('.imp-tree').innerText()).replace(/\s+/g, ' ').trim(),
});

const p0 = await readPreview();
console.log('default preview:', JSON.stringify(p0));

// toggle: Don't split
await page.locator('#imp-seg button[data-mode="none"]').click();
await page.waitForTimeout(500);
const pNone = await readPreview();
console.log("after Don't split:", JSON.stringify(pNone.stats), 'seg on:', pNone.seg.filter(s => s.on).map(s => s.mode));

// toggle: Headings
await page.locator('#imp-seg button[data-mode="h"]').click();
await page.waitForTimeout(500);
const pH = await readPreview();
console.log('after Headings:', JSON.stringify(pH.stats), 'seg on:', pH.seg.filter(s => s.on).map(s => s.mode));

// commit the HEADINGS preview
await page.locator('#imp-go').click();
await page.waitForTimeout(1600);

const book = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const st = g.result;
      const b = st.books.find(x => x.title === 'Vellum Test');
      res(b ? {
        chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, words: s.words })) }))
      } : null);
    };
  };
}));
console.log('committed book:', JSON.stringify(book));

const scN = book ? book.chapters.reduce((n, c) => n + c.scenes.length, 0) : -1;
const statsMatch = pH.stats.includes(`${book ? book.chapters.length : '?'} chapters`) && pH.stats.includes(`${scN} scenes`);
const noneWasOne = /2 scenes/.test(pNone.stats);          // Don't split: 1 scene per chapter = 2
const statsChanged = p0.stats !== pNone.stats || pNone.stats !== pH.stats;

const checks = [
  ['seg control offered all modes', p0.seg.length >= 2],
  ["Don't split collapsed to one scene per chapter", noneWasOne],
  ['preview stats re-render on toggle', statsChanged],
  ['committed structure equals the LAST toggled preview', statsMatch],
  ['no page exceptions', errs.length === 0],
];
let pass = true;
for(const [label, ok] of checks){ console.log((ok ? 'ok  ' : 'FAIL'), label); if(!ok) pass = false; }
console.log('vp-IM2-splitmode VERDICT:', pass ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
