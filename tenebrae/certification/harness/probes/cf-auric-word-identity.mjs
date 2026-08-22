// TX-6b / TX-6c GAP PROBE — WORD IDENTITY in the Auric word script.
//
// The alphabets are keyed by letter, so "Sea", "sea," and "sea" are the same
// three glyphs however you spell them. The word script is keyed by the WHOLE
// WORD, so identity is a design decision the code makes in auricClean
// (step1.html:3160) and nothing in the suite has ever checked it. If the key
// were case-sensitive, or kept punctuation, an author would burn a codepoint
// per capitalisation and the same word would carve two different runes.
//
// Ground truth is the codex's own carver input — transcribeHTML does
// `wd.replace(/[^\wéäí'-]/g,"")` then lower-cases (codex.html:2091) — NOT any
// expectation of how a word script "should" fold.
//
// Asserted:
//   1. case and stripped punctuation collapse to ONE codepoint and ONE slot
//   2. the minted key is byte-identical to the codex's own cleaned word
//   3. characters the carver KEEPS (hyphen, straight apostrophe) still
//      separate words; the curly apostrophe is stripped, exactly as the codex
//      strips it — so "don't" and "don’t" are two words in BOTH
//   4. a token that cleans to nothing mints nothing and writes nothing
//   5. distinct keys carve distinct runes, one capsule per carver segment
//   6. THE TX-6b EXCEPTION, proven both ways on ONE phrase: the alphabets drop
//      a word the lexicon cannot render, the Auric script WRITES it, and the
//      rune it writes carries composeWord's loan diamond
//
// Run: cd probes && node cf-auric-word-identity.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };
const codes = s => [...(s || '')].filter(c => c.charCodeAt(0) >= 0xE800).map(c => c.charCodeAt(0));

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

/* ---------------- 1..4: identity ---------------- */
const R = await page.evaluate(async () => {
  const F = window.tenebrae._forge;
  const A = () => F.map().celan_basic;
  const clean = w => String(w).replace(/[^\wéäí'-]/g, '').toLowerCase(); // codex transcribeHTML
  const runs = [];
  const call = v => {
    const before = A().order.length;
    const scr = F.textFor('celan_basic', v);
    return { v, scr, cs: [...(scr || '')].filter(c => c.charCodeAt(0) >= 0xE800).map(c => c.charCodeAt(0)),
             minted: A().order.length - before, key: clean(v), keyKnown: !!A().words[clean(v)] };
  };
  const SAME = ['sea', 'Sea', 'SEA', 'sea,', '"sea"', '(sea).', 'sea!', '…sea…', 'sEa'];
  for(const v of SAME) runs.push(call(v));
  const DIFF = ['coop', 'co-op', "don't", 'don’t', 'seas'];
  const diffRuns = DIFF.map(call);
  const EMPTY = ['!!!', '—', '…', '???', '  '];
  const emptyRuns = EMPTY.map(call);
  const Aw = A();
  const geo = {};
  for(const k of ['coop', 'co-op', 'dont', "don't", 'sea', 'seas']){
    const rec = Aw.words[k];
    if(!rec) { geo[k] = null; continue; }
    const cw = window.tenebrae && null;
    geo[k] = { code: rec.code, contours: rec.glyph.contours.length, advance: rec.glyph.advance };
  }
  // carver truth for the same keys
  const w = await window.tenebrae.engine();
  const carve = {};
  for(const k of Object.keys(geo)) if(geo[k]){ const c = w.composeWord(k); carve[k] = { segs: c.segs.length, w: c.w }; }
  return { runs, diffRuns, emptyRuns, geo, carve, total: Aw.order.length, order: Aw.order.slice() };
});
console.log('order after identity pass:', R.order.join(' '));
for(const r of R.runs) console.log(`   ${JSON.stringify(r.v).padEnd(10)} key=${JSON.stringify(r.key).padEnd(8)} codes=${r.cs.map(n=>'U+'+n.toString(16)).join(',')||'-'} minted=${r.minted}`);

const seaCodes = R.runs.map(r => r.cs.join(','));
ck('case + stripped punctuation collapse to ONE codepoint',
   new Set(seaCodes).size === 1 && R.runs[0].cs.length === 1, JSON.stringify([...new Set(seaCodes)]));
ck('and to ONE slot: only the first spelling mints',
   R.runs[0].minted === 1 && R.runs.slice(1).every(r => r.minted === 0),
   JSON.stringify(R.runs.map(r => r.minted)));
ck('the minted key is the codex\'s own cleaned word, every variant',
   R.runs.every(r => r.key === 'sea' && r.keyKnown), JSON.stringify(R.runs.map(r => r.key)));

for(const r of R.diffRuns) console.log(`   ${JSON.stringify(r.v).padEnd(10)} key=${JSON.stringify(r.key).padEnd(8)} codes=${r.cs.map(n=>'U+'+n.toString(16)).join(',')||'-'} minted=${r.minted}`);
const byKey = Object.fromEntries(R.diffRuns.map(r => [r.v, r]));
// Codepoints are assigned in SORTED order, so minting a word renumbers the ones
// that sort after it: a code read at the moment a run was written is stale as
// soon as anything else is minted. The invariant — distinct words, distinct
// runes — is about the mapping as it finally stands, so read it from R.geo,
// which is collected after every call above.
const code = k => R.geo[k] && R.geo[k].code;
ck('a kept hyphen still separates words: "coop" != "co-op"',
   code('coop') !== code('co-op') && byKey['co-op'].key === 'co-op',
   `coop U+${(code('coop')||0).toString(16)} vs co-op U+${(code('co-op')||0).toString(16)}`);
ck('the curly apostrophe is STRIPPED and the straight one KEPT — exactly as the codex cleans',
   byKey["don't"].key === "don't" && byKey['don’t'].key === 'dont' &&
   code("don't") !== code('dont'),
   `"don't"->${JSON.stringify(byKey["don't"].key)}  "don’t"->${JSON.stringify(byKey['don’t'].key)}`);
ck('a different word is a different rune: "sea" != "seas"', code('seas') !== code('sea'),
   `sea U+${(code('sea')||0).toString(16)} vs seas U+${(code('seas')||0).toString(16)}`);

for(const r of R.emptyRuns) console.log(`   ${JSON.stringify(r.v).padEnd(8)} -> ${JSON.stringify(r.scr)} minted=${r.minted}`);
ck('a token that cleans to nothing mints nothing and writes nothing',
   R.emptyRuns.every(r => r.scr === null && r.minted === 0),
   JSON.stringify(R.emptyRuns.map(r => [r.v, r.scr, r.minted])));

const geoRows = Object.entries(R.geo).filter(([, g]) => g);
for(const [k, g] of geoRows) console.log(`   ${k.padEnd(8)} contours=${g.contours} carverSegs=${R.carve[k].segs} adv=${g.advance} carverW=${R.carve[k].w}`);
ck('one capsule per carver segment for every distinct key',
   geoRows.every(([k, g]) => g.contours === R.carve[k].segs),
   JSON.stringify(geoRows.map(([k, g]) => `${k}:${g.contours}/${R.carve[k].segs}`)));
ck('distinct keys carve distinct runes (not one rune reused)',
   new Set(geoRows.map(([k]) => JSON.stringify(R.geo[k].code))).size === geoRows.length);

/* ---------------- 6: the TX-6b exception, both ways on one phrase ---------------- */
const LOAN = 'the sea remembers zyxqwv';
const X = await page.evaluate(async src => {
  const F = window.tenebrae._forge;
  const w = await window.tenebrae.engine();
  const out = { src, alpha: {}, };
  for(const id of ['celan_high', 'kildaren', 'kerrackian', 'calgridarian', 'evernessian']){
    const t = await window.tenebrae.translate2(id, src);
    const scr = F.textForToks(id, t.toks || []) || '';
    const units = scr.split(/[\n ]/).filter(Boolean).length;
    out.alpha[id] = { rom: t.romanization,
                      romWords: t.romanization.split(/\s+/).filter(Boolean).length,
                      unknownToks: (t.toks || []).filter(k => k.u).map(k => k.t),
                      units, hasLoanText: /zyxqwv/i.test(scr) };
  }
  const tb = await window.tenebrae.translate2('celan_basic', src);
  const A0 = F.map().celan_basic.order.length;
  const scrb = F.textForToks('celan_basic', tb.toks || []) || '';
  const A = F.map().celan_basic;
  const words = A.order.slice(A0);
  out.auric = { rom: tb.romanization, scrCodes: [...scrb].filter(c => c.charCodeAt(0) >= 0xE800).length,
                romWords: tb.romanization.split(/\s+/).filter(Boolean).length,
                unknownToks: (tb.toks || []).filter(k => k.u).map(k => k.t), newWords: words };
  // does the rune the writer forged for the UNKNOWN word carry composeWord's loan diamond?
  const unk = (tb.toks || []).filter(k => k.u).map(k => String(k.t).replace(/[^\wéäí'-]/g, '').toLowerCase()).filter(Boolean);
  out.loan = unk.map(k => {
    const rec = A.words[k];
    if(!rec) return { k, missing: true };
    const c = w.composeWord(k);
    // composeWord stamps a loan with a diamond quad around (0.5, 1.10)
    const dia = c.segs.filter(([x1, y1, x2, y2]) =>
      y1 > 1.0 && y1 < 1.2 && y2 > 1.0 && y2 < 1.2 && Math.abs(x1 - 0.5) < 0.12 && Math.abs(x2 - 0.5) < 0.12);
    return { k, code: rec.code, segs: c.segs.length, contours: rec.glyph.contours.length, diamond: dia.length };
  });
  return out;
}, LOAN);
console.log('LOAN phrase:', JSON.stringify(X, null, 1).slice(0, 1600));

const alphaIds = Object.keys(X.alpha);
ck('setup: the phrase really does contain a word the lexicon cannot render',
   alphaIds.every(id => X.alpha[id].unknownToks.length > 0) && X.auric.unknownToks.length > 0,
   JSON.stringify(alphaIds.map(id => X.alpha[id].unknownToks)));
ck('TX-6b: every ALPHABET writes one unit fewer than its romanization has words — the loan is not transliterated',
   alphaIds.every(id => X.alpha[id].units === X.alpha[id].romWords - X.alpha[id].unknownToks.length),
   JSON.stringify(alphaIds.map(id => `${id}:${X.alpha[id].units}/${X.alpha[id].romWords}`)));
ck('TX-6b: no alphabet leaks the English loan word into the script text',
   alphaIds.every(id => !X.alpha[id].hasLoanText));
ck('TX-6c EXCEPTION: the Auric script WRITES the loan — one rune per romanized word, unknown included',
   X.auric.scrCodes === X.auric.romWords, `${X.auric.scrCodes} runes / ${X.auric.romWords} romanized words`);
ck('the loan rune is the carver\'s own, and it carries composeWord\'s loan diamond',
   X.loan.length > 0 && X.loan.every(l => !l.missing && l.contours === l.segs && l.diamond === 4),
   JSON.stringify(X.loan));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('CF AURIC WORD IDENTITY', checks.every(c => c[1]));
await browser.close();
await srv.close();
