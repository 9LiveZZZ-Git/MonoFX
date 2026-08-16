// X2-14: translations render in the ACTUAL CONSTRUCTED SCRIPT — never
// romanization dressed in a Latin font.
//   Sample codex: every tongue maps to PUA codepoints rendered by the four
//   embedded script TTFs. PUA has no Latin fallback, so glyph presence is
//   provable: text is PUA, the tongue's font is loaded and supplies those
//   codepoints, and a canvas pixel test shows distinct real glyphs (a missing
//   font would draw identical tofu boxes).
//   Imported codex: spans render the codex's SVG glyph systems, including
//   vertical flows (cols-rtl staves, btt-stave notches).
// Run: cd probes && node s2-glyph-script.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };
const PUA = c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF;
const puaShare = s => { const letters = [...String(s)].filter(c => /\S/.test(c)); return letters.length ? letters.filter(PUA).length / letters.length : 0; };

// ---- sample codex: every tongue renders PUA script, not Latin ----
const sample = await page.evaluate(() => {
  const c = window.tenebrae.codex();
  return c.languages.map(l => {
    const r = window.tenebrae.translate(l.id, 'the sea remembers the old king');
    return { id: l.id, family: l.fontFamily, rom: r.romanization, rendered: r.rendered, dir: l.dir };
  });
});
console.log('sample tongues:', JSON.stringify(sample.map(t => ({ id: t.id, family: t.family, rom: t.rom, renderedLen: t.rendered.length })), null, 1).slice(0, 800));
ck('all 7 sample tongues produce a rendered script form', sample.length === 7 && sample.every(t => t.rendered && t.rendered.length > 0));
ck('rendered form is PUA script (>=90% of letters), never the romanization', sample.every(t => puaShare(t.rendered) >= 0.9 && t.rendered !== t.rom),
   sample.map(t => `${t.id}:${Math.round(puaShare(t.rendered) * 100)}%`).join(' '));

// fonts loaded and supplying those exact codepoints
const fontState = await page.evaluate(langs => langs.map(t => {
  const ch = [...t.rendered].find(c => c.charCodeAt(0) >= 0xE000);
  return { id: t.id, family: t.family, loaded: document.fonts.check(`16px "${t.family}"`, t.rendered) };
}), sample);
ck('every tongue\'s script font is loaded and covers its rendered text', fontState.every(f => f.loaded), JSON.stringify(fontState.filter(f => !f.loaded)));

// canvas proof: real distinct glyphs, not tofu, not Latin reuse
const glyphPixels = await page.evaluate(() => {
  const draw = (ch, family) => {
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 40, 40);
    g.fillStyle = '#000'; g.font = `32px "${family}"`;
    g.fillText(ch, 4, 32);
    return cv.toDataURL();
  };
  const fam = 'Tenebrae Celan Runes';
  const a = String.fromCharCode(0xE100), b = String.fromCharCode(0xE101);
  return {
    twoGlyphsDiffer: draw(a, fam) !== draw(b, fam),          // tofu would be identical
    glyphNotLatin: draw(a, fam) !== draw('a', 'Georgia'),    // not Latin reuse
    glyphNotFallback: draw(a, fam) !== draw(a, 'Georgia'),   // font actually applies
  };
});
ck('canvas: two script glyphs are visually distinct (not tofu)', glyphPixels.twoGlyphsDiffer);
ck('canvas: script glyph differs from Latin letterform', glyphPixels.glyphNotLatin);
ck('canvas: custom font actually applies (differs from serif fallback)', glyphPixels.glyphNotFallback);

// in the real editor: a span shows PUA + the script font
await createBook(page, 'Glyph Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight, said the fallen king');
await wait(page, 1200);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await insertTranslationSpan(page, 'fallen king', 'Kerrackian');
const uiSpans = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(sp => ({
  lang: sp.dataset.lang, text: sp.textContent, dir: sp.getAttribute('dir'),
  family: getComputedStyle(sp).fontFamily,
})));
console.log('editor spans:', JSON.stringify(uiSpans, null, 1));
ck('editor spans render PUA script text', uiSpans.length === 2 && uiSpans.every(sp => [...sp.text].some(c => c.charCodeAt(0) >= 0xE000)));
ck('editor spans use their script fonts', uiSpans.some(sp => /Celan Runes/.test(sp.family)) && uiSpans.some(sp => /Fallen Script/.test(sp.family)));
ck('Kerrackian span is RTL', uiSpans.find(sp => sp.lang === 'kerrackian').dir === 'rtl');

// ---- imported codex: SVG glyph systems incl. vertical flows ----
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 500);
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX_PATH);
await page.waitForFunction(() => /tongues awake/.test(document.querySelector('#toast').textContent), null, { timeout: 45000 });
await wait(page, 600);

// open the book again and add spans in scripted tongues (incl. a vertical one)
await page.locator('#lib-list .row', { hasText: 'Glyph Book' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
await page.evaluate(() => { // fresh line to translate
  const ed = document.querySelector('#ed-content');
  const p = document.createElement('p');
  p.textContent = 'the drover walks the long road home';
  ed.appendChild(p);
});
await insertTranslationSpan(page, 'long road', 'Kildaren');   // btt-stave in the real codex
await insertTranslationSpan(page, 'drover walks', 'Celan High'); // cols-rtl
const omniSpans = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan[data-omni]')].map(sp => ({
  lang: sp.dataset.lang, svgGlyphs: sp.querySelectorAll('svg').length,
  vertical: sp.querySelectorAll('.tn-w.v').length, dir: sp.getAttribute('dir'),
  looseText: [...sp.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim(),
})));
console.log('omni spans:', JSON.stringify(omniSpans, null, 1));
ck('imported-codex spans draw SVG glyphs', omniSpans.length >= 2 && omniSpans.every(sp => sp.svgGlyphs > 0));
ck('vertical script (btt-stave / cols-rtl) tokens carry the vertical class', omniSpans.some(sp => sp.vertical > 0), JSON.stringify(omniSpans.map(sp => `${sp.lang}:${sp.vertical}v`)));
ck('no bare romanization text outside the glyphs', omniSpans.every(sp => sp.looseText.length === 0), JSON.stringify(omniSpans.map(sp => sp.looseText)));

// the older sample spans re-rendered under the codex too
const rerendered = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(sp => ({ lang: sp.dataset.lang, omni: sp.dataset.omni, svg: sp.querySelectorAll('svg').length })));
ck('pre-existing spans re-rendered as codex glyphs', rerendered.filter(r => r.omni === '1').length === rerendered.length, JSON.stringify(rerendered));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-14 glyph-script', checks.every(c => c[1]));
await browser.close();
await srv.close();
