// TX-5 / TX-6b REFUTATION PROBE — decode the PUA out of the SPAN THE EDITOR
// STORED and check it against the CODEX'S OWN TYPESETTER, not against the
// writer's own engine seam.
//
// Why: cf-script-longword-layout.mjs claims TX-5 "decoded out of a span the
// real editor made", but its decoder actually reads
// window.tenebrae._forge.textForToks(...) — the writer's own seam — so a bug in
// the span-writing path (spanFromResult / omniScriptFor) would be invisible to
// it, and so would a bug shared by seam and span. Here the expected glyph
// sequence comes from C.wordScriptSVG(), the codex's OWN word typesetter: its
// emitted <path d="..."> values are matched back to codex glyph keys and its
// <circle> marks are the codex's own unknown-token mark. That also pins the
// briefing's token-order rule (codex reverses for rtl and btt-stave, not for
// cols-rtl) at the token level.
//
// Input is hostile on purpose: mixed case, an unknown word, digits, a straight
// apostrophe, a curly apostrophe, a hyphenate, a non-ASCII letter, and
// sentence punctuation.
//
// Run: cd probes && node cf-adv-span-truth.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const PHRASE = "The old King's zyxqwv 42 co-op naïve don’t remembers the sea, blessing!";
const TONGUES = [['Celan High','celan_high'],['Kildaren','kildaren'],['Kerrackian','kerrackian'],
                 ['Calgridarian','calgridarian'],['Evernessian','evernessian']];

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1400 });
await wait(page, 3500);

await createBook(page, 'Span Truth');
await page.click('#ed-content');
for(let i = 0; i < TONGUES.length; i++){
  await page.keyboard.type(PHRASE);
  if(i < TONGUES.length - 1) await page.keyboard.press('Enter');
}
await wait(page, 500);
for(const [label] of TONGUES){
  await insertTranslationSpan(page, PHRASE, label);
  await wait(page, 900);
}
await wait(page, 800);

const res = await page.evaluate(async ([phrase, tongues]) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX, F = window.tenebrae._forge;
  const spans = [...document.querySelectorAll('#ed-content .tspan')];
  const out = [];
  for(const [, id] of tongues){
    const sp = spans.find(s => s.dataset.lang === id);
    if(!sp){ out.push({ id, err: 'no span for ' + id }); continue; }
    const T = C.TRANS[id], sc = T.L.script, matcher = C.makeMatcher(sc);
    const flow = C.scriptDir(sc);
    // --- CODEX-SIDE TRUTH: its own compileText -> cleanText -> its own typesetter
    const { parts, lines } = C.compileText(T, sp.dataset.src, 'e2l');
    const cleanText = lines
      ? lines.map(l => l.filter(p => !p.u).map(p => p.t).join(' ')).join(' ')
      : parts.filter(p => !p.drop && !p.unknown).map(p => p.out).join(' ');
    const codexWords = cleanText.split(/\s+/).filter(Boolean)
      .map(x => x.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter(Boolean);
    const d2k = {};
    sc.glyphs.forEach(g => { d2k[C.esc(g.d)] = g.k.toLowerCase(); });
    const codexSeq = codexWords.map(word => {
      const svg = C.wordScriptSVG(word, sc, matcher, 100, '#000').svg;
      const toks = [];
      for(const m of svg.matchAll(/<path d="([^"]*)"|<circle/g)) toks.push(m[1] === undefined ? '·' : (d2k[m[1]] || '?UNKNOWN-PATH'));
      // the codex reverses its token order for rtl and btt-stave; the writer
      // keeps the string logical and lets CSS do it — undo the codex's reversal
      return (flow === 'rtl' || flow === 'btt-stave') ? toks.reverse() : toks;
    });
    // --- WRITER SIDE: decode the span the editor actually stored
    const f = F.map()[id];
    const keys = sc.glyphs.map(g => g.k.toLowerCase());
    const scr = sp.dataset.scr || '';
    const units = scr.split(/[\n ]/).filter(Boolean);
    const spanSeq = units.map(u => [...u].map(c => {
      const n = c.charCodeAt(0) - f.base;
      return n === keys.length ? '·' : (n >= 0 && n < keys.length ? keys[n] : `?U+${c.charCodeAt(0).toString(16)}`);
    }));
    out.push({
      id, flow,
      textIsScr: sp.textContent === scr,
      rom: sp.dataset.rom,
      cleanText, codexWords,
      nCodex: codexSeq.length, nSpan: spanSeq.length,
      codex: codexSeq.map(s => s.join('')), span: spanSeq.map(s => s.join('')),
      allPUA: [...scr.replace(/[\n ]/g, '')].every(c => c.charCodeAt(0) >= 0xE000),
      dirAttr: sp.getAttribute('dir'),
      romHasUnknown: /zyxqwv/i.test(sp.dataset.rom || ''),
    });
  }
  return out;
}, [PHRASE, TONGUES]);

for(const r of res){
  if(r.err){ ck('span exists: ' + r.id, false, r.err); continue; }
  console.log(`\n   [${r.id}] flow=${r.flow} dir=${r.dirAttr}`);
  console.log(`     rom       : ${r.rom}`);
  console.log(`     cleanText : ${r.cleanText}`);
  console.log(`     codex keys: ${r.codex.join(' | ')}`);
  console.log(`     span  keys: ${r.span.join(' | ')}`);
  ck(`${r.id}: span textContent is exactly data-scr`, r.textIsScr);
  ck(`${r.id}: every stored character is a forged PUA codepoint (no Latin fallback)`, r.allPUA);
  ck(`TX-6b ${r.id}: the span writes exactly as many word units as the codex's cleanText has words`,
     r.nSpan === r.nCodex, `span=${r.nSpan} codex=${r.nCodex}`);
  ck(`TX-5 ${r.id}: every unit decodes to the codex's own typesetter token sequence`,
     r.nSpan === r.nCodex && r.span.every((s, i) => s === r.codex[i]),
     r.span.map((s, i) => s === r.codex[i] ? '' : `#${i} span=${s} codex=${r.codex[i]}`).filter(Boolean).join('  '));
  ck(`TX-6b ${r.id}: the untranslatable word survives in the romanization`, r.romHasUnknown, r.rom);
  ck(`${r.id}: dir="rtl" only on the horizontal rtl tongue`,
     (r.flow === 'rtl') === (r.dirAttr === 'rtl'), `flow=${r.flow} dir=${r.dirAttr}`);
}
ck('no page exceptions', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

const ok = checks.every(c => c[1]);
console.log(`\n${checks.filter(c => c[1]).length}/${checks.length} checks`);
verdict('TX-5/TX-6b span truth', ok);
await browser.close(); await srv.close();
