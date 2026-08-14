// CD-5 — card export independent of the manuscript:
//   (a) Story bible .md via cards-screen export sheet (grouped by type,
//       per-card sections, mentions, [[wikilink]] connections)
//   (b) Cards archive .zip: one wikilink-ready .md per card + graph.json with
//       the card set (nodes) and mention/card edges referencing real card ids.
// The zip is store-only; parsed manually here, CRC32 verified per entry.
// Run: cd probes && node cd-export.mjs
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

// book + scene mentioning both cards (Lodestone twice)
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Export Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Dock');
await page.click('#ed-content');
await page.keyboard.type('Serane waited by the Lodestone. The Lodestone hummed.');
await T(1400);
await page.click('#ed-back');
await T(500);

// cards: Serane (person, notes reference Lodestone) and Lodestone (artifact)
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Serane');
await page.click('#ps-save');
await T(700);
await page.click('#cc-notes');
await page.keyboard.type('Bearer of the Lodestone.');
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
await page.click('#cc-back');
await T(500);

// Headless Chromium reports suggestedFilename() as "download" for blob-anchor
// downloads, so capture the real filename from the anchor's download attribute
// (the app's download() at step1.html L2006 clicks an <a download="…">).
await page.evaluate(() => {
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest && e.target.closest('a[download]');
    if(a) window.__lastDownloadName = a.getAttribute('download');
  }, true);
});

// (a) story bible .md
await page.click('#cd-export');
await T(450);
const [mdDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#sheet button', { hasText: 'Story bible' }).click(),
]);
const bible = await readFile(await mdDl.path(), 'utf8');
const bibleName = await page.evaluate(() => window.__lastDownloadName);
console.log('bible file (anchor download attr):', JSON.stringify(bibleName),
  '| suggestedFilename:', JSON.stringify(mdDl.suggestedFilename()));
console.log('--- story bible ---\n' + bible + '-------------------');
const bibleOk =
  bible.includes('# Export Probe — Story Bible') &&
  bible.includes('## People') && bible.includes('### Serane') &&
  bible.includes('## Artifacts') && bible.includes('### Lodestone') &&
  bible.includes('#### Mentioned in') && bible.includes('Chapter 1 · Dock') &&
  /Chapter 1 · Dock \(×2\)/.test(bible) &&
  bible.includes('[[Lodestone]]') && bible.includes('[[Serane]]');
console.log('bible checks:', bibleOk);

// (b) cards archive .zip
await T(400);
await page.click('#cd-export');
await T(450);
const [zipDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#sheet button', { hasText: 'Cards archive' }).click(),
]);
const zipName = await page.evaluate(() => window.__lastDownloadName);
const buf = await readFile(await zipDl.path());
console.log('zip file (anchor download attr):', JSON.stringify(zipName), '|', buf.length, 'bytes');

// manual store-only zip parse + CRC32 verification
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = u8 => {
  let c = 0xFFFFFFFF;
  for(let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const entries = {};
let off = 0, crcOk = true;
while(off + 4 <= buf.length && buf.readUInt32LE(off) === 0x04034b50){
  const method = buf.readUInt16LE(off + 8);
  const crc = buf.readUInt32LE(off + 14);
  const csize = buf.readUInt32LE(off + 18);
  const nlen = buf.readUInt16LE(off + 26);
  const xlen = buf.readUInt16LE(off + 28);
  const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
  const data = buf.subarray(off + 30 + nlen + xlen, off + 30 + nlen + xlen + csize);
  if(method !== 0){ console.log('NON-STORED ENTRY:', name); crcOk = false; }
  if(crc32(data) !== crc){ console.log('CRC MISMATCH:', name); crcOk = false; }
  entries[name] = Buffer.from(data).toString('utf8');
  off += 30 + nlen + xlen + csize;
}
const names = Object.keys(entries);
console.log('zip entries:', JSON.stringify(names), '| CRCs ok:', crcOk);

const seraneMd = entries['cards/Serane.md'] || '';
const lodeMd = entries['cards/Lodestone.md'] || '';
console.log('--- cards/Serane.md ---\n' + seraneMd + '-----------------------');
const perCardOk =
  seraneMd.startsWith('# Serane') && seraneMd.includes('[[Lodestone]]') &&
  seraneMd.includes('## Mentioned in') && seraneMd.includes('Chapter 1 · Dock') &&
  lodeMd.startsWith('# Lodestone') && lodeMd.includes('[[Serane]]') &&
  /Chapter 1 · Dock \(×2\)/.test(lodeMd);
console.log('per-card md checks:', perCardOk);

const graph = JSON.parse(entries['graph.json'] || '{}');
const ids = (graph.cards || []).map(c => c.id);
const byTitle = Object.fromEntries((graph.cards || []).map(c => [c.title, c.id]));
const mentionEdges = (graph.edges || []).filter(e => e.kind === 'mention');
const cardEdges = (graph.edges || []).filter(e => e.kind === 'card');
const edgesRefValid = (graph.edges || []).every(e =>
  ids.includes(e.from) && (e.kind === 'card' ? ids.includes(e.to) : typeof e.sceneId === 'string'));
console.log('graph.json: kind =', graph.kind, '| cards(nodes) =', (graph.cards || []).length,
  '| mention edges =', JSON.stringify(mentionEdges),
  '| card edges =', JSON.stringify(cardEdges), '| all edge refs valid =', edgesRefValid);
const graphOk =
  graph.kind === 'cards-graph' && ids.length === 2 &&
  byTitle['Serane'] && byTitle['Lodestone'] &&
  mentionEdges.length === 2 &&
  mentionEdges.some(e => e.from === byTitle['Serane'] && e.count === 1) &&
  mentionEdges.some(e => e.from === byTitle['Lodestone'] && e.count === 2) &&
  cardEdges.length === 1 &&
  ((cardEdges[0].from === byTitle['Serane'] && cardEdges[0].to === byTitle['Lodestone']) ||
   (cardEdges[0].from === byTitle['Lodestone'] && cardEdges[0].to === byTitle['Serane'])) &&
  edgesRefValid;
console.log('graph checks:', graphOk);

const ok = bibleOk && crcOk && perCardOk && graphOk &&
  names.length === 3 && names.includes('graph.json') &&
  bibleName === 'Export Probe — story bible.md' && zipName === 'Export Probe — cards.zip';
console.log(ok ? 'CD-5 VERDICT: PASS' : 'CD-5 VERDICT: FAIL');

await browser.close();
await srv.close();
