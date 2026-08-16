// STEP 2 adversarial probe (X2-1, X2-2, X2-4): book/chapter/scene titles and
// prose carrying XML specials (& < > " ') and unicode. The export must stay
// strictly well-formed (validated OUTSIDE the browser with python3
// zipfile+minidom), the scene-scope export must contain exactly that scene,
// and the book export must round-trip the exact titles + prose through the
// app's own .docx import UI.
import { launch, wait, createBook, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/s2-hostile';
await mkdir(OUT, { recursive: true });

const BOOK_T = `Roses & "Thorns" <br/> it's — Ünïcødé 日本語 Ω`;
const CH2_T = `Ch <2> & "Gate" 'x' — émigré`;
const SC1_T = `Scene <&> "one" '§' Ω`;
const SC2_T = `L'append & <tail> "fin"`;
const BODY1A = `alpha & <beta> "gamma" 'delta' 5<6 & 7>4`;
const BODY1B = `second line ampersand & angle < done`;
const BODY2 = `omega body & <text> here`;

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- build the hostile book through the real UI ----
await createBook(page, BOOK_T); // editor opens on Chapter 1 / scene 1
await page.click('#ed-title');
await page.keyboard.type(SC1_T);
await page.click('#ed-content');
await page.keyboard.type(BODY1A);
await page.keyboard.press('Enter');
await page.keyboard.type(BODY1B);
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// chapter 2 with hostile title + scene 2
await page.click('#bk-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
await wait(page, 500);
await page.fill('#ps-input', CH2_T);
await page.click('#ps-save');
await wait(page, 600);
await page.locator('.chapter-block').nth(1).locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type(SC2_T);
await page.click('#ed-content');
await page.keyboard.type(BODY2);
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// ---- canonical options: chapterTitles ON (default), sceneTitles ON, asterism OFF ----
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
await page.click('#bk-share');
await wait(page, 450);
await toggle('Include scene titles'); // OFF -> ON
await toggle('⁂ between scenes');     // ON -> OFF
const bookDocx = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/hostile-book.docx`, bookDocx.buf);
console.log('saved', `${OUT}/hostile-book.docx`, bookDocx.buf.length, 'B; suggested name:', bookDocx.name);

// scene-scope export of scene 1
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 600);
await page.click('#ed-share');
await wait(page, 450);
const sceneDocx = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/hostile-scene.docx`, sceneDocx.buf);
await page.click('#ed-back');
await wait(page, 500);

// ---- store-only unzip (copied from the canonical probe) ----
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

// ---- python3 zipfile + minidom validation (external strict parser) ----
const PY = `
import sys, zipfile, xml.dom.minidom
p = sys.argv[1]
z = zipfile.ZipFile(p)
bad = z.testzip()
assert bad is None, 'CRC fail: %s' % bad
names = z.namelist()
parsed = 0
for n in names:
    if n.endswith('.xml') or n.endswith('.rels'):
        xml.dom.minidom.parseString(z.read(n))
        parsed += 1
print('PYOK parts=%d parsed=%d' % (len(names), parsed), ' '.join(names))
`;
const pyValidate = path => {
  try{ return execFileSync('python3', ['-c', PY, path], { encoding: 'utf8' }).trim(); }
  catch(e){ return 'PYFAIL ' + (e.stderr || e.message); }
};
const pvBook = pyValidate(`${OUT}/hostile-book.docx`);
const pvScene = pyValidate(`${OUT}/hostile-scene.docx`);
console.log('py book :', pvBook);
console.log('py scene:', pvScene);
ck('X2-1 python zipfile+minidom validates hostile book.docx (all 6 parts parse)', pvBook.startsWith('PYOK parts=6 parsed=6'));
ck('X2-1 python zipfile+minidom validates hostile scene.docx (all 6 parts parse)', pvScene.startsWith('PYOK parts=6 parsed=6'));

// ---- exact escaped titles inside document.xml ----
const bz = unzipStored(bookDocx.buf);
const doc = Buffer.from(bz.files.get('word/document.xml')).toString('utf8');
const escXml = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
ck('X2-2 hostile book title escaped in Title paragraph', doc.includes(`<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(BOOK_T)}</w:t>`));
ck('X2-2 hostile chapter title escaped in Heading1', doc.includes(`<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(CH2_T)}</w:t>`));
ck('X2-2 hostile scene titles escaped in Heading2', doc.includes(`<w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(SC1_T)}</w:t>`) && doc.includes(escXml(SC2_T)));
ck('X2-2 hostile prose escaped in body runs', doc.includes(escXml(BODY1A)) && doc.includes(escXml(BODY2)));
ck('X2-2 no raw markup leaked from titles', !doc.includes('<br/> it') && !doc.includes('<beta>') && !doc.includes('<tail>'));

// ---- scene-scope export contains exactly that scene ----
const sz = unzipStored(sceneDocx.buf);
const sdoc = Buffer.from(sz.files.get('word/document.xml')).toString('utf8');
ck('X2-1 scene scope: scene title as Heading2 + its prose', sdoc.includes(`<w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(SC1_T)}</w:t>`) && sdoc.includes(escXml(BODY1A)) && sdoc.includes(escXml(BODY1B)));
ck('X2-1 scene scope: nothing but that scene (no Title/Heading1, no book/ch/other-scene text)',
   !sdoc.includes('w:val="Title"') && !sdoc.includes('w:val="Heading1"') && !sdoc.includes(escXml(BOOK_T)) && !sdoc.includes(escXml(CH2_T)) && !sdoc.includes(escXml(BODY2)) && !sdoc.includes(escXml(SC2_T)));

// ---- round-trip through the real import UI ----
async function importFile(path, useHeadingMode){
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
const readLastBook = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const textOf = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent; };
      res(b ? {
        title: b.title, count: g.result.books.length,
        chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc, text: textOf(s.doc) })) })),
      } : null);
    };
  };
}));

const stats = await importFile(`${OUT}/hostile-book.docx`, true);
console.log('re-import preview:', stats);
const rb = await readLastBook();
console.log('re-imported title:', JSON.stringify(rb && rb.title));
console.log('re-imported chapters:', JSON.stringify(rb && rb.chapters.map(c => [c.title, c.scenes.map(s => s.title)])));
ck('X2-4 book title round-trips EXACTLY', !!rb && rb.title === BOOK_T);
ck('X2-4 chapter titles round-trip EXACTLY', !!rb && rb.chapters.length === 2 && rb.chapters[0].title === 'Chapter 1' && rb.chapters[1].title === CH2_T);
ck('X2-4 scene titles round-trip EXACTLY', !!rb && rb.chapters[0].scenes.length === 1 && rb.chapters[0].scenes[0].title === SC1_T && rb.chapters[1].scenes[0].title === SC2_T);
const t1 = rb && rb.chapters[0].scenes[0].text || '';
const t2 = rb && rb.chapters[1].scenes[0].text || '';
ck('X2-4 hostile prose round-trips (text-exact per line)', t1.includes(BODY1A) && t1.includes(BODY1B) && t2.includes(BODY2));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('S2-DOCX-HOSTILE-TITLES', checks.every(c => c[1]));
await browser.close();
await srv.close();
