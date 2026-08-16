// STEP 2 (X2-1..X2-10): DOCX + EPUB export — structure, determinism, XML
// well-formedness, and round-trip through the app's own importers.
//
// Canonical config for round-trip: chapterTitles ON (default), sceneTitles ON
// (toggled), asterism OFF (toggled). The rich book still carries an IN-scene ⁂,
// which auto-detects as separator-split on re-import — the probe selects the
// Headings split rule in the preview (#imp-seg), after which structure must
// round-trip exactly (⁂ comes back as an in-scene break).
import { launch, wait, buildRichBook, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/s2';
await mkdir(OUT, { recursive: true });

const { srv, browser, page, errors } = await launch();
await buildRichBook(page, 'Step Two Book');

// ---- export sheet: canonical options, then capture downloads (binary) ----
const openSheet = async () => { await page.click('#bk-share'); await wait(page, 450); };
const toggle = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 450); };
const downloadBinary = async label => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await dl.path());
  await wait(page, 500);
  return { name: dl.suggestedFilename(), buf };
};

await openSheet();
await toggle('Include scene titles');   // OFF -> ON (keepOpen)
await toggle('⁂ between scenes');       // ON -> OFF (keepOpen)
const docx1 = await downloadBinary('Word (.docx)');
await openSheet();
const epub1 = await downloadBinary('EPUB (.epub)');
await openSheet();
const docx2 = await downloadBinary('Word (.docx)');
await openSheet();
const epub2 = await downloadBinary('EPUB (.epub)');

await writeFile(`${OUT}/book.docx`, docx1.buf);
await writeFile(`${OUT}/book.epub`, epub1.buf);
console.log(`saved: ${OUT}/book.docx (${docx1.buf.length} B), book.epub (${epub1.buf.length} B)`);

// scene-scope docx from the editor share button
await page.locator('.scene-row', { hasText: 'First Light' }).click().catch(() => page.locator('#bk-list, #scr-book').locator('text=First Light').first().click());
await wait(page, 600);
await page.click('#ed-share');
await wait(page, 450);
const sceneDocx = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/scene.docx`, sceneDocx.buf);
await page.click('#ed-back');
await wait(page, 500);

// ---- store-only zip reader (exports are uncompressed by design) ----
function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map(); const order = [];
  let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    if(method !== 0) throw new Error('unexpected compression on ' + name);
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    order.push({ name, extraLen, headerOffset: off });
    off += 30 + nameLen + extraLen + csize;
  }
  return { files, order };
}
const dz = unzipStored(docx1.buf);
const ez = unzipStored(epub1.buf);
const sz = unzipStored(sceneDocx.buf);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- X2-10 determinism ----
ck('X2-10 docx byte-deterministic', Buffer.compare(docx1.buf, docx2.buf) === 0);
ck('X2-10 epub byte-deterministic', Buffer.compare(epub1.buf, epub2.buf) === 0);

// ---- X2-1 docx package shape ----
const docxParts = ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'word/document.xml'];
ck('X2-1 docx has all parts', docxParts.every(p => dz.files.has(p)), [...dz.files.keys()].join(','));
ck('X2-1 scene docx has all parts', docxParts.every(p => sz.files.has(p)));

// ---- X2-6 epub container shape ----
ck('X2-6 mimetype is first entry, stored, exact', ez.order[0] && ez.order[0].name === 'mimetype' && ez.order[0].extraLen === 0 &&
   Buffer.from(ez.files.get('mimetype')).toString('utf8') === 'application/epub+zip');
ck('X2-6 container.xml present', ez.files.has('META-INF/container.xml'));
const opf = Buffer.from(ez.files.get('OEBPS/content.opf') || '').toString('utf8');
ck('X2-6 opf: identifier/title/language/modified', /dc:identifier/.test(opf) && /Step Two Book/.test(opf) && /dc:language/.test(opf) && /dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ</.test(opf));
ck('X2-6 opf: nav + css + 2 chapters manifested, spine ordered', /properties="nav"/.test(opf) && /style\.css/.test(opf) && /ch1\.xhtml/.test(opf) && /ch2\.xhtml/.test(opf) && /<itemref idref="ch1"\/><itemref idref="ch2"\/>/.test(opf));
const nav = Buffer.from(ez.files.get('OEBPS/nav.xhtml') || '').toString('utf8');
ck('X2-6 nav lists both chapters', /epub:type="toc"/.test(nav) && /Chapter 1/.test(nav) && /The Second Gate/.test(nav));

// ---- X2-7 strict XML parse of every XML/XHTML part (in-page DOMParser) ----
const xmlParts = [];
for(const [name, data] of dz.files) if(/\.xml$|\.rels$/.test(name)) xmlParts.push(['docx:' + name, Buffer.from(data).toString('utf8')]);
for(const [name, data] of ez.files) if(/\.xhtml$|\.xml$|\.opf$/.test(name)) xmlParts.push(['epub:' + name, Buffer.from(data).toString('utf8')]);
const parseFails = await page.evaluate(parts => parts
  .map(([label, text]) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? label : null;
  })
  .filter(Boolean), xmlParts);
ck('X2-7 all XML/XHTML parts strictly well-formed', parseFails.length === 0, parseFails.join(','));

// ---- X2-2/X2-3 docx mapping ----
const doc = Buffer.from(dz.files.get('word/document.xml')).toString('utf8');
ck('X2-2 Title/Heading1/Heading2 present', /w:val="Title"/.test(doc) && /w:val="Heading1"/.test(doc) && /w:val="Heading2"/.test(doc));
ck('X2-2 in-scene H2/H3 -> Heading3/Heading4', /w:val="Heading3"[\s\S]*heading line/.test(doc) && /w:val="Heading4"[\s\S]*sub line/.test(doc));
ck('X2-2 blockquote -> Quote', /w:val="Quote"[\s\S]*quote line/.test(doc));
ck('X2-2 lists -> ListBullet/ListNumber + numPr', /w:val="ListBullet"\/><w:numPr>[\s\S]*bullet item/.test(doc) && /w:val="ListNumber"\/><w:numPr>[\s\S]*numbered item/.test(doc));
ck('X2-2 in-scene ⁂ centered', /<w:jc w:val="center"\/><\/w:pPr><w:r><w:t[^>]*>⁂/.test(doc));
ck('X2-2 asterism OFF: no ⁂ between scenes', (doc.match(/⁂/g) || []).length === 1);
ck('X2-3 marks map to rPr', /<w:b\/>[\s\S]{0,80}?bold/.test(doc) && /<w:i\/>[\s\S]{0,80}?italic/.test(doc) && /<w:u w:val="single"\/>[\s\S]{0,80}?under/.test(doc) && /<w:strike\/>[\s\S]{0,80}?strike/.test(doc) && /<w:smallCaps\/>[\s\S]{0,80}?caps/.test(doc));
ck('X2-5 docx tspan: italic romanization, no PUA', /<w:i\/>[\s\S]{0,60}?meres memnerin/.test(doc) && !PUA_RE.test(doc));

// ---- X2-7 epub content mapping ----
const ch1 = Buffer.from(ez.files.get('OEBPS/ch1.xhtml')).toString('utf8');
ck('X2-7 epub ch1: h1 chapter + h2 scenes + shifted h3/h4', /<h1[^>]*>Chapter 1<\/h1>/.test(ch1) && /<h2[^>]*>First Light<\/h2>/.test(ch1) && /<h3[^>]*>heading line<\/h3>/.test(ch1) && /<h4[^>]*>sub line<\/h4>/.test(ch1));
ck('X2-7 epub marks + sc + blockquote + lists', /<b[^>]*>bold<\/b>/.test(ch1) && /<i[^>]*>italic<\/i>/.test(ch1) && /<u[^>]*>under<\/u>/.test(ch1) && /<s[^>]*>strike<\/s>/.test(ch1) && /class="sc"[^>]*>caps/.test(ch1) && /<blockquote/.test(ch1) && /<ul[^>]*><li/.test(ch1) && /<ol[^>]*><li/.test(ch1));
ck('X2-9 epub tspan carries data attrs + SCRIPT TEXT + rom metadata', /class="tspan"/.test(ch1) && /data-lang="celan-basic"/.test(ch1) && /data-src="sea remembers"/.test(ch1) && /data-rom="meres memnerin"/.test(ch1) && PUA_RE.test(ch1));
const epubCss = Buffer.from(ez.files.get('OEBPS/style.css') || '').toString('utf8');
ck('X2-9 epub embeds the script fonts + @font-face + lang rules', [...ez.files.keys()].some(n => /fonts\/f\d+\.ttf/.test(n)) && /@font-face/.test(epubCss) && /data-lang="celan-basic"/.test(epubCss));

// ---- round-trips through the real import UI ----
async function importFile(path, useHeadingMode){
  // make sure we're on the library screen (imports live in its menu)
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
  if(useHeadingMode){
    const seg = await page.$('#imp-seg button[data-mode="h"]');
    if(seg){ await seg.click(); await wait(page, 500); }
  }
  const stats = (await page.locator('.imp-stats').innerText()).trim();
  await page.click('#imp-go');
  await wait(page, 1000);
  return stats;
}
// imports append; commitImport does not dedupe titles — always read the LAST book
const readLastBook = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      res(b ? {
        title: b.title, count: g.result.books.length,
        chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc, words: s.words })) })),
      } : null);
    };
  };
}));

// DOCX round-trip
const dStats = await importFile(`${OUT}/book.docx`, true);
console.log('docx re-import preview:', dStats);
const dBook = await readLastBook();
console.log('docx re-import landed as book', dBook && dBook.count, JSON.stringify(dBook && dBook.title));
const dS1 = dBook && dBook.chapters[0] && dBook.chapters[0].scenes[0];
ck('X2-4 docx round-trip: 2 chapters, titles kept', !!dBook && dBook.chapters.length === 2 && dBook.chapters[0].title === 'Chapter 1' && dBook.chapters[1].title === 'The Second Gate');
ck('X2-4 docx round-trip: scene titles kept', !!dBook && dBook.chapters[0].scenes.map(s => s.title).join('|') === 'First Light|Second Scene' && dBook.chapters[1].scenes[0].title === 'Third Scene');
ck('X2-4 docx round-trip: marks + blocks survive', !!dS1 && /<b>bold<\/b>/.test(dS1.doc) && /<i>italic<\/i>/.test(dS1.doc) && /<u>under<\/u>/.test(dS1.doc) && /<s>strike<\/s>/.test(dS1.doc) && /class="sc">caps/.test(dS1.doc) && /<h2>heading line<\/h2>/.test(dS1.doc) && /<h3>sub line<\/h3>/.test(dS1.doc) && /<blockquote>/.test(dS1.doc) && /<li>bullet item<\/li>/.test(dS1.doc) && /<li>numbered item<\/li>/.test(dS1.doc) && /asterism/.test(dS1.doc));
ck('X2-5 docx round-trip: romanization text present', !!dS1 && /meres memnerin/.test(dS1.doc));
if(dS1 && !( /<b>bold<\/b>/.test(dS1.doc) && /asterism/.test(dS1.doc) )) console.log('docx scene1 doc:', dS1.doc.slice(0, 900));

// EPUB round-trip (the headline: tspans come back alive)
const eStats = await importFile(`${OUT}/book.epub`, true);
console.log('epub re-import preview:', eStats);
const eBook = await readLastBook();
console.log('epub re-import landed as book', eBook && eBook.count, JSON.stringify(eBook && eBook.title));
const eS1 = eBook && eBook.chapters[0] && eBook.chapters[0].scenes[0];
ck('X2-8 epub round-trip: 2 chapters, titles kept', !!eBook && eBook.chapters.length === 2 && eBook.chapters[0].title === 'Chapter 1' && eBook.chapters[1].title === 'The Second Gate');
ck('X2-8 epub round-trip: scene titles kept', !!eBook && eBook.chapters[0].scenes.map(s => s.title).join('|') === 'First Light|Second Scene');
ck('X2-8 epub round-trip: marks survive', !!eS1 && /<b>bold<\/b>/.test(eS1.doc) && /<i>italic<\/i>/.test(eS1.doc) && /<s>strike<\/s>/.test(eS1.doc) && /class="sc">caps/.test(eS1.doc));
ck('X2-9 epub round-trip: tspan restored LIVE with source', !!eS1 && /class="tspan"/.test(eS1.doc) && /data-src="sea remembers"/.test(eS1.doc) && /data-lang="celan-basic"/.test(eS1.doc));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('STEP2 export+roundtrip', checks.every(c => c[1]));
await browser.close();
await srv.close();
