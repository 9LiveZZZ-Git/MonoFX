// TX-15 follow-up — a harvested card must be a REAL card.
//
// Card quotes are {text, sceneId} everywhere in the app: renderCard reads
// qt.text and resolves qt.sceneId to a chapter/scene line, the search index
// reads q.text, and the card markdown export calls q.text.replace(...). The
// v1.5 harvester pushed bare strings, which renders as "undefined" and THROWS
// in the exporter — so a harvested card silently broke card export.
// This probe files a card through the harvest path with a stubbed model reply
// and then makes every consumer read it.
// Run: cd probes && node tx-claude-quote-shape.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 200)); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, 'Quote Shape Book');
await page.click('#ed-content');
await page.keyboard.type('The drover walks the long road home. The lamp holds steady.');
await wait(page, 700);

// harvest with a stubbed reply, through the real UI path
const filed = await page.evaluate(async () => {
  const real = window.fetch;
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {},
    content: [{ type: 'text', text: JSON.stringify({ cards: [{
      title: 'The Drover', type: 'person', aliases: ['drover'], keywords: ['road'],
      quotes: ['The drover walks the long road home.'], notes: 'Walks a long road.' }] }) }] }) });
  await window.tenebrae._claude.setKey('sk-ant-test');
  window.__t = window.tenebrae;
  return true;
});
ck('setup: harvest path is reachable', filed);

await page.click('#ed-more'); await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Harvest cards' }).click();
await wait(page, 1800);
await page.locator('#sheet .sh-item', { hasText: 'File this card' }).click();
await wait(page, 900);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 500);

const shape = await page.evaluate(() => {
  const g = window.__tenebraeState || null;
  const cards = [...document.querySelectorAll('#cd-list .row')].length;
  return { cards };
});

// read the quote back the way every consumer does
const consumed = await page.evaluate(() => {
  // reach the card through the real UI state via the cards screen
  const out = { quotes: null, shapeOK: null };
  return out;
});

// open the card screen and read the rendered quote
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-more'); await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click();
await wait(page, 900);
const listed = await page.locator('#cd-list .row').count();
ck('the harvested card was filed', listed >= 1, `${listed} cards`);
await page.locator('#cd-list .row').first().click();
await wait(page, 900);
const rendered = await page.evaluate(() => {
  const q = document.querySelector('#cc-quotes');
  return { html: q ? q.textContent.trim() : null, rows: q ? q.querySelectorAll('blockquote').length : 0 };
});
console.log('   rendered quote:', JSON.stringify(rendered));
ck('the quote renders its text, not "undefined"',
   rendered.rows >= 1 && /drover walks the long road/.test(rendered.html) && !/undefined/.test(rendered.html),
   rendered.html);

// the card markdown export calls q.text.replace(...) — a bare string throws
const exported = await page.evaluate(() => {
  try{
    const btn = [...document.querySelectorAll('button, .sh-item')].find(b => /export/i.test(b.textContent || ''));
    return { ok: true };
  }catch(e){ return { ok: false, err: e.message }; }
});
await page.click('#cc-more').catch(() => {});
await wait(page, 600);
const sheetItems = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item')].map(e => e.textContent.trim()));
console.log('   card menu:', JSON.stringify(sheetItems));
const mdItem = sheetItems.find(t => /markdown|\.md/i.test(t));
let mdOK = false, mdErr = '';
if(mdItem){
  try{
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator('#sheet .sh-item', { hasText: mdItem }).click(),
    ]);
    const { readFile } = await import('node:fs/promises');
    const md = await readFile(await dl.path(), 'utf8');
    mdOK = /drover walks the long road/.test(md) && !/undefined/.test(md);
    mdErr = md.slice(0, 200);
  }catch(e){ mdErr = e.message; }
}
ck('the card markdown export runs and carries the quote', mdOK, mdErr);
ck('no page exceptions (a bare-string quote throws in the exporter)', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-15 harvested card quote shape', checks.every(Boolean));
await browser.close();
await srv.close();
