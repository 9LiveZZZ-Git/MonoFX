// vf-PR-5 — adversarial re-check of the "restore nulls an omni-host codex" partial.
// Static claim under test: offerRestore L4088 runs
//   if(state.codex && validateCodex(state.codex)) state.codex = null;
// without the kind==='omni-host' exemption the boot guard has (L4257). An
// imported real codex is stored as {kind:'omni-host', name, version, size}
// with no languages[] (L2682), so validateCodex (L2665) rejects it and EVERY
// restore of such a backup silently drops the codex binding.
// Method: import a minimal fake codex HTML through the real UI (same engine
// contract as vf-tr5-omni-boot.mjs), back up via the real Library menu, then
// restore that very backup IN THE SAME CONTEXT (kv 'codexEngine' still present,
// so the only thing that can kill the binding is L4088), and compare the codex
// before/after via window.tenebrae.codex() and the real codex sheet.
// PASS = the restored state keeps the omni-host codex. Run: node vf-pr5-omni-restore.mjs
import { writeFile, readFile } from 'node:fs/promises';
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const ENGINE = SCRATCH + '/vf-pr5-fake-codex.html';
const BACKUP = SCRATCH + '/vf-pr5-omni-backup.json';
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];

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
const codexProbe = () => page.evaluate(() => {
  const c = window.tenebrae.codex();
  return { kind: c.kind || null, name: c.name || null, sample: !!c.sample };
});

// --- authored state + real codex import through the real UI
await createBook(page, 'Omni Book');
await page.click('#ed-content');
await page.keyboard.type('the sea remembers');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-back');
await wait(page, 500);

await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 800);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(ENGINE);
await wait(page, 3000);
const toast1 = await page.evaluate(() => document.querySelector('#toast').textContent);
console.log('toast after codex import:', JSON.stringify(toast1));
const before = await codexProbe();
console.log('codex before backup:', JSON.stringify(before));
checks.push(has('omni-host codex active before backup', before.kind === 'omni-host'));
await wait(page, 1500); // debounced save

// --- backup via the real Library menu
await page.keyboard.press('Escape');
await wait(page, 400);
await page.click('#lib-more');
await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Back up everything (.json)' }).click(),
]);
await dl.saveAs(BACKUP);
const data = JSON.parse(await readFile(BACKUP, 'utf8'));
console.log('backup state.codex:', JSON.stringify(data.state && data.state.codex));
checks.push(has('backup JSON faithfully carries the omni-host codex', data.state && data.state.codex && data.state.codex.kind === 'omni-host'));
checks.push(has('backup carries the book', JSON.stringify(data.state.books).includes('Omni Book')));
await wait(page, 600);

// --- restore that very backup in the SAME context (kv codexEngine intact)
await page.click('#lib-more');
await wait(page, 450);
const [chooser2] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
]);
await chooser2.setFiles(BACKUP);
await wait(page, 700);
const sheetTxt = await page.locator('#sheet').innerText();
console.log('confirm sheet:', JSON.stringify(sheetTxt.slice(0, 100)));
await page.click('#cs-yes');
await wait(page, 1200);

const after = await codexProbe();
console.log('codex after restoring its own backup:', JSON.stringify(after));
checks.push(has('restore keeps the omni-host codex binding', after.kind === 'omni-host'));
const bookBack = (await page.locator('#lib-list').innerText()).includes('Omni Book');
checks.push(has('book itself restored fine', bookBack));

// what the user sees: the codex sheet after restore
await page.click('#lib-more');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 800);
const sheet2 = await page.locator('#sheet').innerText();
console.log('codex sheet after restore:', JSON.stringify(sheet2.replace(/\n+/g, ' | ').slice(0, 160)));
const uiSample = /Sample/i.test(sheet2);
console.log('UI shows Sample badge (codex binding lost):', uiSample);
await page.keyboard.press('Escape');
await wait(page, 400);

// permanence: the nulled codex was flushSaved — reload and re-check
await wait(page, 1500);
await page.reload();
await wait(page, 1200);
const afterReload = await codexProbe();
console.log('codex after reload:', JSON.stringify(afterReload));
checks.push(has('codex still bound after reload', afterReload.kind === 'omni-host'));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('vf-PR-5 omni restore', checks.every(Boolean) && errors.length === 0);
if (before.kind === 'omni-host' && data.state.codex && data.state.codex.kind === 'omni-host' && after.kind !== 'omni-host')
  console.log('CONFIRMED: backup faithfully stores the imported codex, but restoring that very backup silently drops it (offerRestore L4088 lacks the omni-host exemption boot has at L4257).');

await browser.close();
await srv.close();
