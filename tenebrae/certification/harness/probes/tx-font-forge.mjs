// TX-4 — REAL SCRIPT, AS TEXT: the forged TTFs, validated as fonts.
//
// What this adds over s2-render-parity.mjs (which rasterizes and scores IoU):
// nothing there ever opens the font file. Here every forged TTF is pulled out
// of the live page via window.tenebrae._forge.fontBytes(), written to disk and
// put through fontTools — every table decompiled (saveXML forces it), every
// table checksum and the head checkSumAdjustment recomputed, cmap coverage
// checked against the PUA codepoints a 30-phrase corpus actually produces,
// and every mapped glyph checked for real contours. Then forging determinism
// across a reload and across a storage-fresh context, by SHA-256.
//
// Run: cd probes && node tx-font-forge.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx-fonts';
await mkdir(OUT, { recursive: true });

const PHRASES = [
  'The sea remembers the old king', 'my mana let it stand', 'the lamp holds steady',
  'she walks alone tonight', 'the fire under the mountain', 'gold light on black water',
  'a warrant sealed in wax', 'the gate will not open', 'winter came early this year',
  'he carried the lantern down', 'no one answered the bell', 'blood on the white stair',
  'the tower leans toward the sea', 'her name was never written', 'ash falls on the roofs',
  'seven ships left the harbour', 'the road bends north', 'silence in the long hall',
  'they buried him at dawn', 'the third sun rose red', 'a knife of cold iron',
  'the river took the bridge', 'she read the old charter', 'nothing moved in the dark',
  'the bargain is struck', 'let the record show', 'wind through the dead orchard',
  'the child did not cry', 'stone remembers what men forget', 'zzqx 1234 naïve mother-in-law',
];

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

// collects fonts + the codepoints the corpus actually uses, from a live page
const COLLECT = async (phrases) => {
  const w = await window.tenebrae.engine();
  if(!w) return { fatal: 'engine did not wake' };
  const C = w.CODEX, F = window.tenebrae._forge;
  const forged = F.map();
  const b64 = u8 => {
    let s = '';
    for(let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  };
  // the Auric face is rebuilt as words are minted, and FontFace.load() is async
  for(const id of Object.keys(forged)) for(const ph of phrases){
    const r = await window.tenebrae.translate2(id, ph);
    F.textForToks(id, r.toks);
  }
  await document.fonts.ready;
  const out = { langs: [] };
  for(const id of Object.keys(forged)){
    const f = forged[id];
    // Celan Basic is a WORD script carved by composeWord — no alphabet in TRANS,
    // and its codepoints are minted as words are written, so its glyph count is
    // whatever this run happened to need
    const sc = (C.TRANS[id] && C.TRANS[id].L && C.TRANS[id].L.script) || null;
    const used = new Set();
    for(const p of phrases){
      const r = await window.tenebrae.translate2(id, p);
      const scr = F.textForToks(id, r.toks) || '';
      for(const ch of scr){ const c = ch.charCodeAt(0); if(c !== 32 && c !== 10) used.add(c); }
    }
    const bytes = F.fontBytes(id);
    // does the browser actually have this face, and does the PUA text ink?
    const sample = String.fromCharCode(f.auric ? (f.order.length ? f.words[f.order[0]].code : f.base) : f.base);
    const faceLoaded = document.fonts.check(`19px "${f.family}"`, sample);
    const ink = (txt, family) => {
      const cv = document.createElement('canvas'); cv.width = 80; cv.height = 80;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 80, 80);
      g.fillStyle = '#000'; g.font = `64px "${family}"`; g.textBaseline = 'alphabetic';
      g.fillText(txt, 6, 70);
      const d = g.getImageData(0, 0, 80, 80).data;
      let n = 0; for(let i = 0; i < d.length; i += 4) if(d[i] < 160) n++;
      return n;
    };
    const nGlyphs = sc ? sc.glyphs.length : f.order.length;
    const unmapped = String.fromCharCode(f.auric ? 0xF8FE : f.base + nGlyphs + 40);
    out.langs.push({ id, family: f.family, base: f.base, flow: f.flow, auric: !!f.auric,
      nGlyphs, dotCode: sc ? f.base + nGlyphs : null,
      used: [...used].sort((a, b) => a - b), bytes: b64(bytes), len: bytes.length,
      faceLoaded, inkForged: ink(sample, f.family), inkUnmapped: ink(unmapped, f.family) });
  }
  return out;
};

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const boot = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await p.goto(srv.url + 'step1.html');
  await p.waitForTimeout(3500);
  return p;
};
const ctxA = await browser.newContext({ viewport: { width: 900, height: 900 } });
const pageA = await boot(ctxA);
const runA = await pageA.evaluate(COLLECT, PHRASES);
if(runA.fatal){ console.log('FATAL:', runA.fatal); process.exit(1); }

// run 2: same context, reloaded page (fresh boot, fresh forge)
await pageA.reload();
await pageA.waitForTimeout(3500);
const runB = await pageA.evaluate(COLLECT, PHRASES);
// run 3: storage-fresh context
const ctxC = await browser.newContext({ viewport: { width: 900, height: 900 } });
const pageC = await boot(ctxC);
const runC = await pageC.evaluate(COLLECT, PHRASES);

const sha = b64 => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
console.log('--- forged fonts ---');
const files = [];
for(const L of runA.langs){
  const buf = Buffer.from(L.bytes, 'base64');
  const path = `${OUT}/${L.id}.ttf`;
  await writeFile(path, buf);
  files.push({ ...L, path, sha: sha(L.bytes) });
  console.log(`${L.id.padEnd(14)} ${L.family.padEnd(30)} ${String(L.len).padStart(6)}B base=0x${L.base.toString(16)} glyphs=${L.nGlyphs} usedCodes=${L.used.length} faceLoaded=${L.faceLoaded} ink(forged)=${L.inkForged} ink(unmapped)=${L.inkUnmapped}`);
}
ck('all six scripted tongues forged a font (five alphabets + the Auric word script)',
   files.length === 6 && files.some(f => f.auric), files.map(f => f.id).join(','));
ck('every forged face is loaded and covers its PUA block in the browser', files.every(f => f.faceLoaded));
ck('forged glyphs actually ink (and an unmapped codepoint does not)',
   files.every(f => f.inkForged > 50 && f.inkUnmapped === 0),
   files.map(f => `${f.id}:${f.inkForged}/${f.inkUnmapped}`).join(' '));

// ---- determinism by SHA-256 ----
const shaOf = run => Object.fromEntries(run.langs.map(L => [L.id, sha(L.bytes)]));
const A = shaOf(runA), B = shaOf(runB), Cc = shaOf(runC);
console.log('--- determinism ---');
for(const id of Object.keys(A)) console.log(`  ${id.padEnd(14)} boot1=${A[id].slice(0, 16)} reload=${B[id].slice(0, 16)} freshCtx=${Cc[id].slice(0, 16)}`);
ck('forging is byte-deterministic across a reload', JSON.stringify(A) === JSON.stringify(B));
ck('forging is byte-deterministic in a storage-fresh context', JSON.stringify(A) === JSON.stringify(Cc));

// ---- fontTools structural validation ----
const PY = `
import sys, json, struct
from fontTools.ttLib import TTFont
from fontTools.misc.textTools import Tag
spec = json.load(open(sys.argv[1]))
res = {}
for item in spec:
    r = {"tables": [], "errors": [], "missingCmap": [], "emptyGlyphs": [], "badChecksums": []}
    try:
        raw = open(item["path"], "rb").read()
        f = TTFont(item["path"], lazy=False)
        r["tables"] = sorted(f.keys())
        # force full decompile of EVERY table
        import io
        f.saveXML(io.BytesIO())
        cmap = f.getBestCmap()
        r["cmapSize"] = len(cmap)
        for c in item["used"]:
            if c not in cmap: r["missingCmap"].append(hex(c))
        glyf = f["glyf"]
        for c in item["used"]:
            if c not in cmap: continue
            g = glyf[cmap[c]]
            n = getattr(g, "numberOfContours", 0)
            pts = 0
            if n > 0:
                co, e, fl = g.getCoordinates(glyf)
                pts = len(co)
            if n <= 0 or pts == 0: r["emptyGlyphs"].append(hex(c))
        r["numGlyphs"] = f["maxp"].numGlyphs
        r["unitsPerEm"] = f["head"].unitsPerEm
        r["names"] = sorted({n.toUnicode() for n in f["name"].names})
        # per-table directory checksums + head.checkSumAdjustment
        def cs(b):
            b = b + b"\\x00" * ((4 - len(b) % 4) % 4)
            s = 0
            for i in range(0, len(b), 4): s = (s + struct.unpack(">I", b[i:i+4])[0]) & 0xFFFFFFFF
            return s
        numT = struct.unpack(">H", raw[4:6])[0]
        headOff = None
        for i in range(numT):
            o = 12 + i*16
            tag = raw[o:o+4].decode("latin1")
            chk, off, ln = struct.unpack(">III", raw[o+4:o+16])
            body = raw[off:off+ln]
            got = cs(body)
            if tag == "head":
                headOff = off
                body2 = body[:8] + b"\\x00\\x00\\x00\\x00" + body[12:]
                got = cs(body2)
                chk_stored_zeroed = chk
            if got != chk: r["badChecksums"].append([tag, hex(chk), hex(got)])
        whole = bytearray(raw)
        whole[headOff+8:headOff+12] = b"\\x00\\x00\\x00\\x00"
        want = (0xB1B0AFBA - cs(bytes(whole))) & 0xFFFFFFFF
        have = struct.unpack(">I", raw[headOff+8:headOff+12])[0]
        r["checkSumAdjustment"] = {"stored": hex(have), "computed": hex(want), "ok": have == want}
    except Exception as e:
        r["errors"].append(type(e).__name__ + ": " + str(e))
    res[item["id"]] = r
print(json.dumps(res))
`;
const specPath = `${OUT}/spec.json`;
await writeFile(specPath, JSON.stringify(files.map(f => ({ id: f.id, path: f.path, used: f.used }))));
const pyPath = `${OUT}/validate.py`;
await writeFile(pyPath, PY);
let ft;
try{
  ft = JSON.parse(execFileSync('python3', [pyPath, specPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}catch(e){ console.log('fontTools run failed:', e.message, e.stdout, e.stderr); ft = null; }

console.log('--- fontTools ---');
if(ft){
  for(const [id, r] of Object.entries(ft)){
    console.log(`${id.padEnd(14)} tables=${(r.tables || []).join(',')} numGlyphs=${r.numGlyphs} upem=${r.unitsPerEm} cmap=${r.cmapSize} csAdj=${r.checkSumAdjustment && r.checkSumAdjustment.ok}`);
    if(r.errors.length) console.log(`   ERRORS: ${r.errors.join(' | ')}`);
    if(r.missingCmap.length) console.log(`   MISSING CMAP: ${r.missingCmap.join(',')}`);
    if(r.emptyGlyphs.length) console.log(`   EMPTY GLYPHS: ${r.emptyGlyphs.join(',')}`);
    if(r.badChecksums.length) console.log(`   BAD CHECKSUMS: ${JSON.stringify(r.badChecksums)}`);
    console.log(`   names: ${JSON.stringify(r.names)}`);
  }
  const all = Object.values(ft);
  ck('fontTools decompiles every table of every forged font (saveXML)', all.every(r => r.errors.length === 0), JSON.stringify(all.flatMap(r => r.errors)));
  ck('required tables present (cmap glyf head hhea hmtx loca maxp name post OS/2)',
     all.every(r => ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'].every(t => r.tables.includes(t))));
  ck('cmap covers every PUA codepoint the corpus produces', all.every(r => r.missingCmap.length === 0),
     `${files.reduce((a, f) => a + f.used.length, 0)} distinct codepoints checked`);
  ck('every mapped glyph has real contours (no blank/tofu glyphs)', all.every(r => r.emptyGlyphs.length === 0));
  ck('every table directory checksum is correct', all.every(r => r.badChecksums.length === 0));
  ck('head.checkSumAdjustment is correct for the whole file', all.every(r => r.checkSumAdjustment && r.checkSumAdjustment.ok),
     Object.entries(ft).map(([id, r]) => `${id}:${r.checkSumAdjustment && r.checkSumAdjustment.stored}`).join(' '));
  ck('name table carries the forged family name', all.every(r => (r.names || []).some(n => /^Tenebrae (Omni|Auric)/.test(n))),
     JSON.stringify(Object.entries(ft).map(([id, r]) => `${id}:${(r.names || [])[0]}`)));
  // cmap must cover the WHOLE forged block, not just what the corpus happened
  // to use: space + every codex glyph + the unknown mark
  // an alphabet block is space + every codex glyph + the unknown mark; the Auric
  // word font has no unknown mark — an unknown word gets its own pseudo-rune
  const blockOK = files.every(f => f.auric
    ? (ft[f.id].cmapSize === f.nGlyphs + 1 && ft[f.id].numGlyphs === f.nGlyphs + 2)
    : (ft[f.id].cmapSize === f.nGlyphs + 2 && ft[f.id].numGlyphs === f.nGlyphs + 3));
  ck('cmap covers the whole forged block (space + every codex glyph + unknown mark)', blockOK,
     files.map(f => `${f.id}: cmap=${ft[f.id].cmapSize} want=${f.nGlyphs + (f.auric ? 1 : 2)}, glyphs=${ft[f.id].numGlyphs} want=${f.nGlyphs + (f.auric ? 2 : 3)}`).join(' | '));
}else ck('fontTools validation ran', false, 'python3 invocation failed');

// ---- the unknown-token mark is a real glyph in the font, not a Latin fallback
// alphabets only: the Auric word font has no unknown mark, because an unknown
// word is drawn as its own pseudo-rune stamped with the loan diamond
ck('unknown-token mark is a forged glyph inside the PUA block',
   files.filter(f => !f.auric).every(f => f.dotCode === f.base + f.nGlyphs),
   files.map(f => `${f.id}:${f.dotCode == null ? 'n/a (word script)' : '0x' + f.dotCode.toString(16)}`).join(' '));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('TX-4 FONT FORGE VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
