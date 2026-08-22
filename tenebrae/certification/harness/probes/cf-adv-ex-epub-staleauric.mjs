// ADVERSARY / TX-10 — "EPUB carries the script".
//
// The auditor exported an EPUB from the SAME session in which every Auric word
// had already been minted, so data-scr in the store and the codes in the forged
// face agreed by construction. The interesting case is the one syncScriptDoc
// (step1.html L2442-2464) exists for: a stored doc whose data-scr was minted in
// a PREVIOUS session, exported from a session where the same words carry
// DIFFERENT codes because other words were minted first.
//
// If syncScriptDoc did not really regenerate, the EPUB would carry the stale
// codes and every Auric span would silently show the WRONG WORDS in a font that
// still covers them — the failure a coverage check cannot see.
//
// Run: cd probes && node cf-adv-ex-epub-staleauric.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfstale';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + l + (x === undefined ? '' : '  ' + String(x).slice(0, 400))); };

function unzipStored(buf){
  const out = new Map();
  for(let i = 0; i < buf.length - 3; i++){
    if(buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const csize = buf.readUInt32LE(i + 18);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    out.set(name, buf.slice(start, start + csize));
    i = start + csize - 1;
  }
  return out;
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, 'Cold Auric Book');
await page.click('#ed-title'); await page.keyboard.type('First Light');
await page.click('#ed-content'); await page.keyboard.type('the gate opens at dawn');
await wait(page, 1200);
await insertTranslationSpan(page, 'gate opens', 'Celan Basic');
await wait(page, 1200);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 800);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 900);
await page.click('#ed-title'); await page.keyboard.type('Second Sight');
await page.click('#ed-content'); await page.keyboard.type('the sea remembers the old king');
await wait(page, 1200);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1400);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 1500);

const mint1 = await page.evaluate(() => {
  const A = window.tenebrae._forge.map().celan_basic;
  return { order: A.order.slice(), codes: A.order.map(w => A.words[w].code.toString(16)) };
});
console.log('session-1 mint order:', mint1.order.join(' '), '->', mint1.codes.join(' '));
ck('precondition: session 1 minted the Auric words', mint1.order.length >= 4, mint1.order.join(' '));

const snap = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => res(r.result ? r.result.books : []); r.onerror = () => res([]); };
  rq.onerror = () => res([]);
}));
const stored1 = (await snap())[0];
const storedScr = [];
stored1.chapters.forEach(c => c.scenes.forEach(s => {
  for(const m of (s.doc||'').matchAll(/<span class="tspan"([^>]*)>/g)){
    const scr = (m[1].match(/data-scr="([^"]*)"/)||[])[1] || '';
    const src = (m[1].match(/data-src="([^"]*)"/)||[])[1] || '';
    storedScr.push({ src, codes: [...scr].filter(ch => PUA_RE.test(ch)).map(ch => ch.codePointAt(0).toString(16)) });
  }
}));
console.log('stored data-scr (session 1):', JSON.stringify(storedScr));

// ---- reload: fresh forge, nothing minted ----
await page.reload();
await wait(page, 4200);
const mint0 = await page.evaluate(() => { const m = window.tenebrae._forge.map(); return m && m.celan_basic ? m.celan_basic.order.slice() : null; });
console.log('after reload, before anything:', JSON.stringify(mint0));
ck('precondition: the reloaded session starts with an EMPTY Auric face', Array.isArray(mint0) && mint0.length === 0, JSON.stringify(mint0));

// perturb: mint three decoy words FIRST so every real word gets a different code
const decoy = await page.evaluate(() => {
  const t = window.tenebrae._forge;
  ['qqqx','wwwy','vvvz'].forEach(w => t.textFor('celan_basic', w));
  const A = t.map().celan_basic;
  return { order: A.order.slice() };
});
console.log('after decoy mint:', decoy.order.join(' '));
ck('precondition: decoy words occupy the low Auric codepoints', decoy.order.length === 3, decoy.order.join(' '));

// straight to export — the scenes are never opened in this session
await page.locator('[data-book]').first().click();
await wait(page, 1400);
await page.click('#bk-share');
await wait(page, 600);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 25000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await dl.path());
await wait(page, 800);
await writeFile(OUT + '/stale.epub', epub);
const ez = unzipStored(epub);
const parts = [...ez.keys()].filter(n => /OEBPS\/ch\d+\.xhtml$/.test(n)).map(n => new TextDecoder().decode(ez.get(n))).join('\n');
await writeFile(OUT + '/parts.xhtml', parts);

const spans = [...parts.matchAll(/<span class="tspan"([^>]*)>([^<]*)<\/span>/g)].map(m => ({
  lang: (m[1].match(/data-lang="([^"]+)"/)||[])[1],
  src:  (m[1].match(/data-src="([^"]*)"/)||[])[1],
  rom:  (m[1].match(/data-rom="([^"]*)"/)||[])[1],
  body: m[2],
}));
console.log('epub spans:', JSON.stringify(spans.map(s => ({ lang: s.lang, src: s.src, rom: s.rom,
  codes: [...s.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0).toString(16)) }))));
ck('epub: both Auric spans present', spans.length === 2 && spans.every(s => s.lang === 'celan_basic'), spans.length);

// What each exported codepoint MEANS is a question about the FILE, so it has to
// be asked of the file's own face. An export builds its own document-ordered
// mapping — that is what makes two exports of the same state byte identical —
// so decoding its codes through the SESSION's map answers a different question
// and reads pure noise. Compare outlines instead: the rune the embedded face
// draws for each exported codepoint, against the rune the live face draws for
// the word that codepoint is supposed to be. If syncScriptDoc had not
// regenerated, these would be different drawings.
const cssA = new TextDecoder().decode(ez.get('OEBPS/style.css'));
const unqA = t => t.replace(/\\(.)/g, '$1');
let famA = null, mA;
const rxA = /\.tspan\[data-lang="celan_basic"\]\{font-family:'((?:[^'\\]|\\.)+)'/g;
while((mA = rxA.exec(cssA))) famA = unqA(mA[1]);
let hrefA = null, fA;
const frxA = /@font-face\{font-family:'((?:[^'\\]|\\.)+)';src:url\('(fonts\/f\d+\.ttf)'\)/g;
while((fA = frxA.exec(cssA))) if(unqA(fA[1]) === famA) hrefA = fA[2];
ck('epub: the Auric face is embedded and named by the per-language rule', !!hrefA, famA + ' -> ' + hrefA);

const cleanW = w => String(w).replace(/[^\wéäí'-]/g, '').toLowerCase();
if(hrefA){
  await writeFile(OUT + '/epubface.ttf', ez.get('OEBPS/' + hrefA));
  // mint the expected words live, then take the live face and its map
  const live = await page.evaluate(async words => {
    for(const w of words){
      const r = await window.tenebrae.translate2('celan_basic', w);
      if(r) window.tenebrae._forge.textForToks('celan_basic', r.toks || []);
    }
    const A = window.tenebrae._forge.map().celan_basic;
    let bin = '';
    for(const x of A.ttf) bin += String.fromCharCode(x);
    return { ttf: btoa(bin), codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])) };
  }, spans.map(s2 => s2.src));
  await writeFile(OUT + '/liveface.ttf', Buffer.from(live.ttf, 'base64'));

  const pairs = [], shapeBad = [];
  for(const sp of spans){
    const codes = [...sp.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0));
    const want = String(sp.rom || '').split(/\s+/).map(cleanW).filter(Boolean);
    if(codes.length !== want.length){ shapeBad.push(`"${sp.src}": ${codes.length} runes for ${want.length} words`); continue; }
    want.forEach((w, i) => {
      if(live.codes[w] == null){ shapeBad.push(`"${w}" never minted live`); return; }
      pairs.push([codes[i], live.codes[w], w, sp.src]);
    });
  }
  ck('epub: one rune per romanized word, for every Auric span', shapeBad.length === 0, shapeBad.join('; '));

  let bad = ['not run'];
  if(!shapeBad.length){
    const py = `
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
def draw(path, code):
    f = TTFont(path); cm = f.getBestCmap()
    if code not in cm: return None
    gs = f.getGlyphSet(); pen = RecordingPen(); gs[cm[code]].draw(pen)
    return (repr(pen.value), round(gs[cm[code]].width, 4))
out = []
for ec, lc, word, src in ${JSON.stringify(pairs)}:
    a = draw("${OUT}/epubface.ttf", ec)
    b = draw("${OUT}/liveface.ttf", lc)
    if a is None: out.append(word + ": U+%04X missing from the EPUB face" % ec)
    elif b is None: out.append(word + ": U+%04X missing from the live face" % lc)
    elif a != b: out.append(word + " (in \"" + src + "\"): the EPUB draws a different rune")
print(json.dumps(out))
`;
    await writeFile(OUT + '/outline.py', py);
    bad = JSON.parse(execFileSync('python3', [OUT + '/outline.py'], { encoding: 'utf8' }).trim());
  }
  ck('epub: every exported rune is the one the codex draws for that word — so the stale data-scr really was regenerated',
     bad.length === 0, JSON.stringify(bad).slice(0, 400) + `  (${pairs.length} runes decoded through the embedded face)`);
}

const epubCodes = spans.map(s => [...s.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0).toString(16)));
console.log('DIAGNOSTIC stale-vs-fresh codes: stored', JSON.stringify(storedScr.map(x=>x.codes)), 'exported', JSON.stringify(epubCodes));

// the embedded Auric face must cover the codes the export actually wrote
const css = new TextDecoder().decode(ez.get('OEBPS/style.css'));
const unq = t => t.replace(/\\(.)/g, '$1');
const rx = /\.tspan\[data-lang="celan_basic"\]\{font-family:'((?:[^'\\]|\\.)+)'/g;
let fam = null, m; while((m = rx.exec(css))) fam = unq(m[1]);
const frx = /@font-face\{font-family:'((?:[^'\\]|\\.)+)';src:url\('(fonts\/f\d+\.ttf)'\)/g;
let href = null, f; while((f = frx.exec(css))) if(unq(f[1]) === fam) href = f[2];
console.log('celan_basic family/href:', fam, href);
if(href){
  const p = OUT + '/' + href.replace('/', '_');
  await writeFile(p, ez.get('OEBPS/' + href));
  const cps = [...new Set(epubCodes.flat().map(h => parseInt(h, 16)))];
  const out = execFileSync('python3', ['-c', `
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1]); cm = f.getBestCmap()
print(','.join(str(int(c in cm)) for c in map(int, sys.argv[2].split(','))))
`, p, cps.join(',')]).toString().trim();
  ck(`epub: the embedded "${fam}" covers every code the export wrote`, out.split(',').every(x => x === '1'),
     `${href} cps=${cps.map(c=>c.toString(16)).join(' ')} covered=${out}`);
}else ck('epub: celan_basic resolves to an embedded face', false, String(fam));

ck('no page exceptions', errors.length === 0, errors.slice(0,3).join(' | '));
console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-10 ADVERSARY: stale Auric data-scr across sessions', checks.every(c => c[1]));
console.log('FAILED:', checks.filter(c => !c[1]).map(c => c[0]));
await browser.close(); await srv.close();
