// CD-2 — aliases and keywords as editable chip rows (add + remove + case-insensitive
// dedupe) and the notes field; all of it survives reload.
// CD-3 — deterministic mention detection: card title + alias scanned across scene
// prose, word-boundary and case-insensitive, with a per-scene count in the
// "Mentioned in" list, which navigates to the scene.
// Scene prose: "Marlowe entered the hall. MARLOWE spoke to the warden. Everyone
// feared The Warden. But marlowes are birds."
//   title "Marlowe": Marlowe + MARLOWE = 2 ("marlowes" must NOT count — boundary)
//   alias "the Warden": "the warden" + "The Warden" = 2  -> total 4 mentions
// Run: cd probes && node cd-chips-mentions.mjs
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

// book + scene prose
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Mention Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Opening');
await page.click('#ed-content');
await page.keyboard.type('Marlowe entered the hall. MARLOWE spoke to the warden. Everyone feared The Warden. But marlowes are birds.');
await T(1400);
await page.click('#ed-back');
await T(500);

// card "Marlowe"
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Marlowe');
await page.click('#ps-save');
await T(700);

// pre-alias mention count: title alone = 2
const pre = await page.locator('#cc-mcount').innerText();
console.log('mentions before alias:', JSON.stringify(pre));

async function addChip(rowSel, value){
  await page.click(`${rowSel} [data-add]`);
  await T(450);
  await page.fill('#ps-input', value);
  await page.click('#ps-save');
  await T(600);
}

// CD-2: aliases
await addChip('#cc-aliases', 'the Warden');
await addChip('#cc-aliases', 'Old Wolf');
let aliasChips = await page.$$eval('#cc-aliases .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
console.log('alias chips:', JSON.stringify(aliasChips));

// case-insensitive dedupe: "THE WARDEN" should be rejected
await addChip('#cc-aliases', 'THE WARDEN');
const afterDupe = await page.$$eval('#cc-aliases .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
console.log('after dupe attempt:', JSON.stringify(afterDupe));

// chip removal: drop "Old Wolf" via its × button
const chips = await page.$$('#cc-aliases .chipx');
for(const ch of chips){
  const txt = await ch.textContent();
  if(txt.includes('Old Wolf')){ await ch.$eval('[data-x]', b => b.click()); break; }
}
await T(500);
aliasChips = await page.$$eval('#cc-aliases .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
console.log('alias chips after remove:', JSON.stringify(aliasChips));

// CD-2: keywords + notes
await addChip('#cc-keywords', 'gatekeeper');
const kwChips = await page.$$eval('#cc-keywords .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
console.log('keyword chips:', JSON.stringify(kwChips));
await page.click('#cc-notes');
await page.keyboard.type('Keeper of the black gate.');
await T(400);

// CD-3: mentioned-in list — 4 total, one scene row, ×4, right scene label
const mcount = await page.locator('#cc-mcount').innerText();
const mrows = await page.$$eval('#cc-mentions .ment', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('mention count:', JSON.stringify(mcount));
console.log('mention rows:', JSON.stringify(mrows));

// navigate to the scene from the mention row.
// NOTE (anomaly, kept on record): if #cc-notes still has focus, the first tap on
// a mention row is swallowed — blur fires renderCardLinks() (step1.html L3156)
// which rebuilds #cc-mentions under the pointer, so the click lands on a
// detached node. Blur first, then tap.
await page.keyboard.press('Escape'); // blurs the notes field
await T(500);
await page.click('#cc-mentions .ment');
await T(600);
const inEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
const edText = await page.locator('#ed-content').innerText();
console.log('mention row navigates to editor:', inEditor, '| prose present:', edText.includes('Marlowe entered the hall'));

// persistence: reload and walk back to the card
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Mention Probe' }).click();
await T(500);
await page.click('#bk-cardsrow');
await T(500);
await page.locator('#cd-list [data-card]', { hasText: 'Marlowe' }).click();
await T(600);
const aliases2 = await page.$$eval('#cc-aliases .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
const kw2 = await page.$$eval('#cc-keywords .chipx', els => els.map(e => e.textContent.replace(/×$/, '').trim()));
const notes2 = await page.locator('#cc-notes').innerText();
const mcount2 = await page.locator('#cc-mcount').innerText();
const mrows2 = await page.$$eval('#cc-mentions .ment', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('after reload — aliases:', JSON.stringify(aliases2), '| keywords:', JSON.stringify(kw2));
console.log('after reload — notes:', JSON.stringify(notes2));
console.log('after reload — mentions:', JSON.stringify(mcount2), JSON.stringify(mrows2));

// card list row shows the rolled-up mention count too
await page.click('#cc-back');
await T(500);
const listRow = await page.locator('#cd-list [data-card]', { hasText: 'Marlowe' }).innerText();
console.log('list row:', JSON.stringify(listRow.replace(/\n/g, ' | ')));

const ok =
  pre === '2 mentions' &&                                  // title-only, case-insensitive, boundary honored
  afterDupe.length === 2 &&                                // dedupe rejected THE WARDEN
  aliasChips.length === 1 && aliasChips[0] === 'the Warden' &&
  kwChips[0] === 'gatekeeper' &&
  mcount === '4 mentions' &&
  mrows.length === 1 && /Chapter 1 · Opening/.test(mrows[0]) && /×4/.test(mrows[0]) &&
  inEditor && edText.includes('Marlowe entered the hall') &&
  aliases2.length === 1 && aliases2[0] === 'the Warden' && kw2[0] === 'gatekeeper' &&
  notes2.trim() === 'Keeper of the black gate.' &&
  mcount2 === '4 mentions' && /×4/.test(mrows2[0]) &&
  /4 mentions/.test(listRow);
console.log(ok ? 'CD-2/CD-3 VERDICT: PASS' : 'CD-2/CD-3 VERDICT: FAIL');

await browser.close();
await srv.close();
