// vp-sk-PR-5 — skeptic probe of the restore path's trust in scene docs.
// offerRestore validates shape (app tag + books array) but does NOT sanitize
// scene docs; openEditor sets edContent.innerHTML = s.doc directly. A crafted
// backup carrying <img onerror> in a doc would therefore execute on scene
// open. This probe demonstrates whether that vector is live (anomaly
// substantiation — PR-5's requirement text only demands validation + confirm
// guard, which are separately proven).
// Run: cd probes && node vp-sk-pr5-restore-hostile-doc.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

const backup = {
  app: 'tenebrae-writer', version: 1, exportedAt: '2026-08-15T00:00:00Z',
  state: {
    version: 1,
    books: [{
      id: 'bk1', title: 'Hostile Restore', goal: 0, paraStyle: 'spaced',
      exportOpts: { chapterTitles: true, sceneTitles: false, asterism: true },
      chapters: [{ id: 'ch1', title: 'Chapter 1', scenes: [{
        id: 'sc1', title: 'Trap', status: 'draft',
        doc: '<p>before</p><img src=x onerror="window.__restorePwn=1"><script>window.__restorePwn2=1<\/script><p onclick="1">after</p>',
        words: 2, updated: 1
      }]}],
      cards: [], created: 1, updated: 1
    }],
    codex: null, lastLang: null, tsv: 2
  }
};
const file = join(tmpdir(), 'vp-sk-hostile-backup.json');
writeFileSync(file, JSON.stringify(backup));

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

// restore through the real UI
await page.click('#lib-more');
await page.waitForTimeout(400);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('#sheet button', { hasText: 'Restore from backup' }).click(),
]);
await chooser.setFiles(file);
await page.waitForTimeout(600);
await page.click('#cs-yes'); // confirm restore
await page.waitForTimeout(800);

const lib = await page.locator('#lib-list').innerText();
console.log('library after restore:', JSON.stringify(lib.slice(0, 80)));

// open the hostile scene
await page.locator('#lib-list .row', { hasText: 'Hostile Restore' }).click();
await page.waitForTimeout(600);
await page.locator('#bk-list [data-scene]').first().click();
await page.waitForTimeout(900);

const res = await page.evaluate(() => ({
  pwnImg: window.__restorePwn || null,
  pwnScript: window.__restorePwn2 || null,
  edHTML: document.querySelector('#ed-content').innerHTML.slice(0, 200),
}));
console.log('img onerror executed:', res.pwnImg, '| script executed:', res.pwnScript);
console.log('editor DOM:', JSON.stringify(res.edHTML));

// after the editor debounce, what does the scene doc in IndexedDB hold?
await page.waitForTimeout(1600);
const stored = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => {
      const st = g.result;
      const sc = st && st.books && st.books[0] && st.books[0].chapters[0] && st.books[0].chapters[0].scenes[0];
      rq.result.close(); res(sc ? sc.doc : null);
    };
    g.onerror = () => { rq.result.close(); res('IDB-READ-ERROR'); };
  };
  rq.onerror = () => res('IDB-OPEN-ERROR');
}));
console.log('scene doc in IDB after the editor touched it:', JSON.stringify(stored));
console.log('pageerrors:', errors.length ? errors : 'none');

// Contract: ED-6 (certification/step1-requirements.md L37) — "foreign/pasted
// HTML is normalized to the app's schema; no script/style survives into a
// scene doc" — and PR-5 (L46) restore, which adopts a foreign state object.
// A backup file is foreign input; its scene docs are foreign HTML.
const checks = [];
const ok = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('restore actually ran (control: the hostile book is in the library)', /Hostile Restore/.test(lib));
ok('the prose itself survived the restore (control)', /before/.test(res.edHTML) && /after/.test(res.edHTML));
ok('no img onerror executed from a restored scene doc', res.pwnImg === null);
ok('no <script> element survived into the opened scene DOM', !/<script/i.test(res.edHTML));
ok('no inline event handler survived into the opened scene DOM', !/\son[a-z]+\s*=/i.test(res.edHTML));
ok('no script executed from a restored scene doc', res.pwnScript === null);
console.log('vp-sk-PR5-restore-hostile-doc VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
