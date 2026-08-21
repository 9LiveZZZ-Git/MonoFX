// TR-1 / TX-1 — the tongue roster is the CODEX's roster, from first launch.
//
// TRIAGE 2026-08-21: this probe used to assert the step-1 contract — "seven
// tongues (… Rath-Speech); sample-codex status disclosed until a real codex is
// imported" (step1-requirements.md L68). The artifact deliberately moved past
// that: the real Codex Omnilingua is EMBEDDED (base64 #codex-embed, step1.html
// L886) and installs as the engine at boot with no import step, which is now
// TX-1 in certification/translation-requirements.md. The sample cipher survives
// for its fonts only and must never be the engine, so a "Sample codex" badge
// would now be a FAILURE, not a pass. Rath-Speech is a dead tongue in the codex
// (nav marks it "Rath-Speech †", its <section id="lang-rath_speech"> is empty and
// buildLang registers no TRANS core for it), so the codex itself offers six
// translatable tongues; OMNI_ALIAS maps 'rath-speech' → null (step1.html L3574).
//
// The roster is therefore checked against the codex itself, not against a list
// typed into this probe: celan_basic + Object.keys(CODEX.TRANS).
// Run: cd probes && node tr-tongues.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { launch, wait, createBook, selectWord, verdict } from './ex-lib.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';

// ---- codex ground truth: serve the standalone codex and read its own roster ----
const codexBody = await readFile(CODEX);
const csrv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(codexBody); });
await new Promise(r => csrv.listen(0, '127.0.0.1', r));
const cport = csrv.address().port;

const { srv, browser, context, page, errors } = await launch();

const cpage = await context.newPage();
await cpage.goto(`http://127.0.0.1:${cport}/`);
await cpage.waitForTimeout(3000);
const truth = await cpage.evaluate(() => {
  const C = window.CODEX;
  const ids = ['celan_basic', ...Object.keys(C.TRANS)];
  const names = ['Celan Basic', ...Object.keys(C.TRANS).map(id => (C.TRANS[id].L && C.TRANS[id].L.name) || id)];
  return { ids, names, transKeys: Object.keys(C.TRANS) };
});
await cpage.close();
console.log('CODEX roster (ground truth):', JSON.stringify(truth.ids), JSON.stringify(truth.names));

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
await wait(page, 900); // tonguesList + engine wake + sheet animation

const sheetLabels = await page.$$eval('#sheet .sh-item .lbl', els => els.map(e => e.textContent.trim()));
const sheetText = await page.locator('#sheet').innerText();
console.log('sheet tongue labels:', JSON.stringify(sheetLabels));
console.log('sheet note (first 220):', JSON.stringify(sheetText.replace(/\n/g, ' ').slice(0, 220)));

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('sheet titled Translate To…', sheetText.includes('Translate To')),
  has(`sheet lists exactly the codex's own ${truth.names.length} tongues, in codex order`,
      same(sheetLabels, truth.names)),
  has('sheet names the embedded Codex Omnilingua as the engine',
      /Codex Omnilingua v\d+/.test(sheetText) && /your codex is the engine/.test(sheetText)),
  has('NO sample-codex badge and NO import-first disclosure (TX-1)',
      !/sample codex/i.test(sheetText) && !/import your codex/i.test(sheetText)),
];

// close sheet (tap scrim above the tall sheet), then check the public seam agrees
await page.click('#scrim', { position: { x: 10, y: 10 } });
await wait(page, 400);
const seam = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  return { ids: langs.map(l => l.id), names: langs.map(l => l.name), dirs: langs.map(l => l.dir), note };
});
console.log('tenebrae.langs():', JSON.stringify(seam.ids));
console.log('flows:', JSON.stringify(seam.dirs));
console.log('seam note (first 160):', JSON.stringify(seam.note.slice(0, 160)));
checks.push(
  has("seam ids are the codex's own ids", same(seam.ids, truth.ids)),
  has("seam names are the codex's own names", same(seam.names, truth.names)),
  has('seam note names the codex engine, not a sample badge',
      /Codex Omnilingua v\d+/.test(seam.note) && !/Sample codex/i.test(seam.note)),
);

// every offered tongue actually translates through the REAL engine seam
const roms = await page.evaluate(async ids => {
  const o = {};
  for (const id of ids) { const r = await window.tenebrae.translate2(id, 'the sea remembers'); o[id] = r && r.romanization; }
  return o;
}, seam.ids);
console.log('translate2 sample:', JSON.stringify(roms));
checks.push(has('every offered tongue returns a romanization from translate2 (the real engine)',
  seam.ids.every(id => typeof roms[id] === 'string' && roms[id].length > 0)));

// the codex sheet (library menu) discloses the embedded codex, no Sample badge
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-back');
await wait(page, 500);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const codexSheetText = await page.locator('#sheet').innerText();
console.log('codex sheet (first 200):', JSON.stringify(codexSheetText.replace(/\n/g, ' ').slice(0, 200)));
checks.push(has(`codex sheet shows Codex Omnilingua · ${truth.ids.length} tongues awake, no Sample badge`,
  /Codex Omnilingua v\d+/.test(codexSheetText) &&
  new RegExp(`${truth.ids.length} tongues awake`).test(codexSheetText) &&
  !/sample/i.test(codexSheetText)));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-1 / TX-1', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
csrv.close();
