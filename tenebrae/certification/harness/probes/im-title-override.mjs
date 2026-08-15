// IM-2 (title edit) — the preview's title field (#imp-title) is editable;
// "commit creates the book as previewed" must honor an edited title, not the
// detected one. Import fixtures/ember-crown.md, overwrite the title in the
// preview sheet, commit, and verify the book (and library row after reload)
// carries the edited title while structure/word count still match the preview.
// Run: cd probes && node im-title-override.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'ember-crown.md');
const EDITED = 'Ash & Ember (Working Title)';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let pageErrors = 0;
page.on('pageerror', e => { pageErrors++; console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

await page.setInputFiles('#import-input', FIXTURE);
await page.waitForSelector('#imp-go', { timeout: 10000 });
await T(400);

const detected = await page.inputValue('#imp-title');
console.log('detected title:', JSON.stringify(detected));

// Edit the title through the real input (fill fires the input event the
// sheet's titleOverride listener hangs off).
await page.fill('#imp-title', EDITED);
await T(200);
const stats = await page.locator('.imp-stats').innerText();
console.log('preview stats:', JSON.stringify(stats));

await page.click('#imp-go');
await T(900);

const book = {
  title: await page.locator('#bk-title').innerText(),
  sub: await page.locator('#bk-sub').innerText(),
  stat: await page.locator('#bk-stat').innerText(),
};
console.log('book after commit:', JSON.stringify(book));
const commitOK =
  book.title === EDITED &&
  /2 chapters/.test(book.sub) && /3 scenes/.test(book.sub) && /29 words/.test(book.stat);
console.log('commit uses edited title + previewed structure:', commitOK);

// Reload — edited title persists in the library.
await T(1400);
await page.reload();
await T(800);
const lib = (await page.locator('#lib-list').innerText()).replace(/\n+/g, ' | ');
const persisted = lib.includes(EDITED) && /29 words/.test(lib);
console.log('library after reload:', JSON.stringify(lib.slice(0, 160)));
console.log('persisted:', persisted);

const ok = detected === 'The Ember Crown' && commitOK && persisted && pageErrors === 0;
console.log(ok ? 'IM-TITLE VERDICT: PASS' : 'IM-TITLE VERDICT: FAIL');

await browser.close();
await srv.close();
