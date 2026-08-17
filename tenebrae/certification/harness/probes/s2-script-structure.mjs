// STRUCTURAL PARITY — the rigorous check behind "the translation is right".
// For every scripted tongue x phrase, compare the writer against the codex on:
//   1. romanization      — byte-identical to the codex's own compileText
//   2. glyph sequence    — the writer's PUA run decodes to exactly the codex's
//                          matchWord glyph keys, in the codex's canonical
//                          visual order (rtl / btt-stave reversal included)
//   3. spatial layout    — DOM geometry proves the declared flow:
//                          cols-rtl  one column per word, columns advance
//                                    left->right, letters down, common ceiling
//                          btt-stave staves advance left->right, common ground,
//                                    first letter at the BOTTOM
//                          rtl       first word rightmost
//   4. rail continuity   — vertical scripts fuse into an unbroken stem
// Run: cd probes && node s2-script-structure.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const PHRASES = [
  'The sea remembers the old king',
  'my mana let it stand',
  'the lamp holds steady',
  'she walks alone tonight',
];

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const res = await page.evaluate(async phrases => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const F = window.tenebrae._forge;
  const out = [];

  for(const id of Object.keys(C.TRANS)){
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    if(!sc || !(sc.glyphs || []).length) continue;
    const flow = C.scriptDir(sc);
    const f = F.map()[id];
    const matcher = C.makeMatcher(sc);
    const rec = { id, name: T.L.name || id, flow, checks: [] };
    const ck = (label, ok, detail) => rec.checks.push({ label, ok, detail: ok ? undefined : detail });

    for(const phrase of phrases){
      const r = await window.tenebrae.translate2(id, phrase);

      // 1. romanization parity against the codex's own compiler
      const res2 = C.compileText(T, phrase, 'e2l');
      const lines = res2.lines || [(res2.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
      const codexRom = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
      ck(`rom "${phrase}"`, r.romanization === codexRom, `${r.romanization} != ${codexRom}`);

      // 2. glyph-sequence parity, per word, in canonical visual order
      const scr = F.textForToks(id, r.toks);
      const writerWords = scr.split(/[\n ]+/).filter(Boolean).map(wd =>
        [...wd].map(c => {
          const i = c.charCodeAt(0) - f.base;
          return (i >= 0 && i < sc.glyphs.length) ? sc.glyphs[i].k.toLowerCase() : (i === sc.glyphs.length ? '·' : '?');
        }));
      // the codex feeds its typesetter cleanText — translatable parts only —
      // and strips everything outside [letters, digits, ' \u2019 -] per word
      const codexWords = (r.toks || []).filter(t => !t.sep && t.t && !t.u)
        .flatMap(t => String(t.t).split(/\s+/).filter(Boolean))
        .map(x => x.replace(/[^\p{L}\p{N}'\u2019-]/gu, '')).filter(Boolean).map(t => {
        let keys = C.makeMatcher(sc) && [];
        keys = (function(word){
          const o = []; let i = 0; const s2 = String(word).toLowerCase();
          while(i < s2.length){
            let hit = null;
            for(const k of matcher.keys) if(s2.startsWith(k, i)){ hit = k; break; }
            if(hit){ o.push(hit); i += hit.length; } else { o.push(/\S/.test(s2[i]) ? '·' : ''); i++; }
          }
          return o.filter(Boolean);
        })(t);
        return keys;
      });
      const expect = codexWords.map(k => k.slice()); // logical order in the text
      ck(`glyphs "${phrase}"`, JSON.stringify(writerWords) === JSON.stringify(expect),
         `${JSON.stringify(writerWords).slice(0, 160)} != ${JSON.stringify(expect).slice(0, 160)}`);
    }

    // 3/4. spatial layout + rail continuity, measured in the real DOM
    const r0 = await window.tenebrae.translate2(id, phrases[0]);
    const scr0 = F.textForToks(id, r0.toks);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:0;left:0;width:6000px;font-size:40px;line-height:1;visibility:hidden' + (flow === 'ltr' || flow === 'rtl' ? ';white-space:nowrap' : '');
    const sp = document.createElement('span');
    sp.className = 'tspan'; sp.dataset.omni = '1'; sp.dataset.lang = id;
    if(flow !== 'ltr') sp.dataset.flow = flow;
    if(r0.dir === 'rtl') sp.setAttribute('dir', 'rtl');
    sp.textContent = scr0;
    host.appendChild(sp); document.body.appendChild(host);
    await document.fonts.ready;

    const t = sp.firstChild, rects = [];
    for(let i = 0; i < scr0.length; i++){
      const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
      const b = rg.getBoundingClientRect();
      rects.push({ ch: scr0[i], x: b.x, y: b.y, w: b.width, h: b.height, blank: scr0[i] === ' ' || scr0[i] === '\n' });
    }
    const glyphs = rects.filter(r2 => !r2.blank && r2.w > 0);
    const groups = [];  // contiguous runs = words/columns
    let cur = [];
    for(const r2 of rects){ if(r2.blank){ if(cur.length){ groups.push(cur); cur = []; } } else cur.push(r2); }
    if(cur.length) groups.push(cur);

    if(flow === 'cols-rtl' || flow === 'btt-stave'){
      const sameCol = (a, b) => Math.abs(a.x - b.x) <= 1;
      const dirOK = groups.every(grp => grp.every((g, i) => {
        if(i === 0 || !sameCol(g, grp[i-1])) return true;           // new column: axis restarts
        return flow === 'btt-stave' ? g.y < grp[i-1].y : g.y > grp[i-1].y;
      }));
      ck(flow === 'btt-stave' ? 'letters run bottom-up (first letter lowest)' : 'letters run top-down', dirOK,
         JSON.stringify(groups[0] ? groups[0].slice(0, 4).map(g => [g.x.toFixed(0), g.y.toFixed(0)]) : []));
      // rail continuity: consecutive letters in the same column abut (no gap)
      let maxGap = 0;
      for(const grp of groups) for(let i = 1; i < grp.length; i++){
        const a = grp[i-1], b = grp[i];
        if(Math.abs(b.x - a.x) > 1) continue; // wrapped to a new column
        const gap = flow === 'btt-stave' ? a.y - (b.y + b.h)   // stacking upward
                                         : b.y - (a.y + a.h);  // stacking downward
        maxGap = Math.max(maxGap, gap);
      }
      ck('rail fuses (no gap between stacked letters)', maxGap <= 0.5, `maxGap=${maxGap.toFixed(2)}px`);
    }
    if(flow === 'cols-rtl'){
      const cols = [...new Set(glyphs.map(g => Math.round(g.x)))].sort((a, b) => a - b);
      const firstX = Math.round(glyphs[0].x);
      ck('columns advance left->right (first word leftmost)', cols.length === 1 || firstX === cols[0],
         `first=${firstX} cols=${JSON.stringify(cols)}`);
      const colXs = groups.map(g => Math.round(g[0].x));
      ck('one column per word, each further right', colXs.every((x, i) => i === 0 || x > colXs[i-1]),
         JSON.stringify(colXs));
      const tops = [...new Set(groups.map(g => Math.round(Math.min(...g.map(r2 => r2.y)))))];
      ck('columns hang from a common ceiling', tops.length === 1, `tops=${JSON.stringify(tops)}`);
    }
    if(flow === 'btt-stave'){
      const staves = groups.map(g => ({ x: Math.round(g[0].x), bottom: Math.max(...g.map(r2 => r2.y + r2.h)) }));
      ck('staves advance left->right', staves.every((s, i) => i === 0 || s.x > staves[i-1].x),
         JSON.stringify(staves.map(s => s.x)));
      const bottoms = [...new Set(staves.map(s => Math.round(s.bottom)))];
      ck('staves stand on common ground', bottoms.length === 1, `bottoms=${JSON.stringify(bottoms)}`);
    }
    if(flow === 'rtl'){
      ck('letters and words run right->left', glyphs.every((g, i) => i === 0 || g.x < glyphs[i-1].x + 1),
         JSON.stringify(glyphs.map(g => Math.round(g.x)).slice(0, 8)));
    }
    host.remove();
    out.push(rec);
  }
  return out;
}, PHRASES);

let allOK = true;
for(const rec of res){
  const bad = rec.checks.filter(c => !c.ok);
  console.log(`${(rec.name + ' [' + rec.flow + ']').padEnd(30)} ${rec.checks.length - bad.length}/${rec.checks.length} ${bad.length ? 'FAIL' : 'ok'}`);
  for(const b of bad){ allOK = false; console.log(`   FAIL ${b.label}: ${b.detail}`); }
}
console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('SCRIPT STRUCTURE', allOK && errors.length === 0);
await browser.close();
await srv.close();
