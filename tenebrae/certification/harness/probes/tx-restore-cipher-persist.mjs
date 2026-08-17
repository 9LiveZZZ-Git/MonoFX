// TX-1 follow-up — how far the restore-path cipher fallback goes, and whether
// it survives the next boot.
//
// tx-engine-always.mjs [E2..E4] showed that offerRestore (step1.html L4866-4869)
// applies the boot guard's REJECT half — "drop a codex that fails validation" —
// without the boot guard's REPAIR half (L5044: `if(!state.codex) state.codex =
// embeddedCodexPack()`). So restoring any backup whose state has no usable
// codex leaves state.codex === null, and codexActive() (L2869) then returns
// SAMPLE_CODEX: the placeholder shift cipher becomes the live engine.
//
// offerRestore then calls rerenderAllSpans() (L4877) which, with no omni pack,
// regenerates every existing span through makeTSpan -> translateText -> the
// sample cipher, and scheduleSave()s the result (L3509).
//
// This probe measures the damage and its persistence: the span's stored
// romanization before restore, right after restore, and after a full reload
// (by which point the boot guard has put the codex back).
// Run: cd probes && node tx-restore-cipher-persist.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { wait } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const BK = SCRATCH + '/tx-backup-span-no-codex.json';
const PHRASE = 'The sea remembers';
const TRUE_ROM = 'mara memora'; // codex ground truth, re-verified below

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pageA = await browser.newPage();
await pageA.goto('file://' + SCRATCH + '/tx-codex-patched.html');
await pageA.waitForFunction(() => typeof window.translateE2C === 'function', null, { timeout: 40000 });
const trueRom = await pageA.evaluate(p => window.translateE2C(p).filter(x => x.cel && !x.drop).map(x => x.cel).join(' '), PHRASE);
ck('codex ground truth unchanged', trueRom === TRUE_ROM, trueRom);

const SPAN_DOC = '<p>the tide line</p><p>a span: <span class="tspan" data-lang="celan_basic" '
  + `data-src="${PHRASE}" data-rom="${trueRom}" data-omni="1" contenteditable="false">${trueRom}</span> ends here.</p>`;
await writeFile(BK, JSON.stringify({
  app: 'tenebrae-writer', version: 3, exportedAt: '2026-01-01T00:00:00.000Z',
  state: { version: 3, lastLang: 'celan_basic', tsv: 2, books: [{
    id: 'bk9', title: 'Span Book', created: 1, updated: 1, paraStyle: 'spaced', cards: [],
    chapters: [{ id: 'ch9', title: 'Chapter 1', scenes: [{ id: 'sc9', title: 'Scene', status: 'draft', doc: SPAN_DOC, words: 6, updated: 1 }] }]
  }] }
}, null, 2));

const srv = await startServer();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.goto(srv.url + 'step1.html');
await wait(page, 3500);

// restore through the real UI
await page.click('#lib-more');
await wait(page, 400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
]);
await chooser.setFiles(BK);
await wait(page, 900);
await page.click('#cs-yes');
await wait(page, 3000);

const openSpan = async () => {
  await page.locator('#scr-library [data-book]').first().click();
  await wait(page, 800);
  await page.locator('#scr-book [data-scene]').first().click();
  await wait(page, 1800);
  const sp = await page.evaluate(() => {
    const s = document.querySelector('#ed-content .tspan');
    return s ? { lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, omni: s.dataset.omni || null,
                 pua: [...s.textContent].filter(c => c.charCodeAt(0) >= 0xE000).length, text: s.textContent } : null;
  });
  // and what is actually SAVED in state (not just what the DOM shows)
  const stored = await page.evaluate(() => {
    const doc = window.tenebrae._omni.probe.sceneDoc();
    const m = doc && doc.match(/data-rom="([^"]*)"/);
    return { rom: m ? m[1] : null, hasOmni: !!(doc && /data-omni/.test(doc)) };
  });
  return { sp, stored };
};

const after = await openSpan();
console.log('span right after restore:', JSON.stringify(after));
const engine = await page.evaluate(async () => {
  const c = window.tenebrae.codex();
  const r = await window.tenebrae.translate2('celan_basic', 'The sea remembers');
  return { name: c.name, sample: !!c.sample, rom: r && r.romanization };
});
console.log('engine after restore:', JSON.stringify(engine));
ck('the restore left the sample cipher as the live engine (the defect under test)',
   engine.sample === true, JSON.stringify(engine));
ck('the existing span still carries the codex romanization', after.sp && after.sp.rom === trueRom,
   `rom=${JSON.stringify(after.sp && after.sp.rom)} want ${JSON.stringify(trueRom)}`);
ck('the existing span is still marked as a codex span (data-omni)', !!(after.sp && after.sp.omni),
   JSON.stringify(after.sp));
ck('the SAVED scene doc still carries the codex romanization', after.stored.rom === trueRom,
   JSON.stringify(after.stored));

// reload: the boot guard puts the embedded codex back — is the span repaired?
await page.reload();
await wait(page, 4000);
const engine2 = await page.evaluate(async () => {
  const c = window.tenebrae.codex();
  const r = await window.tenebrae.translate2('celan_basic', 'The sea remembers');
  return { name: c.name, sample: !!c.sample, embedded: !!c.embedded, rom: r && r.romanization };
});
console.log('engine after reload:', JSON.stringify(engine2));
ck('the next boot repairs the ENGINE (embedded codex back)', engine2.sample === false && engine2.rom === trueRom, JSON.stringify(engine2));
const after2 = await openSpan();
console.log('span after reload:', JSON.stringify(after2));
ck('the span recovers its codex romanization after the reboot', after2.sp && after2.sp.rom === trueRom,
   `rom=${JSON.stringify(after2.sp && after2.sp.rom)} want ${JSON.stringify(trueRom)}`);
ck('the English source survives regardless (round-trip is not lost)',
   !!after2.sp && after2.sp.src === PHRASE, JSON.stringify(after2.sp && after2.sp.src));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('RESTORE-CIPHER-PERSISTENCE VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
