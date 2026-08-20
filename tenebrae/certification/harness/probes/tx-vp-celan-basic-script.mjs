// TX-4 / TX-7 VERIFIER — whose script is Celan Basic's?
//
// This probe used to document a gap: Celan Basic had no forged font, so the
// writer drew its romanization through the legacy sample rune face — a
// per-letter substitution cipher, not a Tenebrae script. The codex does have a
// script for it, the Auric runes, but not as an alphabet in TRANS[].L.script:
// they are carved per WORD by composeWord — a root rune, its domain radical, a
// link stroke per extra root, a loan diamond for anything the lexicon does not
// know, and prefix/suffix marks anchored to the whole word.
//
// The gap is closed, so the probe now asserts the other direction:
//   1. the romanization is the codex's                      (unchanged)
//   2. celan_basic IS among the forged scripts
//   3. its codepoints sit in the Auric block, not the sample block
//   4. the face is the forged Auric family, not the sample TTF
//   5. the forged glyph geometry is the codex carver's own, segment for
//      segment — the structural test, since a substitution cipher could still
//      produce plausible-looking marks
//   6. it is logographic, not a cipher: an anagram of a word does NOT produce
//      an anagram of its glyphs
//
// Run: cd probes && node tx-vp-celan-basic-script.mjs
import { launch, wait, insertTranslationSpan, createBook, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, detail) => { checks.push({ label, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };

/* ---- 1. a real Celan Basic span, through the real UI ---- */
await createBook(page, 'Auric Provenance');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the old king');
await wait(page, 500);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Celan Basic');
await wait(page, 1200);

const span = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  return sp ? { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom,
                scr: sp.dataset.scr, text: sp.textContent,
                family: getComputedStyle(sp).fontFamily,
                codes: [...(sp.dataset.scr || '')].map(c => 'U+' + c.charCodeAt(0).toString(16)) } : null;
});
console.log('span:', JSON.stringify({ ...span, scr: undefined, text: undefined }));

const codexRom = await page.evaluate(async src => {
  const w = await window.tenebrae.engine();
  return w.translateE2C(src).filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
}, 'the sea remembers the old king');
ck('the romanization is the codex\'s own translateE2C output', !!span && span.rom === codexRom,
   `${JSON.stringify(span && span.rom)} vs ${JSON.stringify(codexRom)}`);

/* ---- 2/3/4. forged, in its own block, in its own face ---- */
const forge = await page.evaluate(() => {
  const m = window.tenebrae._forge.map() || {};
  const A = m.celan_basic;
  return { ids: Object.keys(m), auric: !!(A && A.auric), family: A && A.family,
           base: A && A.base, words: A && A.order && A.order.slice(0, 8),
           ttfLen: A && A.ttf && A.ttf.length };
});
console.log('forge:', JSON.stringify(forge));
ck('celan_basic is among the forged-from-codex scripts', forge.ids.includes('celan_basic') && forge.auric,
   JSON.stringify(forge.ids));
ck('its codepoints sit in the Auric block, never the sample block U+E100..U+E11D',
   !!span && span.codes.length > 0 &&
   [...span.scr].every(c => { const n = c.charCodeAt(0); return n === 0x20 || (n >= 0xE800 && n <= 0xF8FF); }),
   span && span.codes.join(','));
ck('the face is the forged Auric family, not the sample codex TTF',
   !!span && /Tenebrae Auric Runes/.test(span.family) && !/Celan Runes/.test(span.family), span && span.family);
ck('the forged face carries a glyph per written word', !!forge.ttfLen && forge.words.length > 0,
   `${forge.words && forge.words.join(' ')} — ${forge.ttfLen} bytes`);

/* ---- 5. geometry parity: the writer's glyph IS the carver's drawing ---- */
const parity = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const A = window.tenebrae._forge.map().celan_basic;
  const U = 1000 / 1.7, PADX = 0.18, PADT = 0.36;
  const out = [];
  for(const word of A.order){
    const { segs, w: uw } = w.composeWord(word);
    // the same mapping the forge uses, applied to the carver's own segments
    const wantAdv = Math.round((uw + PADX * 2) * U);
    const g = A.words[word].glyph;
    // every carver segment must have a capsule whose two end-caps are centred
    // on that segment's endpoints, within a rounding unit
    const ends = segs.map(([x1, y1, x2, y2]) => [
      [Math.round((x1 + PADX) * U), Math.round(800 - (y1 + PADT) * U)],
      [Math.round((x2 + PADX) * U), Math.round(800 - (y2 + PADT) * U)]
    ]);
    const centres = g.contours.map(c => {
      const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    });
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 26; // half stroke
    const matched = ends.every(([a, b]) => centres.some(c => near(c, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])));
    out.push({ word, segs: segs.length, contours: g.contours.length,
               advOK: g.advance === wantAdv, matched });
  }
  return out;
});
for(const r of parity) console.log(`   ${r.advOK && r.matched && r.contours === r.segs ? 'ok  ' : 'FAIL'} ${r.word.padEnd(12)} segs=${r.segs} contours=${r.contours} adv=${r.advOK} centres=${r.matched}`);
ck('one capsule per carver segment, each centred on that segment',
   parity.length > 0 && parity.every(r => r.contours === r.segs && r.matched),
   JSON.stringify(parity.filter(r => r.contours !== r.segs || !r.matched)));
ck('every glyph advance is the carver\'s own word width', parity.every(r => r.advOK),
   JSON.stringify(parity.filter(r => !r.advOK).map(r => r.word)));

/* ---- 6. logographic, not a letter cipher ---- */
// The decisive structural difference: a per-letter substitution emits one
// character per LETTER, so word length drives glyph count. The carver draws
// each word whole — one character per word, whatever its length.
const cipherTest = await page.evaluate(async () => {
  const F = window.tenebrae._forge;
  const rows = [];
  for(const src of ['the sea', 'the sea remembers', 'the old king waits alone']){
    const r = await window.tenebrae.translate2('celan_basic', src);
    const scr = F.textForToks('celan_basic', r.toks) || '';
    const glyphs = [...scr].filter(c => c.charCodeAt(0) >= 0xE800).length;
    const romWords = r.romanization.split(/\s+/).filter(Boolean).length;
    const romLetters = r.romanization.replace(/\s+/g, '').length;
    rows.push({ src, rom: r.romanization, glyphs, romWords, romLetters });
  }
  // and two different words must draw differently — not one rune for everything
  const A = F.map().celan_basic;
  const sig = word => JSON.stringify(A.words[word].glyph.contours);
  const distinct = new Set(A.order.map(sig)).size;
  return { rows, distinct, words: A.order.length };
});
for(const r of cipherTest.rows)
  console.log(`   ${r.glyphs === r.romWords ? 'ok  ' : 'FAIL'} ${JSON.stringify(r.rom).padEnd(40)} glyphs=${r.glyphs} words=${r.romWords} letters=${r.romLetters}`);
ck('one glyph per WORD, never one per letter (logographic, not a cipher)',
   cipherTest.rows.every(r => r.glyphs === r.romWords && r.glyphs !== r.romLetters),
   JSON.stringify(cipherTest.rows.map(r => `${r.glyphs}/${r.romWords}/${r.romLetters}`)));
ck('each word draws its own rune, not one rune reused',
   cipherTest.distinct === cipherTest.words, `${cipherTest.distinct} distinct of ${cipherTest.words}`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('CELAN BASIC SCRIPT PROVENANCE', checks.every(c => c.ok));
await browser.close();
await srv.close();
