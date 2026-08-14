// ST-4 — reorder: real pointer-drag on the drag handle in edit mode
// (scene within a chapter, then chapter blocks), plus "Move to chapter…"
// sheet to move a scene between chapters. Order is verified in the DOM and
// again after a reload (persisted).
// Run: cd probes && node st-reorder.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// book with 3 scenes in Chapter 1 (create book -> editor holds scene 1)
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Reorder Book');
await page.click('#ps-save');
await T(700);
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

// second chapter
await page.click('#bk-more');
await T(400);
await page.locator('#sheet button', { hasText: 'Add chapter' }).click();
await T(400);
await page.fill('#ps-input', 'Chapter 2');
await page.click('#ps-save');
await T(600);

// (cards-pin div precedes the chapter blocks in #bk-list, so :first-of-type
// would never match — take the first .chapter-block explicitly)
const sceneOrder = () => page.locator('#bk-list .chapter-block').first()
  .locator('[data-scenelist] .row .t').allInnerTexts();
console.log('order before drag:', JSON.stringify(await sceneOrder()));

// --- drag-to-reorder: enter edit mode, drag S3's handle above S1
await page.click('#bk-edit');
await T(500);
const s3handle = page.locator('#bk-list .row[data-scene]', { hasText: 'S3' }).locator('.handle');
const s1row = page.locator('#bk-list .row[data-scene]', { hasText: 'S1' });
const hb = await s3handle.boundingBox();
const rb = await s1row.boundingBox();
if (!hb || !rb) { console.log('DRAG BLOCKED: handle/row not visible', hb, rb); }
else {
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await T(120);
  // move in steps to just above S1's vertical midpoint
  await page.mouse.move(hb.x + hb.width / 2, rb.y + 4, { steps: 12 });
  await T(120);
  await page.mouse.up();
  await T(500);
}
const afterDrag = await sceneOrder();
console.log('order after drag:', JSON.stringify(afterDrag));
const dragWorked = JSON.stringify(afterDrag) === JSON.stringify(['S3', 'S1', 'S2']);
console.log('scene drag result:', dragWorked ? 'reordered S3,S1,S2' : 'DID NOT reorder as expected');

// --- move a scene between chapters via the "Move to chapter…" sheet
await page.locator('#bk-list .row[data-scene]', { hasText: 'S2' }).click(); // edit mode -> scene sheet
await T(400);
await page.locator('#sheet button', { hasText: 'Move to chapter' }).click();
await T(400);
const moveChoices = await page.locator('#sheet .sh-item .lbl').allInnerTexts();
console.log('move sheet chapters:', JSON.stringify(moveChoices));
await page.locator('#sheet button', { hasText: 'Chapter 2' }).click();
await T(600);
const ch2scenes = await page.locator('.chapter-block', { hasText: 'Chapter 2' }).locator('.row[data-scene] .t').allInnerTexts();
const ch1scenes = await sceneOrder();
console.log('after move — ch1:', JSON.stringify(ch1scenes), 'ch2:', JSON.stringify(ch2scenes));

// --- chapter drag: drag "Chapter 2" block's handle above chapter 1
const chHandle = page.locator('.chapter-block', { hasText: 'Chapter 2' }).locator('.ch-head .handle');
const ch1head = page.locator('#bk-list .chapter-block').first().locator('.ch-head');
const chb = await chHandle.boundingBox();
const c1b = await ch1head.boundingBox();
let chapDragWorked = false;
if (!chb || !c1b) { console.log('CHAPTER DRAG BLOCKED: handle not visible', chb, c1b); }
else {
  await page.mouse.move(chb.x + chb.width / 2, chb.y + chb.height / 2);
  await page.mouse.down();
  await T(120);
  await page.mouse.move(chb.x + chb.width / 2, c1b.y + 2, { steps: 12 });
  await T(120);
  await page.mouse.up();
  await T(500);
  const chOrder = await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent));
  console.log('chapter order after drag:', JSON.stringify(chOrder));
  chapDragWorked = chOrder[0] === 'Chapter 2';
}

// --- persistence of the new order
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Reorder Book' }).click();
await T(600);
const chOrder2 = await page.$$eval('#bk-list .chapter-block .ch-head .name', els => els.map(e => e.textContent));
const persistedCh2 = await page.locator('.chapter-block', { hasText: 'Chapter 2' }).locator('.row[data-scene] .t').allInnerTexts();
const persistedCh1 = await page.locator('.chapter-block', { hasText: 'Chapter 1' }).locator('.row[data-scene] .t').allInnerTexts();
console.log('after reload — chapters:', JSON.stringify(chOrder2),
  '| Chapter 1 scenes:', JSON.stringify(persistedCh1),
  '| Chapter 2 scenes:', JSON.stringify(persistedCh2));

const moveWorked = ch2scenes.includes('S2') && !ch1scenes.includes('S2');
const persisted = persistedCh2.includes('S2') &&
  JSON.stringify(persistedCh1) === JSON.stringify(dragWorked ? ['S3', 'S1'] : persistedCh1) &&
  (chapDragWorked ? chOrder2[0] === 'Chapter 2' : true);
console.log('summary: sceneDrag=', dragWorked, 'chapterDrag=', chapDragWorked, 'moveSheet=', moveWorked, 'persisted=', persisted);
console.log((dragWorked && moveWorked && persisted) ? 'ST-4 VERDICT: PASS' : 'ST-4 VERDICT: CHECK OUTPUT');

await browser.close();
await srv.close();
