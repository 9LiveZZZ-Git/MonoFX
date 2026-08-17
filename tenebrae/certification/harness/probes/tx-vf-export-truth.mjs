// TX-VF: independent re-verification of the disputed TX-10 / TX-11 claims.
//   1. EPUB style.css is destroyed by an unescaped ASCII apostrophe in a
//      @font-face family name  (counterfactual: escape it, re-parse)
//   2. EPUB re-import rebuilds spans through the LEGACY SAMPLE cipher
//   3. DOCX / plain text do not keep the English source recoverable
// Ground truth for "is this the sample cipher" is the app's own legacy seam
// window.tenebrae.translate(), compared against the codex's compileText.
// Run: cd probes && node tx-vf-export-truth.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vf-export';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? '  ok   ' : '  FAIL '), label, extra === undefined ? '' : extra); };

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

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const SRC_A = 'the sea remembers the old king alphamark';
const SRC_B = 'the lamp holds steady betamark';

await createBook(page, 'VF Export Truth');
await page.click('#ed-title'); await page.keyboard.type('Faces');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter'); await page.keyboard.type(SRC_A);
await page.keyboard.press('Enter'); await page.keyboard.type(SRC_B);
await wait(page, 400);
await insertTranslationSpan(page, SRC_A, 'Celan High');
await insertTranslationSpan(page, SRC_B, 'Kildaren');
await wait(page, 1800);

const live = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(s => ({
  lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, flow: s.dataset.flow || null,
  omni: s.dataset.omni || null, scr: s.dataset.scr || null, text: s.textContent,
})));
console.log('live spans:', JSON.stringify(live.map(s => ({ lang: s.lang, rom: s.rom })), null, 1));
ck('two live omni spans built through the real UI', live.length === 2 && live.every(s => s.omni === '1'));

await page.click('#ed-back'); await wait(page, 600);

// ---------------- EPUB ----------------
await page.click('#bk-share'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 12000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epubBuf = await readFile(await dl.path());
await writeFile(`${OUT}/book.epub`, epubBuf);
await wait(page, 500);
const files = unzipStored(epubBuf);
const css = Buffer.from(files.get('OEBPS/style.css') || '').toString('utf8');
await writeFile(`${OUT}/style.css`, css);
const nFonts = [...files.keys()].filter(n => /^OEBPS\/fonts\//.test(n)).length;
const nFaceText = (css.match(/@font-face/g) || []).length;
console.log(`\nstyle.css: ${css.length} B, ${nFaceText} @font-face written, ${nFonts} font files in the zip`);
const badFamily = /@font-face\{font-family:'[^']*'[^;{]/.test(css);
const apos = css.match(/font-family:'[^;]*'[^;]*'/g);
console.log('unbalanced-quote @font-face lines:', JSON.stringify((css.split('\n').filter(l => /@font-face/.test(l) && (l.match(/'/g) || []).length % 2 !== 0))));

// feed the exported CSS to a REAL css parser in the browser
const parsed = await page.evaluate(async cssText => {
  const count = t => {
    const s = document.createElement('style'); s.textContent = t; document.head.appendChild(s);
    const sheet = s.sheet; const rules = [...sheet.cssRules];
    const r = { total: rules.length,
      faces: rules.filter(x => x.constructor.name === 'CSSFontFaceRule' || x.type === 5).length,
      lang: rules.filter(x => /\[data-lang=/.test(x.cssText || '')).length,
      flow: rules.filter(x => /data-flow/.test(x.cssText || '')).length };
    s.remove(); return r;
  };
  const asExported = count(cssText);
  // counterfactual: only change is escaping the ASCII apostrophe inside the
  // single-quoted family name
  // counterfactual done properly: restate the family as a DOUBLE-quoted string,
  // which needs no escaping at all. Re-escaping an already-escaped apostrophe
  // produced a broken sheet and made a correct export look like a regression.
  const fixed = count(cssText.replace(/font-family:'((?:[^'\\]|\\.)*)'/g,
    (m, fam) => `font-family:"${fam.replace(/\\'/g, "'")}"`));
  return { asExported, fixed };
}, css);
console.log('CSSOM as-exported        :', JSON.stringify(parsed.asExported));
console.log('CSSOM apostrophe-escaped :', JSON.stringify(parsed.fixed));
ck('exported style.css survives a real CSS parser intact',
   parsed.asExported.total === parsed.fixed.total && parsed.asExported.faces === nFaceText,
   `${parsed.asExported.total} rules survive of ${parsed.fixed.total}; faces ${parsed.asExported.faces}/${nFaceText}`);
ck('per-language and per-flow CSS survives the parser',
   parsed.asExported.lang > 0 && parsed.asExported.flow > 0,
   `lang=${parsed.asExported.lang} flow=${parsed.asExported.flow}`);

// ---------------- EPUB re-import ----------------
// SUPERSEDED: reading the re-imported span out of #ed-content raced the editor
// (a stale scene DOM answered instead of the imported one). The authoritative
// check reads the STORED doc straight out of IndexedDB and lives in
// tx-vf-reimport-engine.mjs — see that probe for the re-import verdict.

// ---------------- DOCX / TXT / MD source recoverability ----------------
await page.goto(srv.url + 'step1.html');
await wait(page, 3000);
await page.evaluate(() => { const r = document.querySelector('#lib-list .row'); if(r) r.click(); });
await wait(page, 1200);
await page.click('#bk-share'); await wait(page, 450);
const labels = await page.locator('#sheet .sh-item').allTextContents();
console.log('\nshare sheet:', JSON.stringify(labels.map(l => l.trim())));

async function grab(label){
  if(!(await page.locator('#sheet.show, #sheet').first().isVisible().catch(() => false)) || !(await page.locator('#sheet .sh-item', { hasText: label }).first().isVisible().catch(() => false))){
    await page.click('#bk-share'); await wait(page, 450);
  }
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 12000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await d.path());
  await wait(page, 400);
  return buf;
}
const md = (await grab('Markdown')).toString('utf8');
const txtB = (await grab('Plain text')).toString('utf8');
const docxBuf = await grab('Word');
const docxFiles = unzipStored(docxBuf);
let docXml = '';
try{ docXml = Buffer.from(docxFiles.get('word/document.xml') || '').toString('utf8'); }
catch(e){ docXml = ''; }
if(!docXml){
  // docx is deflate-zipped by some writers — fall back to python
  const { execFileSync } = await import('node:child_process');
  await writeFile(`${OUT}/book.docx`, docxBuf);
  docXml = execFileSync('python3', ['-c',
    'import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf8"))',
    `${OUT}/book.docx`], { encoding: 'utf8', maxBuffer: 64e6 });
}
await writeFile(`${OUT}/book.md`, md);
await writeFile(`${OUT}/book.txt`, txtB);
await writeFile(`${OUT}/document.xml`, docXml);

const romA = live[0].rom, romB = live[1].rom;
console.log('\nformat survey:');
for(const [name, body] of [['markdown', md], ['plain text', txtB], ['docx', docXml]]){
  console.log(`  ${name.padEnd(11)} bytes=${body.length} srcA=${body.includes(SRC_A)} srcB=${body.includes(SRC_B)} romA=${body.includes(romA)} romB=${body.includes(romB)} PUA=${(body.match(/[\uE000-\uF8FF]/g) || []).length}`);
}
ck('markdown keeps the English source', md.includes(SRC_A) && md.includes(SRC_B));
ck('plain text keeps the English source', txtB.includes(SRC_A) && txtB.includes(SRC_B),
   `srcA=${txtB.includes(SRC_A)} srcB=${txtB.includes(SRC_B)}`);
ck('docx keeps the English source', docXml.includes(SRC_A) && docXml.includes(SRC_B),
   `srcA=${docXml.includes(SRC_A)} srcB=${docXml.includes(SRC_B)}`);
ck('no raw PUA in md/txt/docx',
   !/[\uE000-\uF8FF]/.test(md) && !/[\uE000-\uF8FF]/.test(txtB) && !/[\uE000-\uF8FF]/.test(docXml));
ck('md/txt/docx carry the romanization',
   md.includes(romA) && txtB.includes(romA) && docXml.includes(romA));

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF EXPORT TRUTH', checks.every(c => c[1]) && errors.length === 0);
await browser.close();
await srv.close();
