// TX-VF: does the LEGACY SAMPLE CIPHER become the live translation engine after
// a restore-from-backup whose state carries no codex?  Verified end to end
// through the real #restore-input -> offerRestore -> confirmSheet path, with an
// independent engine fingerprint (the codex's own compileText run inside the
// engine iframe) rather than a hard-coded expected string.
// Run: cd probes && node tx-vf-restore-engine.mjs
import { launch, wait, verdict } from './ex-lib.mjs';
import { writeFile } from 'node:fs/promises';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const PHRASE = 'The sea remembers the old king';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const ck = [];
const check = (label, ok, detail) => { ck.push({ label, ok, detail }); console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : '  — ' + detail}`); };

// ---- baseline: what the embedded codex itself says, straight from the iframe ----
const base = await page.evaluate(async phrase => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const T = C.TRANS.celan_high;
  const res = C.compileText(T, phrase, 'e2l');
  const codexTruth = res.lines.map(l => l.map(p => p.t).join(' ')).join(' ');
  const r2 = await window.tenebrae.translate2('celan_high', phrase);
  const legacy = window.tenebrae.translate('celan_high', phrase);
  return { codexTruth, active: r2 && r2.romanization, sample: legacy && legacy.romanization,
           codex: window.tenebrae.codex(), langs: (await window.tenebrae.langs()).langs.map(l => l.id) };
}, PHRASE);
console.log('codex ground truth      :', JSON.stringify(base.codexTruth));
console.log('translate2 at boot      :', JSON.stringify(base.active));
console.log('legacy sample seam      :', JSON.stringify(base.sample));
console.log('active pack at boot     :', JSON.stringify({ kind: base.codex.kind, name: base.codex.name, sample: base.codex.sample }));
check('boot: the codex is the engine', base.active === base.codexTruth, `${base.active} != ${base.codexTruth}`);
check('boot: the sample cipher is distinguishable', base.sample !== base.codexTruth, 'sample == codex — detector is blind');

// ---- build a backup with a book but NO codex key (the app itself accepts this shape) ----
const backup = {
  app: 'tenebrae-writer',
  version: 1,
  exportedAt: new Date().toISOString(),
  state: {
    version: 1,
    books: [{ id: 'bk1', title: 'Restored Book', created: 1, updated: 1,
      chapters: [{ id: 'ch1', title: 'Chapter 1', scenes: [
        { id: 'sc1', title: 'Scene', doc: '<p>the sea remembers the old king</p>', words: 7, created: 1, updated: 1 }
      ] }], cards: [] }],
  },
};
const bpath = SCRATCH + '/vf-restore-nocodex.json';
await writeFile(bpath, JSON.stringify(backup, null, 2));

// ---- drive the REAL restore UI ----
await page.click('#lib-more');
await wait(page, 400);
const items = await page.locator('#sheet .sh-item').allTextContents();
console.log('library sheet items     :', JSON.stringify(items));
await page.locator('#sheet .sh-item', { hasText: 'Restore' }).click();
await wait(page, 400);
await page.setInputFiles('#restore-input', bpath);
await wait(page, 700);
// confirmSheet -> the "Restore" action button
await page.locator('#sheet .sh-item, #sheet button', { hasText: /^Restore$/ }).first().click();
await wait(page, 2500);

const after = await page.evaluate(async phrase => {
  const pack = window.tenebrae.codex();
  const r2 = await window.tenebrae.translate2('celan_high', phrase);
  const legacy = window.tenebrae.translate('celan_high', phrase);
  const L = await window.tenebrae.langs();
  return { pack: { kind: pack.kind, name: pack.name, sample: !!pack.sample },
           active: r2 && r2.romanization, activeLang: r2 && r2.lang && r2.lang.id,
           sample: legacy && legacy.romanization,
           langs: L.langs.map(l => l.id), note: L.note.slice(0, 120) };
}, PHRASE);

console.log('\n--- after restore ---');
console.log('active pack             :', JSON.stringify(after.pack));
console.log('translate2 result       :', JSON.stringify(after.active), 'lang:', after.activeLang);
console.log('legacy sample seam      :', JSON.stringify(after.sample));
console.log('tongues offered         :', JSON.stringify(after.langs));
console.log('tongues note            :', JSON.stringify(after.note));

check('after restore: codex still the engine', after.active === base.codexTruth,
      `translate2 -> ${JSON.stringify(after.active)} (codex says ${JSON.stringify(base.codexTruth)})`);
check('after restore: translate2 is NOT the sample cipher', after.active !== after.sample,
      `translate2 output is byte-identical to the legacy sample cipher: ${JSON.stringify(after.active)}`);
check('after restore: active pack is not the sample codex', after.pack.sample !== true,
      `active pack = ${JSON.stringify(after.pack)}`);

// ---- and does a reload heal it? ----
await page.reload();
await wait(page, 3500);
const healed = await page.evaluate(async phrase => {
  const pack = window.tenebrae.codex();
  const r2 = await window.tenebrae.translate2('celan_high', phrase);
  return { pack: { kind: pack.kind, sample: !!pack.sample }, active: r2 && r2.romanization };
}, PHRASE);
console.log('\nafter reload            :', JSON.stringify(healed));
check('reload restores the codex as engine', healed.active === base.codexTruth, JSON.stringify(healed));

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF RESTORE ENGINE', ck.every(c => c.ok) && errors.length === 0);
await browser.close();
await srv.close();
