// TR-5 — Codex import surface, functional, in three parts.
// (Rewritten for the post-4c9ebd1 artifact: the engine-wake poll chain is
// single now, ensureOmni removes its iframe on failure, omniPatchHTML seals
// the srcdoc with a CSP so the codex's external @import fails fast instead of
// hanging — the real codex is expected to wake through the pure UI with no
// test-seam assistance. The earlier revision of this probe documented the
// pre-fix wake failure and used the __omniInjected seam; that narrative is
// preserved in git history.)
//
// PART A  Baseline: sample-codex span in a scene; sample fonts registered
//         via FontFace at boot (document.fonts).
// PART B  Codex Pack (JSON with an embedded font). Pure UI: library menu →
//         Tenebrae Codex… → Import → chooser. Verifies validation, badge
//         clear, FontFace registration (document.fonts + computed font-style
//         flips italic→normal), span re-render, removal restores the sample.
// PART C  The REAL Codex Omnilingua HTML (3.4 MB, scratchpad; not committed),
//         imported through the real UI with no seam. Verifies the wake toast,
//         sample-disclosure clear, span re-render against the real engine
//         (data-omni + SVG glyph decoration), deterministic translation for
//         every engine tongue (repeat calls AND across a reload), RTL via the
//         real Kerrackian wing, and that removing the codex restores the
//         sample engine and re-renders spans back.
// Run: cd probes && node tr-codex-import.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const CODEX = SCRATCH + '/codex.html';
const PACK = SCRATCH + '/probe-codex-pack.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// build the JSON Codex Pack fixture (font borrowed from the app's own sample pack)
{
  const src = await readFile('/home/user/MonoFX/tenebrae/step1.html', 'utf8');
  const m = src.match(/\{"family": "Tenebrae Celan Runes", "format": "ttf", "data": "([^"]+)"\}/);
  if (!m) throw new Error('could not extract sample font from step1.html');
  await writeFile(PACK, JSON.stringify({
    name: 'Probe Pack', version: '9',
    languages: [
      { id: 'celan-basic', name: 'Probe Celan', fontFamily: 'Probe Rune Font', dir: 'ltr',
        script: { base: 0xE100, digraphs: { th: 26, sh: 27, ch: 28, ck: 29 } },
        shift: [['s', 'z'], ['m', 'b'], ['a', 'o']], affix: { plural: 'ux', past: 'or', prog: 'el' } },
      { id: 'probe-rtl', name: 'Probe RTL', fontFamily: 'Probe Rune Font', dir: 'rtl',
        shift: [['e', 'a']], affix: { plural: 'ak' } },
    ],
    lexicon: { sea: 'mar', remember: 'memna' },
    fonts: [{ family: 'Probe Rune Font', format: 'ttf', data: m[1] }],
  }));
}

const { srv, browser, page, errors } = await launch();
const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [];
const anomalies = [];
const external = [];
page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });

async function importFile(path){
  await page.click('#lib-more');
  await wait(page, 400);
  await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
  await wait(page, 900);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
  ]);
  await chooser.setFiles(path);
}
const toastText = () => page.evaluate(() => document.querySelector('#toast').textContent);
// wait until the toast matches re, up to ~timeoutS seconds; returns {t, seconds}
async function awaitToast(re, timeoutS){
  const t0 = Date.now();
  let t = '';
  while ((Date.now() - t0) / 1000 < timeoutS) {
    t = await toastText();
    if (re.test(t)) break;
    await sleep(500);
  }
  return { t, seconds: ((Date.now() - t0) / 1000).toFixed(1) };
}

/* ============ PART A — baseline ============ */
await createBook(page, 'Codex Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the stone gate');
await wait(page, 300);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
const before = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom, omni: t.dataset.omni || null };
});
const fontsBefore = await page.evaluate(() => [...document.fonts].map(f => f.family).sort());
console.log('[A] sample span:', JSON.stringify(before));
console.log('[A] document.fonts at boot:', JSON.stringify(fontsBefore));
checks.push(has('[A] sample fonts registered via FontFace at boot (4 Tenebrae families)',
  ['Tenebrae Celan Runes', 'Tenebrae Seal Hand', 'Tenebrae Fallen Script', "Tenebrae Drover's Notch"]
    .every(f => fontsBefore.includes(f))));
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 500);

/* ============ PART B — JSON Codex Pack with a font ============ */
await importFile(PACK);
await wait(page, 2500);
console.log('[B] toast after pack import:', JSON.stringify(await toastText()));
const packState = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  const fonts = [...document.fonts].map(f => f.family);
  return { note, langs: langs.map(l => l.name), fonts: fonts.filter(f => f.includes('Probe')),
           rom: window.tenebrae.translate('celan-basic', 'sea remembers').romanization };
});
console.log('[B] pack state:', JSON.stringify(packState));
checks.push(
  has('[B] JSON pack accepted; sample badge cleared; pack named in note',
      /Probe Pack/.test(packState.note) && !/sample codex/i.test(packState.note)),
  has('[B] pack tongues listed', packState.langs.includes('Probe Celan') && packState.langs.includes('Probe RTL')),
  has('[B] pack font registered via FontFace (document.fonts)', packState.fonts.includes('Probe Rune Font')),
  has('[B] translation now follows the pack rules (rom changed)', packState.rom !== before.rom),
);
// span re-rendered + computed style uses the pack font, non-italic (loaded)
await page.locator('#lib-list .row', { hasText: 'Codex Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 600);
const packSpan = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  const cs = getComputedStyle(t);
  return { src: t.dataset.src, rom: t.dataset.rom, family: cs.fontFamily, style: cs.fontStyle };
});
console.log('[B] span under the pack:', JSON.stringify(packSpan));
checks.push(
  has('[B] existing span re-rendered from source under the pack',
      packSpan.src === 'sea remembers' && packSpan.rom === packState.rom && packSpan.rom !== before.rom),
  has('[B] span styled with the pack font, upright (FontFace load confirmed)',
      /Probe Rune Font/.test(packSpan.family) && packSpan.style === 'normal'),
);
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);
// remove the pack → sample restored
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Remove pack' }).click();
await wait(page, 600);
await page.click('#cs-yes');
await wait(page, 1200);
const packGone = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  const c = window.tenebrae.codex();
  const r = await window.tenebrae.translate2('celan_basic', 'sea remembers');
  return { n: langs.length, embedded: !!c.embedded, kind: c.kind, name: c.name, rom: r.romanization };
});
console.log('[B] after pack removal:', JSON.stringify(packGone));
checks.push(has('[B] pack removal returns to the embedded Codex Omnilingua',
  packGone.embedded === true && packGone.kind === 'omni-host' && /Omnilingua/.test(packGone.name)));

/* ============ PART C — the real Codex Omnilingua HTML, pure UI ============ */
await importFile(CODEX);
const wake = await awaitToast(/awake|didn.t wake|Couldn/, 60);
console.log(`[C] wake outcome after ${wake.seconds}s:`, JSON.stringify(wake.t));
checks.push(has('[C] real codex imports and wakes through the pure UI (“tongues awake” toast)',
  /awake/.test(wake.t) && !/didn.t wake/.test(wake.t)));
if (!/awake/.test(wake.t)) anomalies.push(`pure-UI wake did not complete in ${wake.seconds}s: ${wake.t}`);

const seam = await page.evaluate(async () => {
  const { langs, note } = await window.tenebrae.langs();
  return { note, langs: langs.map(l => ({ id: l.id, name: l.name, dir: l.dir })) };
});
console.log('[C] post-import note:', JSON.stringify(seam.note));
console.log('[C] post-import tongues:', JSON.stringify(seam.langs));
checks.push(
  has('[C] sample-codex disclosure cleared', !/sample codex/i.test(seam.note)),
  has('[C] note names the imported codex as the engine', /Codex Omnilingua/i.test(seam.note)),
  has('[C] real engine offers its tongues (celan_basic + the codex wings)',
      seam.langs.length >= 6 && seam.langs.some(l => l.id === 'celan_basic') && seam.langs.some(l => l.id === 'kerrackian')),
);

// spans re-rendered against the real engine
await page.locator('#lib-list .row', { hasText: 'Codex Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 1500);
const spanAfter = await page.evaluate(() => {
  const t = document.querySelector('#ed-content .tspan');
  return t ? { lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom,
               omni: t.dataset.omni || null, scr: t.dataset.scr || null, svg: !!t.querySelector('svg') } : null;
});
console.log('[C] span after import:', JSON.stringify(spanAfter));
checks.push(
  has('[C] span re-rendered as an omni span (data-omni)', !!spanAfter && spanAfter.omni === '1'),
  has('[C] span source text preserved', !!spanAfter && spanAfter.src === 'sea remembers'),
  has('[C] romanization from the imported codex matches the embedded engine (parity)',
      !!spanAfter && !!spanAfter.rom && spanAfter.rom === before.rom),
  // script-as-text model: the codex script renders as forged-font PUA TEXT, never SVG
  has('[C] span carries codex script as forged-font text (PUA, zero SVG)',
      !!spanAfter && !spanAfter.svg && !!spanAfter.scr && [...(spanAfter.scr || '')].some(c => c.charCodeAt(0) >= 0xE000)),
);

// deterministic translation with the real engine — repeat calls, all tongues
const detSnap = () => page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  const out = {};
  for (const l of langs) {
    const r = await window.tenebrae.translate2(l.id, 'The sea remembers the fallen king');
    out[l.id] = JSON.stringify(r && { rom: r.romanization, gloss: r.gloss, dir: r.dir, flow: r.flow });
  }
  return out;
});
const d1 = await detSnap();
const d2 = await detSnap();
const ids = Object.keys(d1);
let sameRepeat = ids.length > 0;
for (const k of ids) if (d1[k] !== d2[k]) { sameRepeat = false; console.log('[C] REPEAT MISMATCH', k); }
console.log('[C] real-engine tongues checked:', ids.length, '-', ids.join(', '));
console.log('[C] celan_basic:', (d1['celan_basic'] || '').slice(0, 120));
console.log('[C] kerrackian:', (d1['kerrackian'] || '').slice(0, 120));
checks.push(has('[C] real-engine translation deterministic across repeat calls (all tongues)', sameRepeat));

// UI selection→translate against the real engine (Kerrackian = RTL wing)
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf('stone gate');
    if (i > -1) {
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 'stone gate'.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const rect = r.getBoundingClientRect();
      n.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
        clientX: Math.max(10, rect.left + 4), clientY: Math.max(10, rect.top + 4) }));
      return;
    }
  }
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 1000);
const omniSheetText = await page.locator('#sheet').innerText();
checks.push(has('[C] translate sheet shows the codex as engine (no Sample badge)',
  /Codex Omnilingua/i.test(omniSheetText) && !/sample codex/i.test(omniSheetText)));
await page.locator('#sheet .sh-item', { hasText: 'Kerrackian' }).click();
await wait(page, 1500);
const newSpan = await page.evaluate(() => {
  const t = [...document.querySelectorAll('#ed-content .tspan')].find(x => x.dataset.src === 'stone gate');
  return t ? { lang: t.dataset.lang, rom: t.dataset.rom, omni: t.dataset.omni || null,
               dir: t.getAttribute('dir'), svg: !!t.querySelector('svg') } : null;
});
console.log('[C] UI-inserted omni span:', JSON.stringify(newSpan));
checks.push(has('[C] UI selection→translate works against the real engine',
  !!newSpan && newSpan.omni === '1' && !!newSpan.rom));

// determinism + engine boot across a reload with the codex installed
await wait(page, 1500);
const errsBeforeReload = errors.length;
await page.reload();
console.log('[C] reloaded with the codex active; waiting for the engine to answer…');
let rebootRom = null;
for (let i = 0; i < 40; i++) {
  await sleep(1500);
  rebootRom = await page.evaluate(async () => {
    try { const r = await window.tenebrae.translate2('celan_basic', 'gate'); return r ? r.romanization : null; }
    catch (e) { return null; }
  });
  if (rebootRom) break;
}
const bootErrors = errors.slice(errsBeforeReload);
console.log('[C] engine answers after reload:', JSON.stringify(rebootRom),
  '| pageerrors during reload boot:', bootErrors.length ? JSON.stringify(bootErrors) : 'none');
if (bootErrors.length) anomalies.push('boot-with-codex pageerrors: ' + bootErrors.join(' | '));
checks.push(
  has('[C] codex persists across reload (kind omni-host)',
      await page.evaluate(() => { const c = window.tenebrae.codex(); return c && c.kind === 'omni-host'; })),
  has('[C] engine reboots from IndexedDB after reload (translate2 answers)', !!rebootRom),
  has('[C] no page exceptions booting with the codex installed', bootErrors.length === 0),
);
const d3 = await detSnap();
let sameReload = ids.length === Object.keys(d3).length && ids.length > 0;
for (const k of ids) if (d1[k] !== d3[k]) { sameReload = false; console.log('[C] RELOAD MISMATCH', k, '\n  before:', (d1[k] || '').slice(0, 140), '\n  after :', (d3[k] || '').slice(0, 140)); }
checks.push(has('[C] real-engine translation identical across reload (all tongues)', sameReload));

// remove the codex → sample engine restored, spans re-render back
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
await page.locator('#sheet .sh-item', { hasText: 'Remove imported codex' }).click();
await wait(page, 700);
await page.click('#cs-yes');
await wait(page, 1500);
// Removing an IMPORTED codex now returns to the codex EMBEDDED in the app
// (the real Codex Omnilingua ships inside the file), never to the placeholder
// sample cipher — so the engine must still be codex-owned after removal.
const restored = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  const c = window.tenebrae.codex();
  const r = await window.tenebrae.translate2('celan_basic', 'sea remembers');
  return { n: langs.length, embedded: !!c.embedded, kind: c.kind, name: c.name, rom: r.romanization };
});
console.log('[C] after removal:', JSON.stringify(restored));
checks.push(
  has('[C] removal returns to the EMBEDDED Codex Omnilingua (not the sample cipher)',
      restored.embedded === true && restored.kind === 'omni-host' && /Omnilingua/.test(restored.name)),
  has('[C] embedded-engine translation matches the pre-import output', restored.rom === before.rom),
);
await page.locator('#lib-list .row', { hasText: 'Codex Book' }).click();
await wait(page, 500);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 800);
const spanRestored = await page.evaluate(() => {
  const t = [...document.querySelectorAll('#ed-content .tspan')].find(x => x.dataset.src === 'sea remembers');
  return t ? { rom: t.dataset.rom, omni: t.dataset.omni || null } : null;
});
console.log('[C] span after removal:', JSON.stringify(spanRestored));
checks.push(has('[C] spans re-render against the embedded codex after removal',
  !!spanRestored && spanRestored.omni === '1' && spanRestored.rom === before.rom));

if (external.length) anomalies.push('external request attempts: ' + external.slice(0, 5).join(', '));
console.log('external request attempts:', external.length ? external.map(u => u.slice(0, 80)) : 'none');
console.log('ANOMALIES:', anomalies.length ? anomalies : 'none');
console.log('pageerrors (all):', errors.length ? errors : 'none');
verdict('TR-5', checks.every(Boolean) && errors.length === 0);

await browser.close();
await srv.close();
