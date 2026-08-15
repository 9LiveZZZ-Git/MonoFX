// vp-sk-CD-6 — skeptic re-test of the type filter's conditional rendering.
// The filter chips only render with >3 cards AND >=2 types (step1.html L3035).
// Verify: (a) with 3 cards of 2 types there is NO filter UI but search still
// works; (b) adding a 4th card makes the chips appear; (c) a chip actually
// filters the list; (d) 'All' restores it.
// Run: cd probes && node vp-sk-cd6-filter-threshold.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

let fails = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) fails++; };

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

// book
await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Filter Book');
await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#ed-back'); // to book screen
await page.waitForTimeout(500);
await page.click('#bk-cardsrow');
await page.waitForTimeout(500);

async function addCard(name, type){
  await page.click('#cd-new');
  await page.waitForTimeout(400);
  await page.fill('#ps-input', name);
  await page.click('#ps-save');
  await page.waitForTimeout(600); // card detail opens
  if(type){
    await page.click('#cc-type');
    await page.waitForTimeout(400);
    await page.locator('#sheet button .lbl', { hasText: type }).first().click();
    await page.waitForTimeout(500);
  }
  await page.click('#cc-back');
  await page.waitForTimeout(500);
}

await addCard('Aldous', null);          // person (default)
await addCard('Bastion', 'Place');
await addCard('Cinder', 'Place');

let chips = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-filters .fchip')).map(b => b.textContent));
console.log('chips with 3 cards / 2 types:', JSON.stringify(chips));
ok(chips.length === 0, '3 cards: no filter chips (documented threshold)');

// search must still work without the filter UI
await page.fill('#cd-q', 'cin');
await page.waitForTimeout(300);
let rows = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-list [data-card] .t')).map(b => b.textContent));
console.log('search "cin" at 3 cards:', JSON.stringify(rows));
ok(rows.length === 1 && rows[0] === 'Cinder', '3 cards: search works without filter UI');
await page.fill('#cd-q', '');
await page.waitForTimeout(300);

await addCard('Dagger', 'Thing');       // 4th card, 3rd type

chips = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-filters .fchip')).map(b => b.textContent));
console.log('chips with 4 cards / 3 types:', JSON.stringify(chips));
ok(chips.join(',') === 'All,Person,Place,Thing', '4 cards: chips appear (All + types present only)');

// filter by Place
await page.locator('#cd-filters .fchip', { hasText: 'Place' }).click();
await page.waitForTimeout(300);
rows = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-list [data-card] .t')).map(b => b.textContent));
const groups = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-list .cd-group')).map(g => g.textContent));
console.log('Place filter rows:', JSON.stringify(rows), 'groups:', JSON.stringify(groups));
ok(rows.join(',') === 'Bastion,Cinder' && groups.join(',') === 'Places', 'Place chip filters to the two places');

// All restores
await page.locator('#cd-filters .fchip', { hasText: 'All' }).click();
await page.waitForTimeout(300);
rows = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-list [data-card] .t')).map(b => b.textContent));
console.log('All rows:', JSON.stringify(rows));
ok(rows.length === 4, "'All' restores all four cards");

// search + filter combined
await page.locator('#cd-filters .fchip', { hasText: 'Place' }).click();
await page.fill('#cd-q', 'bast');
await page.waitForTimeout(300);
rows = await page.evaluate(() => Array.from(document.querySelectorAll('#cd-list [data-card] .t')).map(b => b.textContent));
console.log('Place+search rows:', JSON.stringify(rows));
ok(rows.join(',') === 'Bastion', 'search and type filter compose');

ok(errors.length === 0, 'no page exceptions');

await browser.close();
await srv.close();
console.log(fails === 0 ? 'vp-sk-CD-6 VERDICT: PASS' : `vp-sk-CD-6 VERDICT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
