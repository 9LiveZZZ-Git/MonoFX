// vf-ED-1 — adversarial re-check of the "flush on visibilitychange" hole.
//
// CONTRACT UPDATE (2026-08 triage): the hole this probe was written to
// substantiate has been CLOSED. flushSave() now pulls the editor DOM into
// state before snapshotting:
//   step1.html L1011-1017
//     function flushSave(){
//       // keystrokes younger than the input debounce live only in the editor
//       // DOM — pull them into state before snapshotting, or a hide+discard
//       // loses them
//       try{ persistEditor(); persistCard(); }catch(e){}
//       clearTimeout(saveTimer); saveTimer = null;
//       kvSet('state', JSON.parse(JSON.stringify(state)));
//     }
// So the probe's assertion is inverted to the governing contract, ED-1
// ("edits autosave (debounced) and flush on visibilitychange",
// certification/step1-requirements.md L30): a page hidden mid-keystroke must
// carry the tail into the flushed IndexedDB write. Same three measurements,
// same rigour (no reload anywhere — the flushed write is read directly);
// only the expected sign changed.
// The original probe (st-editor-save.mjs) reloaded 120ms after dispatching the
// hidden visibilitychange; a skeptic could argue the reload raced the IDB
// write. This probe avoids reload entirely for the core assertion:
//   1. type a tail, dispatch visibilitychange(hidden) IMMEDIATELY (inside the
//      450ms editor debounce), wait 400ms for the kv transaction to settle,
//      read IDB directly -> if the flushed write lacks the tail, a page killed
//      at that moment (the exact scenario the flush exists for) loses it.
//   2. control: keep the page alive, wait out 450+500ms debounces, read IDB
//      again -> tail present, proving the DOM had it and only the flush missed
//      it (not a typing/selector failure).
//   3. control 2: text older than the 450ms debounce at hide time IS captured
//      by the flush (the flush works for already-persisted state).
// Run: cd probes && node vf-ed1-flush.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

const readDoc = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => {
      const st = g.result;
      const s = st && st.books && st.books[0] && st.books[0].chapters[0] && st.books[0].chapters[0].scenes[0];
      rq.result.close();
      res(s ? s.doc : null);
    };
    g.onerror = () => { rq.result.close(); res('IDB-READ-ERROR'); };
  };
  rq.onerror = () => res('IDB-OPEN-ERROR');
}));
const hide = () => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const unhide = () => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

await page.goto(srv.url + 'step1.html');
await T(600);
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Flush Book');
await page.click('#ps-save');
await T(700);

// Baseline paragraph, fully persisted (past both debounces).
await page.click('#ed-content');
await page.keyboard.type('anchor paragraph settled');
await T(1400);
const base = await readDoc();
console.log('baseline persisted:', base !== null && base.includes('anchor paragraph settled'));

// CONTROL 2: text older than the editor debounce at hide time.
await page.keyboard.type(' aged-text');
await T(700); // 450ms editor debounce fired -> in state; 500ms save pending
await hide();
await T(400); // let the flush transaction settle; NO reload
const c2 = await readDoc();
console.log('aged-text (>450ms old) captured by hidden flush:', c2 !== null && c2.includes('aged-text'));
await unhide();
await T(300);

// THE HOLE: keystrokes younger than 450ms when the page hides.
await page.click('#ed-content');
await page.keyboard.type(' tail-burst');
await hide();          // immediately — inside the 450ms editor debounce
await T(400);          // flush transaction has settled by now; NO reload
const holeDoc = await readDoc();
const tailInFlushedWrite = holeDoc !== null && holeDoc.includes('tail-burst');
console.log('tail-burst (<450ms old) present in the flushed IDB write:', tailInFlushedWrite);

// CONTROL 1: the same tail IS in the editor DOM and lands in IDB once the
// debounces run — the page just happened to survive this time.
await unhide();
const domHasTail = await page.evaluate(() => document.querySelector('#ed-content').innerText.includes('tail-burst'));
await T(1400);
const later = await readDoc();
console.log('tail-burst was in the editor DOM at hide time:', domHasTail);
console.log('tail-burst reaches IDB later via debounce (page survived):', later !== null && later.includes('tail-burst'));

console.log('pageerrors:', errors.length ? errors : 'none');
const checks = [];
const ok = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('baseline paragraph persisted', base !== null && base.includes('anchor paragraph settled'));
ok('aged text (>450ms) captured by the hidden flush', c2 !== null && c2.includes('aged-text'));
ok('the tail really was in the editor DOM at hide time (probe is honest)', domHasTail);
ok('sub-debounce tail (<450ms) IS in the flushed write — no data loss on hide+discard', tailInFlushedWrite);
ok('tail also reaches IDB via the normal debounce', later !== null && later.includes('tail-burst'));
ok('no page exceptions', errors.length === 0);
console.log('vf-ED-1 VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
