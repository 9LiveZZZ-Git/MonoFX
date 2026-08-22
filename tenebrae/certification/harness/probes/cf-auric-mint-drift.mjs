// TX-4 / TX-6c GAP PROBE — the Auric word font's codepoints are SESSION-LOCAL
// and MINTED LAZILY, in the order words are first written. Nothing in the
// existing suite crosses a reload with the mint order deliberately permuted,
// which is the one thing that can make a stored data-scr mean a different word.
//
// The attack:
//   session 1 — scene A ("the sea remembers") is written first, so its words
//               take the low codepoints; scene B ("the old king waits") next.
//   reload    — the word map is empty again.
//   session 2 — open scene B ONLY. Its words now take the low codepoints, so
//               every code stored in scene A's doc now denotes a DIFFERENT word.
//   then      — export the whole book WITHOUT ever opening scene A, and open
//               scene A afterwards.
//
// Asserted:
//   1. the mint order really does permute across the reload (attack is live)
//   2. scene A's STORED doc carries the stale codes (hazard is real, not
//      hypothetical) — read out of the app's own backup JSON
//   3. the EPUB of a scene never opened this session decodes, through the
//      CURRENT word map, back to the right Auric words
//   4. the EPUB's embedded Auric TTF cmap covers every codepoint the EPUB uses
//      (TX-4 "its cmap covers every codepoint used")
//   5. opening scene A regenerates its data-scr to the live codes, and the
//      span still renders in the forged Auric face with textContent === scr
//
// Run: cd probes && node cf-auric-mint-drift.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cf-auric';
await mkdir(OUT, { recursive: true });

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };
const hex = s => [...s].map(c => c.charCodeAt(0).toString(16).toUpperCase()).join(' ');

const SCENE_A = 'the sea remembers';
const SCENE_B = 'the old king waits';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

/* ---------------- session 1: write A then B ---------------- */
await createBook(page, 'Drift Book');
await page.click('#ed-title'); await page.keyboard.type('Scene A');
await page.click('#ed-content');
await page.keyboard.type('alpha opener');
await page.keyboard.press('Enter');
await page.keyboard.type(SCENE_A);
await wait(page, 400);
await insertTranslationSpan(page, SCENE_A, 'Celan Basic');
await wait(page, 1600);
await page.click('#ed-back'); await wait(page, 600);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 700);
await page.click('#ed-title'); await page.keyboard.type('Scene B');
await page.click('#ed-content');
await page.keyboard.type('beta opener');
await page.keyboard.press('Enter');
await page.keyboard.type(SCENE_B);
await wait(page, 400);
await insertTranslationSpan(page, SCENE_B, 'Celan Basic');
await wait(page, 1800);

const s1 = await page.evaluate(() => {
  const A = window.tenebrae._forge.map().celan_basic;
  const sp = document.querySelector('#ed-content .tspan');
  return { order: A.order.slice(), codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])),
           bScr: sp && sp.dataset.scr };
});
console.log('session1 mint order:', s1.order.join(' '));
await page.click('#ed-back'); await wait(page, 800);

/* ---------------- reload; open scene B FIRST ---------------- */
await page.reload();
await wait(page, 4000);
await page.locator('#lib-list .row', { hasText: 'Drift Book' }).click(); await wait(page, 700);
const sceneRows = await page.locator('#bk-list .row[data-scene]').count();
console.log('scene rows:', sceneRows);
await page.locator('#bk-list .row[data-scene]').nth(1).click(); // Scene B
await wait(page, 2500);

const s2 = await page.evaluate(() => {
  const A = window.tenebrae._forge.map().celan_basic;
  const sp = document.querySelector('#ed-content .tspan');
  return { title: document.querySelector('#ed-bartitle').textContent,
           order: A.order.slice(), codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])),
           bScr: sp && sp.dataset.scr, bText: sp && sp.textContent };
});
console.log('session2 mint order (after opening Scene B only):', s2.order.join(' '), '=>', s2.title);
ck('setup: Scene B was opened first this session', /Scene B/.test(s2.title), s2.title);

// the attack is only meaningful if the mint order actually permuted
const permuted = s1.order.length && s2.order.length &&
  s1.order.slice(0, s2.order.length).join(' ') !== s2.order.join(' ');
ck('ATTACK LIVE: mint order permutes across the reload (codes now mean other words)',
   permuted, `s1=[${s1.order.join(' ')}] s2=[${s2.order.join(' ')}]`);
// name a code that changed meaning
const collide = s2.order.filter(w => s1.codes[w] != null && s1.codes[w] !== s2.codes[w]);
console.log('words whose codepoint moved:', collide.map(w => `${w}: U+${s1.codes[w].toString(16)}->U+${s2.codes[w].toString(16)}`).join(', '));

await page.click('#ed-back'); await wait(page, 600);
await page.click('#bk-back'); await wait(page, 600);

/* ---------------- 2. the stored doc still holds the stale codes ---------------- */
await page.click('#lib-more'); await wait(page, 500);
const [bdl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'Back up everything (.json)' }).click(),
]);
await bdl.saveAs(OUT + '/backup.json');
await wait(page, 500);
const backup = JSON.parse(await readFile(OUT + '/backup.json', 'utf8'));
const bk = (backup.books || backup.state && backup.state.books || []).find(b => /Drift Book/.test(b.title));
const scenes = bk.chapters[0].scenes;
const storedA = scenes[0].doc;
const storedScrA = (/data-scr="([^"]*)"/.exec(storedA) || [])[1] || '';
console.log('stored Scene A data-scr:', hex(storedScrA));
const s2code2word = Object.fromEntries(Object.entries(s2.codes).map(([w, c]) => [c, w]));
const storedDecode = [...storedScrA].filter(c => c.charCodeAt(0) >= 0xE800)
  .map(c => s2code2word[c.charCodeAt(0)] || '?');
console.log('stored codes read through the CURRENT map:', storedDecode.join(' '));
ck('HAZARD REAL: the un-opened scene\'s stored codes no longer denote its own words',
   storedDecode.join(' ') !== 'sea remembers' && storedDecode.join(' ') !== 'the sea remembers',
   `stored decodes to "${storedDecode.join(' ')}"`);

/* ---------------- 3+4. export the book without opening Scene A ---------------- */
await page.locator('#lib-list .row', { hasText: 'Drift Book' }).click(); await wait(page, 800);
await page.click('#bk-share'); await wait(page, 600);
const [edl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await edl.path());
await writeFile(OUT + '/drift.epub', epub);
await wait(page, 600);
console.log('epub bytes:', epub.length);

function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map(); let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true), extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    if(method !== 0) throw new Error('unexpected compression on ' + name);
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    off += 30 + nameLen + extraLen + csize;
  }
  return files;
}
const files = unzipStored(epub);
const auricFileEarly = () => (/@font-face\{font-family:'Tenebrae Auric Runes';src:url\('([^']+)'\)/
  .exec(Buffer.from(files.get('OEBPS/style.css') || '').toString('utf8')) || [])[1];
const ch1 = Buffer.from(files.get('OEBPS/ch1.xhtml') || '').toString('utf8');
await writeFile(OUT + '/ch1.xhtml', ch1);
const spanRe = /<span class="tspan"([^>]*)>([\s\S]*?)<\/span>/g;
const eSpans = []; let m;
while((m = spanRe.exec(ch1))){
  const at = k => { const r = new RegExp(`${k}="([^"]*)"`).exec(m[1]); return r ? r[1] : null; };
  eSpans.push({ lang: at('data-lang'), src: at('data-src'), rom: at('data-rom'), text: m[2] });
}
console.log('epub spans:', JSON.stringify(eSpans.map(s => ({ src: s.src, codes: hex(s.text) }))));

// live map AFTER the export (syncScriptDoc mints during it)
const s3 = await page.evaluate(() => {
  const A = window.tenebrae._forge.map().celan_basic;
  return { order: A.order.slice(), codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])) };
});
const c2w = Object.fromEntries(Object.entries(s3.codes).map(([w, c]) => [c, w]));
console.log('post-export mint order:', s3.order.join(' '));

const decoded = eSpans.map(s => ({
  src: s.src,
  words: [...s.text].filter(c => c.charCodeAt(0) >= 0xE800).map(c => c2w[c.charCodeAt(0)] || `?U+${c.charCodeAt(0).toString(16)}`)
}));
for(const d of decoded) console.log(`   "${d.src}" -> ${d.words.join(' ')}`);
// The EPUB carries its own font, and a reader has nothing else: the only
// question that means anything about a FILE is whether the codepoint in its
// text draws the rune for the right word. Decoding the file's codepoints
// through the SESSION's map answers a different question — an export builds its
// own ordering, on purpose, so that two exports of the same state are the same
// bytes whatever the session did first. So compare OUTLINES: the glyph the
// embedded face draws for each codepoint, against the glyph the live face draws
// for the word that codepoint is supposed to be.
const expected = await page.evaluate(async srcs => {
  const out = {};
  for(const src of srcs){
    const r = await window.tenebrae.translate2('celan_basic', src);
    // minting the words is the point: the live face must be able to draw them
    window.tenebrae._forge.textForToks('celan_basic', r.toks);
    out[src] = r.romanization.split(/\s+/).filter(Boolean)
      .map(w => w.replace(/[^\wéäí'-]/g, '').toLowerCase()).filter(Boolean);
  }
  return out;
}, eSpans.map(s => s.src));
console.log('expected:', JSON.stringify(expected));

const live = await page.evaluate(() => {
  const A = window.tenebrae._forge.map().celan_basic;
  let bin = '';
  for(const b of A.ttf) bin += String.fromCharCode(b);
  return { ttf: btoa(bin), codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])) };
});
await writeFile(OUT + '/live.ttf', Buffer.from(live.ttf, 'base64'));

// pair every codepoint the file writes with the live codepoint for the word it
// should be — same order, same length, or the run itself is wrong
const pairs = [];
let shapeOK = true, shapeWhy = '';
for(const sp of eSpans){
  const fileCodes = [...sp.text].filter(c => c.charCodeAt(0) >= 0xE800).map(c => c.charCodeAt(0));
  const words = expected[sp.src] || [];
  if(fileCodes.length !== words.length){
    shapeOK = false;
    shapeWhy += `"${sp.src}": ${fileCodes.length} runes for ${words.length} words; `;
    continue;
  }
  words.forEach((w, i) => {
    if(live.codes[w] == null){ shapeOK = false; shapeWhy += `"${w}" never minted live; `; return; }
    pairs.push([fileCodes[i], live.codes[w], w, sp.src]);
  });
}

let truthOK = false, truthDetail = shapeWhy || 'no auric font entry';
if(shapeOK && auricFileEarly()){
  await writeFile(OUT + '/auric.ttf', files.get('OEBPS/' + auricFileEarly()));
  const py = `
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
def outline(path, code):
    f = TTFont(path)
    cm = f.getBestCmap()
    if code not in cm: return None
    pen = RecordingPen()
    f.getGlyphSet()[cm[code]].draw(pen)
    return repr(pen.value)
pairs = ${JSON.stringify(pairs.map(p => [p[0], p[1], p[2], p[3]]))}
bad = []
for fc, lc, word, src in pairs:
    a = outline("${OUT}/auric.ttf", fc)
    b = outline("${OUT}/live.ttf", lc)
    if a is None: bad.append(word + ": U+%04X not in the EPUB face" % fc)
    elif b is None: bad.append(word + ": U+%04X not in the live face" % lc)
    elif a != b: bad.append(word + ": the EPUB draws a different rune (U+%04X vs live U+%04X)" % (fc, lc))
print(json.dumps({"checked": len(pairs), "bad": bad}))
`;
  await writeFile(OUT + '/outline.py', py);
  const out2 = execFileSync('python3', [OUT + '/outline.py'], { encoding: 'utf8' }).trim();
  console.log('outline check:', out2);
  const j2 = JSON.parse(out2);
  truthOK = j2.checked > 0 && j2.bad.length === 0;
  truthDetail = out2;
}
ck('EXPORT TRUTH: a scene never opened this session still exports the RIGHT Auric runes',
   truthOK, truthDetail);

// cmap coverage of the embedded Auric face against every code the EPUB uses
const fontNames = [...files.keys()].filter(n => /^OEBPS\/fonts\//.test(n));
const css = Buffer.from(files.get('OEBPS/style.css') || '').toString('utf8');
const auricFile = auricFileEarly();
console.log('fonts in epub:', fontNames.length, '| auric =', auricFile);
let cmapOK = false, cmapDetail = 'no auric font entry';
if(auricFile){
  await writeFile(OUT + '/auric.ttf', files.get('OEBPS/' + auricFile));
  const used = [...new Set(eSpans.flatMap(s => [...s.text]).filter(c => c.charCodeAt(0) >= 0xE000).map(c => c.charCodeAt(0)))];
  const py = `
import sys, json
from fontTools.ttLib import TTFont
f = TTFont("${OUT}/auric.ttf")
f.saveXML("${OUT}/auric.ttx")
cm = f.getBestCmap()
used = ${JSON.stringify(used)}
print(json.dumps({"tables": sorted(f.keys()), "n": len(cm),
                  "missing": [hex(u) for u in used if u not in cm]}))
`;
  await writeFile(OUT + '/cm.py', py);
  const out = execFileSync('python3', [OUT + '/cm.py'], { encoding: 'utf8' }).trim();
  console.log('fontTools:', out);
  const j = JSON.parse(out);
  cmapOK = j.missing.length === 0 && j.tables.includes('glyf') && j.tables.includes('cmap');
  cmapDetail = out;
}
ck('the EPUB\'s embedded Auric TTF decompiles and its cmap covers every codepoint used',
   cmapOK, cmapDetail);

/* ---------------- 5. now open Scene A ---------------- */
await page.click('#scrim').catch(() => {});
await wait(page, 400);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 2500);
const a = await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  const A = window.tenebrae._forge.map().celan_basic;
  return { title: document.querySelector('#ed-bartitle').textContent,
           scr: sp && sp.dataset.scr, text: sp && sp.textContent, rom: sp && sp.dataset.rom,
           family: sp && getComputedStyle(sp).fontFamily, svg: sp ? sp.querySelectorAll('svg,img,canvas').length : -1,
           codes: Object.fromEntries(A.order.map(w => [w, A.words[w].code])) };
});
const aDecode = [...(a.scr || '')].filter(c => c.charCodeAt(0) >= 0xE800)
  .map(c => Object.entries(a.codes).find(([, code]) => code === c.charCodeAt(0))?.[0] || '?');
console.log('Scene A on open:', a.title, '| scr', hex(a.scr || ''), '->', aDecode.join(' '), '| family', a.family);
ck('opening the drifted scene regenerates data-scr to the LIVE codepoints',
   JSON.stringify(aDecode) === JSON.stringify(expected[SCENE_A] || expected[Object.keys(expected)[0]]),
   `${aDecode.join(' ')} vs ${JSON.stringify(expected)}`);
ck('the regenerated span is still TEXT in the forged Auric face (no svg/img/canvas)',
   a.svg === 0 && /Tenebrae Auric Runes/.test(a.family) && a.text === a.scr, `${a.family} svg=${a.svg}`);
ck('the stale stored codes were actually replaced (not merely re-rendered)',
   (a.scr || '') !== storedScrA, `${hex(storedScrA)} -> ${hex(a.scr || '')}`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('CF AURIC MINT DRIFT', checks.every(c => c[1]));
await browser.close();
await srv.close();
