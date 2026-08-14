// CD-3/CD-5 adversarial edges the main probes don't cover:
//   (a) accented-letter word boundary: card "Nária" must NOT count "Nárian"
//       (ASCII \b would treat 'á' as a non-word char and falsely match — the
//       app's Unicode lookaround at step1.html L2925 is what's under test);
//   (b) regex-special characters in a card title: "Mr. O'Brien (the Elder)"
//       with alias "O'Brien" — escapeRx (L2920) must keep '(' ')' '.' literal,
//       and the longer alternative must win so the full-name occurrence is not
//       double-counted via the alias: expected 2 mentions total;
//   (c) two cards with the same title: the zip writer (L3370-3375) must dedupe
//       entry names (cards/Twin.md + cards/Twin 2.md) so no entry is lost.
// Run: cd probes && node cd-adversarial-names.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile } from 'node:fs/promises';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// book + prose with the trap words
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Edge Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Ruins');
await page.click('#ed-content');
await page.keyboard.type("Nária stood near the Nárian stones. Mr. O'Brien (the Elder) nodded. O'Brien left.");
await T(1400);
await page.click('#ed-back');
await T(500);

await page.click('#bk-cardsrow');
await T(500);
async function newCard(name){
  await page.click('#cd-new');
  await T(450);
  await page.fill('#ps-input', name);
  await page.click('#ps-save');
  await T(700);
}
const mcount = () => page.locator('#cc-mcount').innerText();

// (a) accented boundary
await newCard('Nária');
const naria = await mcount();
console.log('Nária mentions (want "1 mention", Nárian must not count):', JSON.stringify(naria));
await page.click('#cc-back');
await T(500);

// (b) regex specials + alias subsumed by the longer full-name alternative
await newCard("Mr. O'Brien (the Elder)");
await page.click('#cc-aliases [data-add]');
await T(450);
await page.fill('#ps-input', "O'Brien");
await page.click('#ps-save');
await T(600);
const obrien = await mcount();
console.log("O'Brien card mentions (want \"2 mentions\"):", JSON.stringify(obrien));
await page.click('#cc-back');
await T(500);

// (c) duplicate titles → distinct zip entry names
await newCard('Twin');
await page.click('#cc-back');
await T(500);
await newCard('Twin');
await page.click('#cc-back');
await T(500);

await page.click('#cd-export');
await T(450);
const [zipDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#sheet button', { hasText: 'Cards archive' }).click(),
]);
const buf = await readFile(await zipDl.path());
const names = [];
let off = 0;
while(off + 4 <= buf.length && buf.readUInt32LE(off) === 0x04034b50){
  const csize = buf.readUInt32LE(off + 18);
  const nlen = buf.readUInt16LE(off + 26);
  const xlen = buf.readUInt16LE(off + 28);
  names.push(buf.subarray(off + 30, off + 30 + nlen).toString('utf8'));
  off += 30 + nlen + xlen + csize;
}
console.log('zip entries:', JSON.stringify(names));
const graphRaw = (() => {
  // re-walk to pull graph.json data
  let o = 0;
  while(o + 4 <= buf.length && buf.readUInt32LE(o) === 0x04034b50){
    const csize = buf.readUInt32LE(o + 18);
    const nlen = buf.readUInt16LE(o + 26);
    const xlen = buf.readUInt16LE(o + 28);
    const nm = buf.subarray(o + 30, o + 30 + nlen).toString('utf8');
    const data = buf.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize);
    if(nm === 'graph.json') return data.toString('utf8');
    o += 30 + nlen + xlen + csize;
  }
  return '{}';
})();
const graph = JSON.parse(graphRaw);
const nariaCard = (graph.cards || []).find(c => c.title === 'Nária');
const obCard = (graph.cards || []).find(c => c.title === "Mr. O'Brien (the Elder)");
const mEdges = (graph.edges || []).filter(e => e.kind === 'mention');
console.log('graph mention edges:', JSON.stringify(mEdges.map(e => ({
  from: (graph.cards.find(c => c.id === e.from) || {}).title, count: e.count }))));

const ok =
  naria === '1 mention' &&
  obrien === '2 mentions' &&
  names.includes('cards/Twin.md') && names.includes('cards/Twin 2.md') &&
  names.filter(n => n.startsWith('cards/')).length === 4 &&
  nariaCard && obCard &&
  mEdges.some(e => e.from === nariaCard.id && e.count === 1) &&
  mEdges.some(e => e.from === obCard.id && e.count === 2);
console.log(ok ? 'CD-ADVERSARIAL VERDICT: PASS' : 'CD-ADVERSARIAL VERDICT: FAIL');

await browser.close();
await srv.close();
