// X2-14 (gap coverage): the script is TEXT — selectable and copyable.
// Selecting across a translation span must expose the PUA script characters
// through the Selection API, and a real Ctrl+C must land the PUA text on the
// system clipboard — under BOTH engines (sample codex fonts, and the forged
// TTFs of an imported codex). SVG/canvas renderings would fail all of this.
// Run: cd probes && node s2-ux-select-copy.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, context, page, errors } = await launch();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(srv.url).origin });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };
const PUA = s => [...String(s)].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF);

// select the paragraph that holds the first .tspan (prose + span together)
const selectSpanParagraph = () => page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return null;
  const block = sp.closest('p, div, li, h2, h3, blockquote') || sp.parentElement;
  const r = document.createRange();
  r.selectNodeContents(block);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.querySelector('#ed-content').focus();
  return { selection: sel.toString(), spanText: sp.textContent, scr: sp.dataset.scr || null };
});
const selectSpanOnly = () => page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  const r = document.createRange();
  r.selectNode(sp);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  document.querySelector('#ed-content').focus();
  return { selection: sel.toString(), spanText: sp.textContent };
});
const readClipboard = () => page.evaluate(async () => {
  try{ return { ok: true, text: await navigator.clipboard.readText() }; }
  catch(e){ return { ok: false, err: e.message }; }
});
const clearClipboard = () => page.evaluate(() => navigator.clipboard.writeText('SENTINEL-EMPTY').catch(() => {}));

async function copyStage(label){
  // paragraph selection: prose + script together
  const para = await selectSpanParagraph();
  ck(`${label}: selection API exposes the PUA script text`, !!para && PUA(para.selection).length > 0 && para.selection.includes(para.spanText.trim()),
     para ? `sel ${JSON.stringify(para.selection.slice(0, 60))}` : 'no span');
  await clearClipboard();
  await selectSpanParagraph();
  await page.keyboard.press('Control+c');
  await wait(page, 400);
  const clipPara = await readClipboard();
  ck(`${label}: Ctrl+C puts prose + PUA script on the clipboard`, clipPara.ok && PUA(clipPara.text).length > 0 && clipPara.text !== 'SENTINEL-EMPTY',
     clipPara.ok ? JSON.stringify(clipPara.text.slice(0, 80)) : clipPara.err);

  // span-only selection: the clipboard payload should BE the script text
  const only = await selectSpanOnly();
  await clearClipboard();
  await selectSpanOnly();
  await page.keyboard.press('Control+c');
  await wait(page, 400);
  const clipOnly = await readClipboard();
  const wantPua = PUA(only.spanText).join('');
  const gotPua = clipOnly.ok ? PUA(clipOnly.text).join('') : '';
  ck(`${label}: span-only copy carries the exact PUA run`, clipOnly.ok && wantPua.length > 0 && gotPua === wantPua,
     `want ${wantPua.length} PUA chars, got ${gotPua.length}${clipOnly.ok ? '' : ' err:' + clipOnly.err}`);
  return { para, clipPara, only, clipOnly };
}

// ---- stage 1: sample codex ----
await createBook(page, 'Copy Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('before words the sea remembers after words');
await wait(page, 800);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1500);
await copyStage('sample');

// ---- stage 2: imported codex (forged fonts, omni spans) ----
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
await page.locator('#lib-list .row', { hasText: 'Copy Book' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
await page.waitForFunction(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp && sp.dataset.omni === '1' && sp.dataset.scr && sp.textContent === sp.dataset.scr;
}, null, { timeout: 25000 });
const omni = await copyStage('imported codex');
// the copied PUA must be the forged-font range the omni span declares (data-scr)
ck('imported codex: clipboard PUA equals the span data-scr script text',
   omni.clipOnly.ok && PUA(omni.clipOnly.text).join('') === PUA(await page.evaluate(() => document.querySelector('#ed-content .tspan').dataset.scr)).join(''));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-14 select-copy', checks.every(c => c[1]));
await browser.close();
await srv.close();
