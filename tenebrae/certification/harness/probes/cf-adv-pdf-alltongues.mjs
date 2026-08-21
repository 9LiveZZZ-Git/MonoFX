// TX-10b ADVERSARY PROBE — every tongue on the page, not just three.
//
// The audit's hostile book carried celan_high (cols-rtl), kildaren (btt-stave)
// and kerrackian (rtl). TX-10b says "EVERY tongue on the page is embedded as a
// CIDFontType2". Three tongues were never put through the PDF at all:
//   calgridarian (ltr alphabet), evernessian (ltr alphabet) and celan_basic —
//   the Auric word-script, whose face is minted lazily and REBUILT as words are
//   written (auricRebuild, step1.html:3196), which is exactly the shape of a
//   stale-face bug.
// Two checks nothing else makes:
//   1. /W advances vs the embedded face's own hmtx. A Type0 viewer advances by
//      /W, the screen advances by hmtx. If they disagree the printed word is
//      not the word on screen. cf-pdfcheck2.py only checks /W ordering.
//   2. every /S_lang a page's content stream selects is in THAT page's
//      /Resources /Font.
// plus the standard identity: gid -> embedded cmap -> the codepoints the app
// shows, per flow (rtl reversed, the rest logical), and for celan_basic
// gid -> code -> the WORD the forge minted.
//
// Run: cd probes && node cf-adv-pdf-alltongues.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-all';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 400)); };

/* ---------- minimal PDF object reader (byte-exact) ---------- */
function objects(buf){
  const s = buf.toString('latin1');
  const objs = {};
  for(const m of s.matchAll(/(\d+) 0 obj\n/g)){
    const id = +m[1], start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    objs[id] = { body: s.slice(start, end), start };
  }
  return { s, objs };
}
function streamBytes(buf, s, o){
  const i = s.indexOf('stream\n', o.start);
  const len = +(/\/Length (\d+)/.exec(o.body) || [0, 0])[1];
  const b0 = i + 'stream\n'.length;
  return buf.subarray(b0, b0 + len);
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => ({ id: l.id, name: l.name })));
const LINES = {
  celan_basic:  'the sea remembers the old king',
  celan_high:   'a light upon the water',
  kerrackian:   'the stone gate is open',
  kildaren:     'winter comes to the north',
  calgridarian: 'the river runs to the sea',
  evernessian:  'her name was written in fire',
};

await createBook(page, 'All Tongues PDF');
await page.click('#ed-title'); await page.keyboard.type('Six Tongues');
await page.click('#ed-content');
const ids = Object.keys(LINES);
for(let i = 0; i < ids.length; i++){
  if(i) await page.keyboard.press('Enter');
  await page.keyboard.type(LINES[ids[i]]);
}
await wait(page, 600);
for(const id of ids){
  const name = (LANGS.find(l => l.id === id) || {}).name;
  await insertTranslationSpan(page, LINES[id], name);
  await wait(page, 1200);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 300);
}

const app = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#ed-content .tspan')].map(sp => ({
    lang: sp.dataset.lang, flow: sp.dataset.flow, src: sp.dataset.src, rom: sp.dataset.rom,
    codes: [...(sp.dataset.scr || '')].filter(c => c !== ' ' && c !== '\n').map(c => c.charCodeAt(0)),
  }));
  const F = window.tenebrae._forge.map() || {};
  const forge = {};
  for(const [k, v] of Object.entries(F)){
    forge[k] = { flow: v.flow, family: v.family, auric: !!v.auric,
                 codeMap: Object.fromEntries(Object.entries(v.codeMap || {}).map(([c, e]) => [c, [e.gid, e.adv]])),
                 order: v.order ? v.order.slice() : null,
                 words: v.words ? Object.fromEntries(Object.entries(v.words).map(([w, r]) => [w, r.code])) : null,
                 ttfLen: v.ttf ? v.ttf.length : 0 };
  }
  return { spans, forge };
});
console.log('spans:', app.spans.map(s => `${s.lang}/${s.flow}/${s.codes.length}`).join('  '));
ck('precondition: all six tongues produced a real script span',
   app.spans.length === 6 && app.spans.every(s => s.codes.length > 0),
   app.spans.map(s => s.lang + ':' + s.codes.length).join(' '));

const buf = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/six.pdf`, buf);
console.log('pdf bytes', buf.length);

/* ---------- parse ---------- */
const { s, objs } = objects(buf);
// page objects -> their own /Resources font map
const pages = Object.entries(objs).filter(([, o]) => /\/Type \/Page[^s]/.test(o.body));
const pageRes = pages.map(([id, o]) => {
  const map = {};
  for(const m of o.body.matchAll(/\/S_([a-z_]+) (\d+) 0 R/g)) map[m[1]] = +m[2];
  const cid = +(/\/Contents (\d+) 0 R/.exec(o.body) || [0, 0])[1];
  return { id: +id, map, cid };
});
// content streams -> which /S_lang each page selects, and the gid runs
const usedPerPage = pageRes.map(p => {
  const content = streamBytes(buf, s, objs[p.cid]).toString('latin1');
  const sel = new Set();
  const runs = [];
  for(const m of content.matchAll(/BT \/(S_[a-z_]+) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]+)> Tj ET/g)){
    const lang = m[1].slice(2);
    sel.add(lang);
    const hex = m[5];
    runs.push({ lang, size: +m[2], x: +m[3], y: +m[4],
                gids: hex.match(/.{4}/g).map(h => parseInt(h, 16)) });
  }
  return { page: p, sel: [...sel], runs };
});
const allRuns = usedPerPage.flatMap(p => p.runs);
const langsInPdf = [...new Set(allRuns.map(r => r.lang))].sort();
console.log('langs painted in the pdf:', langsInPdf.join(' '));
ck('every tongue in the book is actually painted as glyphs in the PDF',
   ids.slice().sort().join(' ') === langsInPdf.join(' '),
   `expected ${ids.slice().sort().join(' ')} | got ${langsInPdf.join(' ')}`);

// every selected font is in that page's own /Resources
let resBad = [];
for(const p of usedPerPage) for(const l of p.sel) if(!(l in p.page.map)) resBad.push(`page ${p.page.id} selects /S_${l} not in its /Resources`);
ck('every /S_lang a page selects is in that page\'s own /Resources /Font', resBad.length === 0, resBad.join('; '));

/* ---------- fonts ---------- */
const fontInfo = {};
for(const lang of langsInPdf){
  const t0id = pageRes[0].map[lang];
  const t0 = objs[t0id].body;
  const okT0 = /\/Subtype \/Type0/.test(t0) && /\/Encoding \/Identity-H/.test(t0);
  const dm = /\/DescendantFonts \[(\d+) 0 R\]/.exec(t0);
  const cid = objs[+dm[1]].body;
  const okCid = /\/Subtype \/CIDFontType2/.test(cid) && /\/CIDToGIDMap \/Identity/.test(cid);
  const W = {};
  const wm = /\/W \[(.*?)\] \/CIDToGIDMap/s.exec(cid);
  for(const m of (wm ? wm[1] : '').matchAll(/(\d+) \[(-?\d+)\]/g)) W[+m[1]] = +m[2];
  const desc = objs[+(/\/FontDescriptor (\d+) 0 R/.exec(cid))[1]].body;
  const ffid = +(/\/FontFile2 (\d+) 0 R/.exec(desc))[1];
  const ttf = streamBytes(buf, s, objs[ffid]);
  const path = `${OUT}/${lang}.ttf`;
  await writeFile(path, ttf);
  fontInfo[lang] = { okT0, okCid, W, path, bytes: ttf.length };
  ck(`${lang}: Type0 + Identity-H + CIDFontType2 + CIDToGIDMap /Identity`, okT0 && okCid, `${okT0} ${okCid}`);
}
const py = `
import sys, json, io
from fontTools.ttLib import TTFont
out={}
for a in sys.argv[1:]:
    lang,path=a.split('=',1)
    f=TTFont(path); f.ensureDecompiled()
    order=f.getGlyphOrder(); cm=f.getBestCmap()
    out[lang]={'numGlyphs':f['maxp'].numGlyphs,'upem':f['head'].unitsPerEm,
               'g2c':{order.index(n):c for c,n in cm.items()},
               'hmtx':{i:f['hmtx'].metrics[n][0] for i,n in enumerate(order)}}
print(json.dumps(out))
`;
await writeFile(`${OUT}/fi.py`, py);
const FI = JSON.parse(execFileSync('python3', [`${OUT}/fi.py`, ...langsInPdf.map(l => `${l}=${fontInfo[l].path}`)]).toString());
for(const l of langsInPdf) console.log(`   ${l}: ${fontInfo[l].bytes}B numGlyphs=${FI[l].numGlyphs} cmap=${Object.keys(FI[l].g2c).length} upem=${FI[l].upem}`);
ck('every embedded FontFile2 decompiles under fontTools', langsInPdf.every(l => FI[l].numGlyphs > 1));

// 1. /W vs the face's own hmtx
const wBad = [];
for(const l of langsInPdf){
  const f = FI[l], scale = 1000 / f.upem;
  for(const [g, w] of Object.entries(fontInfo[l].W)){
    const h = f.hmtx[g];
    if(h === undefined){ wBad.push(`${l}: /W gid ${g} not in hmtx`); continue; }
    if(Math.abs(h * scale - w) > 1) wBad.push(`${l}: gid ${g} /W ${w} vs hmtx ${h}`);
  }
}
ck('every /W advance equals the embedded face\'s own hmtx advance (paper matches screen)',
   wBad.length === 0, wBad.slice(0, 6).join('; '));

// 2. gid -> cmap -> the codepoints the app shows, per flow
for(const sp of app.spans){
  const f = FI[sp.lang];
  const got = allRuns.filter(r => r.lang === sp.lang).flatMap(r => r.gids).map(g => f.g2c[g]);
  const want = sp.codes;
  const wantSeq = sp.flow === 'rtl' ? want.slice().reverse() : want;
  const same = got.length === wantSeq.length && got.every((c, i) => c === wantSeq[i]);
  ck(`${sp.lang} (${sp.flow}): every glyph id decodes through the embedded cmap to exactly what the app shows`,
     same, `pdf ${got.length} / app ${want.length}` + (same ? '' : ` | pdf ${JSON.stringify(got.slice(0, 8))} want ${JSON.stringify(wantSeq.slice(0, 8))}`));
  ck(`${sp.lang}: no .notdef and no gid the face lacks`,
     allRuns.filter(r => r.lang === sp.lang).every(r => r.gids.every(g => g > 0 && g < f.numGlyphs)));
}

// 3. celan_basic: gid -> code -> the WORD the forge minted (face is not stale)
const A = app.forge.celan_basic;
const basicSpan = app.spans.find(s => s.lang === 'celan_basic');
if(A && basicSpan){
  const f = FI.celan_basic;
  const gids = allRuns.filter(r => r.lang === 'celan_basic').flatMap(r => r.gids);
  const words = gids.map(g => {
    const code = f.g2c[g];
    const w = Object.entries(A.words || {}).find(([, c]) => c === code);
    return w ? w[0] : `?${code}`;
  });
  const expect = basicSpan.codes.map(c => (Object.entries(A.words).find(([, cc]) => cc === c) || ['?'])[0]);
  console.log('   auric words from the PDF:', words.join(' '));
  ck('celan_basic: every rune in the PDF decodes to the exact word the forge minted',
     words.join(' ') === expect.join(' ') && words.every(w => !w.startsWith('?')),
     `${words.join(' ')} || ${expect.join(' ')}`);
  ck('celan_basic: the embedded face carries the whole current mint (not a stale rebuild)',
     f.numGlyphs === A.order.length + 2, `numGlyphs ${f.numGlyphs} vs order ${A.order.length} + 2`);
}else ck('celan_basic reached the PDF at all', false, 'no auric span or no forge entry');

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b ALL SIX TONGUES IN THE PDF', checks.every(c => c[1]));
await browser.close();
await srv.close();
