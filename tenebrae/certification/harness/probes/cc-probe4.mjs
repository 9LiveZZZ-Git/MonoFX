// COVERAGE-CRITIC probe 4: unknown-token handling, multi-sentence rom joining,
// celan_basic script provenance, empty-result spans — all through the real app.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
let html = await readFile(CODEX, 'utf8');
html = html.replace(/window\.CODEX\s*=\s*\{/, 'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ');
const csrv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
await new Promise(r => csrv.listen(0, '127.0.0.1', r));
const cport = csrv.address().port;

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

const CASES = ['the keeper\'s oath', 'Vor, kesh; nyx.', 'the zorblax remembers', 'a'];

// ---- codex ground truth: cleanText (unknowns EXCLUDED) + plain copy string ----
const cp = await ctx.newPage();
await cp.goto(`http://127.0.0.1:${cport}/`);
await cp.waitForTimeout(2500);
const gt = await cp.evaluate(({ cases }) => {
  const C = window.CODEX, out = {};
  for (const id of Object.keys(C.TRANS)) {
    out[id] = cases.map(t => {
      const { parts, lines } = C.compileText(C.TRANS[id], t, 'e2l');
      const cleanText = lines ? lines.map(l => l.filter(p => !p.u).map(p => p.t).join(' ')).join(' ')
                              : parts.filter(p => !p.drop && !p.unknown).map(p => p.out).join(' ');
      const plainCopy = lines ? lines.map(l => l.map(p => p.t).join(' ')).join('\n') : parts.filter(p => !p.drop).map(p => p.out).join(' ');
      return { src: t, cleanText, plainCopy, nLines: lines ? lines.length : 1,
               unknowns: lines ? lines.flat().filter(p => p.u).map(p => p.t) : [] };
    });
  }
  return out;
}, { cases: CASES });

// ---- writer ----
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(1500);
const wr = await page.evaluate(async ({ cases, ids }) => {
  const out = {};
  for (const id of ids) {
    out[id] = [];
    for (const t of cases) {
      const r = await window.tenebrae.translate2(id, t);
      const scr = window.tenebrae._forge.textForToks(id, r.toks || []);
      out[id].push({ src: t, rom: r.romanization, toks: (r.toks || []).map(k => k.sep ? '|SEP|' : k.t + (k.u ? '·?' : '')), scrLen: scr ? scr.length : null, scrWords: scr ? scr.split(/[ \n]/).length : 0 });
    }
  }
  // celan_basic span provenance, straight through spanFromResult (via the DOM)
  const host = document.createElement('div'); document.body.appendChild(host);
  const rb = await window.tenebrae.translate2('celan_basic', 'the sea remembers');
  // reproduce what the app inserts: use the internal path via a real translate insert
  out.__cb = { rom: rb.romanization };
  // an empty-result span
  const rk = await window.tenebrae.translate2('kildaren', 'a');
  out.__empty = { rom: rk.romanization, toks: rk.toks, scr: window.tenebrae._forge.textForToks('kildaren', rk.toks || []) };
  host.remove();
  return out;
}, { cases: CASES, ids: Object.keys(gt) });

for (const id of Object.keys(gt)) {
  console.log('\n===== ' + id + ' =====');
  for (let i = 0; i < CASES.length; i++) {
    const g = gt[id][i], w = wr[id][i];
    console.log(JSON.stringify(g.src));
    console.log('  writer rom      = ' + JSON.stringify(w.rom));
    console.log('  codex  plainCopy= ' + JSON.stringify(g.plainCopy) + (g.nLines > 1 ? '   <-- ' + g.nLines + ' LINES' : ''));
    console.log('  codex  cleanText(script input, unknowns dropped) = ' + JSON.stringify(g.cleanText));
    console.log('  codex  unknown tokens = ' + JSON.stringify(g.unknowns));
    console.log('  writer toks     = ' + JSON.stringify(w.toks) + '  -> ' + w.scrWords + ' script words');
    console.log('  codex script words = ' + g.cleanText.split(/\s+/).filter(Boolean).length);
  }
}
console.log('\n__cb', JSON.stringify(wr.__cb));
console.log('__empty', JSON.stringify(wr.__empty));
console.log('pageerrors', errs);
await browser.close(); await srv.close(); csrv.close();
