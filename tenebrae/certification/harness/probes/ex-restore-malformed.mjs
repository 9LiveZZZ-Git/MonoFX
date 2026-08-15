// PR-5 (adversarial) — depth of restore validation.
// offerRestore (step1.html L4120-4144) validates only {app tag, state,
// Array.isArray(state.books)} and then assigns `state = st` WITHOUT the boot
// path's migration guard (L4289-4300) that backfills chapters/cards/exportOpts.
// renderLibrary (L1163) dereferences b.chapters.length, so a backup whose
// books array holds a chapter-less object is accepted by validation, persisted
// by flushSave, and only then crashes the render.
// This probe feeds: (A) state.books not an array -> must be rejected with the
// toast; (B) books:[{id,title}] with no chapters -> observes whether the
// confirm sheet accepts it, whether a pageerror fires, what the library shows,
// and whether the app recovers after reload (boot migration re-fills fields).
// Run: cd probes && node ex-restore-malformed.mjs
import { writeFile } from 'node:fs/promises';
import { launch, wait, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

const { srv, browser, page, errors } = await launch();

const restoreVia = async filePath => {
  await page.click('#lib-more'); await wait(page, 450);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
  ]);
  await chooser.setFiles(filePath);
  await wait(page, 700);
};

// (A) books is not an array -> validation must reject
const aPath = SCRATCH + '/restore-books-not-array.json';
await writeFile(aPath, JSON.stringify({ app: 'tenebrae-writer', version: 2, state: { books: {} } }));
await restoreVia(aPath);
const toastA = await page.locator('#toast').innerText();
const confirmA = await page.$('#cs-yes');
console.log('A: toast:', JSON.stringify(toastA), '| confirm sheet shown:', !!confirmA);
checks.push(has('non-array books rejected before the confirm sheet',
  /Tenebrae backup/i.test(toastA) && !confirmA));

// (B) books array holding a chapter-less book object -> passes shallow
// validation; what happens next?
const bPath = SCRATCH + '/restore-chapterless-book.json';
await writeFile(bPath, JSON.stringify({
  app: 'tenebrae-writer', version: 2,
  state: { version: 2, books: [{ id: 'b1', title: 'Half Book' }], codex: null },
}));
const errsBefore = errors.length;
await restoreVia(bPath);
const confirmB = await page.$('#cs-yes');
console.log('B: confirm sheet shown for chapter-less book:', !!confirmB);
if (confirmB) { await page.click('#cs-yes'); await wait(page, 900); }
const errsAfterRestore = errors.slice(errsBefore);
const libAfter = (await page.locator('#scr-library').innerText()).replace(/\n+/g, ' | ');
console.log('B: pageerrors during restore:', errsAfterRestore.length ? errsAfterRestore : 'none');
console.log('B: library after restore:', JSON.stringify(libAfter.slice(0, 200)));
const restoredCleanly = errsAfterRestore.length === 0 && libAfter.includes('Half Book');
checks.push(has('chapter-less backup restores without a pageerror (or is rejected)',
  restoredCleanly || !confirmB));

// (C) whatever happened, the app must still be usable after reload
await wait(page, 1200);
await page.reload(); await wait(page, 900);
const errsReload = errors.slice(errsBefore + errsAfterRestore.length);
const libReload = (await page.locator('#scr-library').innerText()).replace(/\n+/g, ' | ');
console.log('C: pageerrors after reload:', errsReload.length ? errsReload : 'none');
console.log('C: library after reload:', JSON.stringify(libReload.slice(0, 200)));
// boot migration should have backfilled chapters -> row renders with 0 chapters
checks.push(has('app boots after malformed restore (no reload pageerror)', errsReload.length === 0));
checks.push(has('restored book visible after reload with migrated fields',
  libReload.includes('Half Book')));

// (D) the app is still writable: create another book on top
await page.click('#lib-new'); await wait(page, 400);
await page.fill('#ps-input', 'After Book'); await page.click('#ps-save');
await wait(page, 700);
const onEditor = await page.evaluate(() => document.querySelector('#scr-editor').classList.contains('on'));
checks.push(has('app still functional after the exercise', onEditor));

console.log('all pageerrors:', errors.length ? errors : 'none');
verdict('PR-5 malformed-restore', checks.every(Boolean));

await browser.close();
await srv.close();
