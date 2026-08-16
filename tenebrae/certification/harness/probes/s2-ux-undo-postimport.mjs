// X2-13 (gap coverage): undo IMMEDIATELY after a codex import re-renders spans.
// Import of a real codex triggers rerenderAllSpans() + decorateAll() — DOM
// rewrites that never enter the undo history. The browser's undo stack may
// still hold entries from the pre-import editing session in the SAME
// #ed-content element. A Ctrl+Z pressed right after the re-rendered scene
// opens must NOT corrupt prose or resurrect stale pre-import DOM into the
// persisted state. Editing + undo must still work afterwards, and the
// persisted doc after reload must be the intact re-rendered scene.
// Run: cd probes && node s2-ux-undo-postimport.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const clone = ed.cloneNode(true);
  clone.querySelectorAll('.tspan').forEach(t => t.remove());
  const norm = s => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return {
    prose: norm(clone.textContent),
    spans: [...ed.querySelectorAll('.tspan')].map(sp => ({
      lang: sp.dataset.lang, src: sp.dataset.src, omni: sp.dataset.omni || null,
      scr: sp.dataset.scr || null, text: sp.textContent,
      pua: [...sp.textContent].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF),
      svg: sp.querySelectorAll('svg').length,
    })),
  };
});
const focusEditor = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const undo = async () => { await focusEditor(); await page.keyboard.press('Control+z'); await wait(page, 450); };

// ---- pre-import: prose + a sample-codex span, saved ----
await createBook(page, 'Post Import Undo');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the old king tonight');
await wait(page, 800);
await insertTranslationSpan(page, 'old king', 'Celan Basic');
await wait(page, 1500); // debounced save
const pre = await snap();
console.log('pre-import:', JSON.stringify(pre));
ck('pre-import: sample span in place', pre.spans.length === 1 && pre.spans[0].src === 'old king' && pre.spans[0].pua);

// ---- import the real codex from the library menu ----
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 500);
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX_PATH);
await page.waitForFunction(() => /tongues awake/.test(document.querySelector('#toast').textContent), null, { timeout: 45000 });
await wait(page, 600);

// ---- reopen the scene: spans re-render (rerenderAllSpans + decorateAll) ----
await page.locator('#lib-list .row', { hasText: 'Post Import Undo' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
await page.waitForFunction(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp && sp.dataset.scr && sp.textContent === sp.dataset.scr;
}, null, { timeout: 25000 });
const post = await snap();
console.log('post-import:', JSON.stringify(post));
ck('re-render kept prose byte-for-byte', post.prose === pre.prose, JSON.stringify(post.prose));
ck('re-rendered span is a live TEXT omni span with source kept',
   post.spans.length === 1 && post.spans[0].omni === '1' && post.spans[0].src === 'old king' && post.spans[0].pua && post.spans[0].svg === 0);

// ---- Ctrl+Z immediately: must not corrupt the re-rendered scene ----
await undo();
const u1 = await snap();
console.log('after 1st undo:', JSON.stringify(u1));
const clean = s => s.prose === pre.prose && s.spans.length === 1 && s.spans[0].src === 'old king' && s.spans[0].pua && s.spans[0].svg === 0;
ck('undo #1 after import: prose intact, span intact as text', clean(u1), JSON.stringify(u1));
for(let i = 0; i < 3; i++) await undo();
const u4 = await snap();
console.log('after 4 undos:', JSON.stringify(u4));
ck('repeated undo after import: still no corruption', clean(u4), JSON.stringify(u4));

// ---- editing + its own undo still work after the import ----
await focusEditor();
await page.keyboard.type(' postscript');
await wait(page, 600);
const typed = await snap();
ck('typing after import works', /postscript/.test(typed.prose) && typed.spans.length === 1);
await undo();
const untyped = await snap();
ck('undo of post-import typing works and touches nothing else', clean(untyped) && !/postscript/.test(untyped.prose), JSON.stringify(untyped.prose));

// ---- persisted state after reload is the intact re-rendered scene ----
await wait(page, 1500);
await page.reload();
await wait(page, 900);
await page.locator('#lib-list .row', { hasText: 'Post Import Undo' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
await page.waitForFunction(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp && sp.dataset.scr && sp.textContent === sp.dataset.scr;
}, null, { timeout: 25000 });
const persisted = await snap();
console.log('persisted:', JSON.stringify(persisted));
ck('persisted scene after reload: prose + live text span intact', clean(persisted), JSON.stringify(persisted));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-13 undo-postimport', checks.every(c => c[1]));
await browser.close();
await srv.close();
