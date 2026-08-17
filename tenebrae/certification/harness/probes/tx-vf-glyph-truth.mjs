// TX-VF: glyph-sequence ground truth taken from the CODEX'S OWN TYPESETTER.
//
// The disputed point: the writer's omniScriptText tokenizes each compiler token
// RAW. The codex's own typesetter (transcribeScriptHTML / transcribeScriptSVG)
// does NOT — it splits the text on /\s+/ and strips [^\p{L}\p{N}'’-] from every
// word before calling matchWord. So the ground truth for "the glyph keys the
// codex's own tokenizer produces for that word" is the codex's WORD, not the
// compiler's token.
//
// This probe compares three things per tongue x phrase:
//   1. writer PUA word runs  (decoded through the forge's own base/gidx)
//   2. codex STRICT pipeline (cleanText -> split -> strip -> matchWord)
//   3. codex transcribeScriptSVG output, parsed back to path-d -> glyph key
// Run: cd probes && node tx-vf-glyph-truth.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const PHRASES = [
  'The sea remembers the old king',
  'the lamp holds steady',
  'she walks alone tonight',
  'my mana let it stand',
  'the old king waits beneath the drowned tower while the winter sea remembers every name',
  // multi-word compiler tokens: genitive ("ni "+o / "na "+o) and negation
  'the song of the sea',
  'she does not remember the king',
  'the name of the tower',
];

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const res = await page.evaluate(async phrases => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const F = window.tenebrae._forge;
  F.map(); // ensure forged
  const out = [];

  for(const id of Object.keys(C.TRANS)){
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    if(!sc || !(sc.glyphs || []).length) continue;
    const matcher = C.makeMatcher(sc);
    const f = F.map()[id];
    if(!f) continue;
    const flow = C.scriptDir(sc);
    // d -> key, for decoding the codex's own SVG back to glyph keys
    const dToKey = {};
    sc.glyphs.forEach(g => { dToKey[g.d] = g.k.toLowerCase(); });

    const rec = { id, name: T.L.name || id, flow, cases: [] };

    for(const phrase of phrases){
      const r = await window.tenebrae.translate2(id, phrase);
      if(!r) continue;

      // ---------- 1. writer ----------
      const scr = F.textForToks(id, r.toks) || '';
      const writer = scr.split(/[\n ]+/).filter(Boolean).map(wd =>
        [...wd].map(c => {
          const i = c.charCodeAt(0) - f.base;
          if(i >= 0 && i < sc.glyphs.length) return sc.glyphs[i].k.toLowerCase();
          if(i === sc.glyphs.length) return '·';
          return '?' + c.charCodeAt(0).toString(16);
        }));

      // ---------- 2. codex STRICT pipeline ----------
      // exactly what the codex feeds its own script wing (buildLang.translate):
      //   cleanText = lines.map(l => l.filter(p=>!p.u).map(p=>p.t).join(' ')).join(' ')
      const comp = C.compileText(T, phrase, 'e2l');
      const lines = comp.lines;
      const cleanText = lines
        ? lines.map(l => l.filter(p => !p.u).map(p => p.t).join(' ')).join(' ')
        : (comp.parts || []).filter(p => !p.drop && !p.unknown).map(p => p.out).join(' ');
      // and exactly what transcribeScriptSVG then does with it:
      const codexWordsStrict = cleanText.split(/\s+/).filter(Boolean)
        .map(x => x.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter(Boolean)
        .map(word => C.makeMatcher && matchKeys(word));

      function matchKeys(word){
        return C.wordScriptSVG ? keysOf(word) : [];
      }
      function keysOf(word){
        const o = []; let i = 0; const s = String(word).toLowerCase();
        while(i < s.length){
          let hit = null;
          for(const k of matcher.keys) if(s.startsWith(k, i)){ hit = k; break; }
          if(hit){ o.push(hit); i += hit.length; } else { o.push('·'); i++; }
        }
        return o;
      }

      // ---------- 3. codex transcribeScriptSVG, parsed ----------
      let svgWords = null;
      try{
        const svgStr = C.transcribeScriptSVG(cleanText, sc, matcher, 30, '#111', null);
        const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
        const root = doc.documentElement;
        // one direct <g> per rendered word (transcribeScriptSVG wraps each
        // wordScriptSVG body in a translate <g>)
        svgWords = [...root.children].filter(n => n.tagName === 'g').map(g => {
          const marks = [...g.querySelectorAll('path,circle')];
          return marks.map(m => m.tagName === 'circle' ? '·' : (dToKey[m.getAttribute('d')] || '?'));
        });
      }catch(e){ svgWords = 'ERR ' + e.message; }

      // un-apply the codex's visual reversal so both sides are LOGICAL order
      if(Array.isArray(svgWords) && (flow === 'rtl' || flow === 'btt-stave')){
        svgWords = svgWords.map(k => [...k].reverse());
      }
      // NOTE: transcribeScriptSVG emits its <g> word wrappers in LOGICAL order
      // for every flow (it places them by coordinate, not by document order),
      // so only the per-word letter reversal above needs undoing.

      // writer's raw token list, for diagnosing WHY
      const toks = (r.toks || []).filter(t => !t.sep && t.t).map(t => t.t);

      rec.cases.push({
        phrase, rom: r.romanization, cleanText, toks,
        writer, strict: codexWordsStrict, svg: svgWords,
        wEqStrict: JSON.stringify(writer) === JSON.stringify(codexWordsStrict),
        strictEqSvg: JSON.stringify(codexWordsStrict) === JSON.stringify(svgWords),
        nWriter: writer.length, nStrict: codexWordsStrict.length,
        nSvg: Array.isArray(svgWords) ? svgWords.length : -1,
      });
    }
    out.push(rec);
  }
  return out;
}, PHRASES);

let anyMismatch = false, anySvgDisagree = false;
let totWords = 0, badWords = 0, cases = 0, badCases = 0;
const examples = [];
for(const rec of res){
  console.log(`\n=== ${rec.name} [${rec.flow}] (${rec.id})`);
  for(const c of rec.cases){
    cases++;
    if(!c.strictEqSvg){ anySvgDisagree = true; console.log('  !! strict pipeline != transcribeScriptSVG — my model of the codex is wrong'); console.log('     strict', JSON.stringify(c.strict)); console.log('     svg   ', JSON.stringify(c.svg)); }
    if(!c.wEqStrict){
      anyMismatch = true; badCases++;
      console.log(`  MISMATCH  words writer=${c.nWriter} codex=${c.nStrict}`);
      console.log(`     rom        : ${c.rom}`);
      console.log(`     cleanText  : ${c.cleanText}`);
      console.log(`     writer toks: ${JSON.stringify(c.toks)}`);
      console.log(`     writer     : ${JSON.stringify(c.writer)}`);
      console.log(`     codex      : ${JSON.stringify(c.strict)}`);
      if(examples.length < 12) examples.push({ lang: rec.id, phrase: c.phrase, writer: c.writer, codex: c.strict });
    }
    totWords += Math.max(c.nWriter, c.nStrict);
    if(c.nWriter !== c.nStrict) badWords++;
  }
}

console.log('\n---- summary ----');
console.log('cases:', cases, 'mismatching cases:', badCases);
console.log('my strict model of the codex agrees with transcribeScriptSVG:', !anySvgDisagree);
console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF GLYPH TRUTH (writer == codex typesetter)', !anyMismatch && errors.length === 0);
await browser.close();
await srv.close();
