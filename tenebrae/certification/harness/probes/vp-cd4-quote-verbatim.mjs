// vp-CD-4 (adversarial skeptic): the standard says "verbatim quotes saved from
// editor selection to a card". The recorded pass saved one clean sentence. This
// probe stresses the claim: a selection with punctuation, an apostrophe and a
// mid-selection bold mark must round-trip character-for-character, and the
// disclosed whitespace caveat (multi-block selection flattens to single spaces,
// selTextFromRange L2535-2542) is measured, not assumed.
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
await page.fill('#ps-input', 'Quote Book'); await page.click('#ps-save');
await page.waitForTimeout(800);

// pre-create the target card via the book screen so both quote saves use the
// attach-to-existing path (the New-card path navigates into the occluded card
// screen — see vp-cd6-card-over-editor.mjs)
await page.click('#ed-back'); await page.waitForTimeout(600);
await page.click('#bk-cardsrow'); await page.waitForTimeout(600);
await page.click('#cd-new'); await page.waitForTimeout(450);
await page.fill('#ps-input', 'Harbormaster'); await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#cc-back'); await page.waitForTimeout(500);
await page.click('#cd-back'); await page.waitForTimeout(500);
await page.locator('#bk-list [data-scene]').first().click(); await page.waitForTimeout(700);

// scene with punctuation-heavy prose, a bold run, and two paragraphs
await page.click('#ed-title'); await page.keyboard.type('Ledger');
await page.click('#ed-content');
await page.keyboard.type("Don't trust the harbormaster's ledger — it lies, twice.");
await page.keyboard.press('Enter');
await page.keyboard.type('Second paragraph waits below.');
await page.waitForTimeout(600);

// bold "twice" inside paragraph one via the real UI
await page.evaluate(() => {
  const c = document.querySelector('#ed-content');
  const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  let node, i = -1;
  while((node = w.nextNode())){ i = node.nodeValue.replace(/\u00A0/g, " ").indexOf("twice"); if(i > -1) break; }
  const r = document.createRange();
  r.setStart(node, i); r.setEnd(node, i + 5);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
});
await page.click('.fb.mark-b'); await page.waitForTimeout(400);

// --- CASE 1: single-paragraph selection spanning the bold run ---
const expected1 = "Don't trust the harbormaster's ledger — it lies, twice.";
await page.evaluate(() => {
  const c = document.querySelector('#ed-content');
  const find = (needle) => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let n;
    while((n = w.nextNode())){ const i = n.nodeValue.replace(/\u00A0/g, " ").indexOf(needle); if(i > -1) return [n, i]; }
    return null;
  };
  const a = find("Don't trust");
  // after bolding, "twice." spans <b>twice</b> + "." — end just after the
  // period text node that follows the bold element
  const bEl = c.querySelector('b');
  const after = bEl.nextSibling; // text node beginning with "."
  const r = document.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(after, after.nodeValue.indexOf('.') + 1);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
});
await page.click('#ed-more'); await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'to a card' }).click();
await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'Harbormaster' }).click();
await page.waitForTimeout(800);

// --- CASE 2: selection crossing the paragraph boundary (whitespace caveat) ---
await page.evaluate(() => {
  const c = document.querySelector('#ed-content');
  const find = (needle) => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let n;
    while((n = w.nextNode())){ const i = n.nodeValue.replace(/\u00A0/g, " ").indexOf(needle); if(i > -1) return [n, i]; }
    return null;
  };
  const r = document.createRange();
  const a = find('it lies'), b = find('Second paragraph');
  r.setStart(a[0], a[1]);
  r.setEnd(b[0], b[1] + 'Second paragraph'.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
});
await page.click('#ed-more'); await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'to a card' }).click();
await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'Harbormaster' }).click();
await page.waitForTimeout(800);

// read stored quotes + sceneId linkage
await page.waitForTimeout(1400);
const data = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books.find(x => x.title === 'Quote Book');
      const card = (b.cards || []).find(c => c.title === 'Harbormaster');
      const sceneIds = b.chapters.flatMap(c => c.scenes.map(s => s.id));
      res({ quotes: card ? card.quotes : null, sceneIds });
    };
  };
}));
console.log('stored quotes:', JSON.stringify(data.quotes, null, 1));

const q1 = data.quotes && data.quotes[0];
const q2 = data.quotes && data.quotes[1];
const checks = [
  ['two quotes stored', !!q1 && !!q2],
  ['single-paragraph quote is verbatim (punctuation, apostrophes, em-dash, bold run text)', !!q1 && q1.text === expected1],
  ['quote links a real sceneId', !!q1 && data.sceneIds.includes(q1.sceneId)],
  ['cross-paragraph quote keeps all words (whitespace flattened as disclosed)', !!q2 && /it lies, twice\. Second paragraph/.test(q2.text)],
  ['no page exceptions', errs.length === 0],
];
let pass = true;
for(const [label, ok] of checks){ console.log((ok ? 'ok  ' : 'FAIL'), label); if(!ok) pass = false; }
console.log('vp-CD4-quote-verbatim VERDICT:', pass ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
