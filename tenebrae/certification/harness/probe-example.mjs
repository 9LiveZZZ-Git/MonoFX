// Example Playwright probe for the Tenebrae Writer step-1 certification.
// Copy this pattern for each functional check. Run: node probe-example.mjs
//
// Facts probes rely on:
// - Start your own server per probe via startServer() from serve.mjs (below) —
//   do NOT rely on a shared background server; the container restarts kill those.
// - Chromium binary: /opt/pw-browsers/chromium (executablePath below).
// - The app script is an IIFE — internals are NOT page globals. Drive the real UI.
//   The only public seam is window.tenebrae (translate/langs/codex + _omni probe).
// - Screens are stacked <section class="screen">; the active one has class "on".
//   Library: #lib-new (new book), #lib-list (books), #lib-more (menu).
//   Prompt sheets: input #ps-input, confirm #ps-save, cancel #ps-cancel.
//   Sheets/actions animate and commits are deferred ~120ms — waitForTimeout(400)
//   after each sheet interaction, don't race them.
// - Action sheets are built from labels: click by text, e.g.
//   page.locator('#sheet button', { hasText: 'Add chapter' }).
// - Editor: #ed-title / #ed-content are contenteditable; #ed-count shows words.
// - Persistence: IndexedDB db. Saves are debounced (~600ms); a save also flushes
//   on visibilitychange. Before page.reload(), wait ≥1200ms after the last edit.
// - Downloads: app uses blob-anchor download(); use acceptDownloads +
//   page.waitForEvent('download'), then download.path() to read the file.
// - The favicon 404 in console is expected noise; real failures surface via
//   'pageerror'. Log and report any pageerror — determinism matters here.
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const srv = await startServer();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

// Create a book through the real UI
await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Probe Book');
await page.click('#ps-save');
await page.waitForTimeout(600);

const bookRow = await page.locator('#lib-list, #scr-book').first().innerText();
console.log('after create:', bookRow.includes('Probe Book') ? 'book visible' : 'BOOK MISSING: ' + bookRow.slice(0, 120));

// Persistence round-trip (debounced save → reload)
await page.waitForTimeout(1400);
await page.reload();
await page.waitForTimeout(800);
const lib = await page.locator('#lib-list').innerText();
console.log('after reload:', lib.includes('Probe Book') ? 'persisted' : 'NOT PERSISTED: ' + lib.slice(0, 120));

// Public deterministic-translation seam
const det = await page.evaluate(() => {
  const a = window.tenebrae.translate('celan_basic', 'The sea remembers');
  const b = window.tenebrae.translate('celan_basic', 'The sea remembers');
  return { same: JSON.stringify(a) === JSON.stringify(b), sample: a && (a.romanization || a.rom || JSON.stringify(a)).slice(0, 80) };
});
console.log('deterministic:', det.same, '| sample:', det.sample);

await browser.close();
await srv.close();
