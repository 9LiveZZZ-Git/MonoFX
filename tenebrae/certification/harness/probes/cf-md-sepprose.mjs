// cf-md-sepprose — TX-11b: a line of the AUTHOR'S OWN PROSE that merely looks
// like a separator.
//
// Found by the refuter on ex-md-mapping. Nothing in the suite ever types an
// asterism — every one comes from the toolbar's #fb-break button, which makes a
// div.asterism the exporter can mark. A paragraph the author TYPES as "⁂", or
// "#", or a rule of dashes, serialized as a bare line, and SEP_TEXT read it
// back as a scene break: the scene split and the paragraph was DELETED. That is
// TX-11b's "reproduces its chapter/scene structure exactly" failing on our own
// file, through ordinary writing.
//
// Everything here is typed. The book is exported, re-imported through the real
// import sheet, and read back out of IndexedDB.
// Run: cd probes && node cf-md-sepprose.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/sepprose';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const { srv, browser, page, errors } = await launch();

const snap = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('tenebrae-writer', 1);
  req.onsuccess = () => {
    const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    r.onsuccess = () => {
      const st = r.result;
      resolve(!st ? [] : st.books.map(b => ({
        title: b.title,
        chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc })) }))
      })));
    };
    r.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));
const text = doc => String(doc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// the lines an author might actually type that SEP_TEXT would claim
const LINES = ['⁂', '#', '---', '• • •'];

await createBook(page, 'Sep Prose');
await page.click('#ed-title');
await page.keyboard.type('Only Scene');
await page.click('#ed-content');
await page.keyboard.type('first prose line');
for(const l of LINES){
  await page.keyboard.press('Enter');
  await page.keyboard.type(l);
}
await page.keyboard.press('Enter');
await page.keyboard.type('last prose line');
await wait(page, 700);

// leave the editor first: typing lands in state on a 500 ms debounce and in
// IndexedDB after that, and #ed-back flushes both
await page.click('#ed-back'); await wait(page, 900);
const before = await snap();
const beforeBook = before[before.length - 1];
console.log('typed doc:', JSON.stringify(beforeBook.chapters[0].scenes[0].doc));
const beforeText = text(beforeBook.chapters[0].scenes[0].doc);
ck('setup: every typed line is in the scene',
   LINES.every(l => beforeText.includes(l)) && beforeText.includes('first prose line') && beforeText.includes('last prose line'),
   JSON.stringify(beforeText));
ck('setup: the toolbar was never used, so nothing is a div.asterism',
   !/asterism/.test(beforeBook.chapters[0].scenes[0].doc || ''), beforeBook.chapters[0].scenes[0].doc);

await page.click('#bk-share'); await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md ---\n' + md.text + '\n---------------');
await writeFile(OUT + '/sepprose.md', md.text);

// every separator-shaped line the author typed must say it is prose
for(const l of LINES){
  ck(`"${l}" is written as prose, not as a bare separator line`,
     md.text.includes(l + '<!--tenebrae:prose-->') || !new RegExp('^' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm').test(md.text),
     JSON.stringify(md.text.split('\n').filter(x => x.includes(l.charAt(0))).slice(0, 4)));
}

// re-import our own file through the real sheet
await page.click('#bk-back').catch(() => {});
await wait(page, 500);
await page.click('#lib-more'); await wait(page, 450);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(OUT + '/sepprose.md');
await page.waitForSelector('#imp-go', { timeout: 15000 });
await wait(page, 500);
const stats = await page.locator('.imp-stats').innerText();
console.log('preview stats:', JSON.stringify(stats));
await page.click('#imp-go');
await wait(page, 2200);

const after = await snap();
const book = after[after.length - 1];
console.log('re-imported:', JSON.stringify(book, null, 1).slice(0, 900));
const scenes = book.chapters.reduce((n, c) => n + c.scenes.length, 0);
ck('the scene is not split by the author’s own prose', scenes === 1, scenes + ' scenes');
const back = text(book.chapters.map(c => c.scenes.map(s => s.doc).join(' ')).join(' '));
for(const l of LINES){
  ck(`"${l}" survives the round-trip as the author’s line`, back.includes(l), JSON.stringify(back));
}
ck('the prose around it survives too',
   back.includes('first prose line') && back.includes('last prose line'), JSON.stringify(back));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('SEPARATOR-SHAPED PROSE', checks.every(c => c[1]) && errors.length === 0);
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
