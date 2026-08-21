// TX-4 / VERIFIER — "the forged font really is the codex's own glyph vectors,
// drawn where the codex draws them".
//
// The writer's TX-4 evidence checks the forged TTFs against ITSELF: it decodes
// PUA -> index -> sc.glyphs[index].k, which holds by construction even if the
// outlines were scrambled, mirrored, mis-scaled or shifted. This probe compares
// the RENDERED forged glyph against the CODEX'S OWN RENDERING of the same glyph
// in one shared pixel frame:
//
//   codex side  — Path2D(g.d) stroked exactly as codex wordScriptSVG does
//                 (stroke-width 8 on the 100-grid, round caps, round joins),
//                 placed by the codex's own per-flow transform (vertical: glyph
//                 box abuts the cell; horizontal: 0.07em inset, 0.92 scale)
//   writer side — ctx.fillText of the PUA codepoint in the forged family
//
//   A. SHAPE     — bbox-normalized IoU + a permutation test (forged glyph i must
//                  match codex glyph i better than any other glyph of the script)
//   B. PLACEMENT — raw, un-realigned overlay in the same frame: catches wrong
//                  scale, wrong origin, Y-flip, dropped subpaths
//   C. THE RAIL  — real DOM screenshot of a real .tspan vs the codex's own
//                  transcribeScriptSVG for the same word, analyzed in PIL:
//                  does the vertical stem fuse into one continuous rail?
//
// Run: cd probes && node tx-vp-glyph-vector-truth.mjs
import { launch, wait } from './ex-lib.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vp-glyph';
await mkdir(OUT, { recursive: true });

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

/* ---------------- A + B: per-glyph shape and placement ---------------- */
const res = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const F = window.tenebrae._forge.map();
  if (!F) return { fatal: 'no forge map — engine never woke' };
  await document.fonts.ready;

  const SZ = 420, S = 200, PEN = 60;
  const cv = document.createElement('canvas');
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, SZ, SZ); };
  const mask = () => {
    const d = ctx.getImageData(0, 0, SZ, SZ).data;
    const m = new Uint8Array(SZ * SZ); let n = 0;
    for (let i = 0, p = 3; i < m.length; i++, p += 4) if (d[p] >= 128) { m[i] = 1; n++; }
    return { m, n };
  };
  const bbox = m => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (m[y * SZ + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const N = 64;
  const norm = (m, b) => {                       // crop to bbox, resample to N x N
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = b.x0 + Math.min(b.w - 1, Math.floor(x * b.w / N));
      const sy = b.y0 + Math.min(b.h - 1, Math.floor(y * b.h / N));
      o[y * N + x] = m[sy * SZ + sx];
    }
    return o;
  };
  const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] & b[k]) i++; if (a[k] | b[k]) u++; } return u ? i / u : 0; };

  const out = [];
  const skipped = [];
  for (const [langId, f] of Object.entries(F)) {
    // 2026-08 TRIAGE (stale-probe fix, TX-6c): the forge map also holds the
    // WORD script, Celan Basic, which the codex gives no alphabet in
    // TRANS[].L.script (it is not a key of C.TRANS at all — omniLangs() pushes
    // it by hand before iterating TRANS). Reading C.TRANS[langId].L on it threw
    // "Cannot read properties of undefined (reading 'L')" and crashed the whole
    // probe before a single alphabet was checked. Its runes are carved per WORD
    // by composeWord and its geometry parity is capsule-per-segment, a
    // different proof — tx-vp-celan-basic-script.mjs owns it. Skip it here, but
    // only after PROVING it is that tongue (auric word-forge + no TRANS entry),
    // so a genuinely missing alphabet still fails.
    if (!C.TRANS[langId]) { skipped.push({ langId, auric: !!f.auric, hasWords: !!f.words, hasMatcher: !!f.matcher }); continue; }
    const T = C.TRANS[langId], sc = T.L.script;
    const flow = C.scriptDir(sc);
    const vertical = flow === 'cols-rtl' || flow === 'btt-stave';
    const baseY = vertical ? 300 : 320;
    const rec = { langId, name: T.L.name || langId, flow, n: sc.glyphs.length, checks: [], rows: [] };
    const ck = (label, ok, detail) => rec.checks.push({ label, ok, detail: ok ? undefined : detail });
    rec.fontLoaded = document.fonts.check(`${S}px "${f.family}"`);

    const drawForged = i => {
      clear(); ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
      ctx.font = `${S}px "${f.family}"`;
      ctx.fillText(String.fromCharCode(f.base + i), PEN, baseY);
      return mask();
    };
    const drawCodex = g => {
      clear();
      if (vertical) ctx.setTransform(S / 100, 0, 0, S / 100, PEN, baseY - 0.8 * S);
      else          ctx.setTransform(6.44 * S / 1000, 0, 0, 6.44 * S / 1000, PEN + 0.07 * S, baseY - 0.77 * S);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      try { ctx.stroke(new Path2D(g.d)); } catch (e) {}
      return mask();
    };

    const forged = [], codex = [], fb = [], cb = [];
    for (let i = 0; i < sc.glyphs.length; i++) {
      const a = drawForged(i), b = drawCodex(sc.glyphs[i]);
      forged.push(a); codex.push(b); fb.push(bbox(a.m)); cb.push(bbox(b.m));
    }
    const dot = drawForged(sc.glyphs.length);

    // ---- A. shape identity, bbox-normalized ----
    let minShape = 2, minKey = null, sum = 0, empty = 0;
    const nf = [], nc = [];
    for (let i = 0; i < sc.glyphs.length; i++) {
      if (!forged[i].n || !codex[i].n) { empty++; nf.push(null); nc.push(null); continue; }
      nf.push(norm(forged[i].m, fb[i])); nc.push(norm(codex[i].m, cb[i]));
      const v = iou(nf[i], nc[i]); sum += v;
      if (v < minShape) { minShape = v; minKey = sc.glyphs[i].k; }
    }
    rec.meanShapeIoU = +(sum / sc.glyphs.length).toFixed(4);
    rec.minShapeIoU = +minShape.toFixed(4);
    rec.minShapeKey = minKey;
    ck('every codex glyph and every forged glyph inks', empty === 0, `${empty} empty rasters`);
    // 0.85 floor: at 64x64 normalized resolution a hairline stroke loses a few
    // percent to discretization alone — the permutation test below is the real
    // anti-fraud check.
    ck('forged outline IS the codex outline (bbox-normalized IoU >= 0.85 for every glyph)',
       minShape >= 0.85, `min ${minShape.toFixed(4)} on "${minKey}"`);

    let offDiag = 0, offList = [];
    for (let i = 0; i < sc.glyphs.length; i++) {
      if (!nf[i]) continue;
      let best = -1, bestJ = -1;
      for (let j = 0; j < sc.glyphs.length; j++) { if (!nc[j]) continue; const v = iou(nf[i], nc[j]); if (v > best) { best = v; bestJ = j; } }
      if (bestJ !== i) { offDiag++; offList.push(`${sc.glyphs[i].k}->${sc.glyphs[bestJ].k}`); }
    }
    ck('no permutation: forged glyph i matches codex glyph i best (argmax == i)',
       offDiag === 0, `${offDiag} mismatched: ${offList.slice(0, 6).join(',')}`);

    // ---- B. placement in the shared frame ----
    let maxDx = 0, maxDy = 0, shifted = 0, sizeBad = 0;
    for (let i = 0; i < sc.glyphs.length; i++) {
      if (!fb[i] || !cb[i]) continue;
      const dx = fb[i].x0 - cb[i].x0, dy = fb[i].y0 - cb[i].y0;
      const dw = Math.abs(fb[i].w - cb[i].w), dh = Math.abs(fb[i].h - cb[i].h);
      if (Math.abs(dx) > 1) shifted++;
      if (dw > 2 || dh > 2) sizeBad++;
      if (Math.abs(dx) > Math.abs(maxDx)) maxDx = dx;
      if (Math.abs(dy) > Math.abs(maxDy)) maxDy = dy;
      rec.rows.push({ k: sc.glyphs[i].k, dx, dy, fw: fb[i].w, cw: cb[i].w,
                      shiftEm: +(dx / S).toFixed(4), codexX0em: +((cb[i].x0 - PEN) / S).toFixed(4) });
    }
    rec.maxDx = maxDx; rec.maxDy = maxDy; rec.shifted = shifted;
    ck('glyph SIZE matches the codex placement (ink w/h within 2px at 200px em)', sizeBad === 0, `${sizeBad} glyphs`);
    ck('glyph is drawn WHERE the codex draws it (|dx| <= 1px at 200px em)',
       shifted === 0, `${shifted}/${sc.glyphs.length} glyphs horizontally displaced, worst ${maxDx}px = ${(maxDx / S).toFixed(3)}em`);
    ck('no vertical displacement', Math.abs(maxDy) <= 1, `worst dy ${maxDy}px`);

    const db = bbox(dot.m);
    rec.dot = db ? { w: db.w, h: db.h, rEm: +(db.w / 2 / S).toFixed(4), codexREm: 0.03 } : null;
    out.push(rec);
  }
  return { out, skipped };
});

if (res.fatal) { console.log('FATAL:', res.fatal); await browser.close(); await srv.close(); process.exit(1); }

let allOK = true;
// the only tongue allowed to sit out the alphabet comparison is the word script
console.log('skipped (word scripts, no alphabet in TRANS[].L.script):', JSON.stringify(res.skipped));
const skipOK = (res.skipped || []).every(s => s.langId === 'celan_basic' && s.auric === true && s.hasWords === true && s.hasMatcher === false);
if (!skipOK) { allOK = false; console.log('FAIL a forged tongue has no codex alphabet and is not the Auric word script'); }
for (const r of res.out) {
  console.log(`\n${r.name} [${r.flow}] n=${r.n} fontLoaded=${r.fontLoaded}`);
  console.log(`   shape: mean IoU ${r.meanShapeIoU}  min ${r.minShapeIoU} ("${r.minShapeKey}")`);
  console.log(`   placement: worst dx ${r.maxDx}px (${(r.maxDx / 200).toFixed(3)}em), worst dy ${r.maxDy}px, displaced ${r.shifted}/${r.n}`);
  console.log(`   unknown dot: ${JSON.stringify(r.dot)}`);
  for (const c of r.checks) { if (!c.ok) allOK = false; console.log(`   ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.ok ? '' : ' — ' + c.detail}`); }
  const worst = r.rows.slice().sort((a, b) => Math.abs(b.dx) - Math.abs(a.dx)).slice(0, 4);
  console.log(`   biggest shifts: ${worst.map(w => `${w.k}: dx=${w.dx}px (${w.shiftEm}em, codex x0=${w.codexX0em}em)`).join(' | ')}`);
}

/* ---------------- C. the rail, in the real DOM vs the codex's own render --------------- */
const RAIL = [
  { lang: 'celan_high', word: 'remembers' },
  { lang: 'kildaren',   word: 'remembers' },
];
const railOut = [];
for (const { lang, word } of RAIL) {
  const info = await page.evaluate(async ({ lang, word }) => {
    document.querySelectorAll('.rail-host').forEach(n => n.remove());
    const w = await window.tenebrae.engine();
    const C = w.CODEX, T = C.TRANS[lang], sc = T.L.script;
    const flow = C.scriptDir(sc);
    const r = await window.tenebrae.translate2(lang, word);
    const oneWord = (r.romanization || '').split(/\s+/).filter(Boolean)[0] || 'x';
    const scr = window.tenebrae._forge.textForToks(lang, [{ t: oneWord }]);

    const host = document.createElement('div');
    host.className = 'rail-host';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:10px;display:flex;gap:30px;align-items:flex-start';
    const a = document.createElement('div');            // codex's own typesetter
    a.id = 'rail-codex';
    a.innerHTML = C.transcribeScriptSVG(oneWord, sc, C.makeMatcher(sc), 40, '#000', '#fff');
    const b = document.createElement('div');            // the writer's real span
    b.id = 'rail-writer';
    b.style.cssText = 'font-size:40px;line-height:1;background:#fff';
    const sp = document.createElement('span');
    sp.className = 'tspan'; sp.dataset.omni = '1'; sp.dataset.lang = lang;
    if (flow !== 'ltr') sp.dataset.flow = flow;
    if (r.dir === 'rtl') sp.setAttribute('dir', 'rtl');
    sp.textContent = scr;
    b.appendChild(sp);
    host.appendChild(a); host.appendChild(b);
    document.body.appendChild(host);
    await document.fonts.ready;
    const base = window.tenebrae._forge.map()[lang].base;
    const keys = [...scr].map(c => {
      const i = c.charCodeAt(0) - base;
      return (i >= 0 && i < sc.glyphs.length) ? sc.glyphs[i].k : (i === sc.glyphs.length ? '·' : JSON.stringify(c));
    });
    return { lang, flow, word: oneWord, chars: [...scr].length, keys };
  }, { lang, word });
  await wait(page, 300);
  await page.locator('#rail-codex').screenshot({ path: `${OUT}/${lang}-codex.png` });
  await page.locator('#rail-writer').screenshot({ path: `${OUT}/${lang}-writer.png` });
  railOut.push(info);
}
await page.evaluate(() => document.querySelectorAll('.rail-host').forEach(n => n.remove()));

const PY = `
import sys
from PIL import Image
def profile(path):
    im = Image.open(path).convert('L')
    w,h = im.size
    px = im.load()
    cols = []
    for x in range(w):
        ink = sum(1 for y in range(h) if px[x,y] < 128)
        cols.append(ink)
    # ink rows, to know the real vertical extent of the drawing
    rows = [y for y in range(h) if any(px[x,y] < 128 for x in range(w))]
    span = (rows[-1]-rows[0]+1) if rows else 0
    best = max(cols) if cols else 0
    return w,h,span,best, (best/span if span else 0)
for p in sys.argv[1:]:
    w,h,span,best,frac = profile(p)
    print(f"{p.split('/')[-1]:28s} img={w}x{h} inkRows={span} tallestColumn={best} coverage={frac:.3f}")
`;
await writeFile(`${OUT}/rail.py`, PY);
console.log('\nRAIL CONTINUITY — tallest single ink column / total ink height');
console.log('(the codex fuses stems into one unbroken rail: coverage ~1.0)');
const args = [`${OUT}/rail.py`];
for (const r of railOut) args.push(`${OUT}/${r.lang}-codex.png`, `${OUT}/${r.lang}-writer.png`);
const py = execFileSync('python3', args, { encoding: 'utf8' });
console.log(py.trim());
for (const r of railOut) console.log(`   ${r.lang} [${r.flow}] word="${r.word}" glyphs=${JSON.stringify(r.keys)}`);
console.log(`   screenshots: ${OUT}`);

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(`VERDICT: ${allOK && errors.length === 0 ? 'PASS' : 'FAIL'}`);
await browser.close();
await srv.close();
