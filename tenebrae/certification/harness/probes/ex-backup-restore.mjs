// PR-5 — Backup (full-state JSON download) and restore (file picker,
// validated, confirm-guarded).
// Context A: builds a book ("Backup Book", scene text, one card "Mara Veyl"),
// downloads the backup JSON via Library → "Back up everything (.json)" and
// verifies its shape (app tag, state.books with doc text, cards, codex and
// exportOpts fields). Context B (fresh storage): drives Library → "Restore
// from backup…" through the real file chooser; verifies (1) an invalid file
// is rejected with a toast and no confirm sheet, (2) the confirm sheet guards
// the real restore and Cancel leaves state untouched, (3) Restore brings back
// book + scene text + card, and the restored state survives a further reload.
// Run: cd probes && node ex-backup-restore.mjs
import { writeFile } from 'node:fs/promises';
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

const { srv, browser, context, page, errors } = await launch();

// --- build state in context A
await createBook(page, 'Backup Book');
await page.click('#ed-content');
await page.keyboard.type('alpha beta gamma');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// a card
await page.click('#bk-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click();
await wait(page, 600);
await page.click('#cd-new'); await wait(page, 400);
await page.fill('#ps-input', 'Mara Veyl');
await page.click('#ps-save'); await wait(page, 700);
await page.click('#cc-back'); await wait(page, 400);
await page.click('#cd-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);

// --- backup download from the library menu
await page.click('#lib-more'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Back up everything (.json)' }).click(),
]);
const backupPath = SCRATCH + '/tenebrae-backup-probe.json';
await dl.saveAs(backupPath);
console.log('backup file:', dl.suggestedFilename());
const { readFile } = await import('node:fs/promises');
const raw = await readFile(backupPath, 'utf8');
const data = JSON.parse(raw);
const st = data.state || {};
const bk = (st.books || [])[0] || {};
console.log('backup keys:', JSON.stringify(Object.keys(data)), '| state keys:', JSON.stringify(Object.keys(st)));
checks.push(
  has('payload tagged tenebrae-writer', data.app === 'tenebrae-writer'),
  has('payload carries exportedAt + version', typeof data.exportedAt === 'string' && 'version' in data),
  has('state.books present', Array.isArray(st.books) && st.books.length === 1 && bk.title === 'Backup Book'),
  has('scene doc text in backup', JSON.stringify(bk.chapters || []).includes('alpha beta gamma')),
  has('cards in backup', Array.isArray(bk.cards) && bk.cards.length === 1 && bk.cards[0].title === 'Mara Veyl'),
  has('card shape (type/aliases/keywords/notes)', bk.cards && 'type' in bk.cards[0] && 'aliases' in bk.cards[0] && 'keywords' in bk.cards[0] && 'notes' in bk.cards[0]),
  has('codex field in state', 'codex' in st),
  has('export options in backup', bk.exportOpts && 'chapterTitles' in bk.exportOpts && 'sceneTitles' in bk.exportOpts && 'asterism' in bk.exportOpts),
);

// --- context B: fresh storage
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const pb = await ctxB.newPage();
const errorsB = [];
pb.on('pageerror', e => { errorsB.push(e.message); console.log('PAGE B EXCEPTION:', e.message); });
await pb.goto(srv.url + 'step1.html');
await wait(pb, 800);
const libBefore = await pb.locator('#scr-library').innerText();
checks.push(has('fresh context starts empty', !libBefore.includes('Backup Book')));

const restoreVia = async filePath => {
  await pb.click('#lib-more'); await wait(pb, 450);
  const [chooser] = await Promise.all([
    pb.waitForEvent('filechooser', { timeout: 8000 }),
    pb.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
  ]);
  await chooser.setFiles(filePath);
  await wait(pb, 700);
};

// (1) invalid file → validation toast, no confirm sheet
const badPath = SCRATCH + '/not-a-backup.json';
await writeFile(badPath, JSON.stringify({ hello: 'world' }));
await restoreVia(badPath);
const toastText = await pb.locator('#toast').innerText();
const confirmShown = await pb.$('#cs-yes');
console.log('toast after invalid file:', JSON.stringify(toastText));
checks.push(
  has('invalid backup rejected with toast', /Tenebrae backup/i.test(toastText)),
  has('no confirm sheet for invalid file', !confirmShown),
);

// (2) real file → confirm sheet guards; Cancel leaves state untouched
await restoreVia(backupPath);
const sheetTxt = await pb.locator('#sheet').innerText();
console.log('confirm sheet:', JSON.stringify(sheetTxt.slice(0, 120)));
checks.push(has('confirm sheet appears with book count', /Restore this backup\?/.test(sheetTxt) && /1 book/.test(sheetTxt)));
await pb.click('#cs-no'); await wait(pb, 500);
const libAfterCancel = await pb.locator('#scr-library').innerText();
checks.push(has('cancel leaves state untouched', !libAfterCancel.includes('Backup Book')));

// (3) confirm → state comes back
await restoreVia(backupPath);
await pb.click('#cs-yes'); await wait(pb, 800);
const lib = await pb.locator('#lib-list').innerText();
console.log('library after restore:', JSON.stringify(lib.replace(/\n/g, ' | ')));
checks.push(has('book restored to library', lib.includes('Backup Book') && /3 words/.test(lib)));

await pb.locator('#lib-list .row', { hasText: 'Backup Book' }).click(); await wait(pb, 500);
await pb.locator('#bk-list .row[data-scene]').first().click(); await wait(pb, 500);
const body = await pb.locator('#ed-content').innerText();
checks.push(has('scene text restored', body.includes('alpha beta gamma')));
await pb.click('#ed-back'); await wait(pb, 400);
await pb.click('#bk-more'); await wait(pb, 400);
await pb.locator('#sheet .sh-item', { hasText: 'Cards' }).click(); await wait(pb, 600);
const cards = await pb.locator('#cd-list').innerText();
console.log('cards after restore:', JSON.stringify(cards.replace(/\n/g, ' | ').slice(0, 120)));
checks.push(has('card restored', cards.includes('Mara Veyl')));

// (4) restored state survives reload (persisted to IndexedDB)
await wait(pb, 1500);
await pb.reload(); await wait(pb, 800);
const lib2 = await pb.locator('#lib-list').innerText();
checks.push(has('restored state survives reload', lib2.includes('Backup Book')));

console.log('pageerrors A:', errors.length ? errors : 'none', '| pageerrors B:', errorsB.length ? errorsB : 'none');
verdict('PR-5', checks.every(Boolean) && errors.length === 0 && errorsB.length === 0);

await ctxB.close();
await browser.close();
await srv.close();
