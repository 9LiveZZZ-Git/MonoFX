// vp-ED-1 — adversarial re-test of the sharpest ED-1 claim: keystrokes YOUNGER
// than the 450ms editor debounce survive a visibilitychange flush. If flushSave
// did not call persistEditor() first, this exact sequence would lose the tail.
// Also re-checks: no explicit save button exists in the editor chrome, and the
// flushed state is read straight out of IndexedDB (not via the app's UI).
// Run: cd probes && node vp-ed1-flush-tail.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new'); await T(400);
await page.fill('#ps-input', 'Flush Book');
await page.click('#ps-save'); await T(700);

// no save button anywhere in the editor chrome
const chrome = await page.evaluate(() =>
  [...document.querySelectorAll('#scr-editor button, #fbar button')]
    .map(b => (b.title || b.textContent).trim().toLowerCase()));
const saveButtons = chrome.filter(t => /\bsave\b/.test(t));
console.log('editor buttons:', JSON.stringify(chrome.slice(0, 14)), '| save buttons:', JSON.stringify(saveButtons));

// settled base text (past both debounces)
await page.click('#ed-content');
await page.keyboard.type('settled base sentence here.');
await T(1600);

// tail typed and IMMEDIATELY hidden — no debounce is allowed to fire
await page.keyboard.type(' urgent tail xyzzy');
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await T(400); // just enough for the IDB put to commit

const doc = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result && g.result.books.find(x => x.title === 'Flush Book');
      const s = b && b.chapters[0] && b.chapters[0].scenes[0];
      res(s ? { doc: s.doc, words: s.words } : null);
    };
    g.onerror = () => res('idb-error');
  };
}));
console.log('IDB scene doc:', JSON.stringify(doc));
const tailKept = doc && typeof doc.doc === 'string' && doc.doc.includes('urgent tail xyzzy');
console.log('sub-debounce tail flushed to IndexedDB:', tailKept);

// and a cold reload sees it too
await page.reload(); await T(800);
await page.locator('#lib-list .row', { hasText: 'Flush Book' }).click(); await T(500);
await page.locator('#bk-list .row[data-scene]').first().click(); await T(600);
const body = await page.locator('#ed-content').innerText();
console.log('after reload editor body:', JSON.stringify(body));
const reloadKept = body.includes('settled base sentence here.') && body.includes('urgent tail xyzzy');

const ok = saveButtons.length === 0 && tailKept && reloadKept && errors.length === 0;
console.log('pageerrors:', errors.length);
console.log(ok ? 'vp-ED-1 VERDICT: PASS' : 'vp-ED-1 VERDICT: FAIL');

await browser.close();
await srv.close();
