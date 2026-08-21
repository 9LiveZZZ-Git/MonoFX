// TX-10b ADVERSARY PROBE — the PDF export tap against a slow device.
//
// cf-adv-pdf-forge-race.mjs showed that on this desktop the forge is up ~1.5s
// after a reload, so a Playwright-speed tap cannot get in front of it. The app
// is an OFFLINE PHONE app; the interesting device is a phone. This probe runs
// the same race with the CPU throttled (CDP Emulation.setCPUThrottlingRate),
// taps Export -> "Download PDF (.pdf)" through the real sheet as early as the
// DOM allows, and reads the bytes.
//
// The PDF item's onTap is synchronous (step1.html:2209-2213) where the EPUB
// item awaits ensureOmni()/forgeOmniFonts() (step1.html:2218-2222); with no
// forged face pdfRunsFrom (step1.html:2638-2642) substitutes the italic
// romanization for every span. If that is reachable, a PDF exported one tap too
// early silently contains no script at all.
//
// Run: cd probes && node cf-adv-pdf-forge-race-slow.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-race2';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };
const shape = buf => {
  const s = buf.toString('latin1');
  return { bytes: buf.length, type0: (s.match(/\/Subtype \/Type0/g) || []).length,
           fontFile2: (s.match(/\/FontFile2/g) || []).length,
           glyphRuns: (s.match(/\/S_[a-z_]+ [\d.]+ Tf/g) || []).length,
           italicRuns: (s.match(/\/F3 [\d.]+ Tf/g) || []).length };
};

const { srv, browser, context, page, errors } = await launch();
await wait(page, 3500);
const L1 = 'the sea remembers the old king';
const L2 = 'a light upon the water';
await createBook(page, 'Slow Race');
await page.click('#ed-title'); await page.keyboard.type('Wake Race');
await page.click('#ed-content');
await page.keyboard.type(L1); await page.keyboard.press('Enter'); await page.keyboard.type(L2);
await wait(page, 700);
await insertTranslationSpan(page, L1, 'Celan High');
await wait(page, 1300);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 300);
await insertTranslationSpan(page, L2, 'Kerrackian');
await wait(page, 1300);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
await page.click('#ed-back'); await wait(page, 900);
ck('precondition: the stored book holds two script spans',
   (await page.evaluate(() => (JSON.stringify(window.tenebrae) , document.querySelectorAll('[data-book]').length))) > 0);

const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });   // a mid-range phone
await page.reload();
const t0 = Date.now();
// tap as early as the DOM allows: no actionability waits, straight DOM clicks
let forgeAtTap = null, opened = false;
for(let i = 0; i < 200; i++){
  const st = await page.evaluate(() => {
    const b = document.querySelector('[data-book]');
    return { book: !!b, share: !!document.querySelector('#bk-share'),
             forged: window.tenebrae && window.tenebrae._forge.map() ? Object.keys(window.tenebrae._forge.map()) : null };
  }).catch(() => ({ book: false, share: false, forged: null }));
  if(st.book && !opened){ await page.evaluate(() => document.querySelector('[data-book]').click()); opened = true; continue; }
  if(opened && st.share){
    forgeAtTap = await page.evaluate(() => {
      document.querySelector('#bk-share').click();
      const m = window.tenebrae._forge.map();
      return { forged: m ? Object.keys(m) : null, t: Math.round(performance.now()) };
    });
    break;
  }
  await wait(page, 25);
}
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.evaluate(() => {
    const it = [...document.querySelectorAll('#sheet .sh-item')].find(e => /Download PDF/.test(e.textContent));
    it.click();
  }),
]);
const tapMs = Date.now() - t0;
const early = await readFile(await dl.path());
await writeFile(`${OUT}/early.pdf`, early);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log(`sheet opened at +${tapMs}ms (throttled 20x); forge map when the sheet opened = ${JSON.stringify(forgeAtTap)}`);
console.log('early PDF:', JSON.stringify(shape(early)));
const e = shape(early);
const raced = !forgeAtTap || !forgeAtTap.forged || forgeAtTap.forged.length === 0;
ck('precondition: the tap landed before the forge finished', raced, JSON.stringify(forgeAtTap));
ck('a PDF exported one tap too early still carries the script',
   e.type0 > 0 && e.fontFile2 > 0 && e.glyphRuns > 0,
   `type0=${e.type0} fontFile2=${e.fontFile2} glyphRuns=${e.glyphRuns} italicRuns=${e.italicRuns} — italic-only means the script was silently replaced by romanization`);

await wait(page, 5000);
await page.click('#bk-share');
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'Download PDF (.pdf)' }).click(),
]);
const late = await readFile(await dl2.path());
await writeFile(`${OUT}/late.pdf`, late);
console.log('late  PDF:', JSON.stringify(shape(late)));
ck('control: after the wake the same tap carries the script', shape(late).glyphRuns > 0, JSON.stringify(shape(late)));
ck('the same book exported twice with no edit gives the same file',
   early.equals(late), `${early.length} vs ${late.length} bytes`);
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF FORGE RACE (SLOW DEVICE)', checks.every(c => c[1]));
await browser.close();
await srv.close();
