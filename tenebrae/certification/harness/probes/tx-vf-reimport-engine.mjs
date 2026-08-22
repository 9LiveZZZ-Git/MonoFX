// TX-VF: WHICH ENGINE rebuilds a span on document re-import?
// Both prior reports claim EPUB/Markdown re-import rebuilds spans through the
// legacy SAMPLE cipher (step1.html:4292-4294 -> tspanHTML -> translateText).
// This probe reads the STORED doc straight out of IndexedDB after the import
// commits — no editor, no decorateAll, no chance of a live-DOM upgrade masking
// the stored bytes — for BOTH the EPUB and the Markdown route.
// Run: cd probes && node tx-vf-reimport-engine.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vf-reimport';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? '  ok   ' : '  FAIL '), label, extra === undefined ? '' : extra); };

const SRC_A = 'the sea remembers the old king alphamark';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, 'VF Reimport');
await page.click('#ed-title'); await page.keyboard.type('Faces');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter'); await page.keyboard.type(SRC_A);
await wait(page, 400);
await insertTranslationSpan(page, SRC_A, 'Celan High');
await wait(page, 1800);
await page.click('#ed-back'); await wait(page, 700);

const readState = () => page.evaluate(async () => {
  const req = indexedDB.open('tenebrae-writer', 1);
  const st = await new Promise(res => { req.onsuccess = () => {
    const g = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => res(g.result); g.onerror = () => res(null);
  }; req.onerror = () => res(null); });
  return (st && st.books || []).map(b => ({ title: b.title,
    docs: b.chapters.flatMap(c => c.scenes.map(s => s.doc)) }));
});

async function exportBook(label){
  await page.click('#bk-share'); await wait(page, 500);
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 12000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await d.path());
  await wait(page, 500);
  return buf;
}
async function importFile(path, title){
  await page.click('#bk-back'); await wait(page, 700);
  await page.click('#lib-more'); await wait(page, 450);
  await Promise.all([
    page.waitForEvent('filechooser').then(fc => fc.setFiles(path)),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await page.waitForSelector('#imp-go', { timeout: 15000 });
  await wait(page, 700);
  await page.fill('#imp-title', title);
  await page.click('#imp-go');
  await wait(page, 2600);
  await page.evaluate(() => { try{ window.dispatchEvent(new Event('pagehide')); }catch(e){} });
  await wait(page, 1200);
}

const epub = await exportBook('EPUB (.epub)');
await writeFile(`${OUT}/book.epub`, epub);
const md = await exportBook('Markdown');
await writeFile(`${OUT}/book.md`, md);

await importFile(`${OUT}/book.epub`, 'EPUB REIMPORT');
await importFile(`${OUT}/book.md`, 'MD REIMPORT');

const books = await readState();
console.log('books in storage:', JSON.stringify(books.map(b => b.title)));

const analyse = await page.evaluate(async books => {
  const out = [];
  const tpl = document.createElement('template');
  for(const b of books){
    for(const doc of b.docs){
      if(!doc || doc.indexOf('tspan') === -1) continue;
      tpl.innerHTML = doc;
      for(const s of tpl.content.querySelectorAll('.tspan')){
        const rec = { book: b.title, lang: s.dataset.lang, src: s.dataset.src,
          rom: s.dataset.rom, omni: s.dataset.omni || null, flow: s.dataset.flow || null,
          hasScr: !!s.dataset.scr, textLen: (s.textContent || '').length };
        try{ rec.sampleRom = window.tenebrae.translateSampleLegacy(s.dataset.lang, s.dataset.src).romanization; }catch(e){ rec.sampleRom = 'ERR'; }
        try{ const r = await window.tenebrae.translate2(s.dataset.lang, s.dataset.src); rec.codexRom = r && r.romanization; }catch(e){ rec.codexRom = 'ERR'; }
        rec.isSample = rec.rom === rec.sampleRom;
        rec.isCodex = rec.rom === rec.codexRom;
        out.push(rec);
      }
    }
  }
  return out;
}, books);

console.log('\nspans found in STORED docs:');
for(const r of analyse) console.log('  ', JSON.stringify(r));

for(const label of ['VF Reimport', 'EPUB REIMPORT', 'MD REIMPORT']){
  const rows = analyse.filter(r => r.book === label);
  if(!rows.length){ ck(`${label}: has a stored span`, false, 'none found'); continue; }
  ck(`${label}: stored span is CODEX output (not the sample cipher)`,
     rows.every(r => r.isCodex && !r.isSample),
     JSON.stringify(rows.map(r => ({ lang: r.lang, rom: r.rom, sample: r.sampleRom }))));
  ck(`${label}: stored span keeps data-omni`, rows.every(r => r.omni === '1'),
     JSON.stringify(rows.map(r => r.omni)));
  ck(`${label}: stored span keeps the tongue id celan_high`, rows.every(r => r.lang === 'celan_high'),
     JSON.stringify(rows.map(r => r.lang)));
  ck(`${label}: stored span keeps the PUA script text`, rows.every(r => r.hasScr),
     JSON.stringify(rows.map(r => r.hasScr)));
}

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF REIMPORT ENGINE', checks.every(c => c[1]) && errors.length === 0);
await browser.close();
await srv.close();
