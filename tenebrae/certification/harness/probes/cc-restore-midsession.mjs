// COVERAGE GAP — PR-5 / PR-1: a restore that lands MID-SESSION.
//
// ex-backup-restore.mjs only ever restores into a FRESH browser context, so the
// one thing an author actually does — "today's work went wrong, put yesterday's
// backup back" — has never been tested. offerRestore (step1.html:6077-6106)
// installs the new state and then calls flushSave(), and flushSave's first act
// is persistEditor() + persistCard() (step1.html:1011-1017), which copy the
// LIVE editor/card DOM of the session being replaced into whatever record of
// the RESTORED state carries the same id. currentCardId is set in openCard
// (L4996) and cleared only on delete (L5125) — leaving the card screen does not
// clear it.
//
// Everything here is driven through the real UI: real book, real card, real
// "Back up everything (.json)", real file chooser, real confirm sheet.
// Run: cd probes && node cc-restore-midsession.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet } from './ex-lib.mjs';
import { readFile } from 'node:fs/promises';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3200); // let the codex wake + fonts forge

const openCards = async () => {
  await page.click('#bk-more'); await wait(page, 450);
  await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click(); await wait(page, 700);
};
const kvState = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const db = rq.result;
    const tx = db.transaction('kv', 'readonly').objectStore('kv').get('state');
    tx.onsuccess = () => res(tx.result || null);
    tx.onerror = () => res(null);
  };
  rq.onerror = () => res(null);
}));
const stateNow = async () => {
  const st = await kvState();
  const b = st && st.books && st.books[0];
  if(!b) return null;
  const sc = b.chapters[0].scenes[0];
  const cd = (b.cards || [])[0] || {};
  return { sceneTitle: sc.title, doc: sc.doc || '', cardTitle: cd.title, cardNotes: cd.notes || '' };
};

/* ---------- YESTERDAY: the state the author will want back ---------- */
await createBook(page, 'Ledger');
await page.click('#ed-title'); await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('ORIGINAL yesterday line the sea remembers here.');
await wait(page, 900);
await insertTranslationSpan(page, 'the sea remembers', 'Kildaren');
await wait(page, 900);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
await page.click('#ed-back'); await wait(page, 600);

await openCards();
await page.click('#cd-new'); await wait(page, 450);
await page.fill('#ps-input', 'Mara Veyl');
await page.click('#ps-save'); await wait(page, 800);
await page.click('#cc-notes'); await page.keyboard.type('ORIGINAL note.');
await wait(page, 900);
await page.click('#cc-back'); await wait(page, 500);
await page.click('#cd-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 600);

const before = await stateNow();
console.log('   YESTERDAY state:', JSON.stringify(before).slice(0, 320));
ck('setup: the backup will carry the original scene, span and card',
   /ORIGINAL yesterday line/.test(before.doc) && /tspan/.test(before.doc) && before.cardNotes.includes('ORIGINAL note'));

await page.click('#lib-more'); await wait(page, 500);
const bk = await downloadFromSheet(page, 'Back up everything (.json)');
const backupPath = SCRATCH + '/cc-midsession-backup.json';
await (await import('node:fs/promises')).writeFile(backupPath, bk.text);
const bkState = JSON.parse(bk.text).state.books[0];
console.log('   backup file:', bk.name, bk.text.length, 'bytes');
ck('the backup really holds the original card note',
   JSON.stringify(bkState.cards).includes('ORIGINAL note'));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

/* ---------- TODAY: the work the author wants to throw away ---------- */
await page.locator('#lib-list .row', { hasText: 'Ledger' }).click(); await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click(); await wait(page, 700);
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.keyboard.type('TODAY mistaken rewrite.');
await wait(page, 1200);
await page.click('#ed-title');
await page.keyboard.press('Control+a');
await page.keyboard.type('TODAY Title');
await wait(page, 1200);
await page.click('#ed-back'); await wait(page, 600);

await openCards();
await page.locator('#cd-list .row', { hasText: 'Mara Veyl' }).click(); await wait(page, 700);
await page.click('#cc-notes');
await page.keyboard.press('Control+a');
await page.keyboard.type('TODAY mistaken note.');
await wait(page, 1200);
await page.click('#cc-back'); await wait(page, 500);
await page.click('#cd-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 600);

const today = await stateNow();
console.log('   TODAY state:', JSON.stringify(today).slice(0, 320));
ck("setup: today's work really replaced yesterday's",
   /TODAY mistaken rewrite/.test(today.doc) && today.cardNotes.includes('TODAY mistaken note'));

/* ---------- the restore, mid-session, through the real chooser ---------- */
await page.click('#lib-more'); await wait(page, 500);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
]);
await chooser.setFiles(backupPath);
await wait(page, 800);
const confirmTxt = await page.locator('#sheet').innerText();
console.log('   confirm sheet:', JSON.stringify(confirmTxt.replace(/\s+/g, ' ').slice(0, 110)));
await page.click('#cs-yes');
await wait(page, 1800);

const after = await stateNow();
console.log('   AFTER RESTORE state:', JSON.stringify(after).slice(0, 400));
ck('restore brings the scene prose back', /ORIGINAL yesterday line/.test(after.doc) && !/TODAY mistaken rewrite/.test(after.doc), after.doc.slice(0, 160));
ck('restore brings the scene TITLE back', after.sceneTitle === 'First Light', after.sceneTitle);
ck('restore brings the translated span back', /tspan/.test(after.doc) && /data-lang="kildaren"/.test(after.doc));
ck("restore brings the card note back — today's note must be gone",
   after.cardNotes.includes('ORIGINAL note') && !after.cardNotes.includes('TODAY mistaken note'), JSON.stringify(after.cardNotes));

/* what the author sees, and what survives to disk */
await wait(page, 1200);
await page.reload(); await wait(page, 3200);
const persisted = await stateNow();
console.log('   AFTER RELOAD state:', JSON.stringify(persisted).slice(0, 400));
ck('the restored card note is what got persisted',
   String(persisted.cardNotes).includes('ORIGINAL note') && !String(persisted.cardNotes).includes('TODAY mistaken note'), JSON.stringify(persisted.cardNotes));
ck('the restored scene is what got persisted', /ORIGINAL yesterday line/.test(persisted.doc), persisted.doc.slice(0, 120));

await page.locator('#lib-list .row', { hasText: 'Ledger' }).click(); await wait(page, 600);
await openCards();
const cardRow = await page.locator('#cd-list').innerText();
await page.locator('#cd-list .row', { hasText: 'Mara Veyl' }).click(); await wait(page, 700);
const notesSeen = await page.locator('#cc-notes').innerText();
console.log('   card screen after restore+reload:', JSON.stringify(notesSeen));
ck('the card the author opens shows the restored note', notesSeen.includes('ORIGINAL note'), notesSeen);

/* ---------- is it recoverable? restore the SAME file again, in the same session ---------- */
const toLibrary = async () => {
  for(const sel of ['#cc-back', '#cd-back', '#ed-back', '#bk-back']){
    for(let i = 0; i < 2; i++){
      if(await page.locator(sel).isVisible().catch(() => false)){ await page.click(sel); await wait(page, 500); }
    }
  }
};
await toLibrary();
await page.click('#lib-more'); await wait(page, 500);
const [ch2] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
]);
await ch2.setFiles(backupPath);
await wait(page, 800);
await page.click('#cs-yes'); await wait(page, 1800);
const twice = await stateNow();
console.log('   AFTER A SECOND RESTORE:', JSON.stringify(twice.cardNotes));
ck('restoring the same backup again recovers the card note', String(twice.cardNotes).includes('ORIGINAL note'), JSON.stringify(twice.cardNotes));

/* ---------- and the diagnosis: a reload first (which clears the dangling ids) fixes it ---------- */
await page.reload(); await wait(page, 3400);
await toLibrary();
await page.click('#lib-more'); await wait(page, 500);
const [ch3] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
]);
await ch3.setFiles(backupPath);
await wait(page, 800);
await page.click('#cs-yes'); await wait(page, 1800);
const afterReload = await stateNow();
console.log('   RESTORE AFTER A RELOAD:', JSON.stringify(afterReload.cardNotes));
ck('CONTROL: the same restore works when the session has not opened the card (post-reload)',
   String(afterReload.cardNotes).includes('ORIGINAL note'), JSON.stringify(afterReload.cardNotes));

console.log('pageerrors:', errors.length ? errors : 'none');
console.log('\ncc-RESTORE-MIDSESSION VERDICT:', checks.every(Boolean) && !errors.length ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.every(Boolean) ? 'none' : checks.filter(x => !x).length);
await browser.close();
await srv.close();
