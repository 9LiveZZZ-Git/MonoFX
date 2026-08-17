// COVERAGE-CRITIC probe 1: writer vs codex — tongue roster, romanization,
// glyph-key parity including punctuation/apostrophe/accent material.
import { chromium } from 'playwright-core';
import { startServer } from '/home/user/MonoFX/tenebrae/certification/harness/serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';

// serve the standalone codex too
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const codexBody = await readFile(CODEX);
const csrv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(codexBody);
});
await new Promise(r => csrv.listen(0, '127.0.0.1', r));
const cport = csrv.address().port;

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

const CORPUS = [
  'The sea remembers',
  "the keeper's oath",
  'Vor, kesh; nyx.',
  'shadow-light',
  'THE KING RUNS',
  '1000 stars and 3 suns',
  'café naïve résumé',
  'xyzzyx qqq',
  'a',
  'the sea remembers the drowned dark and the gold sun',
];

// ---------- writer ----------
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(1200);
const langs = await page.evaluate(() => window.tenebrae.langs().then(x => x.langs));
console.log('WRITER TONGUES:', JSON.stringify(langs, null, 1));

const writer = await page.evaluate(async ({ corpus, ids }) => {
  const out = {};
  for (const id of ids) {
    out[id] = [];
    for (const t of corpus) {
      const r = await window.tenebrae.translate2(id, t);
      let scr = null, scrErr = null;
      try { scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null; } catch (e) { scrErr = String(e); }
      out[id].push({
        src: t,
        rom: r ? r.romanization : null,
        flow: r ? r.flow : null,
        toks: r ? (r.toks || []).map(k => k.sep ? '|SEP|' : k.t) : null,
        scr: scr,
        scrCodes: scr ? [...scr].map(c => c.codePointAt(0).toString(16)) : null,
      });
    }
  }
  out.__forgeMap = Object.fromEntries(Object.entries(window.tenebrae._forge.map() || {}).map(([k, v]) => [k, { family: v.family, base: v.base.toString(16), flow: v.flow, dot: v.dot.codePointAt(0).toString(16), nkeys: Object.keys(v.gidx).length }]));
  return out;
}, { corpus: CORPUS, ids: langs.map(l => l.id) });

// ---------- codex ground truth ----------
const cpage = await ctx.newPage();
const cerrs = [];
cpage.on('pageerror', e => cerrs.push(e.message));
await cpage.goto(`http://127.0.0.1:${cport}/`);
await cpage.waitForTimeout(2500);
const codex = await cpage.evaluate(({ corpus }) => {
  const C = window.CODEX;
  const out = { trans: Object.keys(C.TRANS), langs: {} };
  for (const id of Object.keys(C.TRANS)) {
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    const dir = sc ? C.scriptDir(sc) : 'ltr';
    const matcher = sc && (sc.glyphs || []).length ? C.makeMatcher(sc) : null;
    const rows = [];
    for (const t of corpus) {
      let rom = null, err = null;
      try {
        const res = (typeof compileText !== 'undefined') ? compileText(T, t, 'e2l') : { parts: C.coreTranslate(T, t, 'e2l'), lines: null };
        const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
        rom = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
      } catch (e) { err = String(e); }
      // the codex's own typesetter tokenization of that romanization
      let keys = null;
      if (matcher && rom != null) {
        keys = rom.split(/\s+/).filter(Boolean).map(wd => {
          const clean = wd.replace(/[^\p{L}\p{N}'’-]/gu, '');
          if (!clean) return null;
          return C.wordScriptSVG ? null : null;
        });
        // replicate matchWord via the exported path: use makeMatcher + manual greedy
        keys = rom.split(/\s+/).filter(Boolean).map(wd => {
          const clean = wd.replace(/[^\p{L}\p{N}'’-]/gu, '');
          if (!clean) return null;
          const w = clean.toLowerCase(); const o = []; let i = 0;
          while (i < w.length) {
            let hit = null;
            for (const k of matcher.keys) { if (w.startsWith(k, i)) { hit = k; break; } }
            if (hit) { o.push(hit); i += hit.length; } else { o.push('?' + w[i]); i++; }
          }
          return o;
        }).filter(Boolean);
      }
      rows.push({ src: t, rom, err, keys });
    }
    out.langs[id] = { name: T.L && T.L.name, script: sc ? sc.name : null, dir, glyphs: sc ? (sc.glyphs || []).length : 0, rows };
  }
  return out;
}, { corpus: CORPUS });

console.log('CODEX TRANS ids:', codex.trans.join(','));
console.log('FORGE MAP:', JSON.stringify(writer.__forgeMap, null, 1));
console.log('writer pageerrors:', errs.length, errs.slice(0, 5));
console.log('codex pageerrors:', cerrs.length, cerrs.slice(0, 3));

await writeFile('/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cc-writer.json', JSON.stringify(writer, null, 1));
await writeFile('/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cc-codex.json', JSON.stringify(codex, null, 1));

await browser.close(); await srv.close(); csrv.close();
