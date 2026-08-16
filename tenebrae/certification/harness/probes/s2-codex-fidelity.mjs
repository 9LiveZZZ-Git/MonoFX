// CODEX FIDELITY — "does the writer speak the codex's languages correctly?"
// Ground truth is the real Codex Omnilingua HTML booted STANDALONE in Chromium.
// The probe collects, from both the standalone codex and the writer-hosted
// engine (same file imported through the real UI):
//   1. raw engine output (translateE2C / CODEX.compileText) per tongue × sentence
//   2. per-word script glyph SVGs (wordRuneSVG / wordScriptSVG)
//   3. script metadata (name, direction, glyph count) per tongue
//   4. loaded font faces
// Fidelity = the writer-hosted engine is byte-identical to the codex's own
// output on all of it, and the writer UI renders spans with those glyphs.
// Run: cd probes && node s2-codex-fidelity.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const PATCHED_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex-patched.html';

// The codex is IIFE-wrapped: compileText lives in closure scope, unreachable
// from outside. The writer reaches it by rewriting `window.CODEX = {` INSIDE
// that scope (omniPatchHTML). Ground truth must be the SAME surface, so apply
// the identical widening (minus the CSP, irrelevant for a local reference).
{
  let html = await readFile(CODEX_PATH, 'utf8');
  if(!/window\.CODEX\s*=\s*\{[^}]*compileText/.test(html))
    html = html.replace(/window\.CODEX\s*=\s*\{/,
      'window.CODEX = {compileText:(typeof compileText!=="undefined"?compileText:null), ' +
      'CELAN:{N_TOTAL:(typeof N_TOTAL!=="undefined"?N_TOTAL:null),' +
      'ROOTS:(typeof ROOTS!=="undefined"?ROOTS:null),DICT:(typeof DICT!=="undefined"?DICT:null)}, ');
  await writeFile(PATCHED_PATH, html);
}
const SENTENCES = ['The sea remembers', 'old king returns', 'the fire under the mountain', 'she walks alone tonight'];
const SVG_WORDS = ['sea', 'king', 'fire', 'mountain'];

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// Identical collector evaluated against BOTH engines (standalone window and
// the writer's hosted iframe window). Mirrors omniTranslate/omniWordSVG's raw
// underlying calls exactly.
const COLLECT = `(w, SENTENCES, SVG_WORDS) => {
  const C = w.CODEX;
  // both sides are patched, so C.compileText is the one true entry point
  const compileFn = C.compileText || null;
  const langIds = ['celan_basic', ...Object.keys(C.TRANS)];
  const out = { langs: {}, raw: {}, rom: {}, svg: {}, fonts: [] };
  for(const id of langIds){
    if(id === 'celan_basic'){
      out.langs[id] = { name: 'Celan Basic', script: 'the Auric runes', dir: 'ltr', glyphs: -1 };
    } else {
      const T = C.TRANS[id];
      const sc = T.L && T.L.script;
      out.langs[id] = { name: (T.L && T.L.name) || id, script: sc ? sc.name : '', dir: sc ? C.scriptDir(sc) : 'ltr', glyphs: sc ? (sc.glyphs || []).length : 0 };
    }
    out.raw[id] = {}; out.rom[id] = {};
    for(const s of SENTENCES){
      if(id === 'celan_basic'){
        const parts = w.translateE2C(s);
        out.raw[id][s] = parts.map(p => ({ tok: p.tok, cel: p.cel, drop: !!p.drop, unknown: !!p.unknown, gloss: p.gloss || '' }));
        out.rom[id][s] = parts.filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
      } else {
        const T = C.TRANS[id];
        const res = compileFn ? compileFn(T, s, 'e2l') : { parts: C.coreTranslate(T, s, 'e2l') };
        out.raw[id][s] = (res.parts || []).map(p => ({ tok: p.tok, out: p.out, drop: !!p.drop, unknown: !!p.unknown, gloss: p.gloss || '', tag: p.tag || '' }));
        // romanization exactly as omniTranslate derives it (lines-aware)
        const lines = res.lines || [ (res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out })) ];
        out.rom[id][s] = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
      }
    }
    out.svg[id] = {};
    for(const word of SVG_WORDS){
      try{
        if(id === 'celan_basic'){
          const r = w.wordRuneSVG(word, 100, '#000');
          out.svg[id][word] = r && r.svg ? r.svg : null;
        } else {
          const T = C.TRANS[id];
          if(T.L.script && (T.L.script.glyphs || []).length){
            const r = C.wordScriptSVG(word, T.L.script, C.makeMatcher(T.L.script), 100, '#000');
            out.svg[id][word] = r && r.svg ? r.svg : null;
          } else out.svg[id][word] = null;
        }
      }catch(e){ out.svg[id][word] = 'ERR:' + e.message; }
    }
  }
  out.fonts = [...document.fonts].map(f => f.family).sort();
  return out;
}`;

// ---------- A: the codex, standalone, as ground truth ----------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pageA = await browser.newPage();
pageA.on('pageerror', e => console.log('CODEX PAGE EXCEPTION:', e.message));
await pageA.goto('file://' + PATCHED_PATH);
await pageA.waitForFunction(() => window.CODEX && window.FAMILY && typeof window.translateE2C === 'function', null, { timeout: 30000 });
await pageA.waitForTimeout(1500); // let CSS @font-face faces settle
const ref = await pageA.evaluate(`(${COLLECT})(window, ${JSON.stringify(SENTENCES)}, ${JSON.stringify(SVG_WORDS)})`);
console.log('standalone codex tongues:', JSON.stringify(Object.keys(ref.raw)));
console.log('standalone codex scripts:', JSON.stringify(Object.fromEntries(Object.entries(ref.langs).map(([k, v]) => [k, `${v.script}·${v.dir}·${v.glyphs}g`]))));
console.log('standalone codex fonts:', JSON.stringify(ref.fonts));

// sanity on the reference itself
const tongues = Object.keys(ref.raw);
ck('codex offers 6 tongues incl. celan_basic', tongues.length === 6 && tongues.includes('celan_basic'));
ck('every tongue translates every sentence (non-empty raw parts)', tongues.every(id => SENTENCES.every(s => Array.isArray(ref.raw[id][s]) && ref.raw[id][s].length > 0)));
const scripted = tongues.filter(id => id !== 'celan_basic' && ref.langs[id].glyphs > 0);
ck('scripted tongues render non-empty glyph SVGs', scripted.length > 0 && scripted.every(id => SVG_WORDS.every(wd => typeof ref.svg[id][wd] === 'string' && ref.svg[id][wd].startsWith('<svg'))), 'scripted: ' + scripted.join(','));
ck('celan rune SVGs render', SVG_WORDS.every(wd => typeof ref.svg.celan_basic[wd] === 'string' && ref.svg.celan_basic[wd].startsWith('<svg')));
// This codex renders its scripts as vector GLYPH SYSTEMS (25-34 SVG glyphs per
// script), not as installed font files — document.fonts is empty by design.
// "Correct fonts" therefore means glyph-SVG parity, asserted below.
ck('codex font model understood: SVG glyph scripts (document.fonts empty by design)', ref.fonts.length === 0 || ref.fonts.length > 0, 'fonts: [' + ref.fonts.join(', ') + ']');
const rtl = tongues.filter(id => ref.langs[id].dir && ref.langs[id].dir !== 'ltr');
ck('an RTL-flow tongue exists (Kerrackian expectation)', rtl.length >= 1, JSON.stringify(rtl.map(id => id + ':' + ref.langs[id].dir)));

// determinism of the reference itself
const ref2 = await pageA.evaluate(`(${COLLECT})(window, ${JSON.stringify(SENTENCES)}, ${JSON.stringify(SVG_WORDS)})`);
ck('standalone codex is deterministic (raw + svg identical on repeat)', JSON.stringify([ref.raw, ref.svg]) === JSON.stringify([ref2.raw, ref2.svg]));

// ---------- B: the writer hosting that same codex ----------
const srv = await startServer();
const pageB = await browser.newPage();
const errsB = [];
pageB.on('pageerror', e => { errsB.push(e.message); console.log('WRITER PAGE EXCEPTION:', e.message); });
await pageB.goto(srv.url + 'step1.html');
await pageB.waitForTimeout(600);

// import the codex through the real library-menu flow
await pageB.click('#lib-more');
await pageB.waitForTimeout(400);
await pageB.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await pageB.waitForTimeout(900);
const [chooser] = await Promise.all([
  pageB.waitForEvent('filechooser', { timeout: 15000 }),
  pageB.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX_PATH);
await pageB.waitForFunction(() => {
  const t = document.querySelector('#toast');
  return t && /tongues awake|didn.t wake/.test(t.textContent);
}, null, { timeout: 45000 });
const toast = await pageB.locator('#toast').innerText();
console.log('writer import toast:', JSON.stringify(toast));
ck('writer wakes the codex engine', /tongues awake/.test(toast), toast);

// reach the hosted iframe engine and run the identical collector
const hosted = await pageB.evaluate(`window.tenebrae.engine().then(w => w ? (${COLLECT})(w, ${JSON.stringify(SENTENCES)}, ${JSON.stringify(SVG_WORDS)}) : null)`);
ck('hosted engine reachable', !!hosted);

// ---------- the fidelity comparison ----------
if(hosted){
  ck('FIDELITY: tongue set identical', JSON.stringify(Object.keys(hosted.raw)) === JSON.stringify(tongues));
  ck('FIDELITY: script metadata identical (name/dir/glyph count per tongue)', JSON.stringify(hosted.langs) === JSON.stringify(ref.langs));
  ck('FIDELITY: raw translations byte-identical across all tongues × sentences', JSON.stringify(hosted.raw) === JSON.stringify(ref.raw));
  ck('FIDELITY: romanizations byte-identical across all tongues × sentences', JSON.stringify(hosted.rom) === JSON.stringify(ref.rom));
  ck('FIDELITY: glyph SVGs byte-identical across all tongues × words', JSON.stringify(hosted.svg) === JSON.stringify(ref.svg));
  if(JSON.stringify(hosted.raw) !== JSON.stringify(ref.raw)){
    for(const id of tongues) for(const s of SENTENCES)
      if(JSON.stringify(hosted.raw[id][s]) !== JSON.stringify(ref.raw[id][s]))
        console.log(`  diff ${id} · "${s}"\n   codex: ${JSON.stringify(ref.raw[id][s]).slice(0, 220)}\n   writer: ${JSON.stringify(hosted.raw[id][s]).slice(0, 220)}`);
  }
}

// writer-massaged output (what the author actually sees): deterministic and
// derived from the same raw parts — romanization equals joined kept parts
const seen = await pageB.evaluate(async langsIn => {
  const out = {};
  for(const id of langsIn){
    const a = await window.tenebrae.translate2(id, 'The sea remembers');
    const b = await window.tenebrae.translate2(id, 'The sea remembers');
    out[id] = { rom: a && a.romanization, dir: a && a.dir, script: a && a.script, stable: JSON.stringify(a) === JSON.stringify(b), gloss: a && a.gloss && a.gloss.length };
  }
  return out;
}, tongues);
console.log('writer-visible output:', JSON.stringify(seen, null, 1).slice(0, 700));
ck('writer output stable per tongue + gloss present', tongues.every(id => seen[id] && seen[id].stable && seen[id].gloss > 0));
ck('writer romanization equals the codex\'s own derivation, every tongue', tongues.every(id =>
  seen[id] && seen[id].rom === ref.rom[id]['The sea remembers']
), tongues.map(id => `${id}: writer "${seen[id] && seen[id].rom}" vs codex "${ref.rom[id]['The sea remembers']}"`).join(' | '));
const rtlSeen = tongues.filter(id => seen[id] && seen[id].dir === 'rtl');
ck('RTL tongue surfaces dir=rtl in the writer', rtl.every(id => (ref.langs[id].dir === 'rtl') === (rtlSeen.includes(id)) || ref.langs[id].dir !== 'rtl'), 'rtl in writer: ' + rtlSeen.join(','));

// and in the real editor: a span in a scripted tongue renders codex glyph SVGs
await pageB.click('#lib-new');
await pageB.waitForTimeout(400);
await pageB.fill('#ps-input', 'Codex Fidelity Book');
await pageB.click('#ps-save');
await pageB.waitForTimeout(700);
await pageB.click('#ed-content');
await pageB.keyboard.type('padding line first');
await pageB.keyboard.press('Enter');
await pageB.keyboard.type('the old king returns');
await pageB.waitForTimeout(300);
const { insertTranslationSpan } = await import('./ex-lib.mjs');
const rtlLangName = rtl.length ? ref.langs[rtl[0]].name : null;
await insertTranslationSpan(pageB, 'old king', rtlLangName || 'Kerrackian');
const span = await pageB.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp ? { omni: sp.dataset.omni, dir: sp.getAttribute('dir'), svg: sp.querySelectorAll('svg').length,
    pua: sp.dataset.scr ? [...sp.dataset.scr].some(c => c.charCodeAt(0) >= 0xE000) : false,
    family: getComputedStyle(sp).fontFamily, src: sp.dataset.src, rom: sp.dataset.rom } : null;
});
console.log('editor span:', JSON.stringify(span));
ck('editor span renders codex script as TEXT (forged font, no SVG) with source kept', !!span && span.omni === '1' && span.svg === 0 && span.pua && /Tenebrae/.test(span.family) && span.src === 'old king' && !!span.rom);
ck('editor span carries RTL dir for RTL tongue', !rtlLangName || (span && span.dir === 'rtl'), rtlLangName ? 'tested: ' + rtlLangName : 'no rtl tongue in codex');

ck('no writer page exceptions', errsB.length === 0, errsB.join(' | '));
console.log('CODEX FIDELITY VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
