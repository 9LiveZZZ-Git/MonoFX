// TX-12 follow-up — HOW WIDE is the "reload mid-flight" loss window?
// tx-hostile-race.mjs J2 showed a span placed through the real UI and then
// reloaded ~60 ms later is GONE after the reload. This probe measures the
// grace period: place a span, wait N ms, reload, see whether it survived.
// Also isolates the cause (500 ms scheduleSave debounce vs. the IndexedDB
// transaction not committing before teardown) by comparing a plain reload
// against an explicit pagehide+settle before the reload.
// Run: cd probes && node tx-reload-savewindow.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { verdict } from './ex-lib.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const wait = ms => page.waitForTimeout(ms);
const BODY = 'the sea remembers the old king and the lamp holds steady tonight';

const selectWord = w => page.evaluate(w => {
  const ed = document.querySelector('#ed-content');
  const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while((n = walk.nextNode())){
    const i = n.nodeValue.indexOf(w);
    if(i > -1){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
  }
  return false;
}, w);

async function openScene(){
  await page.locator('#lib-list .row[data-book]', { hasText: 'Window Book' }).click();
  await wait(600);
  await page.locator('.row[data-scene]').first().click();
  await wait(900);
}
async function resetScene(){
  await page.reload();
  await wait(3200);
  await openScene();
  await wait(1500);
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = '';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  });
  await page.keyboard.insertText(BODY);
  await wait(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await wait(500);
}
async function placeSpan(){
  await selectWord('lamp holds');
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(300);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(450);
  await page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#ed-content .tspan').length === 1, null, { timeout: 20000 });
}
const spans = () => page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(s => s.dataset.src));

// --- setup
await page.goto(srv.url + 'step1.html');
await wait(600);
await page.click('#lib-new');
await wait(400);
await page.fill('#ps-input', 'Window Book');
await page.click('#ps-save');
await wait(700);
await page.evaluate(() => document.querySelector('#ed-content').focus());
await page.keyboard.insertText(BODY);
await wait(1400);
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await wait(500);

const rows = [];
for(const delay of [0, 60, 200, 400, 600, 900, 1500]){
  await resetScene();
  await placeSpan();
  await wait(delay);
  await page.reload();
  await wait(3000);
  await openScene();
  await wait(1200);
  const s = await spans();
  rows.push({ delay, survived: s.length === 1 && s[0] === 'lamp holds', spans: s });
  console.log(`  reload +${String(delay).padEnd(5)}ms after the span lands -> ${s.length === 1 ? 'SURVIVED' : 'LOST'}  ${JSON.stringify(s)}`);
}

// control: an explicit pagehide + settle before reloading
await resetScene();
await placeSpan();
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await wait(400);
await page.reload();
await wait(3000);
await openScene();
await wait(1200);
const ctl = await spans();
console.log(`  pagehide + 400 ms settle, then reload      -> ${ctl.length === 1 ? 'SURVIVED' : 'LOST'}  ${JSON.stringify(ctl)}`);

// control 2: is this translation-specific, or does plain typing lose the same way?
await resetScene();
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.keyboard.insertText(' TAILWORD');
await wait(60);
await page.reload();
await wait(3000);
await openScene();
await wait(1200);
const typed = await page.evaluate(() => document.querySelector('#ed-content').innerText);
console.log(`  plain typing, reload +60 ms                 -> ${typed.includes('TAILWORD') ? 'SURVIVED' : 'LOST'}`);

// when does a placed span actually reach IndexedDB?
await resetScene();
await placeSpan();
const reachedAt = await page.evaluate(async () => {
  const read = () => new Promise(res => {
    const rq = indexedDB.open('tenebrae-writer', 1);
    rq.onsuccess = () => { const t = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state'); t.onsuccess = () => res(t.result); t.onerror = () => res(null); };
    rq.onerror = () => res(null);
  });
  const t0 = performance.now();
  for(let i = 0; i < 60; i++){
    const st = await read();
    const doc = st && st.books && st.books[0] && st.books[0].chapters[0] && st.books[0].chapters[0].scenes[0].doc;
    if(doc && doc.indexOf('tspan') > -1) return Math.round(performance.now() - t0);
    await new Promise(r => setTimeout(r, 100));
  }
  return -1;
});
console.log(`  span reaches IndexedDB after               -> ${reachedAt} ms (scheduleSave debounce is 500 ms, step1.html L1006)`);

const firstSafe = rows.find(r => r.survived);
console.log('\nsummary');
console.log('  loss window (span placed, then reloaded):',
  rows.filter(r => !r.survived).map(r => r.delay + 'ms').join(', ') || 'none');
console.log('  first delay that survives:', firstSafe ? firstSafe.delay + 'ms' : 'none of the delays tested');
console.log('  explicit pagehide control:', ctl.length === 1 ? 'survives' : 'ALSO LOST');
console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-12 RELOAD SAVE WINDOW (a translation must never be lost to a reload)',
  rows.every(r => r.survived) && errors.length === 0);
await browser.close();
await srv.close();
