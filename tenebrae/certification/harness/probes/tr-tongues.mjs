// TR-1 — Seven tongues offered; sample-codex status disclosed until a real
// codex is imported.
// Verifies (a) the real selection → context menu → "Translate …" sheet lists
// all seven tongues plus the sample-codex disclosure note, and (b) the
// window.tenebrae.langs() seam reports the same seven ids and the same note.
// Run: cd probes && node tr-tongues.mjs
import { launch, wait, createBook, selectWord, verdict } from './ex-lib.mjs';

const SEVEN = ['Celan Basic', 'Celan High', 'Kerrackian', 'Kildaren',
               'Calgridarian', 'Evernessian', 'Rath-Speech'];
const SEVEN_IDS = ['celan-basic', 'celan-high', 'kerrackian', 'kildaren',
                   'calgridarian', 'evernessian', 'rath-speech'];

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Tongue Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the stone gate');
await wait(page, 300);

// selection → context menu → Translate … → tongue sheet (real UI path)
await selectWord(page, 'sea remembers');
await page.evaluate(() => {
  const sel = getSelection();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4)
  }));
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 700); // tonguesList + sheet animation

const sheetLabels = await page.$$eval('#sheet .sh-item .lbl', els => els.map(e => e.textContent.trim()));
const sheetText = await page.locator('#sheet').innerText();
console.log('sheet tongue labels:', JSON.stringify(sheetLabels));
console.log('sheet note (first 220):', JSON.stringify(sheetText.replace(/\n/g, ' ').slice(0, 220)));

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('sheet titled Translate To…', sheetText.includes('Translate To')),
  has('sheet lists exactly the 7 tongues', sheetLabels.length === 7 && SEVEN.every(n => sheetLabels.includes(n))),
  has('sheet discloses sample-codex status', /sample codex/i.test(sheetText)),
  has('disclosure names the import path (library menu)', /import your codex/i.test(sheetText) && /library menu/i.test(sheetText)),
];

// close sheet (tap scrim above the tall sheet), then check the public seam agrees
await page.click('#scrim', { position: { x: 10, y: 10 } });
await wait(page, 400);
const seam = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  return { ids: langs.map(l => l.id), names: langs.map(l => l.name), note };
});
console.log('tenebrae.langs():', JSON.stringify(seam.ids));
console.log('seam note (first 160):', JSON.stringify(seam.note.slice(0, 160)));
checks.push(
  has('seam lists the same 7 ids', seam.ids.length === 7 && SEVEN_IDS.every(id => seam.ids.includes(id))),
  has('seam lists the same 7 names', SEVEN.every(n => seam.names.includes(n))),
  has('seam note carries the Sample codex badge', /Sample codex/i.test(seam.note)),
);

// the codex sheet (library menu) also shows the Sample badge
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-back');
await wait(page, 500);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 700);
const codexSheetText = await page.locator('#sheet').innerText();
console.log('codex sheet (first 200):', JSON.stringify(codexSheetText.replace(/\n/g, ' ').slice(0, 200)));
checks.push(has('codex sheet shows Sample badge', /sample/i.test(codexSheetText)));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-1', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
