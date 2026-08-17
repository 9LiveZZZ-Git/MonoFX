// TX-11 — "Other formats stay legible."
//
// DOCX / Markdown / plain text must carry the ROMANIZATION (never raw PUA) and
// must keep the English source RECOVERABLE. Recoverable is tested two ways:
//   a) is the English literally present in the exported bytes?
//   b) does the app's own importer bring the span back with data-src intact?
// Both book scope and scene scope, in every tongue (all three flows).
//
// Run: cd probes && node tx-other-formats.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx11';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL '), label, extra === undefined ? '' : extra); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const LANGS = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  return langs.map(l => ({ id: l.id, name: l.name }));
});
console.log('tongues:', LANGS.map(l => l.name).join(', '));

await createBook(page, 'TX11 Legible Formats');
await page.click('#ed-title');
await page.keyboard.type('Plain Faces');
await page.click('#ed-content');
await page.keyboard.type('opening line');
for(let i = 0; i < LANGS.length; i++){
  await page.keyboard.press('Enter');
  await page.keyboard.type(`alpha${i} the sea remembers the old king omega${i}`);
}
await wait(page, 400);
for(let i = 0; i < LANGS.length; i++){
  await insertTranslationSpan(page, `the sea remembers the old king omega${i}`, LANGS[i].name);
}
await wait(page, 1800);

// live truth
const LIVE = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(s => ({
  lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr || null, text: s.textContent,
})));
console.log('live spans:', LIVE.length);
for(const s of LIVE) console.log('   ', s.lang.padEnd(14), 'rom=' + JSON.stringify(s.rom).slice(0, 50));
ck('setup: a span per tongue, each rendered as PUA script', LIVE.length === LANGS.length && LIVE.every(s => PUA_RE.test(s.text)));

// ---------- scene-scope md / txt ----------
await page.click('#ed-share'); await wait(page, 450);
const sceneMD = await downloadFromSheet(page, 'Markdown (.md)');
await page.click('#ed-share'); await wait(page, 450);
const sceneTXT = await downloadFromSheet(page, 'plain text (.txt)');
await page.click('#ed-back'); await wait(page, 700);

// ---------- book-scope md / txt / docx ----------
await page.click('#bk-share'); await wait(page, 450);
const bookMD = await downloadFromSheet(page, 'Markdown (.md)');
await page.click('#bk-share'); await wait(page, 450);
const bookTXT = await downloadFromSheet(page, 'plain text (.txt)');
await page.click('#bk-share'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'Word (.docx)' }).click(),
]);
const docxBuf = await readFile(await dl.path());
await wait(page, 500);
await writeFile(`${OUT}/book.docx`, docxBuf);
await writeFile(`${OUT}/book.md`, bookMD.text);
await writeFile(`${OUT}/book.txt`, bookTXT.text);
await writeFile(`${OUT}/scene.md`, sceneMD.text);
await writeFile(`${OUT}/scene.txt`, sceneTXT.text);

function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map();
  let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    off += 30 + nameLen + extraLen + csize;
  }
  return files;
}
const docXml = Buffer.from(unzipStored(docxBuf).get('word/document.xml')).toString('utf8');
await writeFile(`${OUT}/document.xml`, docXml);

const PUA_G = /[\uE000-\uF8FF]/g;
const report = (label, text) => {
  const pua = (text.match(PUA_G) || []);
  console.log(`   ${label.padEnd(12)} bytes=${String(text.length).padEnd(7)} PUA=${pua.length} romsFound=${LIVE.filter(s => text.includes(s.rom)).length}/${LIVE.length} srcsFound=${LIVE.filter(s => text.includes(s.src)).length}/${LIVE.length}`);
  return pua;
};
console.log('format survey:');
const puaMD = report('book.md', bookMD.text);
const puaTXT = report('book.txt', bookTXT.text);
const puaDOCX = report('docx', docXml);
const puaSMD = report('scene.md', sceneMD.text);
const puaSTXT = report('scene.txt', sceneTXT.text);

// ---------- (1) never raw PUA ----------
ck('TX-11 markdown carries no raw PUA', puaMD.length === 0, JSON.stringify(puaMD.slice(0, 8)));
ck('TX-11 plain text carries no raw PUA', puaTXT.length === 0, JSON.stringify(puaTXT.slice(0, 8)));
ck('TX-11 docx carries no raw PUA', puaDOCX.length === 0, JSON.stringify(puaDOCX.slice(0, 8)));
ck('TX-11 scene-scope md/txt carry no raw PUA', puaSMD.length === 0 && puaSTXT.length === 0);

// ---------- (2) romanization present, verbatim, for every tongue ----------
const mdMiss = LIVE.filter(s => !bookMD.text.includes(s.rom));
const txtMiss = LIVE.filter(s => !bookTXT.text.includes(s.rom));
const docxMiss = LIVE.filter(s => !docXml.includes(s.rom));
ck('TX-11 markdown carries every tongue\'s romanization verbatim', mdMiss.length === 0, mdMiss.map(s => s.lang).join(','));
ck('TX-11 plain text carries every tongue\'s romanization verbatim', txtMiss.length === 0, txtMiss.map(s => `${s.lang}:${JSON.stringify(s.rom)}`).join(' | '));
ck('TX-11 docx carries every tongue\'s romanization verbatim', docxMiss.length === 0, docxMiss.map(s => `${s.lang}:${JSON.stringify(s.rom)}`).join(' | '));
ck('TX-11 docx romanization runs are italic',
   LIVE.every(s => new RegExp(`<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${s.rom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</w:t>`).test(docXml)),
   'first: ' + (docXml.match(/<w:rPr><w:i\/><\/w:rPr><w:t[^>]*>[^<]*</) || ['none'])[0]);

// ---------- (3) English source recoverable — in the bytes ----------
const mdSrc = LIVE.filter(s => !bookMD.text.includes(s.src));
const txtSrc = LIVE.filter(s => !bookTXT.text.includes(s.src));
const docxSrc = LIVE.filter(s => !docXml.includes(s.src));
ck('TX-11 markdown keeps the English source in the file', mdSrc.length === 0, mdSrc.map(s => s.lang).join(','));
ck('TX-11 plain text keeps the English source in the file', txtSrc.length === 0,
   txtSrc.map(s => `${s.lang}: ${JSON.stringify(s.src)}`).join(' | '));
ck('TX-11 docx keeps the English source in the file', docxSrc.length === 0,
   docxSrc.map(s => `${s.lang}: ${JSON.stringify(s.src)}`).join(' | '));
const mdMeta = [...bookMD.text.matchAll(/<!--tenebrae:begin\s+({.*?})-->/g)].map(x => JSON.parse(x[1]));
console.log('   md tenebrae markers:', mdMeta.length, JSON.stringify(mdMeta.slice(0, 2)));
ck('TX-11 markdown marks every span with {language, source}',
   mdMeta.length === LIVE.length && LIVE.every((s, i) => mdMeta[i] && mdMeta[i].source === s.src && mdMeta[i].language === s.lang),
   JSON.stringify(mdMeta).slice(0, 300));
ck('TX-11 scene-scope markdown keeps source too',
   LIVE.every(s => sceneMD.text.includes(s.src)) && (sceneMD.text.match(/<!--tenebrae:begin/g) || []).length === LIVE.length);
ck('TX-11 scene-scope plain text keeps source too', LIVE.every(s => sceneTXT.text.includes(s.src)),
   LIVE.filter(s => !sceneTXT.text.includes(s.src)).map(s => s.lang).join(','));

// ---------- (4) English source recoverable — through the real importer ----------
async function importFile(path, headingMode){
  if(await page.$('#scr-book.on')) { await page.click('#bk-back'); await wait(page, 500); }
  await page.click('#lib-more');
  await wait(page, 400);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForSelector('#imp-go', { timeout: 15000 });
  await wait(page, 400);
  if(headingMode){ const seg = await page.$('#imp-seg button[data-mode="h"]'); if(seg){ await seg.click(); await wait(page, 500); } }
  await page.click('#imp-go');
  await wait(page, 1400);
}
const readLast = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const docs = [];
      b.chapters.forEach(c => c.scenes.forEach(s => docs.push(s.doc || '')));
      const joined = docs.join('\n');
      const tpl = document.createElement('template');
      tpl.innerHTML = joined;
      res({ title: b.title, text: tpl.content.textContent,
        spans: [...tpl.content.querySelectorAll('.tspan')].map(s => ({ lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, text: s.textContent })) });
    };
  };
}));

await importFile(`${OUT}/book.md`, true);
const mdBack = await readLast();
console.log('md re-import:', JSON.stringify(mdBack.title), 'spans:', mdBack.spans.length);
for(const s of mdBack.spans) console.log('      back', String(s.lang).padEnd(14), JSON.stringify(s.src).slice(0, 46));
ck('TX-11 markdown round-trip returns a live span per tongue with source intact',
   mdBack.spans.length === LIVE.length && LIVE.every((s, i) => mdBack.spans[i] && mdBack.spans[i].src === s.src),
   mdBack.spans.map((s, i) => `${LIVE[i] ? LIVE[i].lang : '?'}->${s.lang}`).join(' '));

await importFile(`${OUT}/book.txt`, true);
const txtBack = await readLast();
console.log('txt re-import:', JSON.stringify(txtBack.title), 'spans:', txtBack.spans.length);
ck('TX-11 plain-text round-trip keeps the English source readable in the manuscript',
   LIVE.every(s => txtBack.text.includes(s.src)),
   LIVE.filter(s => !txtBack.text.includes(s.src)).map(s => s.lang).join(','));

await importFile(`${OUT}/book.docx`, true);
const docxBack = await readLast();
console.log('docx re-import:', JSON.stringify(docxBack.title), 'spans:', docxBack.spans.length);
ck('TX-11 docx round-trip keeps the English source readable in the manuscript',
   LIVE.every(s => docxBack.text.includes(s.src)),
   LIVE.filter(s => !docxBack.text.includes(s.src)).map(s => `${s.lang}:${JSON.stringify(s.src)}`).join(' | '));
ck('TX-11 docx round-trip keeps the romanization', LIVE.every(s => docxBack.text.includes(s.rom)),
   LIVE.filter(s => !docxBack.text.includes(s.rom)).map(s => s.lang).join(','));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-11 other formats stay legible', checks.every(c => c[1]));
console.log('artifacts in', OUT);
await browser.close();
await srv.close();
