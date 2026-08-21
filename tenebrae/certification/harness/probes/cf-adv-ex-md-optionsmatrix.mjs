// ADVERSARY / TX-11b — "Re-importing one of our files reproduces its
// chapter/scene structure exactly."
//
// The auditor swept the IMPORT split-rule control (#imp-seg). Nobody swept the
// EXPORT options, which decide what our own markdown actually contains:
// 'Include chapter titles' and 'Include scene titles' are both first-class
// toggles on the export sheet (step1.html L2178-2181), and chapterTitles
// changes which heading LEVEL the importer reads as a chapter.
//
// The book here is deliberately CLEAN — no in-scene ⁂ — so the only variable is
// the export options. Structure (chapter count, scenes per chapter) must
// survive every combination; titles must survive whenever they were written.
//
// Run: cd probes && node cf-adv-ex-md-optionsmatrix.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfopts';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + l + (x === undefined ? '' : '  ' + String(x).slice(0, 300))); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3000);

const snapLast = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => { const bs = r.result.books; const b = bs[bs.length-1];
      res({ title: b.title, chapters: b.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) })) }); };
    r.onerror = () => res(null); };
}));
const snapFirst = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => { const b = r.result.books[0];
      res({ title: b.title, chapters: b.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) })) }); };
    r.onerror = () => res(null); };
}));

await createBook(page, 'Options Book');
await page.click('#ed-title'); await page.keyboard.type('First Light');
await page.click('#ed-content'); await page.keyboard.type('alpha prose line');
await wait(page, 1400); await page.click('#ed-back'); await wait(page, 800);
await page.locator('.chapter-block').first().locator('.add').click(); await wait(page, 800);
await page.click('#ed-title'); await page.keyboard.type('Second Sight');
await page.click('#ed-content'); await page.keyboard.type('beta prose line');
await wait(page, 1400); await page.click('#ed-back'); await wait(page, 800);
await page.click('#bk-more'); await wait(page, 500);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click(); await wait(page, 500);
await page.fill('#ps-input', 'The Second Gate'); await page.click('#ps-save'); await wait(page, 1200);
await page.locator('.chapter-block').nth(1).locator('.add').click(); await wait(page, 900);
await page.click('#ed-title'); await page.keyboard.type('Third Watch');
await page.click('#ed-content'); await page.keyboard.type('gamma prose line');
await wait(page, 1500); await page.click('#ed-back'); await wait(page, 1200);

const WANT = await snapFirst();
console.log('ORIGINAL:', JSON.stringify(WANT));

const setOpt = async (label, on) => {
  const it = page.locator('#sheet .sh-item', { hasText: label }).first();
  const isOn = await it.evaluate(el => el.classList.contains('checked'));
  if(isOn !== on){ await it.click(); await wait(page, 500); }
  const now = await page.locator('#sheet .sh-item', { hasText: label }).first()
    .evaluate(el => el.classList.contains('checked'));
  return now === on;
};

const COMBOS = [[true,true],[true,false],[false,true],[false,false]];
const files = [];
for(const [chT, scT] of COMBOS){
  await page.click('#bk-share'); await wait(page, 700);
  const okA = await setOpt('Include chapter titles', chT);
  const okB = await setOpt('Include scene titles', scT);
  ck(`option toggles reachable: chapterTitles=${chT} sceneTitles=${scT}`, okA && okB);
  const { text } = await downloadFromSheet(page, 'Markdown (.md)');
  const name = `${OUT}/opt-${chT?1:0}${scT?1:0}.md`;
  await writeFile(name, text);
  files.push({ chT, scT, name, text });
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 500);
}
for(const f of files) console.log(`\n===== chapterTitles=${f.chT} sceneTitles=${f.scT} =====\n` + f.text);

if(await page.locator('#bk-back').isVisible().catch(()=>false)){ await page.click('#bk-back'); await wait(page, 800); }

for(const f of files){
  await page.click('#lib-more'); await wait(page, 550);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await chooser.setFiles(f.name);
  await page.waitForSelector('#imp-go', { timeout: 20000 });
  await wait(page, 700);
  const stats = await page.locator('.imp-stats').innerText();
  await page.click('#imp-go'); await wait(page, 3000);
  const got = await snapLast();
  for(const sel of ['#ed-back', '#bk-back']){
    if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 700); } }
  const shape = c => JSON.stringify(c.chapters.map(x => x.s.length));
  console.log(`\nchapterTitles=${f.chT} sceneTitles=${f.scT} | preview "${stats.replace(/\n/g,' ')}"`);
  console.log('  ROUNDTRIP:', JSON.stringify(got));
  ck(`chapterTitles=${f.chT} sceneTitles=${f.scT}: chapter/scene COUNTS round-trip`,
     shape(got) === shape(WANT), `${shape(got)} vs ${shape(WANT)}`);
  if(f.chT) ck(`chapterTitles=${f.chT} sceneTitles=${f.scT}: chapter titles round-trip`,
     JSON.stringify(got.chapters.map(c=>c.t)) === JSON.stringify(WANT.chapters.map(c=>c.t)),
     JSON.stringify(got.chapters.map(c=>c.t)));
  if(f.chT && f.scT) ck(`chapterTitles=1 sceneTitles=1: the WHOLE structure is exact (TX-11b's literal claim)`,
     JSON.stringify(got.chapters) === JSON.stringify(WANT.chapters), JSON.stringify(got.chapters));
}

ck('no page exceptions', errors.length === 0, errors.slice(0,4).join(' | '));
console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11b ADVERSARY: export-option matrix', checks.every(c => c[1]));
console.log('FAILED:', checks.filter(c => !c[1]).map(c => c[0]));
await browser.close(); await srv.close();
