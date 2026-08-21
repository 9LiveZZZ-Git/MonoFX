// cf-TX-1 — THE ENGINE ACROSS A REBOOT, AND THE ROSTER BEFORE ONE.
//
// tx-engine-always.mjs drives the five paths the standard names, but every one
// of them is measured INSIDE one page life. The gap this probe fills:
//   P0 the earliest-possible tonguesList() — tx-vf-boot-race asks the same
//      question of translate2 only. The roster/note is the other half: a
//      "Sample codex" badge or a Rath-Speech row in that window would be the
//      cipher announcing itself as the engine (step1.html L3768-3781).
//   P1 an imported JSON pack, then a RELOAD — the boot guard (L6254-6256) sees
//      a codex that is not omni-host and must neither drop it to the sample nor
//      lose it. Then remove it and reload again: the embedded codex must be the
//      engine on the NEXT boot too, not just in the page that removed it.
//   P2 a backup taken while a JSON pack was active, restored into a
//      STORAGE-FRESH context (no kv, no engine) — tx-engine-always restores
//      only backups with a missing or malformed codex.
//   P3 an imported real codex.html, then a RELOAD — the engine HTML has to come
//      back from kv `codexEngine` (L3599-3601). If it cannot, translate must
//      refuse, never answer in the cipher.
//   P4 span-level truth: a span made through the real UI carries the CODEX's
//      romanization in data-rom, and still does after the imported codex is
//      removed under it.
// Ground truth is the standalone codex file, not the app.
// Run: cd probes && node cf-tx1-persistence-paths.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { wait, createBook, insertTranslationSpan } from './ex-lib.mjs';

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const CODEX = SCRATCH + '/codex.html';
const PATCHED = SCRATCH + '/cf-codex-patched.html';
const PACK = SCRATCH + '/probe-codex-pack.json';
const BK_PACK = SCRATCH + '/cf-backup-with-pack.json';
const PHRASE = 'The sea remembers';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---------- ground truth from the codex itself ----------
const pageA = await browser.newPage();
await pageA.goto('file://' + PATCHED);
await pageA.waitForFunction(() => typeof window.translateE2C === 'function', null, { timeout: 120000 });
const TRUE_ROM = await pageA.evaluate(p => window.translateE2C(p).filter(x => x.cel && !x.drop).map(x => x.cel).join(' '), PHRASE);
await pageA.close();
console.log('codex ground truth (celan_basic):', JSON.stringify(TRUE_ROM));

const srv = await startServer();
const errors = [];
const mkPage = async (ctx, init) => {
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  if(init) await page.addInitScript(init);
  await page.goto(srv.url + 'step1.html');
  return page;
};
const probe = page => page.evaluate(async phrase => {
  const c = window.tenebrae.codex();
  let list = null;
  try{ list = await window.tenebrae.langs(); }catch(e){ list = { langs: [], note: 'ERR ' + e }; }
  let r = null;
  try{ r = await window.tenebrae.translate2('celan_basic', phrase); }catch(e){ r = null; }
  let legacy = null;
  try{ legacy = window.tenebrae.translate('celan-basic', phrase).romanization; }catch(e){}
  return { codex: { kind: c.kind || null, name: c.name || null, sample: !!c.sample, embedded: !!c.embedded },
           tongues: (list.langs || []).map(l => l.name || l.id), note: list.note || '',
           rom: r ? r.romanization : null, sampleRom: legacy };
}, PHRASE);
// The forbidden answer is the SAMPLE codex's, captured once while the embedded
// codex is installed. Note that window.tenebrae.translate (the legacy seam) is
// translateText over whatever pack is ACTIVE — with an author's JSON pack
// installed it answers in that pack, not in the sample. So the discriminator
// has to be the sample's fixed string, plus the identity of the active pack.
let SAMPLE_ROM = null;
const notCipher = (tag, s) => {
  ck(`${tag}: active pack is not the sample codex`,
     s.codex.sample === false && !/^Sample/i.test(String(s.codex.name || '')), JSON.stringify(s.codex));
  ck(`${tag}: no Rath-Speech row and no "Sample codex" badge`,
     !s.tongues.some(n => /rath/i.test(n)) && !/Sample codex/i.test(s.note), JSON.stringify(s.tongues) + ' ' + JSON.stringify(s.note.slice(0, 50)));
  ck(`${tag}: translate2 is not the SAMPLE cipher's answer`,
     s.rom === null || (SAMPLE_ROM !== null && s.rom !== SAMPLE_ROM), `rom=${JSON.stringify(s.rom)} sample=${JSON.stringify(SAMPLE_ROM)}`);
};
const toLibrary = async page => {
  for(let i = 0; i < 4; i++){
    const at = await page.evaluate(() => { const s = document.querySelector('.screen.on'); return s ? s.id : null; });
    if(at === 'scr-library') return at;
    await page.evaluate(() => {
      const s = document.querySelector('.screen.on');
      const b = (s && (s.querySelector('#ed-back') || s.querySelector('#bk-back') || s.querySelector('#cd-back'))) || null;
      if(b) b.click();
    });
    await wait(page, 700);
  }
  return page.evaluate(() => { const s = document.querySelector('.screen.on'); return s ? s.id : null; });
};
const openCodexSheet = async page => {
  await toLibrary(page);
  await page.click('#lib-more');
  await wait(page, 450);
  await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
  await wait(page, 1200);
};
const importFile = async (page, file) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 60000 }),
    page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
  ]);
  await chooser.setFiles(file);
};

// ================= P0. earliest-possible roster =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await mkPage(ctx, () => {
    window.__early = { when: null, tongues: null, note: null, err: null };
    const t0 = performance.now();
    const poll = setInterval(() => {
      if(window.tenebrae){
        clearInterval(poll);
        window.__early.when = performance.now() - t0;
        try{
          window.tenebrae.langs().then(x => { window.__early.tongues = (x.langs || []).map(l => l.name || l.id); window.__early.note = x.note || ''; },
                                       e => { window.__early.err = String(e); });
        }catch(e){ window.__early.err = String(e); }
      }
    }, 0);
  });
  await wait(page, 5000);
  const early = await page.evaluate(() => window.__early);
  console.log('P0 earliest langs() fired at', early.when && early.when.toFixed(1), 'ms:', JSON.stringify(early.tongues), JSON.stringify(String(early.note).slice(0, 70)));
  ck('P0 earliest-possible tongue roster carries no "Sample codex" badge and no Rath-Speech',
     !/Sample codex/i.test(String(early.note)) && !(early.tongues || []).some(n => /rath/i.test(n)), JSON.stringify(early));
  ck('P0 earliest-possible roster is the codex\'s six tongues (or an honest wake message)',
     (early.tongues && early.tongues.length === 6) || /failed to wake/i.test(String(early.note)), JSON.stringify(early.tongues));
  await ctx.close();
}

// ================= P1. JSON pack -> reload -> remove -> reload =================
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page1 = await mkPage(ctx1);
await wait(page1, 4000);
{
  const boot = await probe(page1);
  SAMPLE_ROM = boot.sampleRom; // the sample cipher's answer, with no pack installed
  console.log('sample-cipher answer for the same phrase:', JSON.stringify(SAMPLE_ROM));
  ck('the sample cipher answers differently from the codex (the check discriminates)',
     SAMPLE_ROM && SAMPLE_ROM !== TRUE_ROM, `${JSON.stringify(SAMPLE_ROM)} vs ${JSON.stringify(TRUE_ROM)}`);
  notCipher('P1 boot', boot);
}

await openCodexSheet(page1);
await importFile(page1, PACK);
await wait(page1, 3000);
const p1a = await probe(page1);
console.log('P1 pack imported:', JSON.stringify(p1a.codex), JSON.stringify(p1a.tongues));
ck('P1 the imported JSON pack is the engine', /Probe Pack/.test(String(p1a.codex.name)) && !p1a.codex.sample, JSON.stringify(p1a.codex));
notCipher('P1 pack active', p1a);

// back up now, while the pack is the engine (used by P2)
await toLibrary(page1);
await page1.click('#lib-more');
await wait(page1, 450);
{
  const [dl] = await Promise.all([
    page1.waitForEvent('download', { timeout: 60000 }),
    page1.locator('#sheet .sh-item', { hasText: 'Back up everything' }).click(),
  ]);
  await writeFile(BK_PACK, await readFile(await dl.path(), 'utf8'));
}
await wait(page1, 800);

await page1.reload();
await wait(page1, 4500);
const p1b = await probe(page1);
console.log('P1 after reload with the pack installed:', JSON.stringify(p1b.codex), JSON.stringify(p1b.tongues), JSON.stringify(p1b.rom));
ck('P1 a reload keeps the author\'s pack — it is not silently swapped', /Probe Pack/.test(String(p1b.codex.name)), JSON.stringify(p1b.codex));
notCipher('P1 pack after reload', p1b);

await openCodexSheet(page1);
await page1.locator('#sheet .sh-item', { hasText: 'Remove pack' }).click();
await wait(page1, 600);
await page1.click('#cs-yes');
await wait(page1, 4000);
const p1c = await probe(page1);
ck('P1 removing the pack falls back to the EMBEDDED codex', p1c.codex.embedded === true && p1c.codex.kind === 'omni-host', JSON.stringify(p1c.codex));
ck('P1 and it answers with the codex romanization', p1c.rom === TRUE_ROM, `${JSON.stringify(p1c.rom)} want ${JSON.stringify(TRUE_ROM)}`);
notCipher('P1 after pack removal', p1c);

await page1.reload();
await wait(page1, 4500);
const p1d = await probe(page1);
console.log('P1 after removal + reload:', JSON.stringify(p1d.codex), JSON.stringify(p1d.rom));
ck('P1 the NEXT boot after a removal is still the embedded codex', p1d.codex.embedded === true && p1d.rom === TRUE_ROM, JSON.stringify(p1d.codex) + ' ' + JSON.stringify(p1d.rom));
notCipher('P1 next boot after removal', p1d);
await ctx1.close();

// ================= P2. restore a pack-carrying backup into a cold profile =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await mkPage(ctx);
  await wait(page, 4000);
  await toLibrary(page);
  await page.click('#lib-more');
  await wait(page, 450);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 60000 }),
    page.locator('#sheet .sh-item', { hasText: 'Restore from backup' }).click(),
  ]);
  await chooser.setFiles(BK_PACK);
  await wait(page, 1000);
  await page.click('#cs-yes');
  await wait(page, 4000);
  const s = await probe(page);
  console.log('P2 restored a pack-carrying backup into a cold profile:', JSON.stringify(s.codex), JSON.stringify(s.tongues), JSON.stringify(s.rom));
  ck('P2 the restored backup\'s own pack is the engine (never the sample cipher)',
     !s.codex.sample && /Probe Pack/.test(String(s.codex.name)), JSON.stringify(s.codex));
  notCipher('P2 restore with a pack', s);
  await page.reload();
  await wait(page, 4500);
  const s2 = await probe(page);
  console.log('P2 after reload:', JSON.stringify(s2.codex));
  notCipher('P2 restore + reload', s2);
  await ctx.close();
}

// ================= P3/P4. imported codex.html, reload, span-level truth =================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await mkPage(ctx);
  await wait(page, 4000);
  await openCodexSheet(page);
  await importFile(page, CODEX);
  await page.waitForFunction(() => {
    const t = document.querySelector('#toast');
    return t && /tongues awake|didn.t wake|isn.t a Tenebrae codex/.test(t.textContent);
  }, null, { timeout: 240000 });
  console.log('P3 import toast:', JSON.stringify(await page.locator('#toast').innerText()));
  const i1 = await probe(page);
  ck('P3 the imported codex.html is the engine (omni-host, not embedded)',
     i1.codex.kind === 'omni-host' && i1.codex.embedded === false && i1.rom === TRUE_ROM, JSON.stringify(i1.codex) + ' ' + JSON.stringify(i1.rom));

  // P4 span through the real UI, under the IMPORTED engine
  await createBook(page, 'Imported Engine Book');
  await page.click('#ed-content');
  await page.keyboard.type('padding line here');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The sea remembers everything');
  await wait(page, 500);
  await insertTranslationSpan(page, PHRASE, 'Celan Basic');
  await wait(page, 1200);
  const span1 = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    return sp ? { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, omni: sp.dataset.omni || null } : null;
  });
  console.log('P4 span under the imported engine:', JSON.stringify(span1));
  ck('P4 a span made through the real UI carries the CODEX romanization',
     !!span1 && span1.rom === TRUE_ROM && span1.omni === '1', JSON.stringify(span1));

  await page.reload();
  await wait(page, 5000);
  const i2 = await probe(page);
  console.log('P3 after reload with an imported codex:', JSON.stringify(i2.codex), JSON.stringify(i2.rom));
  ck('P3 the imported engine survives a reload (revived from kv), or refuses — never the cipher',
     i2.rom === TRUE_ROM || i2.rom === null, JSON.stringify(i2.rom));
  ck('P3 after reload the pack is still the imported codex', i2.codex.kind === 'omni-host' && i2.codex.embedded === false, JSON.stringify(i2.codex));
  notCipher('P3 imported codex after reload', i2);

  // remove the imported codex out from under the existing span
  await openCodexSheet(page);
  await page.locator('#sheet .sh-item', { hasText: 'Remove imported codex' }).click();
  await wait(page, 700);
  await page.click('#cs-yes');
  await wait(page, 5000);
  const i3 = await probe(page);
  ck('P4 removal falls back to the embedded codex', i3.codex.embedded === true && i3.rom === TRUE_ROM, JSON.stringify(i3.codex));
  await toLibrary(page);
  await page.locator('#scr-library [data-book]').first().click();
  await wait(page, 900);
  await page.evaluate(() => { const r = document.querySelector('#scr-book [data-scene]'); if(r) r.click(); });
  await wait(page, 2500);
  const span2 = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    return sp ? { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, omni: sp.dataset.omni || null, txt: sp.textContent.slice(0, 12) } : null;
  });
  console.log('P4 span after the imported codex was removed:', JSON.stringify(span2));
  ck('P4 the span still carries the codex romanization after the import is removed',
     !!span2 && span2.rom === TRUE_ROM, JSON.stringify(span2));
  await ctx.close();
}

ck('no page exceptions on any path', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-TX-1 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
