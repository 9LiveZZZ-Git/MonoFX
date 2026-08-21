// TX-6 / TX-5 GAP PROBE — the canonical layout at the point where it is
// hardest: ONE VERY LONG WORD, and the two display modes the author can turn
// on from the tap sheet.
//
// tx-layout-geometry proves the flows on a long PHRASE — many short words. The
// clause TX-6 also carries is "long words", and the cols-rtl rule caps a column
// at `max-height:var(--tsrun,22em)` (step1.html:2508, 3365) with
// `word-break:break-all`. The longest single word this codex produces from
// ordinary English is 21 glyph cells ("sa-aevolanodorotiarnus", Celan High) —
// one cell under the cap. Nothing has ever measured it, and nothing has ever
// measured the layout with `data-size="xl"` or `data-block="1"` set, both of
// which are one tap away and both of which change the box the column lives in.
//
// Asserted on the REAL span the REAL editor produced:
//   cols-rtl   the 21-cell word is ONE column, hanging from the shared ceiling,
//              stacked with zero gap, columns advancing left->right
//   btt-stave  the 20-cell Kildaren word is ONE stave, standing on the shared
//              ground, running bottom-up
//   both hold again at Script size = Huge and at Full width = on
//   TX-5       that long word's PUA run decodes to exactly the codex's own
//              matchWord glyph keys
// Plus a DIAGNOSTIC (no verdict) on a run past the 22em cap.
//
// Run: cd probes && node cf-script-longword-layout.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const PHRASE = 'the sea remembers the old king';
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1400 });
await wait(page, 3500);

// per-character client rects for the span's script text, grouped by word unit
const MEASURE = `(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return { err: 'no span' };
  const tn = sp.firstChild;
  const s = sp.textContent;
  const units = []; let cur = [];
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(c === '\\n' || c === ' '){ if(cur.length){ units.push(cur); cur = []; } continue; }
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1);
    const b = r.getBoundingClientRect();
    cur.push({ i, x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height });
  }
  if(cur.length) units.push(cur);
  const cs = getComputedStyle(sp);
  return { units, flow: sp.dataset.flow || 'ltr', lang: sp.dataset.lang,
           scr: sp.dataset.scr, size: sp.dataset.size || '', block: sp.dataset.block || '',
           css: { wm: cs.writingMode, dir: cs.direction, fam: cs.fontFamily, fs: cs.fontSize },
           svg: sp.querySelectorAll('svg,img,canvas').length };
})()`;

function analyse(m){
  const longest = m.units.reduce((a, u) => u.length > a.length ? u : a, m.units[0]);
  const li = m.units.indexOf(longest);
  const out = { nUnits: m.units.length, longestLen: longest.length, longestIdx: li, lens: m.units.map(u => u.length) };
  if(m.flow === 'cols-rtl' || m.flow === 'btt-stave'){
    // one column/stave per word: all of a word's cells share one x band
    out.oneColumnPerWord = m.units.every(u => Math.max(...u.map(c => c.x)) - Math.min(...u.map(c => c.x)) <= 1.5);
    const cx = m.units.map(u => u.reduce((s, c) => s + c.x, 0) / u.length);
    out.colXs = cx.map(v => +v.toFixed(1));
    out.advanceLR = cx.every((v, i) => i === 0 || v > cx[i - 1] + 1);
    // stacking gap inside each word
    let gap = 0;
    for(const u of m.units) for(let i = 1; i < u.length; i++)
      gap = Math.max(gap, m.flow === 'btt-stave' ? Math.abs(u[i - 1].y - u[i].b) : Math.abs(u[i].y - u[i - 1].b));
    out.maxGap = +gap.toFixed(2);
    if(m.flow === 'cols-rtl'){
      out.tops = m.units.map(u => +u[0].y.toFixed(1));
      out.ceiling = Math.max(...out.tops) - Math.min(...out.tops) <= 1.5;
      out.runsDown = m.units.every(u => u.every((c, i) => i === 0 || c.y > u[i - 1].y));
    }else{
      out.bottoms = m.units.map(u => +u[0].b.toFixed(1));   // first letter = lowest
      out.ground = Math.max(...out.bottoms) - Math.min(...out.bottoms) <= 1.5;
      out.runsUp = m.units.every(u => u.every((c, i) => i === 0 || c.y < u[i - 1].y));
    }
  }
  return out;
}

async function run(langLabel, langId, flow){
  await createBook(page, `Longword ${langId}`);
  await page.click('#ed-content');
  await page.keyboard.type('opening line');
  await page.keyboard.press('Enter');
  await page.keyboard.type(PHRASE);
  await wait(page, 400);
  await insertTranslationSpan(page, PHRASE, langLabel);
  await wait(page, 1400);

  const variants = {};
  const grab = async tag => {
    const m = await page.evaluate(MEASURE);
    if(m.err) throw new Error(m.err + ' @' + tag);
    variants[tag] = { m, a: analyse(m) };
    const a = variants[tag].a;
    console.log(`   [${langId}/${tag}] units=${a.nUnits} lens=${a.lens.join(',')} longest=${a.longestLen} ` +
      `oneCol=${a.oneColumnPerWord} lr=${a.advanceLR} gap=${a.maxGap} ` +
      (flow === 'cols-rtl' ? `ceiling=${a.ceiling} down=${a.runsDown}` : `ground=${a.ground} up=${a.runsUp}`) +
      ` fs=${m.css.fs} block=${m.block || '-'} size=${m.size || '-'}`);
  };
  await grab('normal');

  // Script size -> Huge, through the real tap sheet
  await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: 'Script size' }).click();
  await wait(page, 600);
  await page.locator('#sheet .sh-item', { hasText: 'Huge' }).click();
  await wait(page, 800);
  await grab('huge');

  // Full width -> on
  await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: 'Full width' }).click();
  await wait(page, 800);
  await grab('huge+block');

  await page.click('#ed-back'); await wait(page, 600);
  await page.click('#bk-back'); await wait(page, 600);
  return variants;
}

/* ---------------- cols-rtl: Celan High ---------------- */
const CH = await run('Celan High', 'celan_high', 'cols-rtl');
const chLong = CH.normal.a.longestLen;
ck('cols-rtl: the corpus really does produce a near-cap word (>=18 cells at 22em)',
   chLong >= 18, `longest word = ${chLong} cells`);
for(const [tag, v] of Object.entries(CH)){
  ck(`cols-rtl [${tag}]: one column per word, the long one included`, v.a.oneColumnPerWord, JSON.stringify(v.a.lens));
  ck(`cols-rtl [${tag}]: columns advance LEFT->RIGHT`, v.a.advanceLR, JSON.stringify(v.a.colXs));
  ck(`cols-rtl [${tag}]: all columns hang from a common ceiling`, v.a.ceiling, JSON.stringify(v.a.tops));
  ck(`cols-rtl [${tag}]: letters run DOWN, rail fuses (gap <= 0.5px)`, v.a.runsDown && v.a.maxGap <= 0.5, `gap=${v.a.maxGap}`);
  ck(`cols-rtl [${tag}]: script is TEXT in the forged face`, v.m.svg === 0 && /Tenebrae Omni/.test(v.m.css.fam), v.m.css.fam);
}
ck('cols-rtl: Huge really changed the type size', parseFloat(CH.huge.m.css.fs) > parseFloat(CH.normal.m.css.fs),
   `${CH.normal.m.css.fs} -> ${CH.huge.m.css.fs}`);

/* ---------------- btt-stave: Kildaren ---------------- */
const KD = await run('Kildaren', 'kildaren', 'btt-stave');
ck('btt-stave: the corpus really does produce a near-cap word (>=15 cells)',
   KD.normal.a.longestLen >= 15, `longest word = ${KD.normal.a.longestLen} cells`);
for(const [tag, v] of Object.entries(KD)){
  ck(`btt-stave [${tag}]: one stave per word, the long one included`, v.a.oneColumnPerWord, JSON.stringify(v.a.lens));
  ck(`btt-stave [${tag}]: staves advance LEFT->RIGHT`, v.a.advanceLR, JSON.stringify(v.a.colXs));
  ck(`btt-stave [${tag}]: all staves stand on common ground`, v.a.ground, JSON.stringify(v.a.bottoms));
  ck(`btt-stave [${tag}]: letters run BOTTOM-UP, rail fuses`, v.a.runsUp && v.a.maxGap <= 0.5, `gap=${v.a.maxGap}`);
}

/* ---------------- TX-5: decode the long word ---------------- */
const dec = await page.evaluate(async ([phrase, langs]) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX, F = window.tenebrae._forge;
  const out = [];
  for(const id of langs){
    const t = await window.tenebrae.translate2(id, phrase);
    const f = F.map()[id];
    const sc = C.TRANS[id].L.script;
    const matcher = C.makeMatcher(sc);
    const keys = sc.glyphs.map(g => g.k.toLowerCase());
    const scr = F.textForToks(id, t.toks || []) || '';
    const units = scr.split(/[\n ]/).filter(Boolean);
    // longest unit, decoded through the forge's own base
    const u = units.reduce((a, b) => b.length > a.length ? b : a, units[0]);
    const got = [...u].map(c => { const n = c.charCodeAt(0) - f.base; return n >= 0 && n < keys.length ? keys[n] : '·'; });
    // the codex's own word for that unit: cleanText words, cleaned + matched
    const cleanWords = (t.toks || []).filter(k => !k.sep && k.t && !k.u)
      .flatMap(k => String(k.t).split(/\s+/)).filter(Boolean)
      .map(x => x.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter(Boolean);
    const cand = cleanWords.map(cw => C.makeMatcher && matcher ? null : null);
    let want = null;
    for(const cw of cleanWords){
      const ks = (function(word, m){ const o=[]; let i=0; const ww=word.toLowerCase();
        while(i<ww.length){ let hit=null; for(const k of m.keys) if(ww.startsWith(k,i)){ hit=k; break; }
          if(hit){ o.push(hit); i+=hit.length; } else { o.push('·'); i++; } } return o; })(cw, matcher);
      if(ks.length === got.length && (!want || ks.join() === got.join())) want = ks;
      if(want && want.join() === got.join()) break;
    }
    out.push({ id, unitLen: u.length, got, want, ok: !!want && want.join() === got.join() });
  }
  return out;
}, [PHRASE, ['celan_high', 'kildaren', 'kerrackian', 'calgridarian', 'evernessian']]);
for(const d of dec) console.log(`   TX-5 ${d.id.padEnd(14)} len=${d.unitLen} ${d.ok ? 'ok' : 'MISMATCH'} got=${d.got.join('')} want=${(d.want||[]).join('')}`);
ck('TX-5: the longest word\'s PUA run decodes to the codex\'s own matchWord keys, every tongue',
   dec.every(d => d.ok), JSON.stringify(dec.filter(d => !d.ok).map(d => d.id)));

/* ---------------- DIAGNOSTIC: past the 22em cap ---------------- */
const over = await page.evaluate(() => {
  const f = window.tenebrae._forge.map().celan_high;
  const ed = document.querySelector('#ed-content') || document.body;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:800px';
  const rows = [];
  for(const n of [20, 22, 24, 30, 40]){
    const sp = document.createElement('span');
    sp.className = 'tspan'; sp.dataset.omni = '1'; sp.dataset.lang = 'celan_high'; sp.dataset.flow = 'cols-rtl';
    sp.textContent = String.fromCharCode(f.base).repeat(n);
    host.appendChild(sp); document.body.appendChild(host);
    const tn = sp.firstChild; const xs = new Set();
    for(let i = 0; i < n; i++){ const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1);
      xs.add(Math.round(r.getBoundingClientRect().left)); }
    rows.push({ cells: n, columns: xs.size });
    host.innerHTML = '';
  }
  host.remove();
  return rows;
});
console.log('DIAGNOSTIC — a single cols-rtl word of N cells occupies how many columns:');
for(const r of over) console.log(`   ${String(r.cells).padStart(3)} cells -> ${r.columns} column(s)`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('CF SCRIPT LONGWORD LAYOUT', checks.every(c => c[1]));
await browser.close();
await srv.close();
