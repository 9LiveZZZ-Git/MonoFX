// CD-1 — manual card creation through the real UI; the type sheet offers the
// seven spec'd types (Person, Place, Thing, Faction, Event, Language, Artifact);
// type is editable after creation; cards + types survive reload.
// Run: cd probes && node cd-create-types.mjs
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

// book (promptNewBook opens the editor on a fresh scene)
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Card Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-back');
await T(500);

// cards screen via the book pin row
await page.click('#bk-cardsrow');
await T(500);

async function newCard(name){
  await page.click('#cd-new');
  await T(450);
  await page.fill('#ps-input', name);
  await page.click('#ps-save');
  await T(700); // create + openCard
}
async function setType(label){
  await page.click('#cc-type');
  await T(450);
  const labels = await page.$$eval('#sheet button', els => els.map(e => e.textContent.trim()));
  await page.locator('#sheet button', { hasText: label }).click();
  await T(550); // close + 120ms deferred onTap + rerender
  return labels;
}

// first card: default type + the full type sheet
await newCard('Marlowe');
await page.click('#cc-type');
await T(450);
const typeSheet = await page.$$eval('#sheet button', els => els.map(e => e.textContent.trim()));
await page.keyboard.press('Escape'); // close without choosing
await T(450);
console.log('type sheet labels:', JSON.stringify(typeSheet));
const SEVEN = ['Person', 'Place', 'Thing', 'Faction', 'Event', 'Language', 'Artifact'];
const sevenOffered = SEVEN.every(t => typeSheet.includes(t));
console.log('seven types offered:', sevenOffered);

// type is editable: Person -> Faction -> back to Person
await setType('Faction');
const tAfter = await page.locator('#cc-typelabel').innerText();
console.log('type after edit:', tAfter);
await setType('Person');
const tBack = await page.locator('#cc-typelabel').innerText();
console.log('type after second edit:', tBack);
await page.click('#cc-back');
await T(500);

// one card of each remaining type
const plan = [
  ['Blackspire', 'Place'], ['Iron Key', 'Thing'], ['The Silent Choir', 'Faction'],
  ['The Sundering', 'Event'], ['Old Celan', 'Language'], ['The Lodestone', 'Artifact']
];
for(const [name, type] of plan){
  await newCard(name);
  await setType(type);
  await page.click('#cc-back');
  await T(500);
}

const groups = await page.$$eval('#cd-list .cd-group', els => els.map(e => e.textContent.trim()));
const rows = await page.$$eval('#cd-list [data-card] .t', els => els.map(e => e.textContent.trim()));
console.log('group headers:', JSON.stringify(groups));
console.log('card rows:', JSON.stringify(rows));
const PLURALS = ['People', 'Places', 'Things', 'Factions', 'Events', 'Languages', 'Artifacts'];
const allGroups = PLURALS.every(p => groups.includes(p));
const allCards = ['Marlowe', ...plan.map(p => p[0])].every(n => rows.includes(n));

// persistence: debounced save then reload, walk back in
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Card Probe' }).click();
await T(500);
const pinText = await page.locator('#bk-cardsrow').innerText();
console.log('pin row after reload:', JSON.stringify(pinText.replace(/\n/g, ' | ')));
await page.click('#bk-cardsrow');
await T(500);
const groups2 = await page.$$eval('#cd-list .cd-group', els => els.map(e => e.textContent.trim()));
const rows2 = await page.$$eval('#cd-list [data-card] .t', els => els.map(e => e.textContent.trim()));
console.log('groups after reload:', JSON.stringify(groups2));
console.log('rows after reload:', JSON.stringify(rows2));
await page.locator('#cd-list [data-card]', { hasText: 'Blackspire' }).click();
await T(500);
const persistedType = await page.locator('#cc-typelabel').innerText();
console.log('Blackspire type after reload:', persistedType);

const ok = sevenOffered && tAfter === 'Faction' && tBack === 'Person' &&
  allGroups && allCards &&
  PLURALS.every(p => groups2.includes(p)) && rows2.length === 7 &&
  persistedType === 'Place' && /7 cards/.test(pinText);
console.log(ok ? 'CD-1 VERDICT: PASS' : 'CD-1 VERDICT: FAIL');

await browser.close();
await srv.close();
