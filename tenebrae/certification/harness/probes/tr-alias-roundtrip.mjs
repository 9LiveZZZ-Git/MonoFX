// TX-9 / TX-1 adversarial — tongue identity across a codex import/remove round trip.
//
// TRIAGE 2026-08-21 — this probe was written against a contract the artifact
// deliberately replaced, and it CRASHED before asserting anything:
//   locator.click: Timeout 30000ms exceeded.
//     - waiting for locator('#sheet .sh-item').filter({ hasText: 'Rath-Speech' })
// Two reasons it is stale:
//   (a) Rath-Speech no longer exists as a translatable tongue. The codex marks
//       it dead ("Rath-Speech †", codex.html L413), its <section
//       id="lang-rath_speech"> is empty (codex.html L731) and buildLang
//       registers no TRANS core for it, so the codex's own roster is six
//       tongues; OMNI_ALIAS maps 'rath-speech' → null (step1.html L3574).
//   (b) The degradation it was written to demonstrate — codex removal dropping
//       a span onto the sample cipher's languages[0] — cannot happen any more.
//       TX-1 requires the embedded Codex Omnilingua to be the engine on every
//       path including "removal of an imported codex", and removeOmniPack
//       (step1.html L4365-4373) restores embeddedCodexPack() and re-renders
//       every span. So the round trip is now a REQUIREMENT (TX-9: "spans
//       created before a codex import re-render after it; a span never degrades
//       to Latin text"), not an anomaly note, and the verdict gates on it.
//
// The trip: two spans in two different flows (Celan High = cols-rtl, Kerrackian
// = rtl) made under the embedded engine → import the real codex HTML through the
// library menu → remove it → assert tongue, romanization AND the forged PUA
// script run are byte-identical at every stage, with no Latin fallback.
// Run: cd probes && node tr-alias-roundtrip.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const PUA = /[-]/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };

await wait(page, 3500); // engine wake + forge
await createBook(page, 'Alias Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers and the old king waits');
await wait(page, 300);
await insertTranslationSpan(page, 'sea remembers', 'Celan High');
await insertTranslationSpan(page, 'old king', 'Kerrackian');

const snap = () => page.evaluate(() =>
  [...document.querySelectorAll('#ed-content .tspan')].map(t => ({
    src: t.dataset.src, lang: t.dataset.lang, rom: t.dataset.rom,
    flow: t.dataset.flow || 'ltr', dir: t.getAttribute('dir') || '',
    scr: t.dataset.scr || '', text: t.textContent,
  })));
const engine = () => page.evaluate(() => window.tenebrae.langs().then(x => ({ n: x.langs.length, note: x.note })));

const before = await snap();
console.log('before import:', JSON.stringify(before));
console.log('engine before:', JSON.stringify(await engine()));
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);

// import the real codex file through the UI
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX);
await sleep(10000);
console.log('toast:', await page.evaluate(() => document.querySelector('#toast').textContent));
await page.locator('#lib-list .row', { hasText: 'Alias Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 2500);
const under = await snap();
console.log('under imported codex:', JSON.stringify(under));
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);

// remove the imported codex → must fall back to the EMBEDDED codex (TX-1)
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 2000);
await page.locator('#sheet .sh-item', { hasText: 'Remove imported codex' }).click();
await wait(page, 700);
await page.click('#cs-yes');
await wait(page, 3000);
const engAfter = await engine();
console.log('engine after removal:', JSON.stringify(engAfter));
await page.locator('#lib-list .row', { hasText: 'Alias Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 2500);
const after = await snap();
console.log('after removal:', JSON.stringify(after));

const find = (arr, s) => arr.find(x => x.src === s);
const eq = (a, b) => a && b && a.lang === b.lang && a.rom === b.rom && a.flow === b.flow &&
                     a.dir === b.dir && a.scr === b.scr && a.text === b.text;
const hi = { b: find(before, 'sea remembers'), u: find(under, 'sea remembers'), a: find(after, 'sea remembers') };
const ke = { b: find(before, 'old king'), u: find(under, 'old king'), a: find(after, 'old king') };

const checks = [
  has('both spans exist at all three stages',
      [hi.b, hi.u, hi.a, ke.b, ke.u, ke.a].every(Boolean)),
  has('spans were forged as real script to begin with (PUA, not Latin)',
      PUA.test(hi.b.scr) && PUA.test(ke.b.scr) && hi.b.scr === hi.b.text && ke.b.scr === ke.b.text),
  // dir="rtl" belongs to the horizontal rtl tongue alone (TX-6): Celan High is
  // cols-rtl and must NOT carry it, or the column stands on its head.
  has('flows are the codex flows (Celan High cols-rtl with no dir attr; Kerrackian rtl + dir="rtl")',
      hi.b.flow === 'cols-rtl' && hi.b.dir === '' && ke.b.flow === 'rtl' && ke.b.dir === 'rtl'),
  has('Celan High span survives the import unchanged', eq(hi.b, hi.u)),
  has('Kerrackian span survives the import unchanged', eq(ke.b, ke.u)),
  has('Celan High span survives the removal unchanged', eq(hi.b, hi.a)),
  has('Kerrackian span survives the removal unchanged', eq(ke.b, ke.a)),
  has('no span degrades to Latin at any stage (TX-9)',
      [hi.u, hi.a, ke.u, ke.a].every(s => PUA.test(s.text) && s.text !== s.rom && s.text !== s.src)),
  has('removal lands on the embedded Codex Omnilingua, never the sample cipher (TX-1)',
      engAfter.n === 6 && /Codex Omnilingua v\d+/.test(engAfter.note) && !/sample/i.test(engAfter.note)),
];
for (const [n, o] of [['celan_high', hi], ['kerrackian', ke]])
  if (!eq(o.b, o.a)) console.log(`DEGRADED ${n}: ${JSON.stringify(o.b)} -> ${JSON.stringify(o.u)} -> ${JSON.stringify(o.a)}`);

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-9 / TX-1 codex round trip', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
