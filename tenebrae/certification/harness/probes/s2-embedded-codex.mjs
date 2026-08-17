// THE fix for "translations are still not in the script": the real Codex
// Omnilingua is EMBEDDED — the true engine and true scripts are the default
// from first launch, no import step, and the placeholder cipher is unreachable
// for translation. Verified against the codex itself on the user's own text.
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { chromium } from 'playwright-core';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };
const WARRANT = 'Declared: my mana - let it stand as coa. Declared: the wax-candle - let it stand as coe.';

// ---- ground truth from the codex itself (patched standalone) ----
const gt = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const cpage = await gt.newPage();
await cpage.goto('file:///tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex-patched.html');
await cpage.waitForFunction(() => window.CODEX && window.FAMILY, null, { timeout: 30000 });
const codexSays = await cpage.evaluate(src => {
  const T = window.CODEX.TRANS.celan_high;
  const res = window.CODEX.compileText(T, src, 'e2l');
  const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
  return lines.map(l => l.map(p => p.t).join(' ')).join(' ');
}, WARRANT);
await gt.close();
console.log('codex says   :', JSON.stringify(codexSays));

// ---- the writer, FRESH, no import, nothing ----
const { srv, browser, page, errors } = await launch();
const boot = await page.evaluate(() => ({
  codex: window.tenebrae.codex() && { name: window.tenebrae.codex().name, kind: window.tenebrae.codex().kind, embedded: !!window.tenebrae.codex().embedded },
}));
console.log('default codex:', JSON.stringify(boot.codex));
ck('embedded Codex Omnilingua is the default engine (no import)', !!boot.codex && boot.codex.kind === 'omni-host' && boot.codex.embedded);

const writerSays = await page.evaluate(async src => {
  const r = await window.tenebrae.translate2('celan_high', src);
  return r && r.romanization;
}, WARRANT);
console.log('writer says  :', JSON.stringify(writerSays));
ck('writer translation IS the codex translation (byte-identical)', writerSays === codexSays);

const langs = await page.evaluate(() => window.tenebrae.langs());
const names = (langs.langs || langs).map(l => l.name || l.id);
console.log('tongues:', JSON.stringify(names));
ck('tongue list is the codex\'s (6 tongues, no sample-only Rath-Speech)', names.length === 6 && !names.some(n => /rath/i.test(n)));

// through the real editor UI: Seal-Hand columns, forged font, PUA text
await createBook(page, 'Warrant Book');
await page.click('#ed-content');
await page.keyboard.type('padding line one');
await page.keyboard.press('Enter');
await page.keyboard.type('Declared: my mana - let it stand as coa.');
await wait(page, 800);
await insertTranslationSpan(page, 'my mana', 'Celan High');
await wait(page, 2500); // embedded engine may still be waking on first use
let span = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return null;
  const pua = [...sp.textContent].filter(c => c.charCodeAt(0) >= 0xE500 && c.charCodeAt(0) < 0xE580).length;
  return { lang: sp.dataset.lang, flow: sp.dataset.flow, pua, cols: (sp.dataset.scr || '').split('\n').length,
    family: getComputedStyle(sp).fontFamily, wm: getComputedStyle(sp).writingMode,
    tallerThanWide: sp.getBoundingClientRect().height > sp.getBoundingClientRect().width };
});
console.log('editor span:', JSON.stringify(span));
ck('span is Celan High in forged Seal-Hand PUA text', !!span && span.lang === 'celan_high' && span.pua > 0 && /Tenebrae Omni Celan High/.test(span.family));
ck('span lays out as canonical vertical columns', !!span && span.flow === 'cols-rtl' && span.wm === 'vertical-lr' && span.tallerThanWide);
ck('no page exceptions', errors.length === 0, errors.join(' | ').slice(0, 200));
verdict('EMBEDDED CODEX', checks.every(c => c[1]));
await browser.close();
await srv.close();
