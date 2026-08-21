// TX-1 — "THE CODEX IS THE ENGINE, ALWAYS."
// The legacy SAMPLE cipher must never become the translation engine on ANY of
// the five paths the standard names. Each is driven through the real UI:
//   A boot                    fresh profile, no import step
//   B failed engine wake      import an HTML file that passes the codex sniff
//                             but never defines the globals (real 30s wake
//                             timeout, real toast, real recovery sheet)
//   C removal of an imported codex        (real codex.html -> Remove imported codex)
//   D removal of an imported JSON pack    (Codex Pack -> Remove pack)
//   E restore from backup     e1 the app's own backup (control)
//                             e2 a backup whose state carries no codex
//                             e3 a backup carrying a malformed codex pack
// "Sample became the engine" is detected three independent ways:
//   window.tenebrae.codex().sample === true  |  the tongue list contains the
//   sample-only tongue Rath-Speech / the "Sample codex" badge  |  translate2's
//   romanization equals the sample cipher's instead of the codex's.
// 2026-08 TRIAGE (ENVIRONMENTAL, no contract change): run alone this probe
// exits 0 with "TX-1 VERDICT: PASS / failed checks: none". The suite's CRASH
// (code 1, no verdict, 207s) is a Playwright wait timing out under the runner's
// 3-way concurrency on a 4-CPU box — this probe imports the 3.4 MB codex twice
// and sits through the engine's real ~30s wake poll. Only the WAIT BUDGETS are
// raised below (filechooser/download 15s->45s, toast waits 60s->180s, codex
// ground-truth load 40s->120s); every assertion is untouched, and the toast
// waits still accept the wrong toast text so a real regression still fails.
// Run: cd probes && node tx-engine-always.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { wait, createBook, insertTranslationSpan } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const CODEX = SCRATCH + '/codex.html';
const PACK = SCRATCH + '/probe-codex-pack.json';
const DEAD = SCRATCH + '/tx-dead-codex.html';
const BK_NONE = SCRATCH + '/tx-backup-no-codex.json';
const BK_BAD = SCRATCH + '/tx-backup-bad-pack.json';
const BK_SPAN = SCRATCH + '/tx-backup-span-no-codex.json';
const PHRASE = 'The sea remembers';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

// walk the real back buttons until the library screen is the active one
const toLibrary = async page => {
  for (let i = 0; i < 4; i++) {
    const at = await page.evaluate(() => {
      const s = document.querySelector('.screen.on');
      return s ? s.id : null;
    });
    if (at === 'scr-library') return at;
    await page.evaluate(() => {
      const s = document.querySelector('.screen.on');
      const b = (s && (s.querySelector('#ed-back') || s.querySelector('#bk-back'))) || null;
      if (b) b.click();
    });
    await wait(page, 700);
  }
  return await page.evaluate(() => { const s = document.querySelector('.screen.on'); return s ? s.id : null; });
};

// a file that LOOKS like a codex to importCodexPack's sniff test but whose
// engine never wakes (the globals appear only inside a comment)
await writeFile(DEAD, `<!doctype html><html><head><title>Dead Codex v99</title></head><body>
<script>/* window.FAMILY = {}; window.CODEX = {}; never actually assigned */<\/script>
</body></html>`);

const mkBackup = (codex) => JSON.stringify({
  app: 'tenebrae-writer', version: 3, exportedAt: '2026-01-01T00:00:00.000Z',
  state: { version: 3, books: [{ id: 'bk1', title: 'Restored Book', chapters: [], cards: [],
    created: 1, updated: 1, paraStyle: 'spaced' }], lastLang: 'celan_basic', tsv: 2,
    ...(codex === undefined ? {} : { codex }) }
}, null, 2);
await writeFile(BK_NONE, mkBackup(undefined));                                   // no codex key at all
await writeFile(BK_BAD, mkBackup({ name: 'Broken Pack', version: '1', languages: [] })); // fails validateCodex

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---------- ground truth: the codex, standalone ----------
const pageA = await browser.newPage();
await pageA.goto('file://' + SCRATCH + '/tx-codex-patched.html');
await pageA.waitForFunction(() => typeof window.translateE2C === 'function', null, { timeout: 120000 });
const TRUE_ROM = await pageA.evaluate(p => window.translateE2C(p).filter(x => x.cel && !x.drop).map(x => x.cel).join(' '), PHRASE);
console.log('codex says (celan_basic):', JSON.stringify(TRUE_ROM));

const srv = await startServer();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.goto(srv.url + 'step1.html');
await wait(page, 3500);

// one state probe used after every path
const probe = async () => page.evaluate(async ({ phrase }) => {
  const c = window.tenebrae.codex();
  let list = null;
  try { list = await window.tenebrae.langs(); } catch (e) { list = { err: String(e && e.message) }; }
  const langs = (list && (list.langs || list)) || [];
  let r2 = null;
  try { r2 = await window.tenebrae.translate2('celan_basic', phrase); } catch (e) { r2 = { err: String(e && e.message) }; }
  let alias = null;
  try { alias = await window.tenebrae.translate2('celan-basic', phrase); } catch (e) { alias = { err: String(e && e.message) }; }
  let legacy = null;
  try { legacy = window.tenebrae.translate('celan-basic', phrase); } catch (e) { legacy = { err: String(e && e.message) }; }
  return {
    codex: { kind: c.kind || null, name: c.name || null, sample: !!c.sample, embedded: !!c.embedded },
    tongues: langs.map(l => l.name || l.id),
    note: (list && list.note) || '',
    rom2: r2 && r2.romanization !== undefined ? r2.romanization : null,
    romAlias: alias && alias.romanization !== undefined ? alias.romanization : null,
    romLegacySample: legacy && legacy.romanization !== undefined ? legacy.romanization : null,
  };
}, { phrase: PHRASE });

const notSample = (tag, s, expectRom) => {
  ck(`${tag}: active codex is not the sample cipher`, s.codex.sample === false && s.codex.name !== 'Sample Codex', JSON.stringify(s.codex));
  ck(`${tag}: tongue list is the codex's (no sample-only Rath-Speech, no "Sample codex" badge)`,
     !s.tongues.some(n => /rath/i.test(n)) && !/Sample codex/i.test(s.note), JSON.stringify(s.tongues));
  if (expectRom !== null)
    ck(`${tag}: translate2 returns the codex's romanization`, s.rom2 === expectRom, `got ${JSON.stringify(s.rom2)} want ${JSON.stringify(expectRom)}`);
};

// ================= A. boot =================
const A = await probe();
console.log('[A] boot:', JSON.stringify(A).slice(0, 300));
ck('[A] boot: embedded Codex Omnilingua installed with no import step',
   A.codex.kind === 'omni-host' && A.codex.embedded === true && /Omnilingua/.test(A.codex.name));
notSample('[A] boot', A, TRUE_ROM);
ck('[A] boot: the legacy sample seam is a DIFFERENT engine (proves the check discriminates)',
   A.romLegacySample !== null && A.romLegacySample !== TRUE_ROM, `sample="${A.romLegacySample}" codex="${TRUE_ROM}"`);
ck('[A] boot: the "celan-basic" alias also routes to the codex', A.romAlias === TRUE_ROM, JSON.stringify(A.romAlias));

// ================= B. failed engine wake =================
// real UI import of a file that sniffs as a codex but never wakes (~30s poll)
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
{
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 45000 }),
    page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
  ]);
  await chooser.setFiles(DEAD);
}
await page.waitForFunction(() => {
  const t = document.querySelector('#toast');
  return t && /didn.t wake|tongues awake|isn.t a Tenebrae codex/.test(t.textContent);
}, null, { timeout: 180000 });
const deadToast = await page.locator('#toast').innerText();
console.log('[B] toast:', JSON.stringify(deadToast));
ck('[B] failed wake: the app reports the engine did not wake', /didn.t wake/.test(deadToast), deadToast);
const B = await probe();
console.log('[B] after failed wake:', JSON.stringify(B).slice(0, 300));
notSample('[B] failed wake', B, null);
ck('[B] failed wake: translate2 refuses (null) rather than falling back to the cipher',
   B.rom2 === null && B.romAlias === null, `rom2=${JSON.stringify(B.rom2)} alias=${JSON.stringify(B.romAlias)}`);
ck('[B] failed wake: the tongue sheet offers no tongues and says the engine failed',
   B.tongues.length === 0 && /failed to wake/i.test(B.note), `${JSON.stringify(B.tongues)} ${JSON.stringify(B.note.slice(0, 60))}`);

// and through the REAL editor: a translate attempt must not mint a cipher span
await createBook(page, 'Dead Engine Book');
await page.click('#ed-content');
await page.keyboard.type('padding line here');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers everything');
await wait(page, 600);
let sheetItems = [];
try {
  await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
} catch (e) {
  sheetItems = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item .lbl')].map(n => n.textContent));
  console.log('[B] translate sheet offered:', JSON.stringify(sheetItems));
}
const bSpan = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp ? { text: sp.textContent.slice(0, 40), lang: sp.dataset.lang, rom: sp.dataset.rom, omni: sp.dataset.omni } : null;
});
console.log('[B] span after attempting to translate with a dead engine:', JSON.stringify(bSpan));
ck('[B] failed wake: no cipher span is created in the editor', bSpan === null, JSON.stringify(bSpan));
console.log('[B] back to:', await toLibrary(page));

// recover through the real sheet (the failed-wake sheet's remove action)
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const deadSheetLabels = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item .lbl')].map(n => n.textContent));
console.log('[B] failed-wake sheet items:', JSON.stringify(deadSheetLabels));
await page.locator('#sheet .sh-item', { hasText: 'Remove imported codex' }).click();
await wait(page, 500);
await page.click('#cs-yes');
await wait(page, 4000);
const B2 = await probe();
console.log('[B2] after removing the dead codex:', JSON.stringify(B2.codex));
notSample('[B2] recover from failed wake', B2, TRUE_ROM);
ck('[B2] the recovery action restores the EMBEDDED codex (its label says "use sample")',
   B2.codex.embedded === true, JSON.stringify(deadSheetLabels));

// ================= C. removal of an imported codex =================
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
{
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 45000 }),
    page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
  ]);
  await chooser.setFiles(CODEX);
}
await page.waitForFunction(() => {
  const t = document.querySelector('#toast');
  return t && /tongues awake|didn.t wake/.test(t.textContent);
}, null, { timeout: 180000 });
console.log('[C] import toast:', JSON.stringify(await page.locator('#toast').innerText()));
const Cimp = await probe();
ck('[C] an imported real codex is the engine (kind omni-host, not embedded)',
   Cimp.codex.kind === 'omni-host' && Cimp.codex.embedded === false && Cimp.rom2 === TRUE_ROM, JSON.stringify(Cimp.codex));
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
await page.locator('#sheet .sh-item', { hasText: 'Remove imported codex' }).click();
await wait(page, 600);
await page.click('#cs-yes');
await wait(page, 4500);
const C = await probe();
console.log('[C] after removal:', JSON.stringify(C.codex), JSON.stringify(C.rom2));
notSample('[C] remove imported codex', C, TRUE_ROM);
ck('[C] removal falls back to the EMBEDDED codex', C.codex.embedded === true && C.codex.kind === 'omni-host', JSON.stringify(C.codex));

// ================= D. removal of an imported JSON pack =================
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
{
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 45000 }),
    page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
  ]);
  await chooser.setFiles(PACK);
}
await wait(page, 2500);
const Dimp = await probe();
console.log('[D] pack active:', JSON.stringify(Dimp.codex), JSON.stringify(Dimp.tongues));
ck('[D] the imported JSON pack is the engine (not the sample)',
   Dimp.codex.sample === false && /Probe Pack/.test(String(Dimp.codex.name)), JSON.stringify(Dimp.codex));
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
await page.locator('#sheet .sh-item', { hasText: 'Remove pack' }).click();
await wait(page, 600);
await page.click('#cs-yes');
await wait(page, 4500);
const D = await probe();
console.log('[D] after pack removal:', JSON.stringify(D.codex), JSON.stringify(D.rom2));
notSample('[D] remove JSON pack', D, TRUE_ROM);
ck('[D] pack removal falls back to the EMBEDDED codex', D.codex.embedded === true && D.codex.kind === 'omni-host', JSON.stringify(D.codex));

// ================= E. restore from backup =================
// e1 — the app's own backup, taken now (control)
await toLibrary(page);
await page.click('#lib-more');
await wait(page, 400);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 45000 }),
  page.locator('#sheet .sh-item', { hasText: 'Back up everything' }).click(),
]);
const ownBackup = SCRATCH + '/tx-own-backup.json';
await writeFile(ownBackup, await readFile(await dl.path(), 'utf8'));
await wait(page, 800);
const restore = async (file, tag) => {
  await toLibrary(page);
await page.click('#lib-more');
  await wait(page, 400);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 45000 }),
    page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
  ]);
  await chooser.setFiles(file);
  await wait(page, 900);
  await page.click('#cs-yes');
  await wait(page, 4000);
  const s = await probe();
  console.log(`[E] ${tag}:`, JSON.stringify(s).slice(0, 320));
  return s;
};
const E1 = await restore(ownBackup, 'restore the app\'s own backup');
notSample('[E1] restore own backup', E1, TRUE_ROM);

// e2 — a valid backup whose state carries no codex key at all
const E2 = await restore(BK_NONE, 'restore a backup with no codex key');
notSample('[E2] restore backup without a codex', E2, TRUE_ROM);

// reload: does a reboot repair whatever e2 left behind?
await page.reload();
await wait(page, 4000);
const E2r = await probe();
console.log('[E2] after reload:', JSON.stringify(E2r.codex), JSON.stringify(E2r.rom2));
notSample('[E2 after reload] boot guard repairs it', E2r, TRUE_ROM);

// e3 — a backup carrying a malformed codex pack (validateCodex rejects it)
const E3 = await restore(BK_BAD, 'restore a backup with a malformed pack');
notSample('[E3] restore backup with a malformed pack', E3, TRUE_ROM);

// e4 — consequence: offerRestore calls rerenderAllSpans() straight after, so
// EXISTING spans are rewritten by whatever engine is live at that moment.
const SPAN_DOC = '<p>the tide line</p><p>a span: <span class="tspan" data-lang="celan_basic" '
  + `data-src="${PHRASE}" data-rom="${TRUE_ROM}" data-omni="1" contenteditable="false">${TRUE_ROM}</span> ends here.</p>`;
await writeFile(BK_SPAN, JSON.stringify({
  app: 'tenebrae-writer', version: 3, exportedAt: '2026-01-01T00:00:00.000Z',
  state: { version: 3, lastLang: 'celan_basic', tsv: 2, books: [{
    id: 'bk9', title: 'Span Book', created: 1, updated: 1, paraStyle: 'spaced', cards: [],
    chapters: [{ id: 'ch9', title: 'Chapter 1', scenes: [{ id: 'sc9', title: 'Scene', status: 'draft', doc: SPAN_DOC, words: 6, updated: 1 }] }]
  }] }
}, null, 2));
const E4 = await restore(BK_SPAN, 'restore a codex-less backup that CONTAINS a span');
notSample('[E4] restore codex-less backup holding a span', E4, TRUE_ROM);
await toLibrary(page);
await page.locator('#scr-library [data-book]').first().click();
await wait(page, 900);
const openedSpan = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#scr-book [data-scene]')];
  if (rows.length) rows[0].click();
  return rows.length;
});
await wait(page, 1500);
const spanNow = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp ? { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, omni: sp.dataset.omni || null, text: sp.textContent.slice(0, 40) } : null;
});
console.log('[E4] scene rows:', openedSpan, 'span after restore:', JSON.stringify(spanNow));
ck('[E4] an existing span keeps the codex romanization after a codex-less restore',
   !spanNow || spanNow.rom === TRUE_ROM, `rom=${JSON.stringify(spanNow && spanNow.rom)} want ${JSON.stringify(TRUE_ROM)}`);

ck('no page exceptions across all five paths', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('TX-1 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
