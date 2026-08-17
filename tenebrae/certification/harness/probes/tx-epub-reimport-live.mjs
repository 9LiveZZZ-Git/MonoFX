// TX-10 (round-trip half) — "re-importing restores live spans with source intact."
//
// tx-epub-allscripts.mjs showed the re-imported spans carry the wrong tongue and
// the wrong romanization. This probe follows one re-imported span all the way
// through the app to establish WHAT it is now: does opening the scene upgrade
// it? does a reload? what does its tap sheet say? and is it the sample cipher
// or the codex? The comparison baseline is a span created the normal way, in
// the same session, from the same English.
//
// Run: cd probes && node tx-epub-reimport-live.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx10rt';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL '), label, extra === undefined ? '' : extra); };

const SRC = 'the sea remembers the old king';
const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

// baseline: what the codex says, and what the legacy sample cipher says
const REF = await page.evaluate(async src => {
  const first = await window.tenebrae.translate2('celan_high', src);
  const codex = await window.tenebrae.translate2('celan_high', src);
  window.__firstRom = first.romanization;
  const sample = window.tenebrae.translate('celan_high', src);
  const sample2 = window.tenebrae.translate('celan-basic', src);
  return { firstRom: first.romanization, codexRom: codex.romanization, codexLang: codex.lang.id, codexFlow: codex.flow,
           sampleRom: sample.romanization, sampleLang: sample.lang.id,
           sampleBasicRom: sample2.romanization, sample2Lang: sample2.lang.id };
}, SRC);
// sanity: the writer's romanization IS the codex's own compileText output
// (TX-2's territory; recorded because every comparison below leans on it)
const PARITY = await page.evaluate(async src => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX, T = C.TRANS.celan_high;
  const res = C.compileText(T, src, 'e2l');
  const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
  return { codexOwn: lines.map(l => l.map(p => p.t).join(' ')).join(' '),
           writer: (await window.tenebrae.translate2('celan_high', src)).romanization };
}, SRC);
console.log('codex compileText  ->', JSON.stringify(PARITY.codexOwn));
console.log('writer translate2  ->', JSON.stringify(PARITY.writer));
ck('note: writer romanization == codex compileText for this phrase', PARITY.writer === PARITY.codexOwn);

console.log('codex  celan_high call#1 ->', JSON.stringify(REF.firstRom));
console.log('codex  celan_high call#2 ->', JSON.stringify(REF.codexRom), `[${REF.codexLang} / ${REF.codexFlow}]`);
ck('codex translate2 is stable between the first and second call', REF.firstRom === REF.codexRom);
console.log('sample celan_high ->', JSON.stringify(REF.sampleRom), `[falls back to ${REF.sampleLang}]`);
ck('baseline: codex and legacy sample disagree (so the two are distinguishable)', REF.codexRom !== REF.sampleRom);

await createBook(page, 'TX10 Round Trip');
await page.click('#ed-title'); await page.keyboard.type('One Span');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type(SRC + ' here');
await wait(page, 400);
await insertTranslationSpan(page, SRC, 'Celan High');
await wait(page, 1800);
await page.click('#ed-back'); await wait(page, 600);

await page.click('#bk-share'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
await writeFile(`${OUT}/book.epub`, await readFile(await dl.path()));
await wait(page, 500);

// ---- re-import through the real UI ----
if(await page.$('#scr-book.on')) { await page.click('#bk-back'); await wait(page, 500); }
await page.click('#lib-more'); await wait(page, 400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(`${OUT}/book.epub`);
await page.waitForSelector('#imp-go', { timeout: 15000 });
await wait(page, 400);
const seg = await page.$('#imp-seg button[data-mode="h"]'); if(seg){ await seg.click(); await wait(page, 500); }
await page.click('#imp-go');
await wait(page, 1600);

// open the LAST book, then its first scene, in the real UI
// (commitImport usually lands on the new book already)
const openLastBook = async () => {
  if(await page.$('#scr-book.on')) return;
  await page.locator('#lib-list button.row[data-book]').last().click();
  await wait(page, 800);
};
await openLastBook();
await page.locator('#bk-list button.row[data-scene]').first().click();
await wait(page, 2500); // plenty of time for decorateAll + engine

const afterOpen = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp ? { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, omni: sp.dataset.omni || null,
                flow: sp.dataset.flow || null, scr: sp.dataset.scr || null, text: sp.textContent,
                family: getComputedStyle(sp).fontFamily, wm: getComputedStyle(sp).writingMode } : null;
});
console.log('after opening the scene:', JSON.stringify(afterOpen));
ck('TX-10 the re-imported span survives into the editor', !!afterOpen);
ck('TX-10 opening the scene upgrades the span to the codex romanization',
   !!afterOpen && afterOpen.rom === PARITY.codexOwn, `${JSON.stringify(afterOpen && afterOpen.rom)} vs codex ${JSON.stringify(PARITY.codexOwn)}`);
ck('TX-10 the re-imported span keeps its tongue', !!afterOpen && afterOpen.lang === 'celan_high',
   afterOpen && afterOpen.lang);
ck('TX-10 the re-imported span keeps its flow (cols-rtl)', !!afterOpen && afterOpen.flow === REF.codexFlow,
   afterOpen && String(afterOpen.flow));
ck('TX-10 the re-imported span is still marked as a codex span', !!afterOpen && afterOpen.omni === '1',
   afterOpen && String(afterOpen.omni));
console.log('   rendered with font-family:', afterOpen && afterOpen.family, 'writing-mode:', afterOpen && afterOpen.wm);
ck('TX-10 the re-imported span renders in the codex-forged face',
   !!afterOpen && /Tenebrae Omni Celan High/.test(afterOpen.family), afterOpen && afterOpen.family);

// the decisive identification: whose engine wrote the restored romanization?
console.log('legacy sample celan-basic ->', JSON.stringify(REF.sampleBasicRom));
ck('TX-10 the restored span is NOT the legacy sample cipher output',
   !!afterOpen && afterOpen.rom !== REF.sampleBasicRom,
   `restored=${JSON.stringify(afterOpen && afterOpen.rom)} legacySample=${JSON.stringify(REF.sampleBasicRom)}`);

// ---- reload: does persistence heal it? ----
await page.reload();
await wait(page, 4000);
const afterReload = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const tpl = document.createElement('template');
      tpl.innerHTML = b.chapters[0].scenes[0].doc || '';
      const sp = tpl.content.querySelector('.tspan');
      res(sp ? { lang: sp.dataset.lang, rom: sp.dataset.rom, omni: sp.dataset.omni || null, src: sp.dataset.src } : null);
    };
  };
}));
console.log('after reload (stored doc):', JSON.stringify(afterReload));
ck('TX-10 a reload heals the re-imported span', !!afterReload && afterReload.rom === PARITY.codexOwn,
   `${JSON.stringify(afterReload && afterReload.rom)} vs codex ${JSON.stringify(PARITY.codexOwn)}`);
ck('TX-10 the English source survives all of it', !!afterReload && afterReload.src === SRC, afterReload && afterReload.src);

// ---- what the tap sheet reports for this span ----
if(!(await page.$('#scr-book.on'))){
  await page.locator('#lib-list button.row[data-book]').last().click();
  await wait(page, 900);
}
await page.locator('#bk-list button.row[data-scene]').first().click();
await wait(page, 2600);
const sheetInfo = await page.evaluate(async () => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return null;
  sp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const sh = document.querySelector('#sheet');
  const title = sh && sh.querySelector('.sh-title') ? sh.querySelector('.sh-title').textContent : null;
  const rom = sh && sh.querySelector('.ts-rom b') ? sh.querySelector('.ts-rom b').textContent : null;
  const inline = sp.dataset.rom;
  return { title, sheetRom: rom, inlineRom: inline };
});
console.log('tap sheet:', JSON.stringify(sheetInfo));
ck('TX-10 the tap sheet and the inline span agree on the romanization',
   !!sheetInfo && sheetInfo.sheetRom === sheetInfo.inlineRom,
   `sheet=${JSON.stringify(sheetInfo && sheetInfo.sheetRom)} inline=${JSON.stringify(sheetInfo && sheetInfo.inlineRom)}`);

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-10 EPUB round-trip liveness', checks.every(c => c[1]));
await browser.close();
await srv.close();
