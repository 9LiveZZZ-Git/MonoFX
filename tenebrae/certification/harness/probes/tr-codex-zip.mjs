// TR-5 (ZIP branch) — a Codex Pack as a .zip holding codex.json plus a .ttf
// font, imported through the same library-menu chooser.
//
// History: before commit 4c9ebd1 this branch was dead code — importCodexPack
// violated unzipAll's contract three ways (Uint8Array instead of ArrayBuffer;
// .find on a Map; {name,data} entries instead of [name,bytes] pairs) and every
// .zip/.codexpack import fell into the catch with the generic toast. The fix
// passes the ArrayBuffer and consumes the Map; this probe now certifies the
// working path: pack accepted, tongues + lexicon live, font extracted from the
// ZIP and registered via FontFace (document.fonts), removal restores sample.
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
  return { sampleStill: /sample codex/i.test(note), langNames: langs.map(l => l.name),
           zipFonts: [...document.fonts].map(f => f.family).filter(f => f.includes('Zip')),
           rom: window.tenebrae.translate('celan-basic', 'the stone gate').romanization };
});
console.log('state after import:', JSON.stringify(st));

const checks = [
  has('zip pack accepted (named in toast, font count shown)', /Zip Probe Pack/.test(toast) && /1 fonts/.test(toast)),
  has('sample disclosure cleared; zip tongue listed', !st.sampleStill && st.langNames.includes('Zip Celan')),
  has('zip font extracted and registered via FontFace (document.fonts)', st.zipFonts.includes('Probe Zip Font')),
  has('translation follows the zip pack rules (shift e→u, r→th; lexicon gate→zipgat)',
      st.rom === 'thu ztunu zipgat' || /zipgat/.test(st.rom)),
];

// removal restores the sample engine
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Remove pack' }).click();
await wait(page, 600);
await page.click('#cs-yes');
await wait(page, 1200);
const back = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  return { n: langs.length, sampleNote: /sample codex/i.test(note),
           rom: window.tenebrae.translate('celan-basic', 'the stone gate').romanization };
});
console.log('after removal:', JSON.stringify(back));
checks.push(has('removal restores the sample engine (7 tongues, badge back, sample rom)',
  back.n === 7 && back.sampleNote && back.rom === 'te petrek purten'));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-5 (zip branch)', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
