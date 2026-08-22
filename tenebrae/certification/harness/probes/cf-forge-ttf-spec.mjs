// TX-4 STATIC+FUNCTIONAL GAP PROBE — the forged TTFs read against the
// TrueType spec itself, including the two faces nobody has ever opened:
// the EMPTY Auric face the forge mints at boot (step1.html:3272 — auricRebuild()
// runs with zero words) and the same face after one word.
//
// tx-font-forge asks fontTools to decompile and checks cmap coverage and
// checksums. It never checks the table LENGTHS against the spec's fixed table
// sizes, never checks the directory ordering rule, never checks that head's
// bounding box is well-formed, and never opens a zero-glyph face — which is a
// state only the word script can be in.
//
// Also verifies the assumption forgeFlattenPath is built on (step1.html:2940):
// it understands only absolute M/L/H/V/C/Q. Any Z, A, S, T or relative command
// in a codex glyph path would be silently dropped, so the claim is checked
// against the codex's OWN glyph data, all five scripts.
//
// Run: cd probes && node cf-forge-ttf-spec.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cf-forge';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : x); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

/* ---- 1. the path grammar forgeFlattenPath assumes, checked against the codex ---- */
const paths = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const out = { langs: [], badCmds: [], nGlyphs: 0, sample: null };
  for(const id of ['celan_high', 'kerrackian', 'kildaren', 'calgridarian', 'evernessian']){
    const sc = C.TRANS[id] && C.TRANS[id].L && C.TRANS[id].L.script;
    if(!sc) continue;
    out.langs.push(id);
    for(const g of sc.glyphs){
      out.nGlyphs++;
      if(!out.sample) out.sample = g.d;
      for(const m of String(g.d).match(/[A-Za-z]/g) || [])
        if(!/[MLHVCQ]/.test(m)) out.badCmds.push(`${id}/${g.k}:${m}`);
    }
  }
  return out;
});
console.log('codex glyph paths:', paths.nGlyphs, 'across', paths.langs.join(','), '| sample:', String(paths.sample).slice(0, 70));
ck('every codex glyph path uses only the absolute M/L/H/V/C/Q that forgeFlattenPath parses',
   paths.badCmds.length === 0 && paths.nGlyphs > 100, JSON.stringify(paths.badCmds.slice(0, 10)));

/* ---- 2. dump every forged face, plus the EMPTY Auric face ---- */
const dump = async tag => {
  const map = await page.evaluate(() => {
    const m = window.tenebrae._forge.map() || {};
    const out = {};
    for(const [id, f] of Object.entries(m)){
      const t = f.ttf;
      if(!t) { out[id] = { family: f.family, b64: null, words: f.order ? f.order.length : null }; continue; }
      let s = '';
      for(let i = 0; i < t.length; i += 0x8000) s += String.fromCharCode.apply(null, t.subarray(i, i + 0x8000));
      out[id] = { family: f.family, b64: btoa(s), words: f.order ? f.order.length : null };
    }
    return out;
  });
  const files = [];
  for(const [id, v] of Object.entries(map)){
    if(!v.b64) { console.log(`   (${tag}) ${id}: no ttf`); continue; }
    const p = `${OUT}/${tag}-${id}.ttf`;
    await writeFile(p, Buffer.from(v.b64, 'base64'));
    files.push({ id, family: v.family, path: p, words: v.words, bytes: Buffer.from(v.b64, 'base64').length });
  }
  return files;
};
const boot = await dump('boot');
for(const f of boot) console.log(`   boot ${f.id.padEnd(14)} ${String(f.bytes).padStart(7)}B words=${f.words}`);
const emptyAuric = boot.find(f => f.id === 'celan_basic');
ck('the boot-time Auric face exists and holds zero words (the state only a word script can be in)',
   !!emptyAuric && emptyAuric.words === 0, emptyAuric ? `words=${emptyAuric.words}` : 'no celan_basic face');

// one word, then dump again
await page.evaluate(() => window.tenebrae._forge.textFor('celan_basic', 'sea'));
await wait(page, 400);
const one = await dump('one');

/* ---- 3. read the table directories against the spec ---- */
const py = `
import json, struct, sys
from fontTools.ttLib import TTFont
FIXED = {"head":54, "hhea":36, "maxp":32, "post":32, "OS/2":78}
def analyse(p):
    raw = open(p,"rb").read()
    numT = struct.unpack(">H", raw[4:6])[0]
    tags, dirs = [], {}
    for i in range(numT):
        o = 12 + i*16
        tag = raw[o:o+4].decode("latin-1")
        chk, off, ln = struct.unpack(">III", raw[o+4:o+16])
        tags.append(tag); dirs[tag] = (off, ln)
    r = {"tags": tags, "sorted": tags == sorted(tags),
         "inRange": all(off+ln <= len(raw) for off,ln in dirs.values()),
         "lengths": {t: dirs[t][1] for t in dirs},
         "specLen": {t: (dirs[t][1], FIXED[t]) for t in FIXED if t in dirs and dirs[t][1] != FIXED[t]}}
    f = TTFont(p)
    f.saveXML(p + ".ttx")
    h = f["head"]
    r["bbox"] = [h.xMin, h.yMin, h.xMax, h.yMax]
    r["bboxSane"] = h.xMin <= h.xMax and h.yMin <= h.yMax
    r["numGlyphs"] = f["maxp"].numGlyphs
    r["isFixedPitch"] = f["post"].isFixedPitch
    advs = sorted(set(m[0] for m in f["hmtx"].metrics.values()))
    r["advances"] = advs[:6]
    r["monospaced"] = len(advs) == 1
    r["names"] = sorted(set(str(n) for n in f["name"].names if n.nameID in (1,2,4,6)))
    r["cmapN"] = len(f.getBestCmap())
    return r
print(json.dumps({p: analyse(p) for p in sys.argv[1:]}))
`;
await writeFile(OUT + '/spec.py', py);
const all = [...boot, ...one];
const raw = execFileSync('python3', [OUT + '/spec.py', ...all.map(f => f.path)], { encoding: 'utf8', maxBuffer: 1 << 28 });
const J = JSON.parse(raw.trim().split('\n').pop());
for(const f of all){
  const r = J[f.path];
  console.log(`   ${f.path.split('/').pop().padEnd(30)} glyphs=${String(r.numGlyphs).padStart(5)} bbox=${JSON.stringify(r.bbox)} sane=${r.bboxSane} fixedPitch=${r.isFixedPitch} advances=${JSON.stringify(r.advances)} specLenDeviations=${JSON.stringify(r.specLen)}`);
}
const rows = all.map(f => ({ f, r: J[f.path] }));
ck('fontTools decompiles every forged face, including the empty Auric one',
   rows.every(x => x.r.numGlyphs >= 2 && x.r.cmapN >= 1));
ck('table directory tags are in the spec-required ascending order, every face',
   rows.every(x => x.r.sorted), JSON.stringify(rows.filter(x => !x.r.sorted).map(x => x.r.tags)));
ck('every table offset+length lies inside the file', rows.every(x => x.r.inRange));
ck('every fixed-size table has its spec length (head 54, hhea 36, maxp 32, post 32, OS/2 78)',
   rows.every(x => Object.keys(x.r.specLen).length === 0),
   JSON.stringify(rows.filter(x => Object.keys(x.r.specLen).length).map(x => [x.f.id, x.r.specLen])[0] || []));
ck('head\'s bounding box is well-formed (xMin<=xMax, yMin<=yMax) on EVERY face',
   rows.every(x => x.r.bboxSane),
   JSON.stringify(rows.filter(x => !x.r.bboxSane).map(x => `${x.f.path.split('/').pop()} ${JSON.stringify(x.r.bbox)}`)));
ck('post.isFixedPitch agrees with hmtx (a face with several advances must not claim monospaced)',
   rows.every(x => !x.r.isFixedPitch || x.r.monospaced),
   JSON.stringify(rows.filter(x => x.r.isFixedPitch && !x.r.monospaced).map(x => `${x.f.id} advances=${JSON.stringify(x.r.advances)}`)));
ck('every face carries its forged family name', rows.every(x => x.r.names.some(n => /Tenebrae (Omni|Auric)/.test(n))));

/* ---- 4. does a book that never used the word script still SHIP that face? ----
   FRESH page: this probe has already minted an Auric word above, and the word
   map is session-global, so the shipping question can only be asked in a
   session where the word script was never touched. */
const P2 = await launch();
const p2 = P2.page;
await wait(p2, 3500);
await createBook(p2, 'No Auric Book');
await p2.click('#ed-content');
await p2.keyboard.type('opening line');
await p2.keyboard.press('Enter');
await p2.keyboard.type('the sea remembers');
await wait(p2, 400);
await insertTranslationSpan(p2, 'the sea remembers', 'Kerrackian');
await wait(p2, 1600);
await p2.click('#ed-back'); await wait(p2, 700);
await p2.click('#bk-share'); await wait(p2, 600);
const [edl] = await Promise.all([
  p2.waitForEvent('download', { timeout: 15000 }),
  p2.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await edl.path());
await wait(p2, 500);
const auricWords = await p2.evaluate(() => window.tenebrae._forge.map().celan_basic.order.length);
function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map(); let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true), extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    off += 30 + nameLen + extraLen + csize;
  }
  return files;
}
const ef = unzipStored(epub);
const css = Buffer.from(ef.get('OEBPS/style.css') || '').toString('utf8');
const auricHref = (/@font-face\{font-family:'Tenebrae Auric Runes';src:url\('([^']+)'\)/.exec(css) || [])[1];
console.log('celan_basic words at export time:', auricWords, '| auric font in epub:', auricHref);
let shippedBbox = null;
if(auricHref){
  const pth = OUT + '/epub-auric.ttf';
  await writeFile(pth, ef.get('OEBPS/' + auricHref));
  const o = execFileSync('python3', [OUT + '/spec.py', pth], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const R2 = JSON.parse(o.trim().split('\n').pop())[pth];
  shippedBbox = R2.bbox;
  console.log('epub-embedded Auric face:', JSON.stringify(R2.bbox), 'glyphs=' + R2.numGlyphs, 'sane=' + R2.bboxSane);
}
// A face nobody reads is dead weight in every copy of the book, and the empty
// Auric face was the worst of them: two glyphs, no outlines, and — until the
// forge learned to clamp it — an inverted head bounding box. An EPUB now ships
// only the faces the book's own spans call for.
ck('an EPUB does NOT embed a face the book never writes in',
   auricWords === 0 && !auricHref, `words=${auricWords} href=${auricHref}`);
ck('and if one is shipped, its head bbox is well formed',
   !auricHref || (!!shippedBbox && shippedBbox[0] <= shippedBbox[2] && shippedBbox[1] <= shippedBbox[3]),
   JSON.stringify(shippedBbox));

ck('no page exceptions', errors.length === 0 && P2.errors.length === 0, [...errors, ...P2.errors].slice(0, 3).join(' | '));
verdict('CF FORGE TTF SPEC', checks.every(c => c[1]));
await P2.browser.close(); await P2.srv.close();
await browser.close();
await srv.close();
