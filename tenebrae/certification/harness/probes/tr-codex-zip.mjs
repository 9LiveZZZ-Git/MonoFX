// TR-5 (ZIP branch) — a Codex Pack as a .zip holding codex.json plus a .ttf
// font, imported through the same library-menu chooser.
//
// FINDING (confirmed by this probe): the ZIP branch of importCodexPack is
// dead code. unzipAll's contract (see the working DOCX/EPUB caller,
// step1.html L3918: pass an ArrayBuffer, get a Map back, read via .get) is
// violated three ways by the codex caller (L2661-2668):
//   1. L2661 passes new Uint8Array(...) — unzipAll L3551 does
//      new DataView(buf), which throws TypeError for a Uint8Array;
//   2. L2662 calls entries.find(...) — unzipAll returns a Map (no .find);
//   3. L2662-2668 expects {name, data} entries — Map iteration yields
//      [name, bytes] pairs.
// Every .zip/.codexpack import therefore lands in the catch and toasts
// "Couldn't read that pack"; the sample codex stays active. Graceful, but
// the advertised ZIP surface never works.
//
// The fixture is generated at run time in the scratchpad (font borrowed from
// the app's own embedded sample pack) — nothing binary is committed.
// Run: cd probes && node tr-codex-zip.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch, wait, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const DIR = SCRATCH + '/zip-pack';
const ZIP = SCRATCH + '/probe-codex-pack.zip';

{
  const src = await readFile('/home/user/MonoFX/tenebrae/step1.html', 'utf8');
  const m = src.match(/\{"family": "Tenebrae Celan Runes", "format": "ttf", "data": "([^"]+)"\}/);
  if (!m) throw new Error('could not extract sample font from step1.html');
  await mkdir(DIR, { recursive: true });
  await writeFile(DIR + '/Probe Zip Font.ttf', Buffer.from(m[1], 'base64'));
  await writeFile(DIR + '/codex.json', JSON.stringify({
    name: 'Zip Probe Pack', version: '3',
    languages: [
      { id: 'celan-basic', name: 'Zip Celan', fontFamily: 'Probe Zip Font', dir: 'ltr',
        shift: [['e', 'u'], ['r', 'th']], affix: { plural: 'em' } },
    ],
    lexicon: { gate: 'zipgat' },
  }));
  execFileSync('zip', ['-j', '-q', ZIP, DIR + '/codex.json', DIR + '/Probe Zip Font.ttf'], { cwd: SCRATCH });
}

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };

await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 800);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(ZIP);
await wait(page, 2500);
const toast = await page.evaluate(() => document.querySelector('#toast').textContent);
console.log('toast after zip import:', JSON.stringify(toast));

const st = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  return { sampleStill: /sample codex/i.test(note), n: langs.length,
           zipFonts: [...document.fonts].map(f => f.family).filter(f => f.includes('Zip')),
           rom: window.tenebrae.translate('celan-basic', 'the stone gate').romanization };
});
console.log('state after attempt:', JSON.stringify(st));

const zipWorked = /Zip Probe Pack/.test(toast) && !st.sampleStill;
const graceful = /Couldn.t read that pack/.test(toast) && st.sampleStill && st.n === 7
                 && st.rom === 'te petrek purten' && errors.length === 0;
has('zip pack imports as advertised', zipWorked);
has('failure is graceful: generic toast, sample engine intact, no page exception', graceful);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-5 (zip branch works)', zipWorked);
if (!zipWorked && graceful)
  console.log('CONFIRMED: ZIP Codex Pack import is a dead branch (unzipAll contract mismatch, L2661-2668) — fails gracefully to the generic toast.');

await browser.close();
await srv.close();
