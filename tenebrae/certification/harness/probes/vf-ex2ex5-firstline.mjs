// vf-EX-2 / vf-EX-5 — adversarial re-check of the first-line markdown defects:
//   (a) EX-2: a mark (bold) applied on the FIRST typed line of a fresh scene
//       is dropped from the .md and the line fragments into paragraphs;
//   (b) EX-5: a translation span on that first line leaks raw PUA glyphs into
//       the .md with no romanization.
// Skeptic angles covered: the DOM is dumped so we can see whether the bare
// top-level run is an artifact of scripted typing (it is not — real
// page.keyboard typing, and vf-ex3-plaintext.mjs shows the same shape); the
// CONTROL is the same content on a wrapped line 2, exported from the same
// book in the same file, which must come out correct.
// Run: cd probes && node vf-ex2ex5-firstline.mjs
import { launch, wait, createBook, selectWord, insertTranslationSpan, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'VF Firstline Book');
await page.click('#ed-content');
// line 1 — the bare top-level run (never wrapped by Chromium)
await page.keyboard.type('alpha keel the harbor sleeps omega');
await page.keyboard.press('Enter');
// line 2 — wrapped <p> control with the same shape
await page.keyboard.type('ctrla mast the anchor holds ctrlz');
await wait(page, 300);

// bold one word on each line
await selectWord(page, 'keel');
await page.click('[data-cmd="bold"]');
await wait(page, 250);
await selectWord(page, 'mast');
await page.click('[data-cmd="bold"]');
await wait(page, 250);

// translation span on each line (Celan Basic)
await insertTranslationSpan(page, 'harbor sleeps', 'Celan Basic');
await insertTranslationSpan(page, 'anchor holds', 'Celan Basic');

console.log('editor DOM:', await page.evaluate(() => document.querySelector('#ed-content').innerHTML));
// 2026-08 TRIAGE (stale-probe fix, TX-1): expectations must come from the REAL
// engine seam window.tenebrae.translate2 (resolveTranslate → embedded Codex
// Omnilingua). window.tenebrae.translate is the legacy sample cipher and
// answered "purtus durmenin"/"enkhes tenenin" where the app writes
// "harbora dorma"/"ancora tena", so both romanization checks (including the
// CONTROL line) missed against an engine that is not under test.
const roms = await page.evaluate(async () => ({
  r1: (await window.tenebrae.translate2('celan_basic', 'harbor sleeps')).romanization,
  r2: (await window.tenebrae.translate2('celan_basic', 'anchor holds')).romanization,
}));
// the spans themselves must carry script, not Latin (TX-9 / X2-14): dump the
// data-scr codepoints, which are invisible in a terminal.
console.log('span data-scr codepoints:', JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('#ed-content .tspan')].map(t =>
    [...(t.dataset.scr || '')].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')))));
console.log('expected romanizations:', JSON.stringify(roms));

await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-share');
await wait(page, 450);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md ---\n' + md.text + '\n---------------');

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
// control line (wrapped <p>) must be healthy
const ctrlOK = has('CONTROL line 2: bold kept + romanization comment', md.text.includes('**mast**') && md.text.includes(roms.r2) && /tenebrae:begin/.test(md.text));
// first line defects
const boldKept = has('line 1: **keel** present', md.text.includes('**keel**'));
const oneLine  = has('line 1: kept as one paragraph', /alpha[^\n]*omega/.test(md.text));
const romKept  = has('line 1: romanization present', md.text.includes(roms.r1));
const puaLeak  = PUA_RE.test(md.text);
console.log('md leaks PUA glyphs:', puaLeak);
console.log('pageerrors:', errors.length ? errors : 'none');

// PASS = the first-line defect is absent
verdict('vf-EX-2/EX-5 first-line', ctrlOK && boldKept && oneLine && romKept && !puaLeak && errors.length === 0);
if (ctrlOK && (!boldKept || !oneLine || !romKept || puaLeak))
  console.log('CONFIRMED: wrapped-line export is correct but the first-line bare run drops marks/fragments and leaks PUA glyphs (mdFromDoc L1950 fallback).');

await browser.close();
await srv.close();
