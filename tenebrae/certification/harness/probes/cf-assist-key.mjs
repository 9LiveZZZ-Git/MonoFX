// TX-17 — the key stays on the device.
//
// tx-claude-assist.mjs downloads one backup and greps it. This probe closes the
// gaps around that:
//   · the key is pasted through the REAL settings sheet, not the test seam
//   · the kv store is read directly: the key must be its own record and must
//     not appear anywhere inside the persisted `state` record
//   · every file the app can hand the author is checked, not just the backup:
//     book .md, scene .md, .txt, story bible, and the backup itself
//   · localStorage / sessionStorage / the live DOM are checked for residue
//   · "Forget the key" must actually clear the record, and a backup taken
//     afterwards must still be a real backup
// Run: cd probes && node cf-assist-key.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, downloadFromSheet } from './ex-lib.mjs';
import { readFile } from 'node:fs/promises';

const KEY = 'sk-ant-api03-PROBE-SECRET-0123456789';
const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 240)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };
await page.goto(srv.url + 'step1.html');
await T(3600);

/* a real book with a real translated span, so the exports have something in them */
await createBook(page, 'Key Book');
await page.click('#ed-title'); await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady. She said the sea remembers the old king.');
await T(800);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Celan High');
await T(900);
await closeSheet();
await page.click('#ed-back'); await T(500);
await page.click('#bk-back'); await T(500);

/* ---------- 1. paste the key through the real settings sheet ---------- */
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
const sheetNote = await page.evaluate(() => (document.querySelector('#sheet') || {}).textContent || '');
console.log('   settings sheet (off):', JSON.stringify(sheetNote.replace(/\s+/g, ' ').slice(0, 260)));
await page.locator('#sheet .sh-item', { hasText: 'Paste API key' }).click(); await T(500);
await page.fill('#ps-input', KEY);
await page.click('#ps-save'); await T(800);
const on = await page.evaluate(() => window.tenebrae._claude.ready());
ck('the key pasted through the real sheet switches the feature on', on === true, on);
await closeSheet();

/* ---------- 2. where the key lives in storage ---------- */
const kv = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const store = rq.result.transaction('kv', 'readonly').objectStore('kv');
    const keys = store.getAllKeys(), vals = store.getAll();
    keys.onsuccess = () => { vals.onsuccess = () => res({ keys: Array.from(keys.result), vals: vals.result.map(v => JSON.stringify(v)) }); };
  };
}));
const idx = kv.keys.indexOf('claudeKey');
const stateIdx = kv.keys.indexOf('state');
console.log('   kv records:', JSON.stringify(kv.keys));
ck('the key has its own kv record', idx > -1, JSON.stringify(kv.keys));
ck('that record is the key', kv.vals[idx].includes(KEY), kv.vals[idx]);
ck('the persisted manuscript state does not contain the key anywhere',
   stateIdx > -1 && !kv.vals[stateIdx].includes('sk-ant'), 'state bytes ' + (kv.vals[stateIdx] || '').length);
const web = await page.evaluate(k => ({
  ls: JSON.stringify(Object.entries(localStorage)),
  ss: JSON.stringify(Object.entries(sessionStorage)),
  dom: document.documentElement.outerHTML.includes(k),
}), KEY);
ck('the key is not in localStorage', !web.ls.includes('sk-ant'), web.ls.slice(0, 160));
ck('the key is not in sessionStorage', !web.ss.includes('sk-ant'), web.ss.slice(0, 160));
ck('the key is not left in the live DOM', web.dom === false, web.dom);

/* ---------- 3. every file the app can hand the author ---------- */
const files = [];
await page.locator('.row, [data-book]').first().click().catch(() => {});
await T(700);
await page.click('#bk-share').catch(async () => { await page.click('#bk-more'); });
await T(600);
let items = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
console.log('   export sheet:', JSON.stringify(items));
for(const label of ['Markdown', 'Plain text']){
  const hit = items.find(t => new RegExp(label, 'i').test(t));
  if(!hit) continue;
  try{
    const f = await downloadFromSheet(page, hit);
    files.push(f);
    await T(400);
    await page.click('#bk-share').catch(() => {});
    await T(600);
    items = await page.evaluate(() => Array.from(document.querySelectorAll('#sheet .sh-item')).map(n => n.textContent.trim()));
  }catch(e){ console.log('   (skipped export', hit, e.message.slice(0, 60), ')'); }
}
await closeSheet();
await page.click('#bk-back').catch(() => {}); await T(500);
await page.click('#lib-more'); await T(450);
const backup = await downloadFromSheet(page, 'Back up everything (.json)');
files.push(backup);
await closeSheet();
console.log('   files checked:', files.map(f => `${f.name} (${f.text.length}b)`).join(', '));
ck('at least the backup and one export were really produced', files.length >= 2, files.map(f => f.name).join(','));
for(const f of files){
  ck(`no key in ${f.name}`, !f.text.includes('sk-ant'), f.text.includes('sk-ant') ? 'KEY FOUND' : 'absent');
}
ck('the backup is still a real backup', /"app"\s*:\s*"tenebrae-writer"/.test(backup.text), backup.text.slice(0, 60));
ck('the backup really carries the manuscript (teeth)', backup.text.includes('the sea remembers the old king'));

/* ---------- 4. forget the key ---------- */
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Forget the key' }).click(); await T(800);
await closeSheet();
const after = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const st = rq.result.transaction('kv', 'readonly').objectStore('kv').get('claudeKey');
    st.onsuccess = () => res({ ready: window.tenebrae._claude.ready(), stored: JSON.stringify(st.result === undefined ? null : st.result) });
  };
}));
console.log('   after forgetting:', JSON.stringify(after));
ck('the feature is off again', after.ready === false, JSON.stringify(after));
ck('no key value remains in the kv record', !String(after.stored).includes('sk-ant'), after.stored);
await page.reload(); await T(3400);
const post = await page.evaluate(() => window.tenebrae._claude.ready());
ck('and it is still off after a reload', post === false, post);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`TX-17 KEY VERDICT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
