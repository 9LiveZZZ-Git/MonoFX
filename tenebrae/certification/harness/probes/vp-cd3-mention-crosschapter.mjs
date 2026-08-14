// vp-CD-3 — adversarial re-test of mention detection ACROSS CHAPTERS, a case
// cd-chips-mentions.mjs never exercised (its 4 mentions all sat in one scene of
// one chapter). This probe demands:
//   - scenes in TWO different chapters each get their own "mentioned in" row
//     with a per-scene count
//   - punctuation-adjacent hits count ("Vex!" / "Vex,")
//   - a superstring does NOT count ("Vexing")
//   - lowercase hits count (case-insensitive)
//   - tapping the SECOND chapter's row navigates to that scene
// Scene One (Chapter 1): "Vex arrived at dusk. The crowd feared Vex, always." -> x2
// Scene Two (Chapter 2): "A vexing storm came, but vex was calm. They shouted: Vex!" -> x2
// Run: cd probes && node vp-cd3-mention-crosschapter.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new'); await T(400);
await page.fill('#ps-input', 'Cross Book');
await page.click('#ps-save'); await T(700);

// scene One in Chapter 1
await page.click('#ed-title');
await page.keyboard.type('One');
await page.click('#ed-content');
await page.keyboard.type('Vex arrived at dusk. The crowd feared Vex, always.');
await T(1400);
await page.click('#ed-back'); await T(500);

// Chapter 2 + its own scene via the per-chapter + button
await page.click('#bk-more'); await T(400);
await page.locator('#sheet button', { hasText: 'Add chapter' }).click(); await T(450);
await page.fill('#ps-input', 'Chapter 2');
await page.click('#ps-save'); await T(600);
await page.locator('.chapter-block', { hasText: 'Chapter 2' }).locator('[data-addscene]').click();
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Two');
await page.click('#ed-content');
await page.keyboard.type('A vexing storm came, but vex was calm. They shouted: Vex!');
await T(1400);
await page.click('#ed-back'); await T(500);

// card "Vex"
await page.click('#bk-cardsrow'); await T(500);
await page.click('#cd-new'); await T(450);
await page.fill('#ps-input', 'Vex');
await page.click('#ps-save'); await T(800);

const mcount = await page.locator('#cc-mcount').innerText();
const mrows = await page.$$eval('#cc-mentions .ment', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('mention count:', JSON.stringify(mcount));
console.log('mention rows:', JSON.stringify(mrows));

const rowOne = mrows.find(r => r.includes('Chapter 1') && r.includes('One'));
const rowTwo = mrows.find(r => r.includes('Chapter 2') && r.includes('Two'));
console.log('chapter1 row:', JSON.stringify(rowOne), '| chapter2 row:', JSON.stringify(rowTwo));

// navigate from the CHAPTER 2 row (fresh locator lookup at click time —
// the list re-renders on blur/save, so stored element handles go stale)
let navOK = false;
await page.locator('#cc-mentions .ment', { hasText: 'Chapter 2' }).click();
await T(700);
const inEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
const body = await page.locator('#ed-content').innerText().catch(() => '');
navOK = inEditor && body.includes('vexing storm');
console.log('chapter-2 row navigates to its scene:', navOK);

const ok = mcount === '4 mentions' &&
  mrows.length === 2 &&
  rowOne && /×2/.test(rowOne) &&
  rowTwo && /×2/.test(rowTwo) &&        // vexing excluded; vex + Vex! counted
  navOK && errors.length === 0;
console.log('pageerrors:', errors.length);
console.log(ok ? 'vp-CD-3 VERDICT: PASS' : 'vp-CD-3 VERDICT: FAIL');

await browser.close();
await srv.close();
