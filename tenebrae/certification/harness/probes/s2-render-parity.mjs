// RENDER PARITY: the writer's script rendering must LOOK like the codex's own.
// Two independent measures, both computed in-page against the live engine:
//   glyph IoU — one character, forged font vs codex glyphSVG  (is the FORGE faithful?)
//   word  IoU — whole word, forged text vs codex wordScriptSVG (is the LAYOUT faithful?)
// Both rasterize to a common box, crop to ink, and score intersection-over-union.
// Run: cd probes && node s2-render-parity.mjs [--save]
import { launch, wait } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const SAVE = process.argv.includes('--save');
const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/parity';
if(SAVE) await mkdir(OUT, { recursive: true });

const WORDS = ['dicu', 'esto', 'manax', 'coa', 'luminatu'];
const { srv, browser, page, errors } = await launch();
await page.waitForTimeout(3500); // embedded engine warm + forge

const report = await page.evaluate(async words => {
  const w = await window.tenebrae.engine();
  if(!w) return { error: 'engine did not wake' };
  const C = w.CODEX;
  const forged = window.tenebrae._forge ? window.tenebrae._forge.map() : null;

  const SZ = 240; // raster box
  const rasterize = async (drawFn) => {
    const cv = document.createElement('canvas');
    cv.width = SZ; cv.height = SZ;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, SZ, SZ);
    g.fillStyle = '#000';
    await drawFn(g, cv);
    const d = g.getImageData(0, 0, SZ, SZ).data;
    // ink mask + bbox
    const mask = new Uint8Array(SZ * SZ);
    let x0 = SZ, y0 = SZ, x1 = -1, y1 = -1;
    for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
      const i = (y * SZ + x) * 4;
      if(d[i] < 160){ mask[y * SZ + x] = 1; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
    }
    return { mask, box: [x0, y0, x1, y1], ink: mask.reduce((a, b) => a + b, 0), url: cv.toDataURL() };
  };
  const svgToCanvas = svg => async (g, cv) => {
    const img = new Image();
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const s = Math.min(cv.width / img.width, cv.height / img.height) * 0.92;
    g.drawImage(img, (cv.width - img.width * s) / 2, (cv.height - img.height * s) / 2, img.width * s, img.height * s);
  };
  const textToCanvas = (text, family, vertical) => async (g, cv) => {
    // draw PUA text the way CSS lays it out: vertical stacks chars, horizontal runs
    const chars = [...text];
    const n = Math.max(1, chars.length);
    const px = vertical ? Math.min(cv.height / n, cv.width) * 0.92 : Math.min(cv.width / n, cv.height) * 0.92;
    g.font = `${px}px "${family}"`;
    g.textBaseline = 'alphabetic';
    if(vertical){
      const totalH = px * n, startY = (cv.height - totalH) / 2;
      chars.forEach((c, i) => {
        const m = g.measureText(c);
        g.fillText(c, (cv.width - m.width) / 2, startY + (i + 1) * px - px * 0.2);
      });
    }else{
      let total = 0;
      chars.forEach(c => total += g.measureText(c).width);
      let x = (cv.width - total) / 2;
      chars.forEach(c => { g.fillText(c, x, cv.height / 2 + px * 0.35); x += g.measureText(c).width; });
    }
  };
  // normalized IoU: crop each mask to its ink box, scale to 64x64, compare
  const iou = (A, B) => {
    const N = 64;
    const grid = ({ mask, box }) => {
      const [x0, y0, x1, y1] = box;
      const bw = Math.max(1, x1 - x0 + 1), bh = Math.max(1, y1 - y0 + 1);
      const out = new Uint8Array(N * N);
      for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
        const sx = x0 + Math.floor(x * bw / N), sy = y0 + Math.floor(y * bh / N);
        out[y * N + x] = mask[sy * SZ + sx];
      }
      return out;
    };
    const a = grid(A), b = grid(B);
    let inter = 0, uni = 0;
    for(let i = 0; i < N * N; i++){ if(a[i] && b[i]) inter++; if(a[i] || b[i]) uni++; }
    return uni ? inter / uni : 0;
  };

  const langs = Object.keys(C.TRANS);
  const out = { langs: {}, images: {} };
  for(const id of langs){
    const T = C.TRANS[id];
    const sc = T.L && T.L.script;
    if(!sc || !(sc.glyphs || []).length) continue;
    const flow = C.scriptDir(sc);
    const vertical = flow === 'cols-rtl' || flow === 'btt-stave';
    const f = forged && forged[id];
    if(!f){ out.langs[id] = { error: 'not forged' }; continue; }
    const matcher = C.makeMatcher(sc);

    // ---- per-glyph parity (forge fidelity) ----
    const gScores = [];
    for(const g0 of sc.glyphs.slice(0, 8)){
      const gi = sc.glyphs.indexOf(g0);
      const codexImg = await rasterize(svgToCanvas(C.glyphSVG(g0.d, 100, '#000')));
      const fontImg = await rasterize(textToCanvas(String.fromCharCode(f.base + gi), f.family, false));
      gScores.push({ k: g0.k, iou: +iou(codexImg, fontImg).toFixed(3) });
    }

    // ---- per-word parity (layout fidelity) ----
    const wScores = [];
    for(const word of words){
      const codexSvg = C.wordScriptSVG(word, sc, matcher, 100, '#000').svg;
      const codexImg = await rasterize(svgToCanvas(codexSvg));
      // what the WRITER would render for this word (same tokenizer + ordering rules)
      const scr = window.tenebrae._forge.textFor(id, word);
      if(scr == null){ wScores.push({ word, iou: -1, note: 'no writer text' }); continue; }
      const fontImg = await rasterize(textToCanvas(scr, f.family, vertical));
      const sc2 = +iou(codexImg, fontImg).toFixed(3);
      wScores.push({ word, iou: sc2, chars: [...scr].map(c => c.charCodeAt(0).toString(16)).join(',') });
      if(word === words[0]) out.images[id] = { codex: codexImg.url, font: fontImg.url };
    }
    out.langs[id] = { flow, vertical,
      glyphIoU: +(gScores.reduce((a, b) => a + b.iou, 0) / gScores.length).toFixed(3),
      glyphWorst: gScores.sort((a, b) => a.iou - b.iou)[0],
      wordIoU: +(wScores.filter(x => x.iou >= 0).reduce((a, b) => a + b.iou, 0) / Math.max(1, wScores.filter(x => x.iou >= 0).length)).toFixed(3),
      words: wScores };
  }
  return out;
}, WORDS);

if(report.error){ console.log('ERROR:', report.error); process.exit(1); }
console.log('lang            flow        glyphIoU  wordIoU   worst-glyph');
for(const [id, r] of Object.entries(report.langs)){
  if(r.error){ console.log(`${id.padEnd(15)} ${r.error}`); continue; }
  console.log(`${id.padEnd(15)} ${String(r.flow).padEnd(11)} ${String(r.glyphIoU).padEnd(9)} ${String(r.wordIoU).padEnd(9)} ${r.glyphWorst.k}:${r.glyphWorst.iou}`);
  console.log(`   words: ${r.words.map(w => `${w.word}=${w.iou}`).join('  ')}`);
}
if(SAVE) for(const [id, imgs] of Object.entries(report.images || {}))
  for(const [which, url] of Object.entries(imgs))
    await writeFile(`${OUT}/${id}-${which}.png`, Buffer.from(url.split(',')[1], 'base64'));
console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
await srv.close();
