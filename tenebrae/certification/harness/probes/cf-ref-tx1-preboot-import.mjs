// cf-REF-TX-1 — IS THE UNGUARDED makeTSpan REACHABLE?
//
// REFUTATION TARGET. The auditor's TX-1 pass rests on: "makeTSpan (step1.html
// L3825) is a translation-capable entry point that does NOT call
// ensureCodexInstalled(), but I found no UI trigger inside the ~200 ms window
// before boot installs the embedded codex." That is an argument from a measured
// number, not from the architecture. This probe attacks the premise:
//   R1  the window is bounded by idbOpen()'s own 2500 ms safety timeout
//       (step1.html L939) — whenever indexedDB.open is BLOCKED (another tab
//       holding the database, storage disabled) boot waits the full 2.5 s while
//       the library screen is already painted and its handlers already bound.
//   R2  inside that window, drive the REAL markdown-import UI (library menu ->
//       "Import manuscript…" -> preview -> #imp-go), which routes through
//       inlineMD -> tspanHTML -> makeTSpan (step1.html L5368). If the produced
//       spans carry the legacy sample cipher, TX-1 is breached.
//   R3  whatever R2 produces, does the app repair it once boot installs the
//       codex, or is the cipher persisted into the manuscript?
//   R4  control: the same import AFTER a normal boot must give codex spans.
// Run: cd probes && node cf-ref-tx1-preboot-import.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const MD = `<!--tenebrae:doc-->
# Preboot Book

## Chapter One

### First Light<!--tenebrae:scene-->

The tide came in and <!--tenebrae:begin {"language":"celan_high","source":"the sea remembers"}-->mara memora<!--tenebrae:end--> at dusk.
`;
const FILE = { name: 'preboot.md', mimeType: 'text/markdown', buffer: Buffer.from(MD, 'utf8') };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

const readSpans = pg => pg.evaluate(() => {
  const spans = [...document.querySelectorAll('.tspan')];
  const c = window.tenebrae.codex();
  return { n: spans.length,
    live: spans.map(s => ({ lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, omni: s.dataset.omni || null })),
    codex: { kind: c.kind || null, sample: !!c.sample } };
});

// ---------- R1 : the widened window is real ----------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push('R2 ' + e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.addInitScript(() => {
  // A SLOW indexedDB.open — the real database, just 3 s late. boot() rides its
  // own 2500 ms safety timeout (step1.html L939) and carries on with
  // state.codex still null; storage then comes up and everything persists
  // normally. This is the ordinary "slow/blocked IDB" case the timeout exists
  // for, not a broken browser.
  const real = indexedDB.open.bind(indexedDB);
  indexedDB.open = function(...a){
    const stub = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: null };
    setTimeout(() => {
      const req = real(...a);
      req.onupgradeneeded = e => { stub.result = req.result; if(stub.onupgradeneeded) stub.onupgradeneeded.call(stub, e); };
      req.onsuccess = e => { stub.result = req.result; if(stub.onsuccess) stub.onsuccess.call(stub, e); };
      req.onerror = e => { if(stub.onerror) stub.onerror.call(stub, e); };
    }, 3000);
    return stub;
  };
});
const t0 = Date.now();
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(150);
const pre = await page.evaluate(() => {
  const c = window.tenebrae.codex();
  const b = document.querySelector('#lib-more');
  return { sample: !!c.sample, kind: c.kind || null, moreVisible: !!(b && b.offsetParent !== null) };
});
console.log(`R1 at t=${Date.now() - t0}ms:`, JSON.stringify(pre));
ck('R1 boot is held off and the library menu is already live (the window is open)',
   pre.sample === true && pre.moreVisible === true, JSON.stringify(pre));

// ---------- R2 : real import UI inside the window ----------
let committedAt = null, importErr = null;
try{
  await page.click('#lib-more');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 1500 }),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await chooser.setFiles(FILE);
  await page.waitForSelector('#imp-go', { timeout: 1500 });
  await page.click('#imp-go');
  committedAt = Date.now() - t0;
  await page.waitForSelector('#bk-list .row[data-scene]', { timeout: 1200 });
  await page.click('#bk-list .row[data-scene]');
}catch(e){ importErr = e.message.split('\n')[0]; }
console.log('R2 import committed at t=' + committedAt + 'ms', importErr ? ('(error: ' + importErr + ')') : '');
await page.waitForTimeout(500);

const sampleRom = await page.evaluate(() => { try{ return window.tenebrae.translate('celan_high', 'the sea remembers').romanization; }catch(e){ return null; } });
const inWindow = await readSpans(page);
console.log('R2 spans while boot is still held:', JSON.stringify(inWindow));
console.log('R2 legacy sample cipher answer:', JSON.stringify(sampleRom));
const cipherNow = inWindow.live.filter(s => s.rom === sampleRom);
ck('R2 the import inside the pre-boot window produced NO sample-cipher span',
   cipherNow.length === 0,
   cipherNow.length ? `BREACH: ${JSON.stringify(cipherNow)} (committed at ${committedAt}ms, codex ${JSON.stringify(inWindow.codex)})`
                    : (committedAt === null ? 'import did not complete inside the window: ' + importErr : `${inWindow.n} span(s)`));

// ---------- R3 : does boot repair it? ----------
await page.waitForTimeout(6000);
try{ if(!(await page.locator('#ed-content .tspan').count())){ await page.click('#bk-list .row[data-scene]'); await page.waitForTimeout(800); } }catch(e){}
const healed = await page.evaluate(async () => {
  try{ await window.tenebrae._omni.decorate(document.querySelector('#ed-content')); }catch(e){}
  const spans = [...document.querySelectorAll('.tspan')];
  const r = await window.tenebrae.translate2('celan_high', 'the sea remembers');
  const c = window.tenebrae.codex();
  const doc = window.tenebrae._omni.probe.sceneDoc();
  return { live: spans.map(s => ({ lang: s.dataset.lang, rom: s.dataset.rom, omni: s.dataset.omni || null })),
           codexRom: r && r.romanization, codex: { kind: c.kind || null, sample: !!c.sample },
           docHasCipher: !!(doc && doc.indexOf('data-rom') > -1) , doc: (doc || '').slice(0, 300) };
});
console.log('R3 after boot completes:', JSON.stringify(healed).slice(0, 600));
ck('R3 the codex is the engine once boot finishes', healed.codex.kind === 'omni-host' && !healed.codex.sample, JSON.stringify(healed.codex));
ck('R3 no span is left carrying the sample cipher after boot',
   healed.live.every(s => s.rom !== sampleRom), JSON.stringify(healed.live));
ck('R3c the tongue the imported file recorded (celan_high) survived into the manuscript',
   healed.live.length > 0 && healed.live.every(s => s.lang === 'celan_high'),
   'scene doc now says ' + JSON.stringify(healed.live.map(s => s.lang)) + ' — the sample cipher collapsed the unknown tongue id onto SAMPLE_CODEX.languages[0] and rerenderAllSpans then recompiled from THAT');

// ---------- R3b : does the corruption persist across a reload? ----------
await page.waitForTimeout(1200);
await page.reload();
await page.waitForTimeout(4200);
console.log('R3b library after reload:', JSON.stringify((await page.locator('#lib-list').innerText()).replace(/\n+/g, ' | ')));
try{ await page.locator('#lib-list .row').first().click(); await page.waitForTimeout(700); }catch(e){ console.log('R3b lib click:', e.message.split('\n')[0]); }
try{ await page.click('#bk-list .row[data-scene]'); await page.waitForTimeout(900); }catch(e){}
const reloaded = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#ed-content .tspan')];
  return spans.map(s => ({ lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom }));
});
console.log('R3b after reload:', JSON.stringify(reloaded));
// DIAGNOSTIC ONLY: this context's indexedDB.open is slow on EVERY page life,
// so the reload's own kvGet('state') also runs before storage is up and the
// library comes back empty. Persistence of the corruption is asserted from the
// live scene doc in R3c instead, which is the state that gets saved.
console.log('R3b (diagnostic, instrumentation-limited) spans after reload:', JSON.stringify(reloaded));
await ctx.close();

// ---------- R4 : control — the same import after a normal boot ----------
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
page2.on('pageerror', e => { errors.push('R4 ' + e.message); console.log('PAGE EXCEPTION:', e.message); });
await page2.goto(srv.url + 'step1.html');
await page2.waitForTimeout(4200);
await page2.click('#lib-more');
await page2.waitForTimeout(400);
const [ch2] = await Promise.all([
  page2.waitForEvent('filechooser'),
  page2.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await ch2.setFiles(FILE);
await page2.waitForSelector('#imp-go', { timeout: 8000 });
await page2.click('#imp-go');
await page2.waitForTimeout(1200);
await page2.click('#bk-list .row[data-scene]');
await page2.waitForTimeout(1800);
const ctl = await page2.evaluate(async () => {
  const spans = [...document.querySelectorAll('#ed-content .tspan')];
  const r = await window.tenebrae.translate2('celan_high', 'the sea remembers');
  const sample = (() => { try{ return window.tenebrae.translate('celan_high', 'the sea remembers').romanization; }catch(e){ return null; } })();
  return { live: spans.map(s => ({ lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, omni: s.dataset.omni || null, txt: s.textContent.slice(0, 12) })),
           codexRom: r && r.romanization, sampleRom: sample };
});
console.log('R4 control import:', JSON.stringify(ctl).slice(0, 500));
ck('R4 a markdown import after a normal boot yields exactly one span', ctl.live.length === 1, JSON.stringify(ctl.live));
ck('R4 the imported span keeps its recorded tongue', ctl.live.every(s => s.lang === 'celan_high'), JSON.stringify(ctl.live.map(s => s.lang)));
ck('R4 the imported span carries the CODEX romanization, not the cipher and not the English',
   ctl.live.length > 0 && ctl.live.every(s => s.rom === ctl.codexRom),
   `codex=${JSON.stringify(ctl.codexRom)} sample=${JSON.stringify(ctl.sampleRom)} got=${JSON.stringify(ctl.live.map(s => s.rom))}`);
ck('R4 the imported span is marked as an omni span', ctl.live.every(s => s.omni === '1'), JSON.stringify(ctl.live));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-REF-TX-1 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
