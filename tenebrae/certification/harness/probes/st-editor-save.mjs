// ED-1 / PR-1 — title + body contenteditable editing with debounced autosave
// (no explicit save button); state lands in IndexedDB; full structure +
// title + body survive reload; visibilitychange flushes a pending save.
// Also probes what used to be the flush hole: keystrokes younger than the
// 450 ms editor debounce at the moment the page hides/reloads.
// CONTRACT UPDATE (2026-08 triage): flushSave() now calls persistEditor()
// before snapshotting state (step1.html L1011-1017), so sub-debounce
// keystrokes ARE carried into the flushed write. ED-1 ("edits autosave
// (debounced) and flush on visibilitychange") is therefore asserted here in
// full — the tail is a required check now, not a note.
// Run: cd probes && node st-editor-save.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

const readIDB = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => res('IDB-READ-ERROR');
  };
  rq.onerror = () => res('IDB-OPEN-ERROR');
}));

await page.goto(srv.url + 'step1.html');
await T(600);

// contenteditable + no explicit save button
const shape = await page.evaluate(() => ({
  titleCE: document.querySelector('#ed-title').getAttribute('contenteditable'),
  bodyCE: document.querySelector('#ed-content').getAttribute('contenteditable'),
  saveButtons: [...document.querySelectorAll('#scr-editor button, #fbar button')]
    .map(b => b.textContent.trim()).filter(t => /save/i.test(t)),
}));
console.log('editor shape:', JSON.stringify(shape));

// create book -> editor
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Persist Book');
await page.click('#ps-save');
await T(700);

// type title + two-paragraph body through the keyboard
await page.click('#ed-title');
await page.keyboard.type('The Tide Ledger');
await page.click('#ed-content');
await page.keyboard.type('The sea remembers what the ledger forgot.');
await page.keyboard.press('Enter');
await page.keyboard.type('Salt keeps the older accounts.');
await T(1400); // 450ms editor debounce + 500ms save debounce

// state must be in IndexedDB now (not merely in memory)
const idb1 = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => res('IDB-READ-ERROR');
  };
  rq.onerror = () => res('IDB-OPEN-ERROR');
}));
const s1 = idb1 && idb1.books && idb1.books[0] && idb1.books[0].chapters[0].scenes[0];
console.log('IDB after typing:', s1 ? JSON.stringify({
  book: idb1.books[0].title, sceneTitle: s1.title, words: s1.words,
  docHasP1: s1.doc.includes('The sea remembers what the ledger forgot.'),
  docHasP2: s1.doc.includes('Salt keeps the older accounts.'),
}) : JSON.stringify(idb1));

// live word count in editor (belongs to ED-4 but confirms autosave ran)
console.log('ed-count:', JSON.stringify(await page.locator('#ed-count').innerText()));

// --- reload: everything persisted?
await page.reload();
await T(800);
const lib = await page.locator('#lib-list').innerText();
console.log('library after reload:', JSON.stringify(lib.replace(/\n/g, ' | ')));
await page.locator('#lib-list .row', { hasText: 'Persist Book' }).click();
await T(600);
const rowTitle = await page.locator('#bk-list .row[data-scene] .t').first().innerText();
console.log('scene row after reload:', JSON.stringify(rowTitle));
await page.locator('#bk-list .row[data-scene]').first().click();
await T(600);
const edTitle = await page.locator('#ed-title').innerText();
const edBody = await page.locator('#ed-content').innerText();
console.log('editor after reload — title:', JSON.stringify(edTitle), '| body:', JSON.stringify(edBody.replace(/\n/g, ' \\n ')));

// --- visibilitychange flush: edit, let the 450ms editor debounce fire,
// then hide the page BEFORE the 500ms save debounce fires; reload fast.
await page.click('#ed-content');
await page.keyboard.type(' Flushed line.');
await T(700); // editor debounce fired -> persistEditor -> save pending (500ms)
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await T(150);
await page.reload();
await T(800);
const idb2 = await readIDB();
const s2 = idb2 && idb2.books && idb2.books[0].chapters[0].scenes[0];
console.log('flush-on-visibilitychange kept " Flushed line.":', s2 ? s2.doc.includes('Flushed line.') : idb2);

// --- the hole: keystrokes younger than the 450ms editor debounce when the
// page hides. flushSave() writes state, but persistEditor() has not copied
// the DOM into state yet — is the tail lost?
await page.locator('#lib-list .row', { hasText: 'Persist Book' }).click();
await T(600);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(600);
await page.click('#ed-content');
await page.keyboard.type(' TAIL-TEXT');
await page.evaluate(() => { // ~immediately, before the 450ms debounce
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await T(120);
await page.reload();
await T(800);
const idb3 = await readIDB();
const s3 = idb3 && idb3.books && idb3.books[0].chapters[0].scenes[0];
const tailKept = s3 ? s3.doc.includes('TAIL-TEXT') : null;
console.log('sub-debounce tail kept after hide+reload:', tailKept, '(false = last <450ms of typing lost)');

const checks = [];
const okc = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
okc('title + body are contenteditable', shape.titleCE === 'true' && shape.bodyCE === 'true');
okc('no explicit save button', shape.saveButtons.length === 0);
okc('debounced autosave reached IndexedDB', !!s1 && s1.title === 'The Tide Ledger' && s1.docHasP1 !== false && s1.docHasP2 !== false);
okc('structure + scene title survive reload', rowTitle === 'The Tide Ledger' && edTitle === 'The Tide Ledger');
okc('body survives reload', edBody.includes('The sea remembers what the ledger forgot.') && edBody.includes('Salt keeps the older accounts.'));
okc('visibilitychange flush keeps debounced-but-unsaved text', !!s2 && s2.doc.includes('Flushed line.'));
okc('visibilitychange flush keeps sub-debounce (<450ms) keystrokes', tailKept === true);
console.log(checks.every(Boolean) ? 'ED-1/PR-1 VERDICT: PASS' : 'ED-1/PR-1 VERDICT: FAIL');

await browser.close();
await srv.close();
