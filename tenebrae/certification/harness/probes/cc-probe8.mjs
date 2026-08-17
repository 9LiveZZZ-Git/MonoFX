// COVERAGE-CRITIC probe 8: three layout facts TX-6 / tx-layout-geometry.mjs
// never assert.
//   A. cols-rtl column wrapping SPLITS WORDS (word-break:break-all) — the codex
//      breaks only at a word (transcribeScriptSVG cols branch; Celan High rule).
//   B. cols-rtl column content is BOTTOM-aligned; the codex fills from the head.
//   C. btt-stave one-stave-per-word depends entirely on white-space:pre-wrap
//      surviving; drop it and every stave fuses into one.
import { launch, wait, createBook, insertTranslationSpan } from './ex-lib.mjs';

const LONG = 'the old keeper of the fallen tower walked the long cold road under a silent moon while the sea remembered every oath';
const SHORT = 'the sea remembers';

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1200 });
await wait(page, 3000);
await createBook(page, 'CC Geometry');
await page.click('#ed-content');
await page.keyboard.type(LONG);
await page.keyboard.press('Enter');
await page.keyboard.type(SHORT);
await wait(page, 500);
await insertTranslationSpan(page, LONG, 'Celan High');
await wait(page, 400);
await insertTranslationSpan(page, SHORT, 'Celan High');
await wait(page, 600);

const res = await page.evaluate(async () => {
  const out = {};
  const spans = [...document.querySelectorAll('#ed-content .tspan[data-flow="cols-rtl"]')];
  const measure = sp => {
    const t = sp.firstChild;
    const r = [];
    for (let i = 0; i < t.data.length; i++) {
      const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
      const b = rg.getBoundingClientRect();
      r.push({ ch: t.data[i], x: +b.x.toFixed(1), y: +b.y.toFixed(1), h: +b.height.toFixed(1) });
    }
    return r;
  };
  out.spans = spans.map(sp => {
    const rects = measure(sp);
    const words = []; let cur = [];
    for (const t of rects) { if (t.ch === ' ') { if (cur.length) words.push(cur); cur = []; } else cur.push(t); }
    if (cur.length) words.push(cur);
    const splitWords = words.filter(w => new Set(w.map(t => Math.round(t.x))).size > 1);
    const colMap = {};
    rects.filter(t => t.ch !== ' ').forEach(t => { const k = Math.round(t.x); (colMap[k] = colMap[k] || []).push(t); });
    const box = sp.getBoundingClientRect();
    const cols = Object.entries(colMap).map(([x, ts]) => ({
      x: +x, top: +Math.min(...ts.map(t => t.y)).toFixed(1), bottom: +Math.max(...ts.map(t => t.y + t.h)).toFixed(1), n: ts.length }))
      .sort((a, b) => b.x - a.x);
    return { rom: sp.dataset.rom, nWords: words.length, nCols: cols.length,
      wordsSplitAcrossColumns: splitWords.length,
      spanTop: +box.top.toFixed(1), spanBottom: +box.bottom.toFixed(1), spanHeight: +box.height.toFixed(1),
      cols, wordBreak: getComputedStyle(sp).wordBreak };
  });

  // codex ground truth for the same romanization: how many word units per column
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const sc = C.TRANS.celan_high.L.script, m = C.makeMatcher(sc);
  out.codex = out.spans.map(s => {
    const svg = C.transcribeScriptSVG(s.rom, sc, m, 20, '#111', null);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const gs = [...doc.documentElement.children].filter(n => n.tagName === 'g');
    const byX = {};
    gs.forEach(g => { const mm = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || ''); if (mm) { const x = Math.round(+mm[1] / 10) * 10; (byX[x] = byX[x] || []).push(+mm[2]); } });
    return { units: gs.length, cols: Object.keys(byX).length,
      colFirstY: Object.entries(byX).map(([x, ys]) => ({ x: +x, firstY: Math.min(...ys) })).sort((a, b) => b.x - a.x) };
  });

  // C. btt-stave without pre-wrap
  return out;
});
console.log('--- writer cols-rtl spans (real editor) ---');
console.log(JSON.stringify(res.spans, null, 1));
console.log('--- codex transcribeScriptSVG on the same romanization ---');
console.log(JSON.stringify(res.codex, null, 1));

// C: btt-stave newline dependency
await page.keyboard.press('Enter');
const btt = await page.evaluate(async () => {
  const r = await window.tenebrae.translate2('kildaren', 'the old keeper walked the long road');
  const scr = window.tenebrae._forge.textForToks('kildaren', r.toks || []);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;font-size:20px';
  document.body.appendChild(host);
  const mk = ws => {
    const sp = document.createElement('span');
    sp.className = 'tspan'; sp.dataset.omni = '1'; sp.dataset.lang = 'kildaren'; sp.dataset.flow = 'btt-stave';
    sp.textContent = scr; if (ws) sp.style.whiteSpace = ws;
    host.innerHTML = ''; host.appendChild(sp);
    const t = sp.firstChild; const xs = new Set();
    for (let i = 0; i < t.data.length; i++) { const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1); const b = rg.getBoundingClientRect(); if (b.height > 0) xs.add(Math.round(b.x)); }
    return { staves: xs.size, ws: getComputedStyle(sp).whiteSpace };
  };
  const a = mk(null), b = mk('normal');
  host.remove();
  return { scrWords: scr.split('\n').length, withPreWrap: a, withoutPreWrap: b, hasNewline: scr.includes('\n') };
});
console.log('--- btt-stave newline dependency ---');
console.log(JSON.stringify(btt, null, 1));
console.log('pageerrors', errors);
await browser.close(); await srv.close();
