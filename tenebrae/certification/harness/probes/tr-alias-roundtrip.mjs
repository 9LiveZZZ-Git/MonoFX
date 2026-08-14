// TR-5 adversarial — tongue identity across a codex import/remove round trip.
// OMNI_ALIAS (step1.html L2326) maps sample ids to engine ids one-way:
// 'celan-high' → 'celan_high', 'rath-speech' → null (silently retargeted to
// celan_basic by omniTranslate L2397). spanFromResult stores r.lang.id back
// onto the span (L2489), so after codex removal makeTSpan gets an id the
// sample codex doesn't know ('celan_high') and codexLang (L2225-2228) falls
// back to languages[0] — celan-basic. Source text survives; the chosen tongue
// does not. This probe demonstrates the degradation end to end.
// Run: cd probes && node tr-alias-roundtrip.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };

await createBook(page, 'Alias Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers and the old king waits');
await wait(page, 300);
await insertTranslationSpan(page, 'sea remembers', 'Celan High');
await insertTranslationSpan(page, 'old king', 'Rath-Speech');
const snap = () => page.evaluate(() =>
  [...document.querySelectorAll('#ed-content .tspan')].map(t =>
    ({ src: t.dataset.src, lang: t.dataset.lang, rom: t.dataset.rom })));
const before = await snap();
console.log('before import:', JSON.stringify(before));
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);

// import the real codex through the UI
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX);
await sleep(8000);
console.log('toast:', await page.evaluate(() => document.querySelector('#toast').textContent));
await page.locator('#lib-list .row', { hasText: 'Alias Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 1000);
const under = await snap();
console.log('under codex:', JSON.stringify(under));
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);

// remove the codex
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
await page.locator('#sheet .sh-item', { hasText: 'Remove codex' }).click();
await wait(page, 700);
await page.click('#cs-yes');
await wait(page, 1500);
await page.locator('#lib-list .row', { hasText: 'Alias Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 800);
const after = await snap();
console.log('after removal:', JSON.stringify(after));

const hi = { b: before.find(s => s.src === 'sea remembers'), a: after.find(s => s.src === 'sea remembers') };
const ra = { b: before.find(s => s.src === 'old king'), a: after.find(s => s.src === 'old king') };
has('source text preserved on both spans', !!hi.a && !!ra.a && hi.a.src === 'sea remembers' && ra.a.src === 'old king');
const hiKept = hi.a && hi.a.lang === hi.b.lang && hi.a.rom === hi.b.rom;
const raKept = ra.a && ra.a.lang === ra.b.lang && ra.a.rom === ra.b.rom;
has('Celan High span keeps its tongue across the round trip', hiKept);
has('Rath-Speech span keeps its tongue across the round trip', raKept);
if (!hiKept) console.log(`DEGRADED: celan-high -> ${under.find(s => s.src === 'sea remembers').lang} -> ${hi.a.lang} (rom "${hi.b.rom}" -> "${hi.a.rom}")`);
if (!raKept) console.log(`DEGRADED: rath-speech -> ${under.find(s => s.src === 'old king').lang} -> ${ra.a.lang} (rom "${ra.b.rom}" -> "${ra.a.rom}")`);
console.log('pageerrors:', errors.length ? errors : 'none');
verdict('tongue identity round-trips (anomaly check, not a TR-5 gate)', hiKept && raKept);

await browser.close();
await srv.close();
