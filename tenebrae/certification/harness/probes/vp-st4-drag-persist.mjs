// vp-ST-4 — adversarial re-test of drag-to-reorder. Independent from st-reorder.mjs:
//   - drags DOWNWARD (S1 below S3) instead of upward, a different code path through
//     the ghost/insertion logic
//   - verifies the committed order by reading the persisted state DIRECTLY from
//     IndexedDB (not just the DOM the drag itself manipulated)
//   - then chapter drag + reload check
// Run: cd probes && node vp-st4-drag-persist.mjs
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
await page.fill('#ps-input', 'VP Drag Book');
await page.click('#ps-save'); await T(700);
const nameScene = async name => {
  await page.click('#ed-title');
  await page.keyboard.type(name);
  await T(800);
  await page.click('#ed-back');
  await T(500);
};
await nameScene('S1');
await page.click('#bk-newscene'); await T(600); await nameScene('S2');
await page.click('#bk-newscene'); await T(600); await nameScene('S3');

// second chapter for the chapter-drag half
await page.click('#bk-more'); await T(400);
await page.locator('#sheet button', { hasText: 'Add chapter' }).click(); await T(450);
await page.fill('#ps-input', 'Second'); await page.click('#ps-save'); await T(600);

const sceneOrder = () => page.locator('#bk-list .chapter-block').first()
  .locator('[data-scenelist] .row .t').allInnerTexts();
console.log('before drag:', JSON.stringify(await sceneOrder()));

// edit mode; drag S1's handle DOWN past S3
await page.click('#bk-edit'); await T(500);
const h = await page.locator('#bk-list .row[data-scene]', { hasText: 'S1' }).locator('.handle').boundingBox();
const s3 = await page.locator('#bk-list .row[data-scene]', { hasText: 'S3' }).boundingBox();
if(!h || !s3){ console.log('DRAG BLOCKED: geometry missing'); }
else {
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down(); await T(140);
  await page.mouse.move(h.x + h.width / 2, s3.y + s3.height - 3, { steps: 14 });
  await T(140);
  await page.mouse.up(); await T(500);
}
const afterDrag = await sceneOrder();
console.log('after downward drag:', JSON.stringify(afterDrag));
const dragOK = JSON.stringify(afterDrag) === JSON.stringify(['S2', 'S3', 'S1']);

// chapter drag: pull 'Second' above Chapter 1
const ch = await page.locator('.chapter-block', { hasText: 'Second' }).locator('.ch-head .handle').boundingBox();
const c1 = await page.locator('#bk-list .chapter-block').first().locator('.ch-head').boundingBox();
let chOK = false;
if(ch && c1){
  await page.mouse.move(ch.x + ch.width / 2, ch.y + ch.height / 2);
  await page.mouse.down(); await T(140);
  await page.mouse.move(ch.x + ch.width / 2, c1.y + 2, { steps: 14 });
  await T(140);
  await page.mouse.up(); await T(500);
  const names = await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent));
  console.log('chapter order after drag:', JSON.stringify(names));
  chOK = names[0] === 'Second';
}

// the committed order must be in IndexedDB itself, not just the DOM
await T(1500); // debounce
const persisted = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    g.onsuccess = () => {
      const st = g.result;
      const b = st && st.books.find(x => x.title === 'VP Drag Book');
      res(b ? b.chapters.map(c => ({ ch: c.title, scenes: c.scenes.map(s => s.title) })) : null);
    };
    g.onerror = () => res('idb-error');
  };
  rq.onerror = () => res('idb-open-error');
}));
console.log('IndexedDB state:', JSON.stringify(persisted));
const idbOK = Array.isArray(persisted) &&
  persisted[0].ch === 'Second' &&
  JSON.stringify(persisted[1].scenes) === JSON.stringify(['S2', 'S3', 'S1']);

// and it must survive a reload in the UI
await page.reload(); await T(800);
await page.locator('#lib-list .row', { hasText: 'VP Drag Book' }).click(); await T(600);
const chNames = await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent));
const ch1Scenes = await page.locator('.chapter-block', { hasText: 'Chapter 1' }).locator('.row[data-scene] .t').allInnerTexts();
console.log('after reload — chapters:', JSON.stringify(chNames), '| Chapter 1 scenes:', JSON.stringify(ch1Scenes));
const reloadOK = chNames[0] === 'Second' && JSON.stringify(ch1Scenes) === JSON.stringify(['S2', 'S3', 'S1']);

console.log('summary: sceneDrag=', dragOK, 'chapterDrag=', chOK, 'idbState=', idbOK, 'reload=', reloadOK, 'pageerrors=', errors.length);
console.log((dragOK && chOK && idbOK && reloadOK && errors.length === 0)
  ? 'vp-ST-4 VERDICT: PASS' : 'vp-ST-4 VERDICT: FAIL');

await browser.close();
await srv.close();
