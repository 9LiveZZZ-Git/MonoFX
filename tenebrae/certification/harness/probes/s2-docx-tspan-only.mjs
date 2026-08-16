// STEP 2 adversarial probe (X2-1, X2-3, X2-4, X2-5): a scene whose entire body
// is ONE translation span (the whole first typed line — a bare top-level run —
// selected and translated). The DOCX export must carry the italic romanization,
// never raw PUA glyphs, at BOTH book scope and scene scope; the scene-scope
// export must contain exactly that scene; and the book export must round-trip
// through the app's own .docx importer with the romanization text intact.
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/s2-tspan';
await mkdir(OUT, { recursive: true });

const PHRASE = 'the sea remembers';

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- scene whose body is ONLY a translation span ----
await createBook(page, 'Tspan Only Book');
await page.click('#ed-title');
await page.keyboard.type('Only Span');
await page.click('#ed-content');
await page.keyboard.type(PHRASE); // first line stays a bare top-level text run
await wait(page, 300);
await insertTranslationSpan(page, PHRASE, 'Celan Basic'); // replaces the WHOLE line
await wait(page, 1500);

// what does the app itself say the romanization is? (public seam)
const rom = await page.evaluate(p => {
  const r = window.tenebrae.translate('celan_basic', p);
  return { rom: r.romanization, rendered: r.rendered };
}, PHRASE);
console.log('romanization =', JSON.stringify(rom.rom), '| rendered has PUA =', /[-]/.test(rom.rendered));
ck('precondition: sample-codex rendered text is PUA glyphs (so the no-PUA assertion has teeth)', PUA_RE.test(rom.rendered));

// the stored scene doc: must be only the tspan (+ trailing nbsp), wrapped in <p>
const stored = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      res(b.chapters[0].scenes[0].doc);
    };
  };
}));
console.log('stored doc =', JSON.stringify(stored));
ck('precondition: scene body is a single tspan (plus nbsp) and nothing else',
   /^<p><span class="tspan"[^>]*>[^<]*<\/span>(?:&nbsp;|\u00a0| )?<\/p>$/.test(stored), JSON.stringify(stored));
ck('precondition: stored tspan textContent carries PUA glyphs', PUA_RE.test(stored));

// ---- scene-scope export straight from the open editor ----
const downloadBinary = async label => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await dl.path());
  await wait(page, 500);
  return buf;
};
await page.click('#ed-share');
await wait(page, 450);
const sceneDocx = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/tspan-scene.docx`, sceneDocx);
await page.click('#ed-back');
await wait(page, 500);

// ---- book-scope export, canonical options (sceneTitles ON, asterism OFF) ----
const toggle = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 450); };
await page.click('#bk-share');
await wait(page, 450);
await toggle('Include scene titles');
await toggle('⁂ between scenes');
const bookDocx = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/tspan-book.docx`, bookDocx);

// ---- python3 zipfile + minidom validation of both artifacts ----
const PY = `
import sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
n = 0
for name in z.namelist():
    if name.endswith('.xml') or name.endswith('.rels'):
        xml.dom.minidom.parseString(z.read(name)); n += 1
print('PYOK', n)
`;
const pyValidate = path => {
  try{ return execFileSync('python3', ['-c', PY, path], { encoding: 'utf8' }).trim(); }
  catch(e){ return 'PYFAIL ' + (e.stderr || e.message); }
};
ck('X2-1 python validates tspan-scene.docx', pyValidate(`${OUT}/tspan-scene.docx`) === 'PYOK 6');
ck('X2-1 python validates tspan-book.docx', pyValidate(`${OUT}/tspan-book.docx`) === 'PYOK 6');

function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map();
  let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    if(method !== 0) throw new Error('unexpected compression on ' + name);
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    off += 30 + nameLen + extraLen + csize;
  }
  return files;
}
const sdoc = Buffer.from(unzipStored(sceneDocx).get('word/document.xml')).toString('utf8');
const bdoc = Buffer.from(unzipStored(bookDocx).get('word/document.xml')).toString('utf8');

// ---- X2-5: italic romanization, never PUA — both scopes ----
const romRun = new RegExp(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${rom.rom}`);
ck('X2-5 scene scope: tspan-only body renders as ONE italic romanization run', romRun.test(sdoc), sdoc.slice(sdoc.indexOf('Only Span'), sdoc.indexOf('Only Span') + 320));
ck('X2-5 scene scope: zero PUA anywhere in document.xml', !PUA_RE.test(sdoc));
ck('X2-5 book scope: italic romanization run present', romRun.test(bdoc));
ck('X2-5 book scope: zero PUA anywhere in document.xml', !PUA_RE.test(bdoc));

// ---- X2-1: scene scope is exactly that scene ----
ck('X2-1 scene scope: Heading2 title + body, no Title/Heading1', sdoc.includes('w:val="Heading2"') && sdoc.includes('Only Span') && !sdoc.includes('w:val="Title"') && !sdoc.includes('w:val="Heading1"'));
ck('X2-1 book scope: Title + Heading1 + Heading2 all present', bdoc.includes('w:val="Title"') && bdoc.includes('w:val="Heading1"') && bdoc.includes('w:val="Heading2"'));

// ---- X2-4: round-trip through the real import UI ----
async function importFile(path){
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
  const seg = await page.$('#imp-seg button[data-mode="h"]');
  if(seg){ await seg.click(); await wait(page, 500); }
  const stats = (await page.locator('.imp-stats').innerText()).trim();
  await page.click('#imp-go');
  await wait(page, 1000);
  return stats;
}
const stats = await importFile(`${OUT}/tspan-book.docx`);
console.log('re-import preview:', stats);
const rb = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      res({ title: b.title, chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc })) })) });
    };
  };
}));
console.log('re-imported:', JSON.stringify(rb));
const s0 = rb.chapters[0] && rb.chapters[0].scenes[0];
ck('X2-4 round-trip: structure back (book/chapter/scene titles)', rb.title === 'Tspan Only Book' && rb.chapters[0].title === 'Chapter 1' && !!s0 && s0.title === 'Only Span');
ck('X2-4/X2-5 round-trip: romanization comes back as italic prose, no PUA', !!s0 && s0.doc.includes(`<i>${rom.rom}</i>`) && !PUA_RE.test(s0.doc), s0 && s0.doc);

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('S2-DOCX-TSPAN-ONLY', checks.every(c => c[1]));
await browser.close();
await srv.close();
