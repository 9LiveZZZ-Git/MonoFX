// STEP 2 adversarial probe (X2-2, X2-4): an empty-body scene with a title.
// - sceneTitles ON: the empty scene must still emit its Heading2 and the file
//   must stay valid; the book must round-trip with the empty scene intact.
// - sceneTitles OFF + asterism ON: the md compile FILTERS empty scene bodies
//   (compile(): sceneParts.filter(x => x && x.trim())) so md emits ONE ⁂
//   between the two non-empty neighbours — the docx path keeps the titled
//   empty scene in its scenes[] (docxBodyXML: `if(!body.length && !s.title)
//   return;`) and emits a ⁂ before AND after the hollow scene. The standard
//   says compile options are "honored exactly as in md" — this measures it.
import { launch, wait, createBook, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/s2-empty';
await mkdir(OUT, { recursive: true });

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- ch1: Alpha (body) / Hollow (title only, body untouched) / Gamma (body) ----
await createBook(page, 'Empty Scene Book');
await page.click('#ed-title');
await page.keyboard.type('Alpha');
await page.click('#ed-content');
await page.keyboard.type('alpha body words');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Hollow');
await wait(page, 1500); // title debounce + save; body never touched
await page.click('#ed-back');
await wait(page, 500);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Gamma');
await page.click('#ed-content');
await page.keyboard.type('gamma body words');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// record what the hollow scene's stored doc actually is (interpretation aid)
const hollowDoc = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const s = b.chapters[0].scenes.find(x => x.title === 'Hollow');
      res(s ? JSON.stringify(s.doc) : 'SCENE MISSING');
    };
  };
}));
console.log('hollow scene stored doc =', hollowDoc);

// ---- export helpers ----
const openSheet = async () => { await page.click('#bk-share'); await wait(page, 450); };
const toggle = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 450); };
const downloadBinary = async label => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await dl.path());
  await wait(page, 500);
  return buf;
};
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
const countAst = s => (s.match(/⁂/g) || []).length;

// ---- config 1: sceneTitles ON, asterism ON (default) ----
await openSheet();
await toggle('Include scene titles'); // OFF -> ON
const docx1 = await downloadBinary('Word (.docx)');
await openSheet();
const md1 = (await downloadBinary('Markdown (.md)')).toString('utf8');
await writeFile(`${OUT}/titled-on.docx`, docx1);
const py1 = pyValidate(`${OUT}/titled-on.docx`);
console.log('py titled-on:', py1);
ck('X2-1 [titles ON] python validates docx with empty-body scene', py1 === 'PYOK 6');
const d1 = Buffer.from(unzipStored(docx1).get('word/document.xml')).toString('utf8');
ck('X2-2 [titles ON] Hollow emits its Heading2 with no body after it', /w:val="Heading2"\/><\/w:pPr><w:r><w:t[^>]*>Hollow<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:jc/.test(d1));
ck('X2-2 [titles ON] docx ⁂ count = md ⁂ count = 2', countAst(d1) === 2 && countAst(md1) === 2, `docx=${countAst(d1)} md=${countAst(md1)}`);
ck('X2-2 [titles ON] md keeps ### Hollow', md1.includes('### Hollow'));

// ---- config 2: sceneTitles OFF, asterism ON — md parity stress ----
await openSheet();
await toggle('Include scene titles'); // ON -> OFF
const docx2 = await downloadBinary('Word (.docx)');
await openSheet();
const md2 = (await downloadBinary('Markdown (.md)')).toString('utf8');
await writeFile(`${OUT}/titled-off.docx`, docx2);
const py2 = pyValidate(`${OUT}/titled-off.docx`);
ck('X2-1 [titles OFF] python validates docx', py2 === 'PYOK 6');
const d2 = Buffer.from(unzipStored(docx2).get('word/document.xml')).toString('utf8');
console.log('[titles OFF] docx ⁂ =', countAst(d2), '| md ⁂ =', countAst(md2));
console.log('[titles OFF] md body:', JSON.stringify(md2));
ck('X2-2 [titles OFF] ⁂ handling matches md EXACTLY (md drops the empty scene, docx must too)', countAst(d2) === countAst(md2), `docx=${countAst(d2)} md=${countAst(md2)} — a hollow scene must not leave a doubled separator`);
if(countAst(d2) !== countAst(md2)){
  const i = d2.indexOf('alpha body words');
  console.log('docx stream after alpha:', d2.slice(i, i + 420));
}

// ---- round-trip under the CANONICAL options (X2-4's letter):
// chapterTitles ON, sceneTitles ON, asterism OFF ----
await openSheet();
await toggle('Include scene titles'); // OFF -> ON (back on)
await toggle('⁂ between scenes');     // ON -> OFF
const docx3 = await downloadBinary('Word (.docx)');
await writeFile(`${OUT}/canonical.docx`, docx3);
const py3 = pyValidate(`${OUT}/canonical.docx`);
ck('X2-1 [canonical] python validates docx', py3 === 'PYOK 6');

// ---- round-trip (canonical import mode: headings) ----
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
const readLastBook = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      res({ title: b.title, chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc })) })) });
    };
  };
}));

const stats = await importFile(`${OUT}/canonical.docx`);
console.log('canonical re-import preview:', stats);
const rb = await readLastBook();
console.log('canonical re-imported:', JSON.stringify(rb));
const sc = rb.chapters[0] ? rb.chapters[0].scenes : [];
ck('X2-4 [canonical opts] round-trip keeps all 3 scenes incl. the hollow one, in order', sc.map(s => s.title).join('|') === 'Alpha|Hollow|Gamma');
ck('X2-4 [canonical opts] hollow scene comes back empty-bodied', !!sc[1] && !(sc[1].doc || '').replace(/<p>\s*<\/p>|<p><br><\/p>/g, '').trim(), JSON.stringify(sc[1] && sc[1].doc));
ck('X2-4 [canonical opts] neighbours keep their prose', !!sc[0] && sc[0].doc.includes('alpha body words') && !!sc[2] && sc[2].doc.includes('gamma body words'));

// INFORMATIONAL (beyond X2-4's canonical options): re-import of the
// asterism-ON export — between-scene ⁂ paragraphs come back as IN-scene
// asterism divs attached to the preceding/hollow scenes.
const statsAst = await importFile(`${OUT}/titled-on.docx`);
console.log('asterism-ON re-import preview:', statsAst);
const rbAst = await readLastBook();
console.log('asterism-ON re-imported (informational):', JSON.stringify(rbAst.chapters[0] && rbAst.chapters[0].scenes.map(s => [s.title, s.doc])));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('S2-DOCX-EMPTY-SCENE', checks.every(c => c[1]));
await browser.close();
await srv.close();
