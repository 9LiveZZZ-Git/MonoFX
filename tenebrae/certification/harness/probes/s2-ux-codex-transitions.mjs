// X2-14 (gap coverage): sample -> imported codex -> removal transitions.
// The same two prose spans must stay TEXT (zero svg) with the CORRECT script
// font actually drawing real glyphs at every stage:
//   1. sample codex  — sample PUA + embedded sample TTFs
//   2. imported codex — re-rendered as omni spans, forged-TTF PUA, data-scr
//   3. codex removed — re-rendered back to sample tongues, sample PUA again,
//      no data-omni leftovers (an orphaned omni span would be fontless tofu)
// Canvas distinctness is the glyph proof; stored docs are checked for '<svg'.
// Run: cd probes && node s2-ux-codex-transitions.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

const inspectSpans = () => page.evaluate(() => {
  const draw = (ch, fam) => {
    const cv = document.createElement('canvas'); cv.width = 44; cv.height = 44;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 44, 44);
    g.fillStyle = '#000'; g.font = `34px ${fam}`;
    g.fillText(ch, 4, 36);
    return cv.toDataURL();
  };
  return [...document.querySelectorAll('#ed-content .tspan')].map(sp => {
    const cs = getComputedStyle(sp);
    const text = sp.textContent;
    const pua = [...new Set([...text].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF))];
    const imgs = pua.slice(0, 4).map(c => draw(c, cs.fontFamily));
    return {
      lang: sp.dataset.lang, src: sp.dataset.src, omni: sp.dataset.omni || null, scr: sp.dataset.scr || null,
      textIsScr: sp.dataset.scr ? sp.textContent === sp.dataset.scr : null,
      puaCount: pua.length, svg: sp.querySelectorAll('svg').length,
      family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      distinct: new Set(imgs).size, samples: imgs.length,
    };
  });
});
const sceneDocProbe = () => page.evaluate(() => window.tenebrae._omni.probe.sceneDoc());
const reopenScene = async title => {
  await page.locator('#lib-list .row', { hasText: title }).click();
  await wait(page, 600);
  await page.locator('#bk-list .row[data-scene]').first().click();
  await wait(page, 700);
};
const backToLibrary = async () => {
  await page.click('#ed-back'); await wait(page, 500);
  await page.click('#bk-back'); await wait(page, 500);
};
const glyphOK = s => s.svg === 0 && s.puaCount >= 2 && s.samples >= 2 && s.distinct >= 2 && !!s.src;

// ---- stage 1: sample codex ----
await createBook(page, 'Transition Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the fallen king tonight');
await wait(page, 800);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await insertTranslationSpan(page, 'fallen king', 'Kerrackian');
await wait(page, 1500);
const st1 = await inspectSpans();
console.log('stage 1 (sample):', JSON.stringify(st1, null, 1));
ck('stage 1: two sample spans, text + real distinct glyphs', st1.length === 2 && st1.every(glyphOK), JSON.stringify(st1.map(s => `${s.lang}:${s.distinct}/${s.samples}`)));
ck('stage 1: sample script fonts drawing', st1.some(s => s.family === 'Tenebrae Celan Runes') && st1.some(s => s.family === 'Tenebrae Fallen Script'), JSON.stringify(st1.map(s => s.family)));
const doc1 = await sceneDocProbe();
ck('stage 1: stored doc holds text spans, no svg', typeof doc1 === 'string' && doc1.includes('tspan') && !doc1.includes('<svg'));

// ---- stage 2: import the real codex ----
await backToLibrary();
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
await reopenScene('Transition Book');
await page.waitForFunction(() => {
  const sps = [...document.querySelectorAll('#ed-content .tspan')];
  return sps.length === 2 && sps.every(sp => sp.dataset.omni === '1' && sp.dataset.scr && sp.textContent === sp.dataset.scr);
}, null, { timeout: 25000 });
const st2 = await inspectSpans();
console.log('stage 2 (imported codex):', JSON.stringify(st2, null, 1));
ck('stage 2: both spans re-rendered as omni TEXT spans, sources kept',
   st2.length === 2 && st2.every(s => s.omni === '1' && s.textIsScr === true && s.svg === 0) &&
   st2.map(s => s.src).sort().join('|') === 'fallen king|sea remembers');
ck('stage 2: forged/celan fonts draw real distinct glyphs', st2.every(s => glyphOK(s) && /^Tenebrae (Omni|Celan Runes)/.test(s.family)),
   JSON.stringify(st2.map(s => `${s.family}:${s.distinct}/${s.samples}`)));
const doc2 = await sceneDocProbe();
ck('stage 2: stored doc still svg-free', typeof doc2 === 'string' && !doc2.includes('<svg'));

// ---- stage 3: remove the codex (back to sample) ----
await backToLibrary();
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Remove codex' }).click();
await wait(page, 600);
await page.click('#cs-yes');
await page.waitForFunction(() => /Back to the sample codex/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
await wait(page, 600);
await reopenScene('Transition Book');
await wait(page, 800);
const st3 = await inspectSpans();
console.log('stage 3 (codex removed):', JSON.stringify(st3, null, 1));
ck('stage 3: two spans survive removal with sources kept', st3.length === 2 && st3.map(s => s.src).sort().join('|') === 'fallen king|sea remembers');
ck('stage 3: no orphaned omni spans (would be fontless)', st3.every(s => s.omni === null && s.scr === null), JSON.stringify(st3.map(s => s.omni)));
ck('stage 3: spans are sample TEXT script again, real distinct glyphs', st3.every(s => glyphOK(s) && /^Tenebrae /.test(s.family)),
   JSON.stringify(st3.map(s => `${s.lang}:${s.family}:${s.distinct}/${s.samples}`)));
const doc3 = await sceneDocProbe();
ck('stage 3: stored doc svg-free and holds both spans', typeof doc3 === 'string' && !doc3.includes('<svg') && (doc3.match(/class="tspan"/g) || []).length === 2);

// spans still LIVE after the round trip: retranslate one via its sheet
await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
await wait(page, 700);
const sheetUp = await page.evaluate(() => !!document.querySelector('#sheet .sh-item'));
ck('stage 3: spans still open their sheet (live, re-translatable)', sheetUp);
await page.evaluate(() => document.querySelector('#scrim').click());
await wait(page, 400);

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-14 codex-transitions', checks.every(c => c[1]));
await browser.close();
await srv.close();
