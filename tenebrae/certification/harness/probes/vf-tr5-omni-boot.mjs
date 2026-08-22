// vf-TR-5 — adversarial re-check of two codex-HTML-arm claims:
//   (a) importCodexPack accepts a codex HTML through the real UI and the
//       engine wakes (here: a minimal fake engine satisfying ensureOmni's
//       contract — window.FAMILY, window.CODEX{compileText,...}, translateE2C
//       — so no 3.4MB fixture and no wake-budget dependence);
//   (b) with the omni-host pack installed, EVERY subsequent boot throws an
//       unhandled TypeError: boot L4220 -> registerCodexFonts -> codexFontCSS
//       L2600 does codexActive().languages.map(...), and the omni-host pack
//       ({kind:'omni-host', name, version, size}) has no languages array.
// Run: cd probes && node vf-tr5-omni-boot.mjs
import { writeFile } from 'node:fs/promises';
import { launch, wait, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const ENGINE = SCRATCH + '/vf-fake-codex.html';

await writeFile(ENGINE, `<!doctype html><html><body><script>
window.FAMILY = { langs: {} };
window.CODEX = { compileText: null, TRANS: {}, scriptDir: function(){ return 'ltr'; } };
window.translateE2C = function(text){
  return String(text).split(/\\s+/).map(function(t){
    return { tok: t, cel: 'vf' + t.toLowerCase(), gloss: t, drop: false, unknown: false };
  });
};
window.wordRuneSVG = function(word, size, color){
  return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>' };
};
<\/script></body></html>`);

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };

// (a) import the codex HTML through the real library menu + file chooser
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 800);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
const accept = await page.evaluate(() => document.querySelector('#codex-input').getAttribute('accept'));
console.log('#codex-input accept:', JSON.stringify(accept), '| allows .html:', /html/i.test(accept));
await chooser.setFiles(ENGINE); // Playwright bypasses accept; a real iOS picker would not
await wait(page, 3000);
const toast1 = await page.evaluate(() => document.querySelector('#toast').textContent);
console.log('toast after HTML import:', JSON.stringify(toast1));
const imported = has('codex HTML accepted and engine woke', /tongue.*awake|awake/.test(toast1));
console.log('pageerrors during import session:', errors.length ? errors.slice() : 'none');
const importErrors = errors.length;

// (b) reload with the omni-host pack installed -> boot TypeError?
await wait(page, 1200); // let the debounced save land
errors.length = 0;
await page.reload();
await wait(page, 1500);
console.log('pageerrors on boot with installed codex:', errors.length ? errors.slice() : 'none');
const bootTypeError = errors.some(m => /reading 'map'|reading "map"|languages/.test(m));
has('boot throws unhandled TypeError (codexFontCSS on omni-host pack)', bootTypeError);

// the app still runs and the codex still answers after the throw?
const alive = await page.evaluate(async () => {
  try{
    const r = await window.tenebrae.translateSampleLegacy('celan-basic', 'gate');
    const rom = r && (r.then ? (await r).romanization : r.romanization);
    return { libraryVisible: !!document.querySelector('#scr-library.on'), rom: rom || null };
  }catch(e){ return { libraryVisible: !!document.querySelector('#scr-library.on'), rom: 'ERR:' + e.message }; }
});
console.log('after boot throw — library visible:', alive.libraryVisible, '| translate:', JSON.stringify(alive.rom));

verdict('vf-TR-5 (import ok, boot clean)', imported && importErrors === 0 && !bootTypeError);
if (imported && bootTypeError)
  console.log('CONFIRMED: the HTML arm imports and wakes, but an installed omni-host codex makes every boot throw TypeError (codexFontCSS L2600 via boot L4220).');

await browser.close();
await srv.close();
