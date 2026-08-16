// X2-14 (gap coverage): vertical flow GEOMETRY — computed writing-mode alone
// (what the canonical probe checks) doesn't prove layout. Under the imported
// codex this probe measures real client rects:
//   - vertical spans must be TALLER than wide, glyphs stacking top-to-bottom
//   - cols-rtl columns must advance LEFTWARD, btt-stave staves RIGHTWARD
//   - words must map to columns: TWO words must produce TWO columns.
// FINDING baked into this probe's expectations: omniScriptText (step1.html
// ~2716-2740) groups script "words" by tk.sep tokens, and omniTranslate emits
// sep only between compileText LINES (sentence boundaries) — never between
// words; wordStr then joins a line's word tokens with ''. So the column
// mechanism (data-scr '\n' + white-space:pre-line) fires per SENTENCE, and a
// two-word phrase fuses into ONE unbroken column with the word boundary
// erased from the script text (contradicting the code's own comment "one
// column per word in vertical flows"). The word-level checks below are
// EXPECTED to fail until that is fixed; the sentence-level checks prove the
// column plumbing itself works.
// Run: cd probes && node s2-ux-vertical-geometry.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra || ''); };

// ---- import the codex (vertical flows only exist there) ----
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX_PATH);
await page.waitForFunction(() => /tongues awake/.test(document.querySelector('#toast').textContent), null, { timeout: 45000 });
await wait(page, 600);

// ---- discover the vertical tongues; verify source shapes via the engine ----
const TWO_WORDS = 'stone gate';                       // one sentence, two content words
const TWO_SENTS = 'the king waits. the gate opens.';  // two sentences -> 1 sep token
const plan = await page.evaluate(async ([w2, s2]) => {
  const { langs } = await window.tenebrae.langs();
  const out = {};
  for(const l of langs){
    const probe = await window.tenebrae.translate2(l.id, 'stone gate');
    if(!probe || (probe.flow !== 'cols-rtl' && probe.flow !== 'btt-stave')) continue;
    const a = await window.tenebrae.translate2(l.id, w2);
    const b = await window.tenebrae.translate2(l.id, s2);
    out[probe.flow] = { id: l.id, name: l.name,
      twoWords: { words: (a.toks || []).filter(k => !k.sep && k.t).length, seps: (a.toks || []).filter(k => k.sep).length, rom: a.romanization },
      twoSents: { words: (b.toks || []).filter(k => !k.sep && k.t).length, seps: (b.toks || []).filter(k => k.sep).length, rom: b.romanization } };
  }
  return out;
}, [TWO_WORDS, TWO_SENTS]);
console.log('plan:', JSON.stringify(plan, null, 1));
ck('both vertical flows present; two-word and two-sentence sources verified',
   !!(plan['cols-rtl'] && plan['btt-stave']) &&
   plan['btt-stave'].twoWords.words === 2 && plan['btt-stave'].twoWords.seps === 0 &&
   Object.values(plan).every(p => p.twoSents.seps === 1),
   JSON.stringify(Object.values(plan).map(p => `${p.id}: 2w=${p.twoWords.words}w/${p.twoWords.seps}s 2s=${p.twoSents.words}w/${p.twoSents.seps}s`)));

// ---- build a scene: for each vertical tongue, a two-word and a two-sentence span ----
await createBook(page, 'Vertical Geometry');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
const inserts = [];
for(const flow of ['cols-rtl', 'btt-stave']){
  inserts.push({ flow, kind: 'twoWords', src: TWO_WORDS, name: plan[flow].name });
  inserts.push({ flow, kind: 'twoSents', src: TWO_SENTS, name: plan[flow].name });
}
for(const [i, ins] of inserts.entries()){
  await page.keyboard.type(`line${i} alpha ${ins.src} omega${i}`);
  await page.keyboard.press('Enter');
}
await wait(page, 500);
for(const [i, ins] of inserts.entries()){
  const scoped = await page.evaluate(([marker, phrase]) => {
    const ed = document.querySelector('#ed-content');
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while((n = walker.nextNode())){
      if(!n.nodeValue.includes(marker)) continue;
      const at = n.nodeValue.indexOf(phrase);
      if(at < 0) return false;
      const r = document.createRange();
      r.setStart(n, at); r.setEnd(n, at + phrase.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
    return false;
  }, [`line${i} `, ins.src]);
  if(!scoped) throw new Error('could not scope selection for ' + ins.src);
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    sel.anchorNode.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(page, 400);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 600);
  await page.locator('#sheet .sh-item', { hasText: ins.name }).click();
  await wait(page, 700);
  ins.spanIndex = i;
}
await wait(page, 600);

// ---- measure: char-rect x-bands = real columns ----
// Bands/stacking are measured over PUA glyphs only: unmatched romanization
// chars (hyphens, periods) render as serif-fallback '·' inside the run, and
// a trailing '·' at the text-node tail reports a bogus Range rect in vertical
// writing modes (visually the column is continuous — screenshot-verified).
// Those fallback dots are themselves reported as `fallbackChars` evidence.
const geo = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(sp => {
  const rect = sp.getBoundingClientRect();
  const scr = sp.dataset.scr || '';
  const tn = [...sp.childNodes].find(n => n.nodeType === 3);
  const bands = [];
  let stackedOK = true;
  if(tn){
    let last = null;
    for(let i = 0; i < tn.nodeValue.length; i++){
      const code = tn.nodeValue.charCodeAt(i);
      if(code < 0xE000 || code > 0xF8FF) continue; // PUA script glyphs only
      const r = document.createRange();
      r.setStart(tn, i); r.setEnd(tn, i + 1);
      const b = r.getBoundingClientRect();
      if(b.width <= 0 || b.height <= 0) continue;
      const cx = b.x + b.width / 2;
      const band = bands.find(bd => Math.abs(bd.x - cx) < b.width * 0.6);
      if(band){
        if(last && Math.abs(last.x - cx) < b.width * 0.6 && b.top < last.top - 2) stackedOK = false;
        band.n++;
      } else bands.push({ x: cx, n: 1 });
      last = { x: cx, top: b.top };
    }
  }
  return { src: sp.dataset.src, flow: sp.dataset.flow || null, wm: getComputedStyle(sp).writingMode,
    ws: getComputedStyle(sp).whiteSpace, width: rect.width, height: rect.height,
    newlines: (scr.match(/\n/g) || []).length, scrHasSpace: /[\s]/.test(scr.replace(/\n/g, '')),
    fallbackChars: [...scr].filter(c => c !== '\n' && (c.charCodeAt(0) < 0xE000 || c.charCodeAt(0) > 0xF8FF)).length,
    columns: bands.length, bandXs: bands.map(b => Math.round(b.x)), stackedOK,
    svg: sp.querySelectorAll('svg').length };
}));
console.log('geometry:', JSON.stringify(geo, null, 1));
const find = (flow, src) => geo.find(g => g.flow === flow && g.src === src);
const cw = find('cols-rtl', TWO_WORDS), cs = find('cols-rtl', TWO_SENTS);
const bw = find('btt-stave', TWO_WORDS), bs = find('btt-stave', TWO_SENTS);

// -- universal vertical geometry --
ck('all four vertical spans exist as svg-free TEXT', [cw, cs, bw, bs].every(g => g && g.svg === 0));
ck('vertical spans are TALLER than wide', [cw, cs, bw, bs].every(g => g && g.height > g.width),
   JSON.stringify([cw, cs, bw, bs].map(g => g && `${Math.round(g.width)}x${Math.round(g.height)}`)));
ck('glyphs stack top-to-bottom within columns', [cw, cs, bw, bs].every(g => g && g.stackedOK));
ck('writing modes: cols-rtl=vertical-rl, btt-stave=vertical-lr, pre-line',
   cw && cw.wm === 'vertical-rl' && bw && bw.wm === 'vertical-lr' && [cw, cs, bw, bs].every(g => /pre-line/.test(g.ws)));

// -- the column mechanism works at SENTENCE granularity --
ck('two SENTENCES produce two columns (mechanism: data-scr newline + pre-line)',
   cs && cs.newlines === 1 && cs.columns === 2 && bs && bs.newlines === 1 && bs.columns === 2,
   `cols-rtl ${cs && cs.columns}c/${cs && cs.newlines}nl, btt ${bs && bs.columns}c/${bs && bs.newlines}nl`);
ck('cols-rtl columns advance LEFTWARD', cs && cs.columns === 2 && cs.bandXs[0] > cs.bandXs[1], cs && JSON.stringify(cs.bandXs));
ck('btt-stave staves advance RIGHTWARD', bs && bs.columns === 2 && bs.bandXs[0] < bs.bandXs[1], bs && JSON.stringify(bs.bandXs));

// -- REQUIRED word-level geometry: two WORDS must produce two columns --
ck('REQUIRED: two words -> two columns (btt-stave "stone gate")', bw && bw.columns === 2,
   bw && `columns=${bw.columns} newlines=${bw.newlines} (words fused)`);
ck('REQUIRED: word boundary survives in the script text (separator present)',
   bw && (bw.newlines >= 1 || bw.scrHasSpace),
   bw && `data-scr carries ${bw.newlines} newlines, space=${bw.scrHasSpace} for a 2-word source`);
ck('REQUIRED: cols-rtl multi-word line breaks into word columns', cw && cw.columns > 1,
   cw && `columns=${cw.columns} for a ${plan['cols-rtl'].twoWords.words}-script-word line`);

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('X2-14 vertical-geometry', checks.every(c => c[1]));
await browser.close();
await srv.close();
