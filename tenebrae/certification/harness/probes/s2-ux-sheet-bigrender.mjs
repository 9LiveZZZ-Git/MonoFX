// X2-14 (gap coverage): the tongue sheet's BIG RENDER (tap a span -> action
// sheet headline) must be script TEXT, no SVG, drawn by the real script font —
// under BOTH engines. Canvas pixel proof: distinct PUA chars must draw
// distinct glyphs in the big render's computed font (identical images = tofu,
// i.e. the font never applied). Vertical tongues must carry data-flow +
// writing-mode inside the sheet too.
// Run: cd probes && node s2-ux-sheet-bigrender.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// open the span's sheet and inspect the big render
async function inspectSheet(spanIndex){
  await page.evaluate(i => document.querySelectorAll('#ed-content .tspan')[i].click(), spanIndex);
  await wait(page, 800);
  const info = await page.evaluate(() => {
    const sp = document.querySelector('#sheet .sheet-note .tspan');
    if(!sp) return null;
    const cs = getComputedStyle(sp);
    const text = sp.textContent;
    const puaChars = [...new Set([...text].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF))];
    const draw = ch => {
      const cv = document.createElement('canvas'); cv.width = 44; cv.height = 44;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 44, 44);
      g.fillStyle = '#000'; g.font = `34px ${cs.fontFamily}`;
      g.fillText(ch, 4, 36);
      return cv.toDataURL();
    };
    const imgs = puaChars.slice(0, 4).map(draw);
    const letters = [...text].filter(c => /\S/.test(c));
    return {
      text, textLen: text.length,
      puaShare: letters.length ? letters.filter(c => c.charCodeAt(0) >= 0xE000).length / letters.length : 0,
      svg: sp.querySelectorAll('svg').length,
      family: cs.fontFamily, writingMode: cs.writingMode,
      dataFlow: sp.getAttribute('data-flow'), dataLang: sp.getAttribute('data-lang'), dataOmni: sp.getAttribute('data-omni'),
      fontCovers: document.fonts.check(`34px ${cs.fontFamily.split(',')[0]}`, text),
      drawnDistinct: new Set(imgs).size, drawnSamples: imgs.length,
    };
  });
  await page.evaluate(() => document.querySelector('#scrim').click()); // close sheet
  await wait(page, 500);
  return info;
}

// ---- stage 1: sample codex ----
await createBook(page, 'Sheet Render Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the old king tonight');
await wait(page, 800);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1200);
const s1 = await inspectSheet(0);
console.log('sample sheet render:', JSON.stringify(s1));
ck('sample: big render exists and is TEXT (zero svg)', !!s1 && s1.svg === 0 && s1.textLen > 0);
ck('sample: big render is the script itself (>=90% PUA)', !!s1 && s1.puaShare >= 0.9, s1 && `pua ${Math.round(s1.puaShare * 100)}%`);
ck('sample: script font applies (family + coverage)', !!s1 && /Tenebrae Celan Runes/.test(s1.family) && s1.fontCovers, s1 && s1.family);
ck('sample: canvas draws distinct real glyphs, not tofu', !!s1 && s1.drawnSamples >= 2 && s1.drawnDistinct >= 2, s1 && `${s1.drawnDistinct}/${s1.drawnSamples} distinct`);

// ---- stage 2: imported codex ----
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
await page.locator('#lib-list .row', { hasText: 'Sheet Render Book' }).click();
await wait(page, 600);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 700);
await page.waitForFunction(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp && sp.dataset.omni === '1' && sp.dataset.scr && sp.textContent === sp.dataset.scr;
}, null, { timeout: 25000 });

// add a span in a scripted horizontal tongue and one in a VERTICAL tongue
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const p = document.createElement('p');
  p.textContent = 'the drover walks the long road home';
  ed.appendChild(p);
});
await insertTranslationSpan(page, 'long road', 'Kerrackian');   // rtl scripted tongue
await insertTranslationSpan(page, 'drover walks', 'Celan High'); // cols-rtl vertical tongue
await wait(page, 800);
const spanMeta = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map((sp, i) => ({ i, lang: sp.dataset.lang, flow: sp.dataset.flow || null })));
console.log('editor spans:', JSON.stringify(spanMeta));

const kerrIdx = spanMeta.find(s => s.lang === 'kerrackian').i;
const s2 = await inspectSheet(kerrIdx);
console.log('omni sheet render (kerrackian):', JSON.stringify(s2));
ck('omni: big render exists and is TEXT (zero svg)', !!s2 && s2.svg === 0 && s2.textLen > 0);
ck('omni: big render is the script itself (>=90% PUA)', !!s2 && s2.puaShare >= 0.9, s2 && `pua ${Math.round(s2.puaShare * 100)}%`);
ck('omni: forged script font applies in the sheet (family + coverage)', !!s2 && /Tenebrae Omni/.test(s2.family) && s2.fontCovers,
   s2 && `family=${s2.family} covers=${s2.fontCovers} data-omni=${s2.dataOmni}`);
ck('omni: canvas draws distinct real glyphs in the sheet, not tofu', !!s2 && s2.drawnSamples >= 2 && s2.drawnDistinct >= 2,
   s2 && `${s2.drawnDistinct}/${s2.drawnSamples} distinct`);

const vertIdx = spanMeta.find(s => s.flow === 'cols-rtl').i;
const s3 = await inspectSheet(vertIdx);
console.log('omni sheet render (vertical):', JSON.stringify(s3));
ck('omni vertical: sheet big render keeps data-flow + writing-mode', !!s3 && s3.dataFlow === 'cols-rtl' && s3.writingMode === 'vertical-lr',
   s3 && `${s3.dataFlow} ${s3.writingMode}`);
ck('omni vertical: sheet big render is text, no svg', !!s3 && s3.svg === 0 && s3.puaShare >= 0.9);
// NOTE: document.fonts.check() is coverage-insensitive for loaded faces — the
// canvas distinctness is the authoritative real-glyph proof here.
ck('omni vertical: sheet big render draws real glyphs (forged font), not tofu',
   !!s3 && /Tenebrae Omni/.test(s3.family) && s3.drawnSamples >= 2 && s3.drawnDistinct >= 2,
   s3 && `family=${s3.family} distinct=${s3.drawnDistinct}/${s3.drawnSamples}`);

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-14 sheet-bigrender', checks.every(c => c[1]));
await browser.close();
await srv.close();
