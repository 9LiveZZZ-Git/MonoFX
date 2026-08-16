// STEP 2 adversarial probe (X2-2, X2-3): toggling EACH compile option
// (chapter titles / scene titles / ⁂ between scenes) and verifying the DOCX
// paragraph stream changes accordingly — and matches the md compile for the
// same option set (the standard says "honored exactly as in md").
// Also: nested marks compose into one run's rPr (X2-3), verified beyond the
// canonical probe's single-mark checks.
import { launch, wait, createBook, selectWord, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/s2-options';
await mkdir(OUT, { recursive: true });

const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- book: ch1 {S-One (nested marks), S-Two}, ch2 {S-Three} ----
await createBook(page, 'Options Probe Book');
await page.click('#ed-title');
await page.keyboard.type('S-One');
await page.click('#ed-content');
await page.keyboard.type('one body alpha');
await page.keyboard.press('Enter');
await page.keyboard.type('nest deepword tail end');
await wait(page, 300);
// nested marks on the same word: bold, then italic, then underline
for(const cmd of ['bold', 'italic', 'underline']){
  await selectWord(page, 'deepword');
  await page.click(`[data-cmd="${cmd}"]`);
  await wait(page, 250);
}
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('S-Two');
await page.click('#ed-content');
await page.keyboard.type('two body beta');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

await page.click('#bk-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
await wait(page, 500);
await page.fill('#ps-input', 'Second Chapter');
await page.click('#ps-save');
await wait(page, 600);
await page.locator('.chapter-block', { hasText: 'Second Chapter' }).locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('S-Three');
await page.click('#ed-content');
await page.keyboard.type('three body gamma');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// ---- export helpers ----
const openSheet = async () => { await page.click('#bk-share'); await wait(page, 450); };
const toggle = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 450); };
const downloadBinary = async label => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const name = dl.suggestedFilename();
  const buf = await readFile(await dl.path());
  await wait(page, 500);
  return { name, buf };
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

// grab docx + md under the CURRENT option set (sheet reopened between downloads)
async function grabPair(tag){
  const d = await downloadBinary('Word (.docx)');
  await openSheet();
  const m = await downloadBinary('Markdown (.md)');
  const p = `${OUT}/${tag}.docx`;
  await writeFile(p, d.buf);
  const py = pyValidate(p);
  console.log(`[${tag}] docx name="${d.name}" py=${py}`);
  ck(`X2-1 [${tag}] python validates docx`, py === 'PYOK 6');
  return { doc: Buffer.from(unzipStored(d.buf).get('word/document.xml')).toString('utf8'), md: m.buf.toString('utf8') };
}
const countAst = s => (s.match(/⁂/g) || []).length;
const docxPara = re => new RegExp(re);

// ---- A: defaults — chapterTitles ON, sceneTitles OFF, asterism ON ----
await openSheet();
const A = await grabPair('A-defaults');
ck('X2-2 [A] chapter titles ON: Heading1 for both chapters', /w:val="Heading1"[^>]*\/><\/w:pPr><w:r><w:t[^>]*>Chapter 1</.test(A.doc) && /w:val="Heading1"[^>]*\/><\/w:pPr><w:r><w:t[^>]*>Second Chapter</.test(A.doc));
ck('X2-2 [A] scene titles OFF: no Heading2, titles absent', !A.doc.includes('w:val="Heading2"') && !A.doc.includes('S-One') && !A.doc.includes('S-Two') && !A.doc.includes('S-Three'));
ck('X2-2 [A] asterism ON: exactly 1 centered ⁂ (between the two ch1 scenes only)', countAst(A.doc) === 1 && /<w:jc w:val="center"\/><\/w:pPr><w:r><w:t[^>]*>⁂</.test(A.doc), 'count=' + countAst(A.doc));
ck('X2-2 [A] md parity: md also has 1 ⁂, chapter titles, no scene titles', countAst(A.md) === 1 && A.md.includes('## Chapter 1') && A.md.includes('## Second Chapter') && !A.md.includes('S-One'));

// ---- B: chapterTitles OFF (others unchanged) ----
await openSheet();
await toggle('Include chapter titles'); // ON -> OFF
const B = await grabPair('B-chapterOff');
ck('X2-2 [B] chapter titles OFF: no Heading1, chapter titles gone from stream', !B.doc.includes('w:val="Heading1"') && !B.doc.includes('Chapter 1') && !B.doc.includes('Second Chapter'));
ck('X2-2 [B] book Title + bodies still present', /w:val="Title"/.test(B.doc) && B.doc.includes('one body alpha') && B.doc.includes('three body gamma'));
ck('X2-2 [B] md parity: chapter headings gone from md too', !B.md.includes('## Chapter 1') && !B.md.includes('## Second Chapter'));

// ---- C: chapterTitles back ON, sceneTitles ON ----
await openSheet();
await toggle('Include chapter titles'); // OFF -> ON
await toggle('Include scene titles');   // OFF -> ON
const C = await grabPair('C-sceneOn');
ck('X2-2 [C] scene titles ON: Heading2 paragraphs for all 3 scenes', (C.doc.match(/w:val="Heading2"/g) || []).length === 3 && /Heading2"\/><\/w:pPr><w:r><w:t[^>]*>S-One</.test(C.doc) && C.doc.includes('S-Two') && C.doc.includes('S-Three'));
ck('X2-2 [C] asterism still ON: 1 ⁂', countAst(C.doc) === 1, 'count=' + countAst(C.doc));
ck('X2-2 [C] md parity: ### scene titles + 1 ⁂ in md', C.md.includes('### S-One') && C.md.includes('### S-Two') && C.md.includes('### S-Three') && countAst(C.md) === 1);

// ---- D: asterism OFF (scene titles still ON) ----
await openSheet();
await toggle('⁂ between scenes'); // ON -> OFF
const D = await grabPair('D-astOff');
ck('X2-2 [D] asterism OFF: zero ⁂ in docx', countAst(D.doc) === 0, 'count=' + countAst(D.doc));
ck('X2-2 [D] md parity: zero ⁂ in md', countAst(D.md) === 0);
ck('X2-2 [D] scene titles remain (only ⁂ changed)', (D.doc.match(/w:val="Heading2"/g) || []).length === 3);

// ---- X2-3: nested marks compose into a single run's rPr ----
const runM = A.doc.match(/<w:r><w:rPr>((?:<w:[^>]+>)+)<\/w:rPr><w:t[^>]*>deepword<\/w:t><\/w:r>/);
console.log('nested run rPr:', runM && runM[1]);
ck('X2-3 nested b+i+u compose on one run', !!runM && runM[1].includes('<w:b/>') && runM[1].includes('<w:i/>') && runM[1].includes('<w:u w:val="single"/>'));
ck('X2-3 neighbours unmarked (nesting is scoped)', /<w:r><w:t[^>]*>nest <\/w:t><\/w:r>/.test(A.doc) && / tail end/.test(A.doc));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('S2-DOCX-OPTIONS', checks.every(c => c[1]));
await browser.close();
await srv.close();
