// TX-5 — GLYPH-SEQUENCE PARITY, decoded against the codex's OWN TYPESETTER.
//
// What this adds over s2-script-structure.mjs: that probe re-implements the
// codex tokenizer inside the probe and compares the writer to the copy. Here
// the ground truth is the codex's own rendered output — C.wordScriptSVG() —
// whose <path d=…>/<circle> sequence IS what the codex draws. We decode the
// writer's PUA run back to glyph keys and compare to the key sequence the
// codex actually drew, per word, over a 30-phrase corpus per tongue plus a
// hostile single-word list (digits, apostrophes, hyphens, non-ASCII, long
// words, unknown letters) — and, separately, against the PUA text of REAL
// spans created through the real editor UI.
//
// Run: cd probes && node tx-glyph-parity.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const PHRASES = [
  'The sea remembers the old king', 'my mana let it stand', 'the lamp holds steady',
  'she walks alone tonight', 'the fire under the mountain', 'gold light on black water',
  'a warrant sealed in wax', 'the gate will not open', 'winter came early this year',
  'he carried the lantern down', 'no one answered the bell', 'blood on the white stair',
  'the tower leans toward the sea', 'her name was never written', 'ash falls on the roofs',
  'seven ships left the harbour', 'the road bends north', 'silence in the long hall',
  'they buried him at dawn', 'the third sun rose red', 'a knife of cold iron',
  'the river took the bridge', 'she read the old charter', 'nothing moved in the dark',
  'the bargain is struck', 'let the record show', 'wind through the dead orchard',
  'the child did not cry', 'stone remembers what men forget', 'the last light failed',
];
const HOSTILE = [
  'zzqx', '1234', "o'connor", 'mother-in-law', 'naïve', 'coöperate', 'Ærynn',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'q', 'x9x9', 'ʧ', 'ΩΩ', 'a1b2c3', "it's",
];

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const bulk = await page.evaluate(async ({ phrases, hostile }) => {
  const w = await window.tenebrae.engine();
  if(!w) return { fatal: 'engine did not wake' };
  const C = w.CODEX, F = window.tenebrae._forge;
  const forged = F.map();
  const out = { langs: [], dupD: [] };

  for(const id of Object.keys(C.TRANS)){
    const T = C.TRANS[id], sc = T.L && T.L.script;
    if(!sc || !(sc.glyphs || []).length) continue;
    const flow = C.scriptDir(sc);
    const f = forged[id];
    const matcher = C.makeMatcher(sc);

    // codex glyph 'd' (as it appears escaped in the codex's own SVG) -> key
    const dKey = {};
    sc.glyphs.forEach(g => {
      const k = C.esc(g.d);
      if(dKey[k] != null && dKey[k] !== g.k.toLowerCase()) out.dupD.push([id, dKey[k], g.k]);
      if(dKey[k] == null) dKey[k] = g.k.toLowerCase();
    });

    // ---- ground truth: what the CODEX ITSELF draws, in codex visual order,
    //      un-reversed back to logical order so the two are comparable ----
    const codexKeys = word => {
      const svg = C.wordScriptSVG(String(word), sc, matcher, 100, '#000').svg;
      const seq = [];
      const re = /<path d="([^"]*)"|<circle\b/g;
      let m;
      while((m = re.exec(svg))) seq.push(m[1] != null ? (dKey[m[1]] != null ? dKey[m[1]] : 'UNMAPPED:' + m[1].slice(0, 24)) : '·');
      // wordScriptSVG reverses tokens for rtl and btt-stave before drawing
      if(flow === 'rtl' || flow === 'btt-stave') seq.reverse();
      return seq;
    };
    // ---- the writer: decode its PUA run back to glyph keys ----
    const writerKeys = pua => [...String(pua)].map(c => {
      const i = c.charCodeAt(0) - f.base;
      if(i >= 0 && i < sc.glyphs.length) return sc.glyphs[i].k.toLowerCase();
      if(i === sc.glyphs.length) return '·';           // forged unknown mark
      return 'NONPUA:' + c.charCodeAt(0).toString(16);
    });

    const rec = { id, name: T.L.name || id, flow, base: f.base, nGlyphs: sc.glyphs.length,
                  words: 0, unknownMarks: 0, mismatches: [], nMismatch: 0, nMismatchSpaceless: 0,
                  nSpaceTokens: 0, puaOutOfRange: 0, wordCountMismatch: [], nonPUA: [] };

    const checkWord = (word, srcLabel) => {
      const pua = F.textFor(id, word);
      const got = pua == null ? [] : writerKeys(pua);
      const want = codexKeys(word);
      rec.words++;
      if(/\s/.test(String(word))) rec.nSpaceTokens++;
      rec.unknownMarks += want.filter(k => k === '·').length;
      for(const g of got) if(/^NONPUA:/.test(g)) rec.puaOutOfRange++;
      const same = JSON.stringify(got) === JSON.stringify(want);
      if(!same){
        rec.nMismatch++;
        if(!/\s/.test(String(word))) rec.nMismatchSpaceless++;
        if(rec.mismatches.length < 6)
          rec.mismatches.push({ word, src: srcLabel, writer: got.join('|'), codex: want.join('|') });
      }
      return same;
    };

    // corpus: every token of every translated phrase
    for(const p of phrases){
      const r = await window.tenebrae.translate2(id, p);
      const toks = (r.toks || []).filter(t => !t.sep && t.t);
      for(const t of toks) checkWord(t.t, 'corpus');
      // phrase level: the writer's script string must hold exactly one word run
      // per kept token, in logical order
      const scr = F.textForToks(id, r.toks);
      const runs = String(scr || '').split(/[\n ]+/).filter(Boolean);
      const expectRuns = toks.map(t => F.textFor(id, t.t)).filter(Boolean);
      if(JSON.stringify(runs) !== JSON.stringify(expectRuns))
        rec.wordCountMismatch.push({ phrase: p, got: runs.length, want: expectRuns.length });
      // the joiner is the flow's canonical one, and nothing Latin leaks in
      const bad = [...String(scr || '')].filter(c => c !== ' ' && c !== '\n' && (c.charCodeAt(0) < 0xE000 || c.charCodeAt(0) > 0xF8FF));
      if(bad.length) rec.nonPUA.push({ phrase: p, chars: bad.join('') });
    }
    for(const h of hostile) checkWord(h, 'hostile');
    out.langs.push(rec);
  }
  return out;
}, { phrases: PHRASES, hostile: HOSTILE });

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

if(bulk.fatal){ console.log('FATAL:', bulk.fatal); process.exit(1); }
console.log('--- corpus glyph-sequence parity (writer PUA decoded vs codex wordScriptSVG) ---');
for(const r of bulk.langs){
  console.log(`${(r.name + ' [' + r.flow + ']').padEnd(28)} words=${String(r.words).padEnd(5)} spaceTok=${String(r.nSpaceTokens).padEnd(4)} unknownMarks=${String(r.unknownMarks).padEnd(4)} mismatch=${r.nMismatch} (space-free mismatch=${r.nMismatchSpaceless}) base=0x${r.base.toString(16)} glyphs=${r.nGlyphs}`);
  for(const m of r.mismatches) console.log(`   MISMATCH "${m.word}" (${m.src})\n     writer: ${m.writer}\n     codex : ${m.codex}`);
  for(const wc of r.wordCountMismatch.slice(0, 3)) console.log(`   WORD-RUN "${wc.phrase}" got=${wc.got} want=${wc.want}`);
  for(const np of r.nonPUA.slice(0, 3)) console.log(`   NON-PUA "${np.phrase}" -> ${JSON.stringify(np.chars)}`);
}
ck('every scripted tongue forged and measured (5)', bulk.langs.length === 5, bulk.langs.map(r => r.id).join(','));
ck('glyph keys identical to the codex\'s own drawn sequence, every token',
   bulk.langs.every(r => r.nMismatch === 0),
   `${bulk.langs.reduce((a, r) => a + r.words, 0)} tokens compared, ${bulk.langs.reduce((a, r) => a + r.nMismatch, 0)} mismatched`);
ck('glyph keys identical for every SPACE-FREE token (isolates the multi-word-token defect)',
   bulk.langs.every(r => r.nMismatchSpaceless === 0),
   `${bulk.langs.reduce((a, r) => a + r.nMismatchSpaceless, 0)} space-free mismatches`);
ck('unknown-token mark exercised and matches the codex\'s circle placeholder',
   bulk.langs.every(r => r.unknownMarks > 0), bulk.langs.map(r => `${r.id}:${r.unknownMarks}`).join(' '));
ck('no PUA codepoint outside the tongue\'s forged block', bulk.langs.every(r => r.puaOutOfRange === 0));
ck('phrase script text = one PUA run per kept token, logical order', bulk.langs.every(r => r.wordCountMismatch.length === 0));
ck('no Latin/other characters leak into the script text', bulk.langs.every(r => r.nonPUA.length === 0));
ck('no two codex glyphs share a path (decode is unambiguous)', bulk.dupD.length === 0, JSON.stringify(bulk.dupD));

// ---------- REAL spans, through the real editor UI ----------
console.log('--- real editor spans ---');
const names = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  return Object.keys(C.TRANS).filter(id => {
    const sc = C.TRANS[id].L && C.TRANS[id].L.script;
    return sc && (sc.glyphs || []).length;
  }).map(id => ({ id, name: C.TRANS[id].L.name || id }));
});
const SRC = ['alpha old king', 'bravo old king', 'charlie old king', 'delta old king', 'echo old king',
             'foxtrot old king', 'golf old king'];
await createBook(page, 'Glyph Parity Book');
await page.click('#ed-content');
await page.keyboard.type('padding line zero');
for(const s of SRC){ await page.keyboard.press('Enter'); await page.keyboard.type(s); }
await wait(page, 800);

const spanRows = [];
for(let i = 0; i < names.length; i++){
  const { id, name } = names[i];
  await insertTranslationSpan(page, SRC[i], name);
  await wait(page, 900);
  const row = await page.evaluate(async langId => {
    const sp = [...document.querySelectorAll('#ed-content .tspan')].pop();
    if(!sp) return { id: langId, err: 'no span' };
    const w = await window.tenebrae.engine();
    const C = w.CODEX, F = window.tenebrae._forge;
    const sc = C.TRANS[langId].L.script, f = F.map()[langId], matcher = C.makeMatcher(sc);
    const flow = C.scriptDir(sc);
    const dKey = {}; sc.glyphs.forEach(g => { const k = C.esc(g.d); if(dKey[k] == null) dKey[k] = g.k.toLowerCase(); });
    const decode = pua => [...String(pua)].map(c => {
      const i = c.charCodeAt(0) - f.base;
      return (i >= 0 && i < sc.glyphs.length) ? sc.glyphs[i].k.toLowerCase()
           : i === sc.glyphs.length ? '·' : 'X' + c.charCodeAt(0).toString(16);
    });
    const codexKeys = word => {
      const svg = C.wordScriptSVG(String(word), sc, matcher, 100, '#000').svg;
      const seq = []; const re = /<path d="([^"]*)"|<circle\b/g; let m;
      while((m = re.exec(svg))) seq.push(m[1] != null ? dKey[m[1]] : '·');
      if(flow === 'rtl' || flow === 'btt-stave') seq.reverse();
      return seq;
    };
    const r = await window.tenebrae.translate2(langId, sp.dataset.src);
    const toks = (r.toks || []).filter(t => !t.sep && t.t);
    const domRuns = sp.textContent.split(/[\n ]+/).filter(Boolean);
    const want = toks.map(t => codexKeys(t.t));
    const got = domRuns.map(decode);
    return { id: langId, lang: sp.dataset.lang, flow: sp.dataset.flow || 'ltr', src: sp.dataset.src,
      rom: sp.dataset.rom, scrEqTextContent: sp.dataset.scr === sp.textContent,
      svgCount: sp.querySelectorAll('svg').length,
      family: getComputedStyle(sp).fontFamily,
      match: JSON.stringify(got) === JSON.stringify(want),
      got: got.map(a => a.join('')).join(' / '), want: want.map(a => a.join('')).join(' / ') };
  }, id);
  spanRows.push(row);
  console.log(`${row.id.padEnd(14)} flow=${String(row.flow).padEnd(10)} svg=${row.svgCount} match=${row.match} rom="${row.rom}"`);
  if(!row.match) console.log(`   got : ${row.got}\n   want: ${row.want}`);
}
ck('every real editor span decodes to the codex\'s own glyph keys', spanRows.every(r => r.match), spanRows.filter(r => !r.match).map(r => r.id).join(','));
ck('real spans carry data-scr === textContent (stored script is what renders)', spanRows.every(r => r.scrEqTextContent));
ck('zero <svg> inside any real span', spanRows.every(r => r.svgCount === 0));
ck('real spans render in the forged family, not a Latin face', spanRows.every(r => /Tenebrae Omni/.test(r.family)), spanRows.map(r => r.family.slice(0, 30)).join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));

verdict('TX-5 GLYPH PARITY', checks.every(c => c[1]));
await browser.close();
await srv.close();
