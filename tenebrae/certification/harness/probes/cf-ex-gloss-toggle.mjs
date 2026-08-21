// TX-11 (the clause nobody probed) — "exportOpts.sourceGloss, on by default,
// togglable from the export sheet." Verifies the toggle actually governs BOTH
// glossable formats (.txt and .docx), in BOTH scopes (book and single scene),
// that it persists across a reload, and that with the gloss OFF the .docx
// romanization run is still its own italic run and no PUA leaks anywhere.
//
// Run: cd probes && node cf-ex-gloss-toggle.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfgloss';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra)); return ok; };

const { srv, browser, page, errors } = await launch();

function unzipStored(buf){
  const out = new Map();
  for(let i = 0; i < buf.length - 3; i++){
    if(buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const csize = buf.readUInt32LE(i + 18);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    out.set(name, buf.slice(start, start + csize));
    i = start + csize - 1;
  }
  return out;
}
const grabDocx = async () => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#sheet .sh-item', { hasText: 'Download Word (.docx)' }).click(),
  ]);
  const buf = await readFile(await dl.path());
  await wait(page, 600);
  return new TextDecoder().decode(unzipStored(buf).get('word/document.xml'));
};

await createBook(page, 'Gloss Book');
await page.click('#ed-title');
await page.keyboard.type('Tide Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight');
await wait(page, 400);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1700);

/* ---------- scene scope, gloss ON (default) ---------- */
await page.click('#ed-share');
await wait(page, 500);
let label = await page.locator('#sheet .sh-item', { hasText: 'English gloss' }).innerText();
console.log('sheet item (scene scope):', JSON.stringify(label));
ck('the gloss toggle is offered on the SCENE export sheet too', /English gloss in \.txt \/ \.docx/.test(label));
const sTxtOn = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('scene txt (gloss on):', JSON.stringify(sTxtOn.text));
ck('scene .txt: gloss ON prints the English bracketed after the romanization',
   /mara memora \[sea remembers\]/.test(sTxtOn.text) && !PUA_RE.test(sTxtOn.text));

await page.click('#ed-share'); await wait(page, 500);
const sDocxOn = await grabDocx();
ck('scene .docx: gloss ON is a separate upright run after the italic romanization',
   /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">mara memora<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> \[sea remembers\]<\/w:t><\/w:r>/.test(sDocxOn));

/* ---------- turn it OFF from the sheet ---------- */
await page.click('#ed-share'); await wait(page, 500);
await page.locator('#sheet .sh-item', { hasText: 'English gloss' }).click();
await wait(page, 600);
const sTxtOff = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('scene txt (gloss off):', JSON.stringify(sTxtOff.text));
ck('scene .txt: gloss OFF drops the bracketed English but keeps the romanization',
   /mara memora/.test(sTxtOff.text) && !/\[sea remembers\]/.test(sTxtOff.text) && !PUA_RE.test(sTxtOff.text));

await page.click('#ed-share'); await wait(page, 500);
const sDocxOff = await grabDocx();
ck('scene .docx: gloss OFF keeps the italic romanization run and drops the gloss run',
   /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">mara memora<\/w:t><\/w:r>/.test(sDocxOff) &&
   !sDocxOff.includes('[sea remembers]') && !PUA_RE.test(sDocxOff));

/* ---------- book scope honours the same flag ---------- */
await page.click('#ed-back'); await wait(page, 700);
await page.click('#bk-share'); await wait(page, 550);
const bTxtOff = await downloadFromSheet(page, 'Download plain text (.txt)');
ck('book .txt: the flag set from the scene sheet governs the book export too',
   /mara memora/.test(bTxtOff.text) && !/\[sea remembers\]/.test(bTxtOff.text));

/* ---------- and it persists across a reload ---------- */
await page.reload();
await wait(page, 4000);
await page.locator('#lib-list button.row', { hasText: 'Gloss Book' }).first().click();
await wait(page, 900);
await page.click('#bk-share'); await wait(page, 550);
const persisted = await page.locator('#sheet .sh-item', { hasText: 'English gloss' }).getAttribute('class');
const bTxtAfter = await downloadFromSheet(page, 'Download plain text (.txt)');
ck('gloss OFF persists across reload', !/\[sea remembers\]/.test(bTxtAfter.text) && /mara memora/.test(bTxtAfter.text),
   JSON.stringify(persisted));

await page.click('#bk-share'); await wait(page, 550);
await page.locator('#sheet .sh-item', { hasText: 'English gloss' }).click();
await wait(page, 600);
const bTxtBack = await downloadFromSheet(page, 'Download plain text (.txt)');
ck('turning it back ON restores the gloss', /mara memora \[sea remembers\]/.test(bTxtBack.text));

/* ---------- markdown must be unaffected: it has the marker instead ---------- */
await page.click('#bk-share'); await wait(page, 550);
const bMd = await downloadFromSheet(page, 'Download Markdown (.md)');
ck('markdown keeps the source in the marker regardless of the gloss flag',
   /<!--tenebrae:begin \{"language":"celan_basic","source":"sea remembers"\}-->mara memora<!--tenebrae:end-->/.test(bMd.text) &&
   !/\[sea remembers\]/.test(bMd.text));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11 gloss toggle', checks.every(c => c[1]) && errors.length === 0);
console.log('FAILED CHECKS:', checks.filter(c => !c[1]).map(c => c[0]));

await browser.close();
await srv.close();
