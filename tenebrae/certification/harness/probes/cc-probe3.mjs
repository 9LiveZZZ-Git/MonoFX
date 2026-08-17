// COVERAGE-CRITIC probe 3: real-UI span geometry — cols-rtl letter order,
// long-word column splitting, btt-stave word fusion.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const res = {};
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;font-size:20px;width:340px';
  document.body.appendChild(host);

  async function mk(lang, text) {
    const r = await window.tenebrae.translate2(lang, text);
    const scr = window.tenebrae._forge.textForToks(lang, r.toks || []);
    const sp = document.createElement('span');
    sp.className = 'tspan';
    sp.dataset.omni = '1';
    sp.dataset.lang = lang;
    sp.dataset.src = text;
    sp.dataset.rom = r.romanization;
    sp.dataset.scr = scr;
    if (r.flow && r.flow !== 'ltr') sp.dataset.flow = r.flow;
    if (r.dir === 'rtl') sp.setAttribute('dir', 'rtl');   // exactly what spanFromResult does
    sp.textContent = scr;
    host.innerHTML = '';
    host.appendChild(sp);
    await new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(r2)));
    return { sp, r, scr };
  }
  function charRects(sp) {
    const t = sp.firstChild;
    const rects = [];
    for (let i = 0; i < t.data.length; i++) {
      const rg = document.createRange();
      rg.setStart(t, i); rg.setEnd(t, i + 1);
      const b = rg.getBoundingClientRect();
      rects.push({ ch: t.data[i], cp: t.data.codePointAt(i).toString(16), x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
    }
    return rects;
  }

  // ---- 1. Celan High (cols-rtl): does dir="rtl" flip letters bottom-up? ----
  {
    const { sp, r, scr } = await mk('celan_high', 'the sea');
    res.colsShort = { rom: r.rom || r.romanization, dirAttr: sp.getAttribute('dir'), flow: sp.dataset.flow,
      computed: { wm: getComputedStyle(sp).writingMode, dir: getComputedStyle(sp).direction, ub: getComputedStyle(sp).unicodeBidi, wb: getComputedStyle(sp).wordBreak },
      rects: charRects(sp) };
  }
  // ---- 2. Celan High long phrase: column wrapping, words split? ----
  {
    const { sp, r, scr } = await mk('celan_high', 'the sea remembers the drowned dark and the gold sun and the fallen tower of the old city');
    const rects = charRects(sp);
    // group by column (x band)
    const cols = {};
    rects.forEach(t => { const k = Math.round(t.x / 5) * 5; (cols[k] = cols[k] || []).push(t.ch); });
    // find word boundaries in the string (spaces) and check whether any word spans 2 x-bands
    const words = []; let cur = [];
    rects.forEach((t, i) => { if (t.ch === ' ') { if (cur.length) words.push(cur); cur = []; } else cur.push(t); });
    if (cur.length) words.push(cur);
    const split = words.filter(wds => new Set(wds.map(t => Math.round(t.x))).size > 1);
    res.colsLong = { rom: r.romanization, nWords: words.length, nColX: Object.keys(cols).length,
      colXs: Object.keys(cols).map(Number).sort((a, b) => a - b),
      wordsSplitAcrossColumns: split.length,
      splitExample: split[0] ? split[0].map(t => ({ cp: t.cp, x: t.x, y: t.y })) : null };
  }
  // ---- 3. Kildaren btt-stave: staves per word, common ground ----
  {
    const { sp, r, scr } = await mk('kildaren', 'The Gold Sun rose over Doranthe');
    const rects = charRects(sp);
    const staves = {};
    rects.filter(t => t.ch !== '\n').forEach(t => { const k = Math.round(t.x); (staves[k] = staves[k] || []).push(t); });
    res.btt = { rom: r.romanization, scrWords: scr.split('\n').length,
      computed: { wm: getComputedStyle(sp).writingMode, dir: getComputedStyle(sp).direction, ws: getComputedStyle(sp).whiteSpace },
      staveXs: Object.keys(staves).map(Number).sort((a, b) => a - b),
      staveBottoms: Object.entries(staves).map(([x, ts]) => ({ x: +x, bottom: +Math.max(...ts.map(t => t.y + t.h)).toFixed(1), n: ts.length })),
      firstStaveOrder: (Object.values(staves)[0] || []).map(t => ({ cp: t.cp, y: t.y })) };
  }
  // ---- 4. Kerrackian rtl ----
  {
    const { sp, r } = await mk('kerrackian', 'the sea remembers');
    res.rtl = { rom: r.romanization, computed: { dir: getComputedStyle(sp).direction, ub: getComputedStyle(sp).unicodeBidi }, rects: charRects(sp).map(t => ({ cp: t.cp, x: t.x })) };
  }
  // ---- 5. celan_basic span provenance ----
  {
    const r = await window.tenebrae.translate2('celan_basic', 'the sea remembers');
    const forged = window.tenebrae._forge.map();
    res.celanBasic = { rom: r.romanization, forgedHas: Object.keys(forged), forgeText: window.tenebrae._forge.textForToks('celan_basic', r.toks || []) };
  }
  host.remove();
  return res;
});

console.log(JSON.stringify(out, null, 1));
console.log('pageerrors', errs);
await browser.close(); await srv.close();
