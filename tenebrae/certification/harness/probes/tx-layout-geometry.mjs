// TX-6 — CANONICAL LAYOUT, measured on REAL spans in the REAL editor.
//
// What this adds over s2-script-structure.mjs: that probe measures a synthetic
// <span> it builds itself, on one short phrase, and never wraps a column. This
// one drives the actual UI (select → context menu → Translate → tongue), then
// measures the span the editor produced, for BOTH a short multi-word phrase and
// a long phrase that forces cols-rtl to wrap onto extra columns. It also counts
// word units against the romanization, which is where the writer and the
// codex's own typesetter part company.
//
// Run: cd probes && node tx-layout-geometry.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const SHORT = 'the old king waits';
const LONG  = 'the old king waits beneath the drowned tower while the winter sea remembers every name the charter never wrote down';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1200 });
await wait(page, 3500);

const names = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  return Object.keys(C.TRANS).filter(id => {
    const sc = C.TRANS[id].L && C.TRANS[id].L.script;
    return sc && (sc.glyphs || []).length;
  }).map(id => ({ id, name: C.TRANS[id].L.name || id, flow: C.scriptDir(C.TRANS[id].L.script) }));
});
console.log('scripted tongues:', names.map(n => `${n.id}[${n.flow}]`).join(' '));

// one line per (tongue × phrase) so every selection is unique and untouched
const LINES = [];
for(const n of names){ LINES.push({ id: n.id, name: n.name, kind: 'short', text: `${n.id} S ${SHORT}` });
                       LINES.push({ id: n.id, name: n.name, kind: 'long',  text: `${n.id} L ${LONG}` }); }

await createBook(page, 'Layout Geometry Book');
await page.click('#ed-content');
await page.keyboard.type('padding line zero');
for(const l of LINES){ await page.keyboard.press('Enter'); await page.keyboard.type(l.text); }
await wait(page, 1000);

// MEASURE: per-character client rects of the span's own text node.
const MEASURE = async (idx) => {
  const NL = String.fromCharCode(10);
  const sp = document.querySelectorAll('#ed-content .tspan')[idx];
  if(!sp) return { err: 'no span at index ' + idx };
  await document.fonts.ready;
  const cs = getComputedStyle(sp);
  const txt = sp.firstChild;
  if(!txt || txt.nodeType !== 3) return { err: 'span child is not a text node' };
  const s = txt.nodeValue;
  const rects = [];
  for(let i = 0; i < s.length; i++){
    const r = document.createRange(); r.setStart(txt, i); r.setEnd(txt, i + 1);
    const b = r.getBoundingClientRect();
    rects.push({ ch: s[i], code: s.charCodeAt(i), x: b.x, y: b.y, w: b.width, h: b.height,
                 blank: s[i] === ' ' || s[i] === NL });
  }
  const groups = []; let cur = [];
  for(const r of rects){ if(r.blank){ if(cur.length){ groups.push(cur); cur = []; } } else cur.push(r); }
  if(cur.length) groups.push(cur);
  const bb = sp.getBoundingClientRect();
  return { lang: sp.dataset.lang, flow: sp.dataset.flow || 'ltr', dirAttr: sp.getAttribute('dir'),
    src: sp.dataset.src, rom: sp.dataset.rom, scr: sp.dataset.scr, textLen: s.length,
    svgCount: sp.querySelectorAll('svg').length, imgCount: sp.querySelectorAll('img,canvas').length,
    fontFamily: cs.fontFamily, writingMode: cs.writingMode, direction: cs.direction,
    unicodeBidi: cs.unicodeBidi, textOrientation: cs.textOrientation, fontSizePx: parseFloat(cs.fontSize),
    box: { w: bb.width, h: bb.height },
    rects, groups: groups.map(g => ({ n: g.length, x0: g[0].x, y0: g[0].y,
      minX: Math.min(...g.map(r => r.x)), maxX: Math.max(...g.map(r => r.x + r.w)),
      top: Math.min(...g.map(r => r.y)), bottom: Math.max(...g.map(r => r.y + r.h)) })) };
};

const results = [];
for(let i = 0; i < LINES.length; i++){
  const l = LINES[i];
  await insertTranslationSpan(page, l.text, l.name);
  await wait(page, 800);
  const m = await page.evaluate(MEASURE, i);
  results.push({ ...l, m });
  if(m.err){ console.log(`  ${l.id}/${l.kind}: MEASURE ERROR ${m.err}`); continue; }
}

// ---------- analysis ----------
const EPS = 1.0;
const perLang = {};
console.log('\n--- geometry ---');
for(const r of results){
  const m = r.m;
  if(m.err) continue;
  const flow = m.flow;
  const glyphs = m.rects.filter(x => !x.blank && x.w > 0 && x.h > 0);
  const cols = [...new Set(glyphs.map(g => Math.round(g.x)))].sort((a, b) => b - a); // right->left
  const rows = [...new Set(glyphs.map(g => Math.round(g.y)))].sort((a, b) => a - b);
  const F = (perLang[r.id] = perLang[r.id] || { flow, css: {}, notes: [] });
  F.css = { writingMode: m.writingMode, direction: m.direction, unicodeBidi: m.unicodeBidi,
            textOrientation: m.textOrientation, family: m.fontFamily };
  const tag = `${r.id}/${r.kind}`;

  // --- rail continuity + axis direction inside a stacked run ---
  // Rail continuity is a claim about letters WITHIN a word: consecutive
  // letters, same column, no intervening word separator. A space between two
  // words in the same column is a word gap, not a broken rail — measured
  // separately as wordGap.
  let maxGap = -Infinity, axisOK = true, axisBad = null, wordGaps = [];
  if(flow === 'cols-rtl' || flow === 'btt-stave'){
    for(let i = 1; i < m.rects.length; i++){
      const a = m.rects[i - 1], b = m.rects[i];
      if(a.blank || b.blank || !(a.w > 0) || !(b.w > 0)) continue;  // adjacency broken by a separator
      if(Math.abs(b.x - a.x) > EPS) continue;                       // different column
      const forward = flow === 'btt-stave' ? b.y < a.y : b.y > a.y;
      if(!forward){ axisOK = false; axisBad = axisBad || [a.y.toFixed(1), b.y.toFixed(1)]; }
      const gap = flow === 'btt-stave' ? a.y - (b.y + b.h) : b.y - (a.y + a.h);
      maxGap = Math.max(maxGap, gap);
    }
    // word gap: letter, separator, letter — all in the same column
    for(let i = 2; i < m.rects.length; i++){
      const a = m.rects[i - 2], s = m.rects[i - 1], b = m.rects[i];
      if(a.blank || b.blank || !s.blank) continue;
      if(Math.abs(b.x - a.x) > EPS) continue;
      wordGaps.push(+(flow === 'btt-stave' ? a.y - (b.y + b.h) : b.y - (a.y + a.h)).toFixed(1));
    }
  }
  // --- column / stave order ---
  let colOrderOK = null, nCols = cols.length, wrapped = null, staveOrderOK = null,
      groundOK = null, bottoms = null, rtlOK = null, ltrOK = null, oneStavePerRun = null;
  if(flow === 'cols-rtl'){
    // reading order = document order; each new column must sit LEFT of the previous
    const seen = [];
    for(const g of glyphs){ const x = Math.round(g.x); if(!seen.length || seen[seen.length - 1] !== x) if(!seen.includes(x)) seen.push(x); }
    colOrderOK = seen.every((x, i) => i === 0 || x < seen[i - 1] - EPS);
    wrapped = seen.length;
    F.notes.push(`${r.kind}: columns(reading order) = ${JSON.stringify(seen.map(Math.round))}`);
  }
  if(flow === 'btt-stave'){
    const staves = m.groups.map(g => ({ x: Math.round(g.x0), bottom: Math.round(g.bottom), n: g.n }));
    staveOrderOK = staves.every((s, i) => i === 0 || s.x > staves[i - 1].x + EPS);
    bottoms = [...new Set(staves.map(s => s.bottom))];
    groundOK = bottoms.length === 1;
    oneStavePerRun = staves.length;
    F.notes.push(`${r.kind}: staves x=${JSON.stringify(staves.map(s => s.x))} bottoms=${JSON.stringify(bottoms)}`);
  }
  // horizontal flows wrap onto lines; check the axis WITHIN each line, and that
  // lines advance top->bottom in reading order
  let lineInfo = null;
  if(flow === 'rtl' || flow === 'ltr'){
    const lines = [];
    for(const g of glyphs){
      const L = lines.find(l => Math.abs(l.y - g.y) <= 2);
      if(L) L.g.push(g); else lines.push({ y: g.y, g: [g] });
    }
    const axis = lines.every(L => L.g.every((g, i) => i === 0 ||
      (flow === 'rtl' ? g.x < L.g[i - 1].x + EPS : g.x > L.g[i - 1].x - EPS)));
    const linesDown = lines.every((L, i) => i === 0 || L.y > lines[i - 1].y);
    // first word of the line sits at the reading-start edge of that line
    const edge = lines.every(L => flow === 'rtl'
      ? L.g[0].x + L.g[0].w >= Math.max(...L.g.map(x => x.x + x.w)) - EPS
      : L.g[0].x <= Math.min(...L.g.map(x => x.x)) + EPS);
    lineInfo = { n: lines.length, axis, linesDown, edge };
    if(flow === 'rtl') rtlOK = axis && linesDown && edge; else ltrOK = axis && linesDown && edge;
    F.notes.push(`${r.kind}: lines=${lines.length} axisPerLine=${axis} linesDown=${linesDown} startEdge=${edge} firstLineX=${JSON.stringify(lines[0].g.slice(0, 8).map(g => Math.round(g.x)))}`);
  }
  // word-unit accounting: the codex typesets one unit per whitespace-separated
  // romanized word; the writer emits one run per compiler TOKEN
  const romWords = String(m.rom || '').trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  const scrRuns = String(m.scr || '').split(/[\n ]+/).filter(Boolean).length;

  Object.assign(F, { [r.kind]: { nCols, rows: rows.length, maxGap, axisOK, axisBad, colOrderOK, wrapped,
    staveOrderOK, groundOK, bottoms, rtlOK, ltrOK, oneStavePerRun, romWords, scrRuns, wordGaps, lineInfo,
    box: m.box, textLen: m.textLen, svg: m.svgCount, img: m.imgCount, fontPx: m.fontSizePx } });

  console.log(`${tag.padEnd(24)} flow=${flow.padEnd(10)} glyphs=${String(glyphs.length).padEnd(4)} cols=${String(nCols).padEnd(3)} railGap=${maxGap === -Infinity ? 'n/a' : maxGap.toFixed(2)}px wordGap=${wordGaps.length ? [...new Set(wordGaps)].join('/') : 'n/a'} box=${m.box.w.toFixed(0)}x${m.box.h.toFixed(0)} romWords=${romWords} scrRuns=${scrRuns} svg=${m.svgCount} fontPx=${m.fontSizePx}`);
}
console.log('\n--- css seen on the real spans ---');
for(const [id, F] of Object.entries(perLang)){
  console.log(`${id.padEnd(14)} ${F.flow.padEnd(10)} wm=${F.css.writingMode} dir=${F.css.direction} bidi=${F.css.unicodeBidi} to=${F.css.textOrientation}`);
  for(const n of F.notes) console.log(`     ${n}`);
}

const byFlow = f => Object.entries(perLang).filter(([, F]) => F.flow === f);
console.log('');
// cols-rtl
for(const [id, F] of byFlow('cols-rtl')){
  ck(`${id} cols-rtl: writing-mode vertical-rl + upright`, F.css.writingMode === 'vertical-rl' && F.css.textOrientation === 'upright', `${F.css.writingMode}/${F.css.textOrientation}`);
  ck(`${id} cols-rtl: letters run DOWN the column (short + long)`, F.short.axisOK && F.long.axisOK, JSON.stringify([F.short.axisBad, F.long.axisBad]));
  ck(`${id} cols-rtl: columns advance RIGHT->LEFT (short + long)`, F.short.colOrderOK && F.long.colOrderOK);
  ck(`${id} cols-rtl: long phrase actually WRAPS to extra columns`, F.long.wrapped > 1, `columns=${F.long.wrapped} (short=${F.short.wrapped})`);
  ck(`${id} cols-rtl: rail fuses, zero gap between stacked letters of a word`, F.short.maxGap <= 0.5 && F.long.maxGap <= 0.5, `railGap short=${F.short.maxGap.toFixed(2)} long=${F.long.maxGap.toFixed(2)}`);
  ck(`${id} cols-rtl: words inside a column are separated by a real gap`, F.short.wordGaps.length > 0 && F.short.wordGaps.every(g => g > 1), `wordGaps=${JSON.stringify([...new Set(F.short.wordGaps)])}`);
}
// btt-stave
for(const [id, F] of byFlow('btt-stave')){
  ck(`${id} btt-stave: writing-mode vertical-lr + direction rtl + bidi override`, F.css.writingMode === 'vertical-lr' && F.css.direction === 'rtl' && /override/.test(F.css.unicodeBidi), `${F.css.writingMode}/${F.css.direction}/${F.css.unicodeBidi}`);
  ck(`${id} btt-stave: letters run BOTTOM-UP (short + long)`, F.short.axisOK && F.long.axisOK, JSON.stringify([F.short.axisBad, F.long.axisBad]));
  ck(`${id} btt-stave: staves advance LEFT->RIGHT (short + long)`, F.short.staveOrderOK && F.long.staveOrderOK);
  ck(`${id} btt-stave: all staves stand on common ground`, F.short.groundOK && F.long.groundOK, `bottoms short=${JSON.stringify(F.short.bottoms)} long=${JSON.stringify(F.long.bottoms)}`);
  ck(`${id} btt-stave: rail fuses, zero gap between stacked letters`, F.short.maxGap <= 0.5 && F.long.maxGap <= 0.5, `maxGap short=${F.short.maxGap.toFixed(2)} long=${F.long.maxGap.toFixed(2)}`);
}
// rtl
for(const [id, F] of byFlow('rtl')){
  ck(`${id} rtl: direction rtl + bidi override on the span`, F.css.direction === 'rtl' && /override|isolate/.test(F.css.unicodeBidi), `${F.css.direction}/${F.css.unicodeBidi}`);
  ck(`${id} rtl: letters AND words run RIGHT->LEFT, wrapped lines included`, F.short.rtlOK && F.long.rtlOK,
     `short=${JSON.stringify(F.short.lineInfo)} long=${JSON.stringify(F.long.lineInfo)}`);
}
// ltr
for(const [id, F] of byFlow('ltr')){
  ck(`${id} ltr: letters and words run LEFT->RIGHT, wrapped lines included`, F.short.ltrOK && F.long.ltrOK,
     `short=${JSON.stringify(F.short.lineInfo)} long=${JSON.stringify(F.long.lineInfo)}`);
}
// universal
ck('no <svg>/<img>/<canvas> inside any span — script is TEXT', results.every(r => r.m.err || (r.m.svgCount === 0 && r.m.imgCount === 0)));
ck('every span renders in its forged family', Object.values(perLang).every(F => /Tenebrae Omni/.test(F.css.family)));
// word-unit accounting — one script run per romanized word
const unitBad = Object.entries(perLang).filter(([, F]) => F.short.romWords !== F.short.scrRuns || F.long.romWords !== F.long.scrRuns);
ck('one script word-unit per romanized word (codex typesets on whitespace)', unitBad.length === 0,
   unitBad.map(([id, F]) => `${id}: short ${F.short.romWords}rom/${F.short.scrRuns}run, long ${F.long.romWords}rom/${F.long.scrRuns}run`).join(' | '));

// name the offending tokens: which romanized words got fused into one unit
console.log('\n--- fused word units (compiler tokens containing whitespace) ---');
const fused = await page.evaluate(async ({ ids, phrase }) => {
  const rows = [];
  for(const id of ids){
    const r = await window.tenebrae.translate2(id, phrase);
    for(const t of (r.toks || [])){
      if(t.sep || !t.t) continue;
      if(/\s/.test(t.t)) rows.push({ id, token: t.t, words: t.t.trim().split(/\s+/).length,
        pua: [...(window.tenebrae._forge.textFor(id, t.t) || '')].length });
    }
  }
  return rows;
}, { ids: names.map(n => n.id), phrase: LONG });
for(const f of fused) console.log(`  ${f.id.padEnd(14)} token ${JSON.stringify(f.token)} = ${f.words} romanized words -> ONE ${perLang[f.id].flow === 'btt-stave' ? 'stave' : 'word run'} of ${f.pua} glyphs (no gap, no unknown mark)`);
if(!fused.length) console.log('  none');

// GROUND TRUTH: what the codex's OWN typesetter does with the same romanized
// string — transcribeScriptSVG splits on whitespace, so it draws one word unit
// per whitespace-separated word. Count its top-level <g> placements.
console.log('\n--- codex transcribeScriptSVG on the same romanization ---');
const gt = await page.evaluate(async rows => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  return rows.map(({ id, token }) => {
    const sc = C.TRANS[id].L.script;
    const svg = C.transcribeScriptSVG(token, sc, C.makeMatcher(sc), 30, '#111', null);
    // each word unit is a DIRECT <g> child of the root <svg>; glyph groups are
    // nested inside it, so parse rather than count substrings
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const units = [...doc.documentElement.children].filter(n => n.tagName === 'g').length;
    // MEASURE the writer rather than assume it: its script run separates word
    // units with a space (or a newline for one-stave-per-word flows)
    const run = window.tenebrae._forge.textForToks(id, [{ t: token }]) || '';
    const writerUnits = run.split(/[\n ]+/).filter(Boolean).length;
    return { id, token, codexUnits: units, writerUnits };
  });
}, fused.map(f => ({ id: f.id, token: f.token })));
for(const g of gt) console.log(`  ${g.id.padEnd(14)} ${JSON.stringify(g.token)}: codex draws ${g.codexUnits} word units, writer renders ${g.writerUnits}`);
ck('codex and writer agree on word-unit count for whitespace-bearing tokens',
   gt.length > 0 && gt.every(g => g.codexUnits === g.writerUnits),
   gt.map(g => `${g.id} ${g.codexUnits}vs${g.writerUnits}`).join(' | '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));

verdict('TX-6 LAYOUT GEOMETRY', checks.every(c => c[1]));
await browser.close();
await srv.close();
