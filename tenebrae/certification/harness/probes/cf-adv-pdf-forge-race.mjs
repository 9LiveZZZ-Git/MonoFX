// TX-10b ADVERSARY PROBE — "cannot be talked out of it", against the clock.
//
// The EPUB item awaits ensureOmni()/forgeOmniFonts() before it builds
// (step1.html:2218-2222). The PDF item does not (step1.html:2209-2213): its
// onTap is synchronous. pdfRunsFrom (step1.html:2638-2642) then finds no forged
// face and silently substitutes the ITALIC ROMANIZATION for every span. So a
// tap inside the ~3.5s wake window is supposed to produce a PDF with no script
// in it at all — the one thing TX-10b says the format cannot be talked out of.
//
// This probe reloads a book that already has spans in it and taps the real
// Export sheet's "Download PDF (.pdf)" as fast as the UI allows, then reads the
// downloaded bytes: are there Type0 fonts and hex glyph runs in it, or only
// Times-Italic literals?  A second tap after the forge is the control.
//
// Run: cd probes && node cf-adv-pdf-forge-race.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-race';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const shape = buf => {
  const s = buf.toString('latin1');
  return {
    bytes: buf.length,
    type0: (s.match(/\/Subtype \/Type0/g) || []).length,
    fontFile2: (s.match(/\/FontFile2/g) || []).length,
    glyphRuns: (s.match(/\/S_[a-z_]+ [\d.]+ Tf/g) || []).length,
    italicRuns: (s.match(/\/F3 [\d.]+ Tf/g) || []).length,
  };
};

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
const L1 = 'the sea remembers the old king';
const L2 = 'a light upon the water';
await createBook(page, 'Race Book');
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
const spanCount = await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length);
ck('precondition: the book holds two real script spans', spanCount === 2, String(spanCount));
await page.click('#ed-back'); await wait(page, 900);

/* ---- the race: reload, then tap Export -> PDF immediately ---- */
await page.reload();
const t0 = Date.now();
await page.locator('[data-book]').first().click({ timeout: 5000 });
await page.click('#bk-share');
const forgeAtTap = await page.evaluate(() => {
  const m = window.tenebrae._forge.map();
  return { forged: m ? Object.keys(m) : null, ms: Math.round(performance.now()) };
});
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Download PDF (.pdf)' }).click(),
]);
const tapMs = Date.now() - t0;
const early = await readFile(await dl.path());
await writeFile(`${OUT}/early.pdf`, early);
console.log(`tapped at +${tapMs}ms after reload; forge map at tap = ${JSON.stringify(forgeAtTap)}`);
console.log('early PDF:', JSON.stringify(shape(early)));
// Whether this box is slow enough to still be waking at the tap is the box's
// business, not the app's. When it is, the precondition is a real check; when
// it is not, the window is covered deterministically by
// cf-adv-pdf-forge-race-slow.mjs, which throttles the CPU 20x — so record it and
// do not count a fast machine as a failure. The check that matters below runs
// either way: a PDF tapped at ANY moment has to carry the script.
const insideWindow = tapMs < 3500 && (forgeAtTap.forged === null || forgeAtTap.forged.length === 0);
if(insideWindow) ck('precondition: the tap really landed inside the wake window', true,
   `tap +${tapMs}ms, forged = ${JSON.stringify(forgeAtTap.forged)}`);
else console.log(`   NOTE: this box had already woken the forge at the tap (+${tapMs}ms) — window not reached here; see cf-adv-pdf-forge-race-slow.mjs`);

const e = shape(early);
ck('a PDF tapped before the forge wakes still carries the script (Type0 + FontFile2 + glyph runs)',
   e.type0 > 0 && e.fontFile2 > 0 && e.glyphRuns > 0,
   `type0=${e.type0} fontFile2=${e.fontFile2} glyphRuns=${e.glyphRuns} italicRuns=${e.italicRuns}`);

/* ---- control: the same tap after the wake ---- */
await wait(page, 4000);
await page.click('#bk-share');
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.locator('#sheet .sh-item', { hasText: 'Download PDF (.pdf)' }).click(),
]);
const late = await readFile(await dl2.path());
await writeFile(`${OUT}/late.pdf`, late);
console.log('late  PDF:', JSON.stringify(shape(late)));
const l = shape(late);
ck('control: the same tap after the wake does carry the script',
   l.type0 > 0 && l.fontFile2 > 0 && l.glyphRuns > 0,
   `type0=${l.type0} fontFile2=${l.fontFile2} glyphRuns=${l.glyphRuns}`);
ck('the early file and the late file are the same document',
   early.equals(late), `${early.length} vs ${late.length} bytes — a silent difference means the tap decided what the book is`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF FORGE RACE', checks.every(c => c[1]));
await browser.close();
await srv.close();
