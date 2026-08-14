// vp-ED-3 (adversarial skeptic): recorded ED-3 pass demonstrated applying each
// block, but the toggle-back path (re-tapping the active block returns it to a
// plain paragraph, setBlock L1487-1493) was only cited statically. Also checks
// the block survives a persist round-trip after being toggled back.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => { errs.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(700);
await page.click('#lib-new'); await page.waitForTimeout(400);
await page.fill('#ps-input', 'Toggle Book'); await page.click('#ps-save');
await page.waitForTimeout(800);

// type a line
await page.click('#ed-content');
await page.keyboard.type('the heading candidate');
await page.waitForTimeout(200);

const blockOf = () => page.evaluate(() => {
  const c = document.querySelector('#ed-content');
  const first = c.firstElementChild;
  return first ? first.tagName : '(none)';
});

// apply Heading via the Aa panel
await page.click('#fb-aa'); await page.waitForTimeout(250);
await page.click('#seg-block [data-block="h2"]'); await page.waitForTimeout(300);
const asH2 = await blockOf();
const segOnH2 = await page.$eval('#seg-block [data-block="h2"]', b => b.classList.contains('on'));

// re-tap the SAME (active) block button — must toggle back to paragraph
await page.click('#seg-block [data-block="h2"]'); await page.waitForTimeout(300);
const backToP = await blockOf();
const segOnBody = await page.$eval('#seg-block [data-block="p"]', b => b.classList.contains('on'));

// same dance for Quote
await page.click('#seg-block [data-block="blockquote"]'); await page.waitForTimeout(300);
const asQuote = await blockOf();
await page.click('#seg-block [data-block="blockquote"]'); await page.waitForTimeout(300);
const quoteBack = await blockOf();

console.log('h2 applied:', asH2, '| seg h2 on:', segOnH2, '| toggled back:', backToP, '| seg Body on:', segOnBody);
console.log('quote applied:', asQuote, '| toggled back:', quoteBack);

// persist + reload: the final state (plain paragraph) must be what's stored
await page.waitForTimeout(1600);
await page.reload(); await page.waitForTimeout(800);
const stored = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books.find(x => x.title === 'Toggle Book');
      res(b ? b.chapters[0].scenes[0].doc : null);
    };
  };
}));
console.log('stored doc:', JSON.stringify(stored));

const checks = [
  ['H2 applied', asH2 === 'H2'],
  ['segment reflected H2', segOnH2],
  ['re-tap toggled H2 back to P', backToP === 'P'],
  ['segment reflected Body after toggle-back', segOnBody],
  ['blockquote applied', asQuote === 'BLOCKQUOTE'],
  ['re-tap toggled quote back to P', quoteBack === 'P'],
  ['stored doc is a plain paragraph (no h2/blockquote)', !!stored && /<p>/.test(stored) && !/h2|blockquote/i.test(stored)],
  ['no page exceptions', errs.length === 0],
];
let pass = true;
for(const [label, ok] of checks){ console.log((ok ? 'ok  ' : 'FAIL'), label); if(!ok) pass = false; }
console.log('vp-ED3-blocktoggle VERDICT:', pass ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
