// PR-1 (supplement to st-editor-save.mjs) — "the complete state (books, cards,
// codex, options) survives reload". st-editor-save proves books/structure;
// this probe proves cards and per-book export options through the real UI,
// and shows they ride in the same single kv['state'] object that flushSave()
// snapshots (step1.html L997), which is also where state.codex lives.
// Run: cd probes && node st-full-state-persist.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

const readState = () => page.evaluate(() => new Promise(res => {
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

// book (lands in editor), back to book screen
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Full State Book');
await page.click('#ps-save');
await T(700);
await page.click('#ed-back');
await T(500);

// --- toggle two export options away from their defaults
// defaults (L957): chapterTitles:true, sceneTitles:false, asterism:true
await page.click('#bk-share');
await T(400);
await page.locator('#sheet button', { hasText: 'Include scene titles' }).click(); // false -> true
await T(400);
await page.locator('#sheet button', { hasText: '⁂ between scenes' }).click();     // true -> false
await T(400);
await page.locator('#scrim').click({ position: { x: 10, y: 10 } });
await T(500);

// --- create a card through the cards screen
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(400);
await page.fill('#ps-input', 'Vessel of Ash');
await page.click('#ps-save');
await T(700);
const onCard = await page.evaluate(() => document.querySelector('#scr-card').classList.contains('on'));
console.log('after card create: card screen open =', onCard);

// --- persist + reload
await T(1400);
await page.reload();
await T(800);

const st = await readState();
const b = st && st.books && st.books.find(x => x.title === 'Full State Book');
console.log('persisted state keys:', st ? JSON.stringify(Object.keys(st)) : st);
console.log('book found:', !!b,
  '| exportOpts:', b ? JSON.stringify(b.exportOpts) : null,
  '| cards:', b ? JSON.stringify((b.cards || []).map(c => ({ title: c.title, type: c.type }))) : null);
console.log('state.codex slot (sample codex active => absent/null):', st ? JSON.stringify(st.codex ?? null) : st);

// --- and the UI reflects it: card list + export sheet checkmarks after reload
await page.locator('#lib-list .row', { hasText: 'Full State Book' }).click();
await T(600);
const cardsRow = await page.locator('#bk-cardsrow').innerText();
console.log('book screen cards row:', JSON.stringify(cardsRow.replace(/\n/g, ' | ')));
await page.click('#bk-share');
await T(400);
const checks = await page.$$eval('#sheet .sh-item', els =>
  els.map(e => ({ label: e.textContent.trim().slice(0, 26), checked: e.classList.contains('checked') })));
console.log('export sheet after reload:', JSON.stringify(checks.slice(0, 3)));

const optsOK = b && b.exportOpts && b.exportOpts.chapterTitles === true &&
  b.exportOpts.sceneTitles === true && b.exportOpts.asterism === false;
const cardOK = b && b.cards && b.cards.length === 1 && b.cards[0].title === 'Vessel of Ash';
const uiOK = /Vessel of Ash|1 card/i.test(cardsRow) &&
  checks[0] && checks[0].checked === true &&  // chapter titles (default)
  checks[1] && checks[1].checked === true &&  // scene titles (toggled on)
  checks[2] && checks[2].checked === false;   // asterism (toggled off)
console.log('summary: optsPersisted=', !!optsOK, 'cardPersisted=', !!cardOK, 'uiReflects=', uiOK);
console.log((optsOK && cardOK && uiOK) ? 'PR-1(full-state) VERDICT: PASS' : 'PR-1(full-state) VERDICT: FAIL');

await browser.close();
await srv.close();
