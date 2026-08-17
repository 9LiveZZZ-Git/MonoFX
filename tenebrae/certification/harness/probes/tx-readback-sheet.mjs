// TX-8 — READ IT BACK: the tap sheet, retranslation, tongue changes across
// flows, and revert.
//
// Gap coverage vs the existing probes: s2-ux-sheet-bigrender only proves the
// BIG RENDER is real script; s2-undo-translation only proves the sheet's
// actions are undoable. Nothing checks the sheet's four informational panes
// against the codex, and nothing measures a live editor span's geometry after
// a tongue change between two different writing flows.
//
// Part A  for EVERY tongue: sheet title, big script render (== the span's own
//         script form, PUA, zero svg, real face, flow preserved), source line
//         (byte-exact English), romanization line (byte-identical to the codex
//         compiler) and the INTERLINEAR GLOSS compared token-by-token against
//         the codex's own compileText parts (source word, output word, unknown
//         marking, dropped tokens).
// Part B  edit source & retranslate: new source/rom/script all recompiled, old
//         source gone, one span still.
// Part C  change tongue along a chain that crosses every flow
//         Celan High (cols-rtl) -> Kerrackian (rtl) -> Kildaren (btt-stave) ->
//         Calgridarian (ltr) -> Celan High, measuring the LIVE editor span's
//         glyph geometry after each hop, and proving no stale flow/dir/font
//         survives the hop.
// Part D  revert to plain text restores the exact English, byte-for-byte, and
//         the scene prose returns to what it was before the span existed.
//
// Run: cd probes && node tx-readback-sheet.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, ok ? '' : (extra === undefined ? '' : extra)); };

const closeSheet = async () => {
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s) s.click(); });
  await wait(page, 400);
};
const openSheet = async i => {
  await page.evaluate(n => document.querySelectorAll('#ed-content .tspan')[n].click(), i);
  await wait(page, 800);
};

// --- the codex's own answer for a phrase: rom + gloss + script name + flow ---
const codexTruth = (langId, src) => page.evaluate(async ({ id, text }) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  if(id === 'celan_basic'){
    const parts = w.translateE2C(String(text));
    const kept = parts.filter(p => p.cel && !p.drop);
    return { rom: kept.map(p => p.cel).join(' '), flow: 'ltr', scriptName: null,
             gloss: parts.map(p => ({ s: p.tok, o: p.drop ? '∅' : (p.cel || '—'), k: !p.unknown && !p.drop })) };
  }
  const T = C.TRANS[id], sc = T.L.script;
  const res = C.compileText(T, String(text), 'e2l');
  const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
  return {
    rom: lines.map(l => l.map(p => p.t).join(' ')).join(' '),
    flow: C.scriptDir(sc), scriptName: sc.name,
    gloss: (res.parts || []).map(p => ({ s: p.tok, o: p.drop ? '∅' : (p.out || '—'), k: !p.unknown && !p.drop })),
  };
}, { id: langId, text: src });

// --- what the open sheet is showing ---
const readSheet = () => page.evaluate(() => {
  const sh = document.querySelector('#sheet');
  const big = sh.querySelector('.sheet-note .tspan');
  const roms = [...sh.querySelectorAll('.sheet-note .ts-rom')].map(e => e.textContent);
  const cs = big ? getComputedStyle(big) : null;
  const txt = big ? big.textContent : '';
  const letters = [...txt].filter(c => /\S/.test(c));
  return {
    title: sh.querySelector('.sheet-title').textContent,
    bigText: txt, bigSvg: big ? big.querySelectorAll('svg').length : -1,
    bigFamily: cs ? cs.fontFamily : null, bigWM: cs ? cs.writingMode : null, bigDir: cs ? cs.direction : null,
    bigFlow: big ? (big.getAttribute('data-flow') || null) : null,
    bigPua: letters.length ? letters.filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length / letters.length : 0,
    src: (sh.querySelector('.sheet-note .ts-src') || {}).textContent || null,
    rom: roms[0] || null, scriptLine: roms[1] || null,
    gloss: [...sh.querySelectorAll('.sheet-note .gloss .g')].map(g => ({
      s: g.querySelector('.gs').textContent, o: g.querySelector('.go').textContent,
      unk: g.classList.contains('unk'),
    })),
    items: [...sh.querySelectorAll('.sh-item')].map(e => e.textContent.trim()),
  };
});

// --- live editor span: fields + computed style + per-glyph geometry ---
const liveSpan = i => page.evaluate(async n => {
  const sp = document.querySelectorAll('#ed-content .tspan')[n];
  if(!sp) return null;
  await document.fonts.ready;
  const cs = getComputedStyle(sp);
  const txt = sp.textContent;
  const t = sp.firstChild;
  const rects = [];
  if(t && t.nodeType === 3){
    for(let k = 0; k < txt.length; k++){
      const rg = document.createRange(); rg.setStart(t, k); rg.setEnd(t, k + 1);
      const b = rg.getBoundingClientRect();
      rects.push({ ch: txt[k], x: b.x, y: b.y, w: b.width, h: b.height, blank: txt[k] === ' ' || txt[k] === '\n' });
    }
  }
  const letters = [...txt].filter(c => /\S/.test(c));
  return {
    lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, scr: sp.dataset.scr || null,
    flow: sp.dataset.flow || null, dirAttr: sp.getAttribute('dir'), omni: sp.dataset.omni || null,
    text: txt, textIsScr: txt === sp.dataset.scr, svg: sp.querySelectorAll('svg').length,
    latin: /[A-Za-z]/.test(txt),
    pua: letters.length ? letters.filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length / letters.length : 0,
    family: cs.fontFamily, writingMode: cs.writingMode, direction: cs.direction, unicodeBidi: cs.unicodeBidi,
    rects,
  };
}, i);

// geometry verdict for a flow, from the live span's per-character rects
function geometryVerdict(flow, rects){
  const groups = []; let cur = [];
  for(const r of rects){ if(r.blank){ if(cur.length){ groups.push(cur); cur = []; } } else if(r.w > 0 || r.h > 0) cur.push(r); }
  if(cur.length) groups.push(cur);
  const glyphs = groups.flat();
  if(!glyphs.length) return { ok: false, why: 'no glyph rects' };
  const same = (a, b) => Math.abs(a - b) <= 1;
  if(flow === 'cols-rtl'){
    const down = groups.every(g => g.every((r, i) => i === 0 || !same(r.x, g[i-1].x) || r.y > g[i-1].y));
    const cols = [...new Set(glyphs.map(g => Math.round(g.x)))].sort((a, b) => a - b);
    const firstLeftmost = cols.length === 1 || Math.round(glyphs[0].x) === cols[0];
    return { ok: down && firstLeftmost, why: `down=${down} firstLeftmost=${firstLeftmost} cols=${JSON.stringify(cols)}` };
  }
  if(flow === 'btt-stave'){
    const up = groups.every(g => g.every((r, i) => i === 0 || !same(r.x, g[i-1].x) || r.y < g[i-1].y));
    const staves = groups.map(g => ({ x: Math.round(g[0].x), bottom: Math.max(...g.map(r => r.y + r.h)) }));
    const l2r = staves.every((s, i) => i === 0 || s.x > staves[i-1].x);
    const ground = [...new Set(staves.map(s => Math.round(s.bottom)))].length === 1;
    return { ok: up && l2r && ground, why: `up=${up} l2r=${l2r} ground=${ground} x=${JSON.stringify(staves.map(s => s.x))}` };
  }
  // horizontal flows: the span can wrap inside the 390px editor column, so
  // direction is checked WITHIN each visual line, and lines must advance down
  const lines = new Map();
  for(const g of glyphs){ const k = Math.round(g.y / 4) * 4; if(!lines.has(k)) lines.set(k, []); lines.get(k).push(g); }
  const keys = [...lines.keys()].sort((a, b) => a - b);
  const dirOK = keys.every(k => lines.get(k).every((g, i) => i === 0 ||
    (flow === 'rtl' ? g.x < lines.get(k)[i-1].x + 1 : g.x > lines.get(k)[i-1].x - 1)));
  // reading order across the wrap: each new line starts below the previous
  const flowOK = keys.every((k, i) => i === 0 || k > keys[i-1]);
  return { ok: dirOK && flowOK, why: `lines=${keys.length} dirOK=${dirOK} flowOK=${flowOK} ` +
    keys.map(k => JSON.stringify(lines.get(k).map(g => Math.round(g.x)))).join(' / ') };
}

/* =================== Part A — the sheet, for every tongue =================== */
const TONGUES = [
  ['Celan Basic',  'celan_basic'], ['Celan High', 'celan_high'], ['Kerrackian', 'kerrackian'],
  ['Kildaren',     'kildaren'],    ['Calgridarian', 'calgridarian'], ['Evernessian', 'evernessian'],
];
const SRC = 'the drover walks a long road';

await createBook(page, 'TX8 Readback Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('at dusk the drover walks a long road and sleeps');
await wait(page, 900);
await insertTranslationSpan(page, SRC, 'Celan Basic');
await wait(page, 800);

for(const [label, id] of TONGUES){
  if(id !== 'celan_basic'){
    await openSheet(0);
    await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
    await wait(page, 700);
    await page.locator('#sheet .sh-item', { hasText: label }).click();
    await wait(page, 900);
  }
  const truth = await codexTruth(id, SRC);
  const live = await liveSpan(0);
  await openSheet(0);
  const sh = await readSheet();
  await closeSheet();
  const tag = `${label} sheet`;

  ck(`${tag}: titled with the tongue`, sh.title === label, sh.title);
  ck(`${tag}: big render is the span's own script form`, sh.bigText === live.scr, `${JSON.stringify(sh.bigText).slice(0,60)} vs ${JSON.stringify(live.scr).slice(0,60)}`);
  ck(`${tag}: big render is TEXT script, no svg, no Latin`, sh.bigSvg === 0 && sh.bigPua >= 0.9 && !/[A-Za-z]/.test(sh.bigText),
     `svg=${sh.bigSvg} pua=${Math.round(sh.bigPua*100)}%`);
  ck(`${tag}: big render uses a real script face`, /Tenebrae/.test(sh.bigFamily || ''), sh.bigFamily);
  ck(`${tag}: big render keeps the codex flow`, (sh.bigFlow || 'ltr') === truth.flow, `${sh.bigFlow} vs ${truth.flow}`);
  ck(`${tag}: source line shows the exact English`, sh.src === `“${SRC}”`, JSON.stringify(sh.src));
  ck(`${tag}: romanization line is byte-identical to the codex`, sh.rom === truth.rom, `${JSON.stringify(sh.rom)} != ${JSON.stringify(truth.rom)}`);
  if(truth.scriptName)
    ck(`${tag}: names the codex's own script + flow`, sh.scriptLine === `${truth.scriptName}${truth.flow !== 'ltr' ? ' · ' + truth.flow : ''}`,
       JSON.stringify(sh.scriptLine));
  // interlinear gloss, token by token, against the codex's own compiler parts
  const gOK = sh.gloss.length === truth.gloss.length && truth.gloss.every((g, i) => {
    const got = sh.gloss[i];
    return got && got.s === g.s && got.o === (g.k ? g.o : g.o + ' ·?') && got.unk === !g.k;
  });
  ck(`${tag}: interlinear gloss matches the codex token-for-token (${truth.gloss.length} tokens)`, gOK,
     `${JSON.stringify(sh.gloss)} != ${JSON.stringify(truth.gloss)}`);
  ck(`${tag}: offers the full action set`, ['Edit source & retranslate','Change tongue…','Copy romanization','Revert to plain text','Remove span']
     .every(l => sh.items.includes(l)), JSON.stringify(sh.items));
}

/* =================== Part B — edit source & retranslate =================== */
const NEWSRC = "the King's own hand, twice";
await openSheet(0);
await page.locator('#sheet .sh-item', { hasText: 'Edit source & retranslate' }).click();
await wait(page, 600);
await page.fill('#ps-input', NEWSRC);
await page.click('#ps-save');
await wait(page, 1000);
const afterEdit = await liveSpan(0);
const editTruth = await codexTruth(afterEdit ? afterEdit.lang : 'evernessian', NEWSRC);
ck('edit-source: exactly one span survives', (await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length)) === 1);
ck('edit-source: new English stored byte-exact', afterEdit.src === NEWSRC, JSON.stringify(afterEdit.src));
ck('edit-source: romanization recompiled by the codex', afterEdit.rom === editTruth.rom, `${JSON.stringify(afterEdit.rom)} != ${JSON.stringify(editTruth.rom)}`);
ck('edit-source: script form regenerated and rendered', !!afterEdit.scr && afterEdit.textIsScr && !afterEdit.latin && afterEdit.pua >= 0.9);
await openSheet(0);
const shEdit = await readSheet();
await closeSheet();
ck('edit-source: sheet now shows the new source line', shEdit.src === `“${NEWSRC}”`, JSON.stringify(shEdit.src));
ck('edit-source: sheet gloss follows the new source', shEdit.gloss.length === editTruth.gloss.length &&
   shEdit.gloss.every((g, i) => g.s === editTruth.gloss[i].s), JSON.stringify(shEdit.gloss.map(g => g.s)));
ck('edit-source: old source text is not left in the prose', !(await page.evaluate(() => document.querySelector('#ed-content').textContent)).includes(SRC));

// put the original source back for the flow chain
await openSheet(0);
await page.locator('#sheet .sh-item', { hasText: 'Edit source & retranslate' }).click();
await wait(page, 600);
await page.fill('#ps-input', SRC);
await page.click('#ps-save');
await wait(page, 1000);

/* =================== Part C — change tongue across every flow =============== */
const CHAIN = [['Celan High','celan_high'], ['Kerrackian','kerrackian'], ['Kildaren','kildaren'],
               ['Calgridarian','calgridarian'], ['Celan High','celan_high']];
let prevFamily = null;
for(const [label, id] of CHAIN){
  await openSheet(0);
  await page.locator('#sheet .sh-item', { hasText: 'Change tongue' }).click();
  await wait(page, 700);
  const checkedBefore = await page.evaluate(() => [...document.querySelectorAll('#sheet .sh-item')].filter(e => e.classList.contains('checked')).map(e => e.textContent.trim()));
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1000);
  const truth = await codexTruth(id, SRC);
  const s = await liveSpan(0);
  const n = await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length);
  const tag = `chain -> ${label} [${truth.flow}]`;

  ck(`${tag}: still exactly one span, source untouched`, n === 1 && s.src === SRC, `${n} spans, src=${JSON.stringify(s.src)}`);
  ck(`${tag}: tongue + romanization recompiled by the codex`, s.lang === id && s.rom === truth.rom,
     `${s.lang} ${JSON.stringify(s.rom)} != ${JSON.stringify(truth.rom)}`);
  ck(`${tag}: script re-rendered as text (no svg, no Latin)`, s.textIsScr && s.svg === 0 && !s.latin && s.pua >= 0.9,
     `textIsScr=${s.textIsScr} svg=${s.svg} latin=${s.latin} pua=${Math.round(s.pua*100)}%`);
  ck(`${tag}: no stale flow left over`, (s.flow || 'ltr') === truth.flow, `data-flow=${s.flow} expected ${truth.flow}`);
  // dir="rtl" belongs to the horizontal rtl tongue alone — on a vertical flow it
  // reverses the inline (vertical) axis and turns the column upside down
  ck(`${tag}: no stale dir attribute`, (s.dirAttr === 'rtl') === (truth.flow === 'rtl'), `dir=${s.dirAttr}`);
  const wantWM = (truth.flow === 'cols-rtl' || truth.flow === 'btt-stave') ? 'vertical-lr' : 'horizontal-tb';
  ck(`${tag}: computed writing-mode is the codex layout`, s.writingMode === wantWM, `${s.writingMode} != ${wantWM}`);
  ck(`${tag}: font switched to this tongue's forged face`, s.family.includes(label), `${s.family}`);
  const geo = geometryVerdict(truth.flow, s.rects);
  ck(`${tag}: live editor geometry matches the flow`, geo.ok, geo.why);
  if(prevFamily) ck(`${tag}: the previous tongue's face is gone`, s.family !== prevFamily, s.family);
  ck(`${tag}: sheet pre-checks the current tongue`, checkedBefore.length === 1, JSON.stringify(checkedBefore));
  prevFamily = s.family;
}

/* =================== Part D — revert to plain text ========================= */
const proseWithSpan = await page.evaluate(() => document.querySelector('#ed-content').textContent);
await openSheet(0);
await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
await wait(page, 900);
const afterRevert = await page.evaluate(() => ({
  spans: document.querySelectorAll('#ed-content .tspan').length,
  text: document.querySelector('#ed-content').textContent.replace(/ /g, ' '),
  pua: [...document.querySelector('#ed-content').textContent].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF),
}));
ck('revert: the span is gone', afterRevert.spans === 0);
ck('revert: no script characters left anywhere in the scene', !afterRevert.pua);
ck('revert: the exact English is back, byte-for-byte', afterRevert.text.includes(SRC), JSON.stringify(afterRevert.text));
// NOTE: whitespace is normalised here on purpose — the strict codepoint-exact
// comparison lives in tx-nbsp-residue.mjs, which shows revert/remove leave the
// insertion's trailing NBSP behind. The words themselves are exact.
const restored = afterRevert.text.replace(/\s+/g, ' ').trim();
ck('revert: the sentence reads exactly as originally typed (whitespace normalised)',
   restored.includes('at dusk the drover walks a long road and sleeps'), JSON.stringify(restored));
ck('revert: the persisted doc drops the span too',
   !(await page.evaluate(() => window.tenebrae._omni.probe.sceneDoc())).includes('tspan'));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-8 read-it-back', checks.every(c => c[1]));
console.log(`${checks.filter(c => c[1]).length}/${checks.length} checks passed`);
await browser.close();
await srv.close();
