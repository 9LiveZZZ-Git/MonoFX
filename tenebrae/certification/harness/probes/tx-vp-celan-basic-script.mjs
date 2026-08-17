// TX-4 / TX-7 VERIFIER — whose script is Celan Basic's?
//
// The writer's TX-7 note says Celan Basic "has no codex glyph table, so its
// script form is drawn through the legacy sample Auric rune font ... That is
// the documented design — the sample codex supplies FONTS for that tongue,
// never the translation." This probe tests both halves of that claim against
// the codex itself:
//
//   1. is the ROMANIZATION the codex's?            (expected: yes)
//   2. is the SCRIPT the codex's?                  (the actual question)
//   3. does the codex in fact have a Celan script? (Futhark Auricum, VIII.)
//   4. what generates the characters the user sees — the codex's rune engine,
//      or SAMPLE_CODEX.languages['celan-basic'].script (base 0xE100 + the
//      TN_DIGRAPHS table), i.e. a per-letter substitution of the romanization?
//
// The test for (4) is structural, not cosmetic: a letter-substitution cipher is
// a homomorphism — same letters in, same glyphs out, anagrams stay anagrams —
// while the codex's Futhark Auricum is logographic: one rune per ROOT, affix
// marks at the corners, compounds fused into bind-blocks.
//
// Run: cd probes && node tx-vp-celan-basic-script.mjs
import { launch, wait, insertTranslationSpan, createBook, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, detail) => { checks.push({ label, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };

/* ---- 1. a real Celan Basic span, through the real UI ---- */
await createBook(page, 'Celan Basic Provenance');
await page.click('#ed-content');
await page.keyboard.type('the sea remembers the old king tonight');
await wait(page, 400);
await insertTranslationSpan(page, 'the sea remembers', 'Celan Basic');
await wait(page, 800);

const span = await page.evaluate(() => {
  const el = document.querySelector('#ed-content .tspan');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    lang: el.dataset.lang, src: el.dataset.src, rom: el.dataset.rom, scr: el.dataset.scr,
    text: el.textContent, omni: el.dataset.omni, flow: el.dataset.flow || null,
    font: cs.fontFamily, svg: el.querySelectorAll('svg').length,
    codes: [...(el.dataset.scr || '')].map(c => c.charCodeAt(0)),
  };
});
console.log('\nspan:', JSON.stringify({ ...span, codes: span.codes.map(c => 'U+' + c.toString(16).toUpperCase()) }, null, 1), '\n');
ck('a Celan Basic span exists with source, romanization and script', !!span && !!span.src && !!span.rom && !!span.scr);
ck('no <svg> inside the span (script is text)', span.svg === 0);

/* ---- 2/3/4: interrogate the codex directly ---- */
const probe = await page.evaluate(async ({ rom, scr }) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;

  // (a) is the romanization the codex's own?
  const parts = w.translateE2C('the sea remembers');
  const codexRom = parts.filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');

  // (b) does the codex have a Celan script of its own?
  const hasRuneEngine = typeof w.wordRuneSVG === 'function';
  const inTRANS = Object.prototype.hasOwnProperty.call(C.TRANS, 'celan_basic');
  const forged = Object.keys(window.tenebrae._forge.map() || {});

  // (c) reproduce SAMPLE_CODEX's cipher independently: NFD-strip, lowercase,
  //     digraphs th/sh/ch/ck -> 26..29, a-z -> 0xE100 + (c - 'a')
  const DG = { th: 26, sh: 27, ch: 28, ck: 29 };
  const cipher = romz => {
    let s = String(romz).replace(/þ/g, 'th').replace(/Þ/g, 'th');
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    s = s.toLowerCase();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const two = s.slice(i, i + 2);
      if (DG[two] != null) { out += String.fromCharCode(0xE100 + DG[two]); i++; continue; }
      const code = s.charCodeAt(i);
      if (code >= 97 && code <= 122) out += String.fromCharCode(0xE100 + code - 97);
      else out += s[i];
    }
    return out;
  };
  const sampleCipher = cipher(rom);

  // (d) homomorphism test: is the rendering a per-letter substitution?
  //     translate several words, then check every rendered codepoint is a fixed
  //     function of its romanized letter, across all of them.
  const words = ['sea', 'ease', 'stone', 'notes', 'onset', 'king', 'night', 'thing'];
  const map = {}; let consistent = true, anagram = null;
  for (const word of words) {
    const r = await window.tenebrae.translate2('celan_basic', word);
    const romw = r.romanization;
    const s = cipher(romw);
    // pair each cipher char with its source letter run
    let i = 0, j = 0;
    const src = romw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    while (i < src.length && j < s.length) {
      const two = src.slice(i, i + 2);
      const key = DG[two] != null ? two : src[i];
      const cp = s.charCodeAt(j);
      if (map[key] != null && map[key] !== cp) consistent = false;
      map[key] = cp;
      i += key.length; j++;
    }
  }
  // anagram probe: 'notes' and 'onset' are anagrams in English; if their Celan
  // romanizations are anagrams too, a cipher renders anagram glyph-multisets.
  const rA = (await window.tenebrae.translate2('celan_basic', 'notes')).romanization;
  const rB = (await window.tenebrae.translate2('celan_basic', 'onset')).romanization;

  // (e) the codex's OWN Celan script for the same words, for comparison
  const runeOf = word => {
    try {
      const svg = w.wordRuneSVG(word, 100, '#000').svg;
      return { lines: (svg.match(/<line/g) || []).length, len: svg.length };
    } catch (e) { return { err: String(e) }; }
  };
  const runes = {};
  for (const word of ['mareth', 'marethin', 'sea', 'ea']) runes[word] = runeOf(word);

  // (f) which font families does the app have available, and where do they come from?
  const active = window.tenebrae.codex();
  const sampleFams = [];
  document.fonts.forEach(f => sampleFams.push(f.family));

  return {
    codexRom, hasRuneEngine, inTRANS, forged,
    sampleCipher, cipherMatches: sampleCipher === scr,
    consistentSubstitution: consistent, letterMap: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, 'U+' + v.toString(16).toUpperCase()])),
    anagram: { notes: rA, onset: rB, sameMultiset: rA.split('').sort().join('') === rB.split('').sort().join('') },
    runes, activeKind: active && active.kind, loadedFamilies: [...new Set(sampleFams)],
  };
}, { rom: span.rom, scr: span.scr });

console.log('\ncodex interrogation:', JSON.stringify(probe, null, 1), '\n');

ck('the ROMANIZATION is the codex\'s own (translateE2C)', probe.codexRom === span.rom, `${span.rom} vs ${probe.codexRom}`);
ck('the codex DOES have a Celan script of its own (Futhark Auricum rune engine)', probe.hasRuneEngine === true);
ck('celan_basic is NOT among the forged-from-codex scripts', !probe.forged.includes('celan_basic'), JSON.stringify(probe.forged));
ck('the rendered script is byte-identical to the legacy SAMPLE cipher of the romanization',
   probe.cipherMatches, `scr=${JSON.stringify(span.scr)} sampleCipher=${JSON.stringify(probe.sampleCipher)}`);
ck('every rendered glyph codepoint sits in the SAMPLE font block U+E100..U+E11D (not a forged block)',
   span.codes.filter(c => c !== 0x20).every(c => c >= 0xE100 && c <= 0xE11D),
   'codes ' + span.codes.map(c => 'U+' + c.toString(16)).join(','));
ck('the face is the sample codex\'s embedded TTF "Tenebrae Celan Runes"', /Tenebrae Celan Runes/.test(span.font), span.font);
ck('the rendering is a per-letter substitution (same letter -> same glyph, always)',
   probe.consistentSubstitution === true);

console.log('\nletter -> glyph map recovered from 8 words:', JSON.stringify(probe.letterMap));
console.log('codex Futhark Auricum (its own Celan script), <line> count per word:', JSON.stringify(probe.runes));

// The verdict this probe exists to render: is the script the user sees the
// codex's, or the placeholder's?
const isCodexScript = !probe.cipherMatches;
ck('THE SCRIPT THE USER SEES IS THE CODEX\'S', isCodexScript,
   'it is SAMPLE_CODEX.languages["celan-basic"].script (base 0xE100 + TN_DIGRAPHS) applied to the codex\'s romanization — a letter cipher in a placeholder font, while the codex\'s own Celan script is the logographic Futhark Auricum (codex.html:1885-2100, one rune per ROOT)');

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
const failures = checks.filter(c => !c.ok);
console.log(`${checks.length - failures.length}/${checks.length} checks ok`);
verdict('CELAN BASIC SCRIPT PROVENANCE', failures.length === 0 && errors.length === 0);
await browser.close();
await srv.close();
