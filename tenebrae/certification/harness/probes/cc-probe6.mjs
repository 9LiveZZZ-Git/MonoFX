// COVERAGE-CRITIC probe 6: the roster/forge coupling.
// FORGE_BASES (step1.html L2487) is a hard-coded 5-entry id->PUA-base table,
// but the tongue roster comes from the CODEX (omniLangs -> C.TRANS). Import a
// valid codex whose scripted tongue id is not one of the five and see what a
// span becomes.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const FAKE = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/fake-codex.html';
const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(2500);

await page.setInputFiles('#codex-input', FAKE);
await page.waitForTimeout(3000);

const r = await page.evaluate(async () => {
  const langs = (await window.tenebrae.langs()).langs;
  const out = { langs, pack: window.tenebrae.codex(), rows: [] };
  for (const l of langs) {
    const t = await window.tenebrae.translate2(l.id, 'the old sea remembers the king');
    const scr = window.tenebrae._forge.textForToks(l.id, (t && t.toks) || []);
    out.rows.push({ id: l.id, rom: t && t.romanization, flow: t && t.flow, forgeText: scr,
      forged: Object.keys(window.tenebrae._forge.map() || {}) });
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));

// now put one on the page through the real UI and read the span back
await page.evaluate(() => {
  const el = document.querySelector('#lib-new'); if (el) el.click();
});
await page.waitForTimeout(400);
try { await page.fill('#ps-input', 'Roster Book'); await page.click('#ps-save'); await page.waitForTimeout(900); } catch (e) {}
const spanInfo = await page.evaluate(async () => {
  // use the app's own span builder path via the public translate + a manual
  // insert is not available; drive the editor instead
  const ed = document.querySelector('#ed-content');
  if (!ed) return { err: 'no editor' };
  ed.focus();
  ed.innerHTML = '<p>the old sea remembers the king</p>';
  const p = ed.querySelector('p');
  const rg = document.createRange(); rg.selectNodeContents(p);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  document.dispatchEvent(new Event('selectionchange'));
  return { ok: true };
});
console.log('editor prep', JSON.stringify(spanInfo));
console.log('pageerrors', errs);
await browser.close(); await srv.close();
