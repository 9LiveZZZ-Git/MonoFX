// TX-7 — HIGHLIGHT -> TRANSLATE, through the real UI, for EVERY tongue.
//
// Not covered by the existing probes: they exercise two or three tongues by
// hand. This one walks the ENTIRE tongue inventory the engine advertises
// (window.tenebrae.langs) through the genuine selection -> contextmenu ->
// "Translate ..." -> action-sheet path, and for each resulting span proves the
// four things TX-7 requires it to store:
//   src   exact English selection, byte-for-byte (case + punctuation)
//   lang  the tongue that was tapped
//   rom   byte-identical to the CODEX's own compiler (compileText / translateE2C)
//   scr   script form whose PUA run decodes back to the CODEX's own glyph keys
// plus: the selection is consumed from the prose (no duplicate English left
// behind), the span is contenteditable=false, carries the codex's own flow,
// renders as TEXT in a forged/real script face (zero <svg>, zero Latin), and
// survives into the persisted scene doc.
//
// Round 2 re-runs three tongues on a capitalised, punctuated, apostrophed
// selection to prove data-src fidelity is not normalised.
//
// Run: cd probes && node tx-select-translate-all.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500); // embedded engine wake + forge

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, ok ? '' : (extra === undefined ? '' : extra)); };

// ---- the tongue inventory the app itself advertises ----
const langs = await page.evaluate(async () => (await window.tenebrae.langs()).langs);
console.log('tongues advertised by the app:', langs.map(l => `${l.id}/${l.name}`).join(', '));
ck('engine advertises the full codex inventory (6 tongues)', langs.length === 6, langs.length + '');

// ---- ground truth straight from the codex, never from the writer ----
const codexTruth = (langId, src) => page.evaluate(async ({ id, text }) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  if(id === 'celan_basic'){
    const parts = w.translateE2C(String(text));
    const kept = parts.filter(p => p.cel && !p.drop);
    return { rom: kept.map(p => p.cel).join(' '), flow: 'ltr', keys: null };
  }
  const T = C.TRANS[id], sc = T.L.script;
  const res = C.compileText(T, String(text), 'e2l');
  const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
  const rom = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
  // the codex's own tokenizer, per romanized word -> glyph keys
  const matcher = C.makeMatcher(sc);
  // the codex draws cleanText: translatable parts only (p.u dropped), each word
  // stripped of everything outside [letters, digits, ' \u2019 -] before matching
  const keys = [];
  for(const l of lines) for(const p of l){
    if(p.u) continue;
    for(const word of String(p.t).split(/\s+/).filter(Boolean)){
    const s = String(word).toLowerCase().replace(/[^\p{L}\p{N}'\u2019-]/gu, ''); const o = []; let i = 0;
    while(i < s.length){
      let hit = null;
      for(const k of matcher.keys) if(s.startsWith(k, i)){ hit = k; break; }
      if(hit){ o.push(hit); i += hit.length; } else { if(/\S/.test(s[i])) o.push('·'); i++; }
    }
    if(o.length) keys.push(o);
    }
  }
  return { rom, flow: C.scriptDir(sc), keys };
}, { id: langId, text: src });

// decode a span's PUA run back to codex glyph keys using the forge base table
const decodeSpan = (langId, scr) => page.evaluate(async ({ id, s }) => {
  const w = await window.tenebrae.engine();
  const sc = w.CODEX.TRANS[id].L.script;
  const f = window.tenebrae._forge.map()[id];
  if(!f) return null;
  return String(s).split(/[\n ]+/).filter(Boolean).map(word => [...word].map(c => {
    const i = c.charCodeAt(0) - f.base;
    return (i >= 0 && i < sc.glyphs.length) ? sc.glyphs[i].k.toLowerCase()
         : (i === sc.glyphs.length ? '·' : `?${c.charCodeAt(0).toString(16)}`);
  }));
}, { id: langId, s: scr });

const spanInfo = idx => page.evaluate(i => {
  const sp = document.querySelectorAll('#ed-content .tspan')[i];
  if(!sp) return null;
  const cs = getComputedStyle(sp);
  const txt = sp.textContent;
  const letters = [...txt].filter(c => /\S/.test(c));
  return {
    lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, scr: sp.dataset.scr || null,
    omni: sp.dataset.omni || null, flow: sp.dataset.flow || null, dir: sp.getAttribute('dir'),
    ce: sp.getAttribute('contenteditable'), text: txt, textIsScr: txt === sp.dataset.scr,
    svg: sp.querySelectorAll('svg').length,
    puaShare: letters.length ? letters.filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length / letters.length : 0,
    latin: /[A-Za-z]/.test(txt),
    family: cs.fontFamily, writingMode: cs.writingMode, direction: cs.direction,
  };
}, idx);

const prose = () => page.evaluate(() => {
  const c = document.querySelector('#ed-content').cloneNode(true);
  c.querySelectorAll('.tspan').forEach(t => t.remove());
  return c.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
});

// ---- build the page: one paragraph per tongue ----
const ROUND1 = [
  ['Celan Basic',  'celan_basic',  'the sea remembers',  'and the sea remembers a drowned name'],
  ['Celan High',   'celan_high',   'sealed writ',        'the sealed writ waits behind the door'],
  ['Kerrackian',   'kerrackian',   'long road',          'the long road bends toward the fallen gate'],
  ['Kildaren',     'kildaren',     'drover walks',       'the drover walks his cattle to the notch'],
  ['Calgridarian', 'calgridarian', 'cold iron',          'the cold iron rings against the spike'],
  ['Evernessian',  'evernessian',  'green leaf',         'the green leaf turns in the round water'],
];

await createBook(page, 'TX7 Loop Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
for(const [, , , line] of ROUND1){ await page.keyboard.press('Enter'); await page.keyboard.type(line); }
await wait(page, 900);
const proseBefore = await prose();

let idx = 0;
for(const [label, id, phrase] of ROUND1){
  await insertTranslationSpan(page, phrase, label);
  await wait(page, 700);
  const s = await spanInfo(idx);
  if(!s){ ck(`${label}: span created`, false, 'no span'); idx++; continue; }
  const truth = await codexTruth(id, phrase);
  const tag = `${label} [${truth.flow}]`;

  ck(`${tag}: span carries the tapped tongue`, s.lang === id, `${s.lang}`);
  ck(`${tag}: span stores the exact English source`, s.src === phrase, JSON.stringify(s.src));
  ck(`${tag}: romanization is byte-identical to the codex compiler`, s.rom === truth.rom,
     `${JSON.stringify(s.rom)} != ${JSON.stringify(truth.rom)}`);
  ck(`${tag}: span stores a script form and renders it`, !!s.scr && s.textIsScr, `scr=${!!s.scr} textIsScr=${s.textIsScr}`);
  ck(`${tag}: script is TEXT, no svg, no Latin`, s.svg === 0 && !s.latin && s.puaShare >= 0.9,
     `svg=${s.svg} latin=${s.latin} pua=${Math.round(s.puaShare * 100)}%`);
  ck(`${tag}: carries the codex's own flow`, (s.flow || 'ltr') === truth.flow, `${s.flow} vs ${truth.flow}`);
  ck(`${tag}: span is atomic (contenteditable=false, omni)`, s.ce === 'false' && s.omni === '1', `${s.ce}/${s.omni}`);
  ck(`${tag}: rendered in a real script face`, /Tenebrae/.test(s.family), s.family);
  if(truth.keys){
    const dec = await decodeSpan(id, s.scr);
    ck(`${tag}: PUA run decodes to the codex's own glyph keys`, JSON.stringify(dec) === JSON.stringify(truth.keys),
       `${JSON.stringify(dec)} != ${JSON.stringify(truth.keys)}`);
  }
  idx++;
}

ck('every tongue produced exactly one span', idx === ROUND1.length &&
   (await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length)) === ROUND1.length);

// selection consumed: the English is gone from the prose, exactly once each
const proseAfter = await prose();
const leftovers = ROUND1.filter(([, , phrase]) => proseAfter.includes(phrase)).map(r => r[2]);
ck('each highlighted phrase is consumed from the prose (no duplicate English)', leftovers.length === 0, leftovers.join(' | '));
ck('untouched prose survives the six insertions',
   proseBefore.split(' ').filter(w => !ROUND1.some(r => r[2].split(' ').includes(w))).every(w => proseAfter.includes(w)));

// persisted doc keeps every span with its four fields
await wait(page, 1200);
const persisted = await page.evaluate(() => window.tenebrae._omni.probe.sceneDoc());
const persistOK = ROUND1.every(([, id, phrase]) =>
  new RegExp(`data-lang="${id}"`).test(persisted) && persisted.includes(`data-src="${phrase}"`));
ck('persisted scene doc keeps every span (lang + src)', persistOK);
ck('persisted doc carries data-scr for every span', (persisted.match(/data-scr="/g) || []).length === ROUND1.length,
   (persisted.match(/data-scr="/g) || []).length + '');

// ---- round 2: source fidelity on capitalised / punctuated / apostrophed text ----
const closeSheet = async () => {
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && getComputedStyle(s).pointerEvents !== 'none') s.click(); });
  await wait(page, 400);
};
await closeSheet();
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const p = document.createElement('p');
  p.textContent = "He said, The King's Own Hand — twice! and left";
  ed.appendChild(p);
});
await wait(page, 400);
const R2 = [['Celan High', 'celan_high'], ['Kerrackian', 'kerrackian'], ['Kildaren', 'kildaren']];
const R2SRC = "The King's Own Hand — twice!";
for(const [label, id] of R2){
  await closeSheet();
  await insertTranslationSpan(page, R2SRC, label);
  await wait(page, 700);
  const n = await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length);
  const s = await spanInfo(n - 1);
  const truth = await codexTruth(id, R2SRC);
  ck(`${label} (hostile src): data-src is byte-exact`, s && s.src === R2SRC, s && JSON.stringify(s.src));
  ck(`${label} (hostile src): rom matches the codex`, s && s.rom === truth.rom, s && `${JSON.stringify(s.rom)} != ${JSON.stringify(truth.rom)}`);
  ck(`${label} (hostile src): still script text, no Latin`, s && s.svg === 0 && !s.latin && s.puaShare >= 0.9,
     s && `svg=${s.svg} latin=${s.latin} pua=${Math.round(s.puaShare * 100)}%`);
  // undo it so the next tongue selects the same plain phrase again
  await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); });
  await page.keyboard.press('Control+z');
  await wait(page, 500);
}

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-7 select->translate (all tongues)', checks.every(c => c[1]));
console.log(`${checks.filter(c => c[1]).length}/${checks.length} checks passed`);
await browser.close();
await srv.close();
