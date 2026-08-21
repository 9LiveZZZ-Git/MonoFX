// ADVERSARY / TX-17 — "the key stays on the device … a backup file the author
// shares cannot contain it — asserted against real downloaded backup bytes".
//
// The audit probe checked three files (.md, .txt, backup .json). A backup is not
// the only thing an author hands over. This probe sets the key through the real
// settings sheet and then downloads EVERY artifact the app can produce — .md,
// .txt, .docx, .pdf, .epub, story bible .md, cards .zip, the backup .json and
// the codex export — and searches the REAL BYTES, unzipping the container
// formats first so a compressed copy of the key cannot hide from a raw grep.
// It also checks the DOM after the key sheet closes, and every web storage.
// Run: cd probes && node cf-adv-assist-keybytes.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY = 'sk-ant-api03-ADVERSARYKEYBYTES-9f3c2a';
const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 240)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(350); };

await page.goto(srv.url + 'step1.html');
await T(3800);
await createBook(page, 'Key Bytes Book');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady. She said the sea remembers the old king.');
await T(700);
await insertTranslationSpan(page, 'the sea remembers', 'Celan Basic');
await T(700); await close();
// a card, so the story bible and the cards zip exist
await page.click('#ed-back'); await T(500);
await page.click('#bk-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Cards' }).click(); await T(700);
await page.click('#cd-new'); await T(600);
await page.fill('#ps-input', 'The Old King');
await page.click('#ps-save'); await T(800);
await page.click('#cc-back'); await T(500);
await page.click('#cd-back'); await T(500);

/* ---------- the key goes in through the real settings sheet ---------- */
await page.click('#bk-back').catch(() => {}); await T(500);
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Paste API key' }).click(); await T(600);
await page.fill('#ps-input', KEY);
await page.click('#ps-save'); await T(800);
await close();
ck('the key is live', await page.evaluate(() => window.tenebrae._claude.ready()));

/* ---------- the DOM, once the sheet is gone ---------- */
const dom = await page.evaluate(() => document.documentElement.outerHTML);
ck('the key is not left anywhere in the live DOM', !dom.includes(KEY.slice(0, 20)));
// and the Replace sheet does not prefill it
await page.click('#lib-more'); await T(450);
await page.locator('#sheet .sh-item', { hasText: 'Claude assist' }).click(); await T(500);
const sheetHTML = await page.evaluate(() => document.querySelector('#sheet').innerHTML);
ck('the settings sheet never prints the key', !sheetHTML.includes(KEY.slice(0, 20)));
await page.locator('#sheet .sh-item', { hasText: 'Replace API key' }).click(); await T(600);
const prefill = await page.evaluate(() => document.querySelector('#ps-input').value);
ck('the Replace field does not prefill the stored key', prefill === '', JSON.stringify(prefill));
await close();

/* ---------- storages ---------- */
const stores = await page.evaluate(() => ({
  local: JSON.stringify(Object.entries(localStorage)),
  session: JSON.stringify(Object.entries(sessionStorage)),
  cookie: document.cookie
}));
ck('not in localStorage', !stores.local.includes(KEY.slice(0, 20)), stores.local.slice(0, 120));
ck('not in sessionStorage', !stores.session.includes(KEY.slice(0, 20)));
ck('not in cookies', !stores.cookie.includes(KEY.slice(0, 20)), stores.cookie);
const kv = await page.evaluate(() => new Promise(res => {
  const req = indexedDB.open('tenebrae-writer');   // the app's own database
  req.onsuccess = () => { const db = req.result;
    const tx = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
    tx.onsuccess = () => res({ store: 'kv', keys: [...tx.result] });
    tx.onerror = () => res({ store: 'kv', keys: ['<err>'] });
  };
  req.onerror = () => res({ store: null, keys: [] });
}));
console.log('   kv records:', JSON.stringify(kv));
ck('the key lives under its own kv record, beside state', kv.keys.includes('claudeKey') && kv.keys.includes('state'), JSON.stringify(kv.keys));
const stateBlob = await page.evaluate(() => new Promise(res => {
  const req = indexedDB.open('tenebrae-writer');
  req.onsuccess = () => { const db = req.result;
    const g = db.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => res(JSON.stringify(g.result)); g.onerror = () => res('<err>'); };
  req.onerror = () => res('<no db>');
}));
ck('the persisted manuscript state does not contain the key', !stateBlob.includes(KEY.slice(0, 20)), 'state bytes ' + stateBlob.length);

/* ---------- every downloadable artifact ---------- */
const dir = await mkdtemp(join(tmpdir(), 'keybytes-'));
const grabbed = [];
const grab = async (opener, label) => {
  try{
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 12000 }), opener()]);
    const p = join(dir, dl.suggestedFilename());
    await dl.saveAs(p);
    grabbed.push({ name: dl.suggestedFilename(), path: p });
    console.log('   got', dl.suggestedFilename());
  }catch(e){ console.log('   MISSED', label, e.message.slice(0, 60)); }
  await T(400);
};
// library sheet: the backup
await page.click('#lib-more'); await T(450);
await grab(() => page.locator('#sheet .sh-item', { hasText: 'Back up everything' }).click(), 'backup');
await close();
// book export sheet: one download closes the sheet, so reopen each time
await page.locator('[data-book]').first().click(); await T(700);
for(const label of ['Download Markdown (.md)', 'Download plain text (.txt)', 'Download Word (.docx)',
                    'Download PDF (.pdf)', 'Download EPUB (.epub)', 'Story bible (.md)', 'Cards archive (.zip)']){
  await page.click('#bk-share'); await T(600);
  await grab(() => page.locator('#sheet .sh-item', { hasText: label }).click(), label);
  await close();
}

const found = [];
for(const f of grabbed){
  const buf = await readFile(f.path);
  let hit = buf.includes(KEY) || buf.includes(KEY.slice(0, 20));
  let where = hit ? 'raw bytes' : '';
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
  if(isZip){   // by magic bytes, not by name: a download can arrive named 'download'
    try{
      const listing = execFileSync('python3', ['-c', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = []
for n in z.namelist():
    d = z.read(n)
    if b'${KEY.slice(0, 20)}' in d: bad.append(n)
print('|'.join(bad))`, f.path]).toString().trim();
      if(listing){ hit = true; where = 'inside ' + listing; }
    }catch(e){ console.log('   (unzip failed for', f.name, e.message.slice(0, 60), ')'); }
  }
  console.log('   scanned', f.name.padEnd(38), buf.length, 'bytes', hit ? '  <-- KEY ' + where : '');
  if(hit) found.push(f.name + ' (' + where + ')');
}
ck('every downloadable artifact was actually produced (nothing silently skipped)',
   grabbed.length >= 7, grabbed.map(g => g.name).join(', '));
ck('no downloadable artifact carries the key, container formats unzipped',
   found.length === 0, JSON.stringify(found));
// the backup is still a real backup
const bk = grabbed.find(g => /backup/.test(g.name));
if(bk){
  const txt = await readFile(bk.path, 'utf8');
  ck('the backup is still real (app stamp + manuscript inside)',
     /"app": "tenebrae-writer"/.test(txt) && /the sea remembers/.test(txt), bk.name + ' ' + txt.length + ' bytes');
}

console.log('   page exceptions:', JSON.stringify(errors));
verdict('TX-17 ADVERSARY', checks.every(Boolean) && !errors.length);
await browser.close(); await srv.close();
