// COVERAGE-CRITIC probe 2: patched-codex ground truth (compileText) +
// the codex's OWN typesetter word/glyph structure vs the writer's PUA run.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';

const CODEX = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
let html = await readFile(CODEX, 'utf8');
// same mechanical patch the writer applies at import time
html = html.replace(/window\.CODEX\s*=\s*\{/,
  'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ');
const csrv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(r => csrv.listen(0, '127.0.0.1', r));
const cport = csrv.address().port;

const CORPUS = [
  'The sea remembers',
  "the keeper's oath",
  'Vor, kesh; nyx.',
  'shadow-light',
  'THE KING RUNS',
  '1000 stars and 3 suns',
  'café naïve résumé',
  'a',
  'the sea remembers the drowned dark and the gold sun',
  'The Gold Sun rose over Doranthe',
];

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

const cpage = await ctx.newPage();
cpage.on('pageerror', e => console.log('CODEX ERR', e.message));
await cpage.goto(`http://127.0.0.1:${cport}/`);
await cpage.waitForTimeout(2500);
const gt = await cpage.evaluate(({ corpus }) => {
  const C = window.CODEX;
  const out = { hasCompileText: !!C.compileText, langs: {} };
  for (const id of Object.keys(C.TRANS)) {
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    const matcher = sc && (sc.glyphs || []).length ? C.makeMatcher(sc) : null;
    const rows = [];
    for (const t of corpus) {
      const res = C.compileText ? C.compileText(T, t, 'e2l') : { parts: C.coreTranslate(T, t, 'e2l'), lines: null };
      const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
      const rom = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
      // the codex's own typesetter: how many words, and which glyph keys per word
      let words = null;
      if (matcher) {
        words = rom.split(/\s+/).filter(Boolean).map(wd => wd.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter(Boolean)
          .map(clean => {
            const w = clean.toLowerCase(); const o = []; let i = 0;
            while (i < w.length) {
              let hit = null;
              for (const k of matcher.keys) { if (w.startsWith(k, i)) { hit = k; break; } }
              if (hit) { o.push(hit); i += hit.length; } else { o.push('<DOT>'); i++; }
            }
            return o;
          });
      }
      rows.push({ src: t, rom, words });
    }
    out.langs[id] = { dir: sc ? C.scriptDir(sc) : 'ltr', rows };
  }
  return out;
}, { corpus: CORPUS });

// ---------- writer ----------
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(1500);
const wr = await page.evaluate(async ({ corpus, ids }) => {
  const out = {};
  for (const id of ids) {
    out[id] = [];
    for (const t of corpus) {
      const r = await window.tenebrae.translate2(id, t);
      const scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null;
      out[id].push({ src: t, rom: r ? r.romanization : null, toks: r ? (r.toks || []).map(k => k.sep ? '|SEP|' : k.t) : null, scr });
    }
  }
  return out;
}, { corpus: CORPUS, ids: Object.keys(gt.langs) });

console.log('hasCompileText in patched codex:', gt.hasCompileText);
let romBad = 0, wordBad = 0;
const fam = JSON.parse((await readFile('/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/family.json', 'utf8')).slice(0, 1433953));
const bases = { celan_high: 0xE500, kerrackian: 0xE580, kildaren: 0xE600, calgridarian: 0xE680, evernessian: 0xE700 };
const keyByCode = {};
for (const [id, base] of Object.entries(bases)) {
  keyByCode[id] = {};
  fam.langs[id].script.glyphs.forEach((g, i) => keyByCode[id][base + i] = g.k.toLowerCase());
  keyByCode[id][base + fam.langs[id].script.glyphs.length] = '<DOT>';
}
for (const id of Object.keys(gt.langs)) {
  for (let i = 0; i < CORPUS.length; i++) {
    const g = gt.langs[id].rows[i], w = wr[id][i];
    if (g.rom !== w.rom) { romBad++; console.log(`ROM MISMATCH [${id}] ${JSON.stringify(g.src)}\n  writer=${JSON.stringify(w.rom)}\n  codex =${JSON.stringify(g.rom)}`); }
    const wwords = w.scr == null ? [] : w.scr.split(/[ \n]/).filter(Boolean).map(word => [...word].map(ch => keyByCode[id][ch.codePointAt(0)] ?? 'RAW' + JSON.stringify(ch)));
    if (JSON.stringify(wwords) !== JSON.stringify(g.words || [])) {
      wordBad++;
      console.log(`SCRIPT MISMATCH [${id}/${gt.langs[id].dir}] ${JSON.stringify(g.src)}`);
      console.log(`  rom   = ${JSON.stringify(g.rom)}`);
      console.log(`  toks  = ${JSON.stringify(w.toks)}`);
      console.log(`  writer(${wwords.length} words) = ${JSON.stringify(wwords)}`);
      console.log(`  codex (${(g.words || []).length} words) = ${JSON.stringify(g.words)}`);
    }
  }
}
console.log(`\nROM mismatches: ${romBad} / ${CORPUS.length * Object.keys(gt.langs).length}`);
console.log(`SCRIPT mismatches: ${wordBad} / ${CORPUS.length * Object.keys(gt.langs).length}`);
console.log('writer pageerrors', errs);
await writeFile('/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cc-gt.json', JSON.stringify({ gt, wr }, null, 1));
await browser.close(); await srv.close(); csrv.close();
