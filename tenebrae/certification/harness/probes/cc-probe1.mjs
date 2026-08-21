// COVERAGE-CRITIC probe 1 (DIAGNOSTIC — no VERDICT line): writer vs codex —
// tongue roster, romanization, glyph-key parity including punctuation /
// apostrophe / accent material. Dumps both sides to the scratchpad as JSON.
//
// TRIAGE 2026-08-21: this crashed in the writer-side evaluate before printing
// any comparison —
//   page.evaluate: TypeError: Cannot read properties of undefined (reading 'codePointAt')
// because its __forgeMap projection assumed every forged face is an alphabet
// with a `gidx` table and an unknown-token `dot`. Celan Basic is deliberately a
// word script (TX-6c) whose record is {family, base, flow, win, words, order,
// ttf, auric, codeMap}. Projection widened; nothing else changed.
import { chromium } from 'playwright-core';
import { startServer } from '/home/user/MonoFX/tenebrae/certification/harness/serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';

// serve the standalone codex too
const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
// The codex's own window.CODEX export (codex.html L4674) does NOT include
// compileText, and compileText is not a global (it lives inside an IIFE — a
// page.evaluate sees `typeof compileText === "undefined"`; proved by
// cf-codex-compiletext.mjs). Reading ground truth without it silently fell back
// to C.coreTranslate, which is the word core and NOT the codex's compiler: it
// drops the Celan High sentence frame, so this diagnostic reported 12 bogus
// "mismatches" against a writer that was right. Apply the same mechanical,
// behaviour-neutral widening the writer applies at import time (step1.html
// omniPatchHTML, L3581-3585) so both sides read the SAME codex function.
const codexBody = (await readFile(CODEX, 'utf8')).replace(/window\.CODEX\s*=\s*\{/,
  'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ');
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
  // Celan Basic is a WORD script (TX-6c): the codex gives it no alphabet in
  // TRANS[].L.script, so its forge record carries {win, words, order, auric}
  // and has neither `gidx` nor an unknown-token `dot`. Projecting it like an
  // alphabet threw "Cannot read properties of undefined (reading 'codePointAt')"
  // and killed this diagnostic before it printed anything.
  out.__forgeMap = Object.fromEntries(Object.entries(window.tenebrae._forge.map() || {}).map(([k, v]) => [k, {
    family: v.family,
    base: (v.base != null ? v.base.toString(16) : null),
    flow: v.flow,
    kind: v.auric ? 'word-script' : 'alphabet',
    dot: (v.dot && v.dot.length) ? v.dot.codePointAt(0).toString(16) : null,
    nkeys: v.gidx ? Object.keys(v.gidx).length : null,
    nwords: v.words ? Object.keys(v.words).length : null,
    ncodes: v.codeMap ? Object.keys(v.codeMap).length : null,
  }]));
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
        if(!C.compileText) throw new Error('codex compileText not exposed — widening patch failed');
        const res = C.compileText(T, t, 'e2l');
        // the codex feeds its typesetter cleanText: compiled lines with the
        // untranslated parts (p.u) removed (TX-6b). Keep the full romanization
        // here and record the clean form separately.
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
