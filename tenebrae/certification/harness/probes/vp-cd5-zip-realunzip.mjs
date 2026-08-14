// vp-CD5 — adversarial re-verification of the cards .zip export. The original
// cd-export.mjs parsed the archive with its own hand-rolled reader, which could
// share blind spots with the writer. This probe downloads the same archive and
// saves it for validation by an INDEPENDENT extractor (python3 zipfile, run by
// the certification agent right after this probe). In-probe it only asserts the
// download happened and prints where the bytes went.
// Run: cd probes && node vp-cd5-zip-realunzip.mjs
//      then: python3 - <<'PY' ... (see vp verification notes)
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vp-cards.zip';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// book + scene mentioning both cards
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Zip Probe');
await page.click('#ps-save');
await T(700);
await page.click('#ed-title');
await page.keyboard.type('Quay');
await page.click('#ed-content');
await page.keyboard.type('Serane waited by the Lodestone. The Lodestone hummed.');
await T(1400);
await page.click('#ed-back');
await T(500);

// two cards; Serane's notes reference Lodestone (connection)
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Serane');
await page.click('#ps-save');
await T(700);
await page.click('#cc-notes');
await page.keyboard.type('Bearer of the Lodestone.');
await page.keyboard.press('Escape');
await T(600);
await page.click('#cc-back');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Lodestone');
await page.click('#ps-save');
await T(700);
await page.click('#cc-type');
await T(450);
await page.locator('#sheet button', { hasText: 'Artifact' }).click();
await T(550);
await page.click('#cc-back');
await T(500);

await page.click('#cd-export');
await T(450);
const [zipDl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#sheet button', { hasText: 'Cards archive' }).click(),
]);
const buf = await readFile(await zipDl.path());
await writeFile(OUT, buf);
console.log('zip saved:', OUT, '|', buf.length, 'bytes');
console.log('pageerrors:', errors.length ? errors : 'none');
console.log('vp-CD-5 download:', buf.length > 100 && errors.length === 0 ? 'OK — validate with python3 zipfile next' : 'FAIL');

await browser.close();
await srv.close();
