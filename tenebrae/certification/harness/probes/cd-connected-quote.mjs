// CD-4 — (a) connected cards derived from cross-card corpus matches: card
// "Serane" (notes name "Lodestone") and card "Lodestone" must list each other
// under "Connected cards", and the chip navigates between them.
// (b) verbatim quote saved from a real editor selection (triple-click) via
// ⋯ → Save "…" to a card…, landing on the card with a source link back to
// the scene.
// Run: cd probes && node cd-connected-quote.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

const QUOTE = 'The night wind carried salt from the harbor.';

await page.goto(srv.url + 'step1.html');
await T(600);

// book + scene
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Web Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Harbor');
await page.click('#ed-content');
await page.keyboard.type(QUOTE);
await T(1400);
await page.click('#ed-back');
await T(500);

// cards: Serane (notes reference the Lodestone), then Lodestone (Artifact)
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Serane');
await page.click('#ps-save');
await T(700);
await page.click('#cc-notes');
await page.keyboard.type('She guards the Lodestone.');
await page.keyboard.press('Escape');
await T(600);
await page.click('#cc-back');
await T(500);

await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Lodestone');
await page.click('#ps-save');
await T(700);
await page.click('#cc-type');
await T(450);
await page.locator('#sheet button', { hasText: 'Artifact' }).click();
await T(550);

// connected cards on Lodestone (one-way corpus reference is enough by design)
const connOnLode = await page.$$eval('#cc-conn [data-open]', els => els.map(e => e.textContent.trim()));
console.log('Lodestone connected:', JSON.stringify(connOnLode));

// chip navigates to Serane, and the mirror connection shows there
await page.click('#cc-conn [data-open]');
await T(600);
const barTitle = await page.locator('#cc-bartitle').innerText();
const connOnSerane = await page.$$eval('#cc-conn [data-open]', els => els.map(e => e.textContent.trim()));
console.log('after chip tap — bar title:', JSON.stringify(barTitle), '| connected:', JSON.stringify(connOnSerane));

// back to the scene for the quote flow
await page.click('#cc-back'); // -> cards
await T(500);
await page.click('#cd-back'); // -> book
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(600);

// real selection: triple-click the prose paragraph
const pCount = await page.locator('#ed-content p').count();
if(pCount) await page.locator('#ed-content p').first().click({ clickCount: 3 });
else await page.click('#ed-content', { clickCount: 3, position: { x: 60, y: 16 } });
await T(300);
const selNow = await page.evaluate(() => String(window.getSelection()));
console.log('selection before sheet:', JSON.stringify(selNow));

// ⋯ keeps the selection alive (bar mousedown preventDefault) and offers the save item
await page.click('#ed-more');
await T(450);
const sheetLabels = await page.$$eval('#sheet button', els => els.map(e => e.textContent.trim()));
console.log('scene sheet has save item:', sheetLabels.some(l => l.includes('to a card')));
await page.locator('#sheet button', { hasText: 'to a card' }).click();
await T(550);
// Save Quote To… sheet — pick Serane
await page.locator('#sheet button', { hasText: 'Serane' }).click();
await T(550);
const toast = await page.locator('#toast').innerText();
console.log('toast:', JSON.stringify(toast));

// verify on the card: verbatim text + source link that navigates back
await page.click('#ed-more');
await T(450);
await page.locator('#sheet button', { hasText: 'Cards in this scene' }).click();
await T(550);
// Serane is not mentioned in prose, so go via the cards screen instead
const inSceneLabels = await page.$$eval('#sheet button', els => els.map(e => e.textContent.trim()));
console.log('cards-in-scene sheet:', JSON.stringify(inSceneLabels));
await page.keyboard.press('Escape');
await T(450);
await page.click('#ed-back');
await T(500);
await page.click('#bk-cardsrow');
await T(500);
await page.locator('#cd-list [data-card]', { hasText: 'Serane' }).click();
await T(600);

const quoteText = await page.locator('#cc-quotes blockquote').innerText();
const quoteSrc = await page.locator('#cc-quotes .q-src [data-goto]').innerText();
console.log('quote text:', JSON.stringify(quoteText));
console.log('quote source:', JSON.stringify(quoteSrc));
await page.click('#cc-quotes .q-src [data-goto]');
await T(600);
const inEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
console.log('quote source navigates to editor:', inEditor);

// persistence of the quote + connections
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Web Probe' }).click();
await T(500);
await page.click('#bk-cardsrow');
await T(500);
await page.locator('#cd-list [data-card]', { hasText: 'Serane' }).click();
await T(600);
const quote2 = await page.locator('#cc-quotes blockquote').innerText();
const conn2 = await page.$$eval('#cc-conn [data-open]', els => els.map(e => e.textContent.trim()));
console.log('after reload — quote:', JSON.stringify(quote2), '| connected:', JSON.stringify(conn2));

const ok =
  connOnLode.length === 1 && connOnLode[0] === 'Serane' &&
  barTitle === 'Serane' && connOnSerane.length === 1 && connOnSerane[0] === 'Lodestone' &&
  selNow.trim().includes(QUOTE) &&
  toast === 'Quote saved to “Serane”' &&
  quoteText === QUOTE &&
  quoteSrc === 'Chapter 1 · Harbor' &&
  inEditor &&
  quote2 === QUOTE && conn2.includes('Lodestone');
console.log(ok ? 'CD-4 VERDICT: PASS' : 'CD-4 VERDICT: FAIL');

await browser.close();
await srv.close();
