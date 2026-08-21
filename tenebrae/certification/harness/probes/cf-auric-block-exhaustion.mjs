// TX-4 / TX-6c GAP PROBE — what happens when the Auric word block runs out.
//
// AURIC_BASE = 0xE800, AURIC_TOP = 0xF8FF (step1.html:3158) — 4352 slots, one
// per distinct written word, minted lazily for the whole session. Nothing in
// the suite has ever pushed past that boundary. A word script that silently
// wraps, collides, mints outside the PUA, emits an unmapped codepoint, or
// throws would fail TX-4 ("cmap covers every codepoint used") and TX-6c.
//
// Asserted at the boundary:
//   1. exactly 4352 words mint; the last one lands on U+F8FF, none above it
//   2. every minted code is distinct and inside the Auric block
//   3. the script text emitted for an over-cap corpus contains ONLY mapped
//      codepoints — the surplus words are dropped, never written as Latin and
//      never written as an uncovered codepoint
//   4. a fresh word after exhaustion mints nothing and the span DECLINES
//      (omniScriptText returns null) rather than degrading
//   5. the 4354-glyph face still forges: fontTools decompiles every table,
//      loca is long-format, and the cmap covers all 4352 + space
//   6. no page exception anywhere along the way
//
// Run: cd probes && node cf-auric-block-exhaustion.mjs
import { launch, wait, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cf-auric';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };

const { srv, browser, page, errors } = await launch();
page.setDefaultTimeout(120000);
await wait(page, 3500);

// 4500 distinct synthetic words > the 4352-slot cap. Only [\w éäí'-] survives
// auricClean, so plain alphanumerics are the honest stress case.
const res = await page.evaluate(async () => {
  const F = window.tenebrae._forge;
  const A0 = F.map().celan_basic;
  const before = A0.order.length;
  // fixed-width base-26 letters: unique by construction (no padding collisions)
  const enc = n => { let s = ''; for(let k = 0; k < 4; k++){ s = String.fromCharCode(97 + n % 26) + s; n = (n / 26) | 0; } return s; };
  const words = [];
  for(let i = 0; i < 4500; i++) words.push('zq' + enc(i));
  const uniqueInput = new Set(words).size;
  // a REAL phrase minted BEFORE the block fills, to prove old words keep writing
  const pre = F.textFor('celan_basic', 'the sea remembers');
  const preCount = F.map().celan_basic.order.length;
  const t0 = performance.now();
  const scr = F.textForToks('celan_basic', [{ t: words.join(' ') }]);
  const ms = Math.round(performance.now() - t0);
  const A = F.map().celan_basic;
  const codes = A.order.map(w => A.words[w].code);
  const glyphChars = [...(scr || '')].filter(c => c.charCodeAt(0) !== 0x20);
  const codeSet = new Set(codes);
  // every emitted codepoint must be one the face actually maps
  const unmapped = [...new Set(glyphChars.map(c => c.charCodeAt(0)))].filter(n => !A.codeMap[n]);
  const nonPUA = glyphChars.filter(c => { const n = c.charCodeAt(0); return n < 0xE800 || n > 0xF8FF; });
  // 4. a brand-new word once the block is full
  const fresh = F.textFor('celan_basic', 'qqzzfreshword');
  const afterFresh = F.map().celan_basic.order.length;
  return {
    before, minted: A.order.length, ms, uniqueInput, pre, preCount,
    min: Math.min(...codes), max: Math.max(...codes), distinct: codeSet.size,
    emitted: glyphChars.length, unmapped, nonPUA: nonPUA.length,
    codeMapSize: Object.keys(A.codeMap).length,
    ttfLen: A.ttf ? A.ttf.length : 0,
    fresh, afterFresh,
    lastWord: A.order[A.order.length - 1],
    // a phrase whose words were minted BEFORE the block filled must still write
    realSentence: F.textFor('celan_basic', 'the sea remembers') || null,
  };
});
console.log(JSON.stringify(res, null, 1).slice(0, 1200));

ck('setup: 4500 distinct synthetic words offered to a 4352-slot block',
   res.uniqueInput === 4500 && typeof res.pre === 'string', `unique=${res.uniqueInput} pre-minted=${res.preCount}`);
ck('exactly 4352 words mint — the whole block, not one more',
   res.minted === 4352, `minted=${res.minted} (started at ${res.before}) in ${res.ms}ms`);
ck('the block boundary is exact: first U+E800, last U+F8FF, nothing above',
   res.min === 0xE800 && res.max === 0xF8FF,
   `U+${res.min.toString(16).toUpperCase()}..U+${res.max.toString(16).toUpperCase()}`);
ck('every minted codepoint is distinct (no wrap, no collision)',
   res.distinct === res.minted, `${res.distinct} distinct of ${res.minted}`);
ck('the over-cap corpus writes exactly the words that got a slot, and no more',
   res.emitted === 4352 - res.preCount,
   `emitted ${res.emitted} of 4500 offered; block had ${res.preCount} words already`);
ck('no emitted codepoint is unmapped by the face (nothing written it cannot draw)',
   res.unmapped.length === 0, JSON.stringify(res.unmapped.map(n => 'U+' + n.toString(16))));
ck('no emitted character falls outside the Auric block', res.nonPUA === 0, `${res.nonPUA} strays`);
ck('a fresh word after exhaustion mints nothing and the span DECLINES (null, never Latin)',
   res.fresh === null && res.afterFresh === 4352, `fresh=${JSON.stringify(res.fresh)} order=${res.afterFresh}`);
ck('a phrase minted BEFORE exhaustion still writes afterwards',
   typeof res.realSentence === 'string' && [...res.realSentence].every(c => c === ' ' || c.charCodeAt(0) >= 0xE800),
   JSON.stringify(res.realSentence));

/* ---- the 4354-glyph face, opened as a font ---- */
const b64 = await page.evaluate(() => {
  const t = window.tenebrae._forge.map().celan_basic.ttf;
  let s = '';
  for(let i = 0; i < t.length; i += 0x8000) s += String.fromCharCode.apply(null, t.subarray(i, i + 0x8000));
  return btoa(s);
});
await writeFile(OUT + '/auric-full.ttf', Buffer.from(b64, 'base64'));
console.log('auric face:', Buffer.from(b64, 'base64').length, 'bytes');
const py = `
import json, struct
from fontTools.ttLib import TTFont
p = "${OUT}/auric-full.ttf"
f = TTFont(p)
f.saveXML("${OUT}/auric-full.ttx")
cm = f.getBestCmap()
raw = open(p, "rb").read()
head = f["head"]
want = list(range(0xE800, 0xF900)) + [0x20]
missing = [hex(u) for u in want if u not in cm]
empty = [hex(u) for u, n in list(cm.items())[:80] if u != 0x20 and not getattr(f["glyf"][n], "numberOfContours", 0)]
print(json.dumps({"tables": sorted(f.keys()), "numGlyphs": f["maxp"].numGlyphs,
                  "indexToLocFormat": head.indexToLocFormat, "cmapEntries": len(cm),
                  "missing": missing[:8], "nMissing": len(missing), "emptySample": empty}))
`;
await writeFile(OUT + '/full.py', py);
let fj = null, ferr = '';
try{ const o = execFileSync('python3', [OUT + '/full.py'], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
     console.log('fontTools:', o.split('\n').pop()); fj = JSON.parse(o.split('\n').pop()); }
catch(e){ ferr = String(e.message).slice(0, 300); console.log('fontTools FAILED', ferr); }
ck('fontTools decompiles every table of the full 4354-glyph face',
   !!fj && fj.tables.includes('glyf') && fj.tables.includes('loca') && fj.tables.includes('cmap'), fj ? fj.tables.join(' ') : ferr);
ck('numGlyphs = .notdef + space + 4352 words', !!fj && fj.numGlyphs === 4354, fj && String(fj.numGlyphs));
ck('loca is long-format, as a face this size requires', !!fj && fj.indexToLocFormat === 1, fj && String(fj.indexToLocFormat));
ck('cmap covers the whole block: space + every one of the 4352 slots',
   !!fj && fj.nMissing === 0 && fj.cmapEntries === 4353, fj && `entries=${fj.cmapEntries} missing=${fj.nMissing} ${JSON.stringify(fj.missing)}`);
ck('no blank glyph among the mapped words', !!fj && fj.emptySample.length === 0, fj && JSON.stringify(fj.emptySample));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('CF AURIC BLOCK EXHAUSTION', checks.every(c => c[1]));
await browser.close();
await srv.close();
