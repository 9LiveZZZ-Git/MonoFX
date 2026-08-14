// ED-4 — Live word count in the editor (#ed-count updates as you type) and
// count rollup: scene row + book stat on the book screen, book row + library
// subtitle on the library screen after back-navigation.
// Run: cd probes && node ed-count-rollup.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Count Book');
await page.click('#ps-save');
await T(700);

const count = () => page.locator('#ed-count').innerText();

const c0 = await count();
console.log('initial count:', JSON.stringify(c0));

// type 3 words, watch the live count move (450ms debounce)
await page.click('#ed-content');
await page.keyboard.type('one two three');
await T(800);
const c3 = await count();
console.log('after 3 words:', JSON.stringify(c3));

// keep typing — count must update again without any save/navigation
await page.keyboard.type(' four five six seven');
await T(800);
const c7 = await count();
console.log('after 7 words:', JSON.stringify(c7));

// give the debounced save time to land, then roll up to the book screen
await T(900);
await page.click('#ed-back');
await T(500);
const sceneAux = await page.locator('#bk-list .row[data-scene] .aux span').first().innerText();
const chCnt = await page.locator('#bk-list .ch-head .cnt').first().innerText();
const bkStat = await page.locator('#bk-stat').innerText();
console.log('scene row count:', JSON.stringify(sceneAux),
  '| chapter count:', JSON.stringify(chCnt),
  '| book stat:', JSON.stringify(bkStat));

// roll up to the library
await page.click('#bk-back');
await T(500);
const libRow = (await page.locator('#lib-list .row', { hasText: 'Count Book' }).innerText()).replace(/\n/g, ' | ');
const libSub = await page.locator('#lib-sub').innerText();
console.log('library row:', JSON.stringify(libRow));
console.log('library sub:', JSON.stringify(libSub));

const ok =
  c0 === '0 words' && c3 === '3 words' && c7 === '7 words' &&
  sceneAux === '7' && /7 w/.test(chCnt) && /7 words/.test(bkStat) &&
  /7 words/.test(libRow) && /7 words/.test(libSub);
console.log(ok ? 'ED-4 VERDICT: PASS' : 'ED-4 VERDICT: FAIL');

await browser.close();
await srv.close();
