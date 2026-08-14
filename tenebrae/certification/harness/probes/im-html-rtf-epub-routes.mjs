// IM-1 — remaining import routes: .html, .rtf, .epub each reach the correct
// parser (the preview's kind label is per-parser: HTML / Rich text / EPUB) and
// produce the expected structure. The .epub is committed end-to-end; .html and
// .rtf previews are cancelled after verification. Also proves the .doc guard
// (legacy Word is rejected with a toast, not routed).
//
// Expected (hand-counted):
//   glass-comet.html  -> HTML       · title "The Glass Comet" (from <title>),
//                        2 chapters (Arrival, Reckoning), 3 scenes (<hr> split), 20 words
//   salt-ledger.rtf   -> Rich text  · title "salt ledger" (filename),
//                        2 chapters ("Chapter N" lines), 3 scenes ("* * *"), 20 words
//   salt-road.epub    -> EPUB       · title "The Salt Road" (OPF dc:title),
//                        2 chapters (spine chbreaks; nav skipped), 2 scenes, 22 words
// Run: cd probes && node im-html-rtf-epub-routes.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = name => join(HERE, 'fixtures', name);

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let pageErrors = 0;
page.on('pageerror', e => { pageErrors++; console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

async function previewOf(file){
  await page.setInputFiles('#import-input', file);
  await page.waitForSelector('#imp-go', { timeout: 15000 });
  await T(400);
  return {
    src: await page.locator('.imp-src').innerText(),
    title: await page.inputValue('#imp-title'),
    stats: await page.locator('.imp-stats').innerText(),
    tree: (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '),
  };
}
async function cancel(){
  await page.click('#imp-cancel');
  await T(500);
}

// --- HTML route
const html = await previewOf(FX('glass-comet.html'));
console.log('html preview:', JSON.stringify(html, null, 2));
const htmlOK =
  /glass-comet\.html · HTML/.test(html.src) &&
  html.title === 'The Glass Comet' &&
  /2 chapters · 3 scenes · 20 words/.test(html.stats) &&
  /Arrival/.test(html.tree) && /Reckoning/.test(html.tree);
console.log('HTML route OK:', htmlOK);
await cancel();

// --- RTF route
const rtf = await previewOf(FX('salt-ledger.rtf'));
console.log('rtf preview:', JSON.stringify(rtf, null, 2));
const rtfOK =
  /salt-ledger\.rtf · Rich text/.test(rtf.src) &&
  rtf.title === 'salt ledger' &&
  /2 chapters · 3 scenes · 20 words/.test(rtf.stats) &&
  /Chapter 1/.test(rtf.tree) && /Chapter 2/.test(rtf.tree);
console.log('RTF route OK:', rtfOK);
await cancel();

// --- EPUB route, committed end-to-end
const epub = await previewOf(FX('salt-road.epub'));
console.log('epub preview:', JSON.stringify(epub, null, 2));
const epubOK =
  /salt-road\.epub · EPUB/.test(epub.src) &&
  epub.title === 'The Salt Road' &&
  /2 chapters · 2 scenes · 22 words/.test(epub.stats) &&
  /Deadwater/.test(epub.tree) && /Milepost/.test(epub.tree);
console.log('EPUB route OK:', epubOK);

await page.click('#imp-go');
await T(900);
const book = {
  title: await page.locator('#bk-title').innerText(),
  sub: await page.locator('#bk-sub').innerText(),
  stat: await page.locator('#bk-stat').innerText(),
  chapters: await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent)),
};
console.log('epub book after commit:', JSON.stringify(book, null, 2));
const epubCommitOK =
  book.title === 'The Salt Road' &&
  /2 chapters/.test(book.sub) && /2 scenes/.test(book.sub) && /22 words/.test(book.stat) &&
  book.chapters.join('|') === 'Deadwater|Milepost';
console.log('EPUB commit matches preview:', epubCommitOK);

await page.click('#bk-list .row[data-scene]');
await T(600);
const edText = await page.locator('#ed-content').innerText();
const epubBodyOK = /The road tasted of salt and old iron for nine slow miles\./.test(edText);
console.log('epub scene body intact:', epubBodyOK);
await page.click('#ed-back'); await T(400);
await page.click('#bk-back'); await T(400);

// --- legacy .doc is rejected with a toast, not mis-routed
const docPath = join(HERE, 'fixtures', 'legacy.doc');
writeFileSync(docPath, 'not a real word file');
await page.setInputFiles('#import-input', docPath);
await T(600);
const toastText = await page.locator('#toast').innerText();
const sheetEmpty = await page.$eval('#sheet', el => el.innerText.trim() === '' || !el.classList.contains('show'));
const docOK = /\.doc files aren.t supported/.test(toastText) && sheetEmpty;
console.log('legacy .doc toast:', JSON.stringify(toastText), '| no preview opened:', sheetEmpty);

const ok = htmlOK && rtfOK && epubOK && epubCommitOK && epubBodyOK && docOK && pageErrors === 0;
console.log(ok ? 'IM-ROUTES VERDICT: PASS' : 'IM-ROUTES VERDICT: FAIL');

await browser.close();
await srv.close();
