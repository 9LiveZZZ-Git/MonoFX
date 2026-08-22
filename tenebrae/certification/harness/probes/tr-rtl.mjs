// TR-4 — The RTL tongue (Kerrackian) renders its span with dir="rtl"
// isolation. Inserts a Kerrackian span through the real UI, then checks the
// dir attribute, computed CSS direction, and unicode-bidi isolation; an LTR
// control span (Kildaren) must NOT carry dir="rtl".
// Run: cd probes && node tr-rtl.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'RTL Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the stone gate holds and the deep water waits');
await wait(page, 300);

await insertTranslationSpan(page, 'stone gate holds', 'Kerrackian');
await insertTranslationSpan(page, 'deep water waits', 'Calgridarian'); // horizontal LTR control

const spans = await page.evaluate(() => {
  return [...document.querySelectorAll('#ed-content .tspan')].map(t => {
    const cs = getComputedStyle(t);
    return { lang: t.dataset.lang, dirAttr: t.getAttribute('dir'),
             direction: cs.direction, unicodeBidi: cs.unicodeBidi,
             rom: t.dataset.rom };
  });
});
console.log('spans:', JSON.stringify(spans, null, 1));
const ker = spans.find(s => s.lang === 'kerrackian');
const kil = spans.find(s => s.lang === 'calgridarian');
const engineDir = await page.evaluate(() => window.tenebrae.translateSampleLegacy('kerrackian', 'stone gate holds').dir);
console.log('engine dir for kerrackian:', engineDir);

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('kerrackian span present', !!ker),
  has('kerrackian engine result declares rtl', engineDir === 'rtl'),
  has('kerrackian span carries dir="rtl"', ker && ker.dirAttr === 'rtl'),
  has('computed direction is rtl', ker && ker.direction === 'rtl'),
  has('bidi isolation on the span (unicode-bidi: isolate)', ker && /isolate/.test(ker.unicodeBidi)),
  has('LTR control span (calgridarian) has no dir="rtl"', kil && kil.dirAttr !== 'rtl' && kil.direction === 'ltr'),
];

// dir survives persistence: reload and re-check the attribute
await wait(page, 1500);
await page.reload();
await wait(page, 800);
await page.locator('#lib-list .row', { hasText: 'RTL Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
const after = await page.evaluate(() => {
  const t = [...document.querySelectorAll('#ed-content .tspan')].find(x => x.dataset.lang === 'kerrackian');
  return t ? { dirAttr: t.getAttribute('dir'), direction: getComputedStyle(t).direction } : null;
});
console.log('kerrackian span after reload:', JSON.stringify(after));
checks.push(has('dir="rtl" survives reload', !!after && after.dirAttr === 'rtl' && after.direction === 'rtl'));

// the tap sheet also renders the big form RTL
await page.click('#ed-content .tspan[data-lang="kerrackian"]');
await wait(page, 700);
const sheetDir = await page.evaluate(() => {
  const el = document.querySelector('#sheet .tspan[data-lang="kerrackian"]');
  return el ? el.getAttribute('dir') : null;
});
console.log('tap-sheet big render dir:', sheetDir);
checks.push(has('tap sheet renders the form with dir="rtl"', sheetDir === 'rtl'));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TR-4', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
