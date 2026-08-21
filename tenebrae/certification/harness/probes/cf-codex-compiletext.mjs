// DIAGNOSTIC (no VERDICT): is compileText reachable from a page.evaluate on the
// standalone codex, and does the writer's mechanical window.CODEX widening
// (step1.html omniPatchHTML) change what ground truth we can read?
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
let html = await readFile(CODEX, 'utf8');
const patched = html.replace(/window\.CODEX\s*=\s*\{/,
  'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ');
const mk = body => new Promise(async r => {
  const s = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); });
  s.listen(0, '127.0.0.1', () => r({ s, port: s.address().port }));
});
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [name, body] of [['raw', html], ['patched', patched]]) {
  const { s, port } = await mk(body);
  const p = await browser.newPage();
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => ({
    scriptTypes: [...document.querySelectorAll('script')].map(x => x.type || 'classic'),
    globalCompileText: typeof window.compileText,
    bareCompileText: (() => { try { return typeof compileText; } catch (e) { return 'throw:' + e.message; } })(),
    codexHasCompileText: typeof (window.CODEX && window.CODEX.compileText),
    sample: (() => {
      try {
        const C = window.CODEX, T = C.TRANS.celan_high;
        const f = C.compileText || (typeof compileText !== 'undefined' ? compileText : null);
        if (!f) return 'NO compileText';
        const res = f(T, 'The sea remembers', 'e2l');
        return JSON.stringify((res.lines || []).map(l => l.map(x => x.t).join(' ')));
      } catch (e) { return 'ERR ' + e.message; }
    })(),
  }));
  console.log(name, JSON.stringify(r, null, 1));
  await p.close(); s.close();
}
await browser.close();
