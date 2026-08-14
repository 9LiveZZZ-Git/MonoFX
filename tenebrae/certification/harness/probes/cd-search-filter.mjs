// CD-6 — card search (title/alias/keyword/notes) and type filter chips on the
// cards screen; cards reachable from the editor via the book pin row and the
// ⋯ → "Cards in this scene" sheet (mention-matched, navigates to the card).
// Filter chips only render with > 3 cards and > 1 type present, so four cards
// of four types are created.
// Run: cd probes && node cd-search-filter.mjs
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

// book + scene naming two of the cards (one by lowercase alias-of-title case test)
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Filter Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Crossing');
await page.click('#ed-content');
await page.keyboard.type('Aldous crossed the bastion gate.');
await T(1400);
await page.click('#ed-back');
await T(500);

await page.click('#bk-cardsrow');
await T(500);
async function newCard(name, type){
  await page.click('#cd-new');
  await T(450);
  await page.fill('#ps-input', name);
  await page.click('#ps-save');
  await T(700);
  if(type){
    await page.click('#cc-type');
    await T(450);
    await page.locator('#sheet button', { hasText: type }).click();
    await T(550);
  }
}
await newCard('Aldous', null); // Person (default)
// give Aldous an alias so search-by-alias can be shown
await page.click('#cc-aliases [data-add]');
await T(450);
await page.fill('#ps-input', 'Grey Sparrow');
await page.click('#ps-save');
await T(600);
await page.click('#cc-back');
await T(500);
await newCard('Bastion', 'Place');
await page.click('#cc-back');
await T(500);
await newCard('Cinder', 'Thing');
await page.click('#cc-back');
await T(500);
await newCard('Dryft', 'Faction');
await page.click('#cc-back');
await T(500);

const rowsNow = async () => page.$$eval('#cd-list [data-card] .t', els => els.map(e => e.textContent.trim()));
const groupsNow = async () => page.$$eval('#cd-list .cd-group', els => els.map(e => e.textContent.trim()));

// type filter chips
const chips = await page.$$eval('#cd-filters [data-ftype]', els => els.map(e => e.textContent.trim()));
console.log('filter chips:', JSON.stringify(chips));
await page.locator('#cd-filters [data-ftype="place"]').click();
await T(400);
const placeRows = await rowsNow();
const placeGroups = await groupsNow();
console.log('Place filter — rows:', JSON.stringify(placeRows), '| groups:', JSON.stringify(placeGroups));
await page.locator('#cd-filters [data-ftype="all"]').click();
await T(400);
const allRows = await rowsNow();
console.log('All filter — rows:', JSON.stringify(allRows));

// search: by title fragment
await page.fill('#cd-q', 'cin');
await T(400);
const searchCin = await rowsNow();
console.log('search "cin":', JSON.stringify(searchCin));
// search: by alias
await page.fill('#cd-q', 'sparrow');
await T(400);
const searchAlias = await rowsNow();
console.log('search "sparrow":', JSON.stringify(searchAlias));
// search with no hit
await page.fill('#cd-q', 'zzzz');
await T(400);
const noneRows = await rowsNow();
const noneNote = await page.locator('#cd-list').innerText();
console.log('search "zzzz":', JSON.stringify(noneRows), '| note:', JSON.stringify(noneNote.trim()));
await page.fill('#cd-q', '');
await T(400);

// reachable from the editor: book pin row was already used to get here; now the
// cards-in-scene sheet from the ⋯ menu
await page.click('#cd-back');
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(600);
await page.click('#ed-more');
await T(450);
await page.locator('#sheet button', { hasText: 'Cards in this scene' }).click();
await T(550);
const inScene = await page.$$eval('#sheet button', els => els.map(e => e.textContent.trim()));
console.log('cards in this scene:', JSON.stringify(inScene));
// "bastion" is lowercase in prose — case-insensitive title match must list Bastion
await page.locator('#sheet button', { hasText: 'Aldous' }).click();
await T(600);
const onCard = await page.evaluate(() => document.querySelector('#scr-card').classList.contains('on'));
const barTitle = await page.locator('#cc-bartitle').innerText();
console.log('tapping Aldous opens card:', onCard, '| bar title:', JSON.stringify(barTitle));

const ok =
  chips.length === 5 && chips[0] === 'All' &&
  ['Person', 'Place', 'Thing', 'Faction'].every(t => chips.includes(t)) &&
  placeRows.length === 1 && placeRows[0] === 'Bastion' && placeGroups.join() === 'Places' &&
  allRows.length === 4 &&
  searchCin.length === 1 && searchCin[0] === 'Cinder' &&
  searchAlias.length === 1 && searchAlias[0] === 'Aldous' &&
  noneRows.length === 0 && /No cards match/.test(noneNote) &&
  inScene.some(l => l.startsWith('Aldous')) && inScene.some(l => l.startsWith('Bastion')) &&
  onCard && barTitle === 'Aldous';
console.log(ok ? 'CD-6 VERDICT: PASS' : 'CD-6 VERDICT: FAIL');

await browser.close();
await srv.close();
