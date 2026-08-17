// TX-10 — "EPUB carries the script."
//
// A book with one translated span in EVERY tongue the codex offers (all three
// canonical flows + celan_basic), exported to EPUB and taken apart from the
// outside:
//   1. every span carries PUA script text + data-src/data-rom/data-flow
//   2. every forged font that a span actually needs is embedded AND manifested
//   3. style.css carries @font-face, the per-language rules and the per-flow rules
//   4. every XHTML/XML part parses as strict XML (independent parser: python
//      xml.dom.minidom, not the browser that wrote it)
//   5. the embedded TTFs decompile under fontTools and their cmaps cover every
//      PUA codepoint the XHTML actually uses for that language
//   6. re-import through the real UI returns LIVE spans with source intact that
//      re-render identically (same data-lang / data-rom / data-scr / data-flow)
//
// Run: cd probes && node tx-epub-allscripts.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx10';
await mkdir(OUT + '/fonts', { recursive: true });

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL '), label, extra === undefined ? '' : extra); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500); // engine wake + forge

// ---- which tongues does the codex actually offer? ----
const LANGS = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  const F = window.tenebrae._forge.map() || {};
  return langs.map(l => ({ id: l.id, name: l.name, dir: l.dir, forged: !!F[l.id], family: F[l.id] && F[l.id].family }));
});
console.log('codex tongues:', LANGS.map(l => `${l.name}[${l.id}${l.forged ? ' forged' : ''}]`).join(', '));

// ---- build the book: one paragraph per tongue, one span each ----
await createBook(page, 'TX10 Script Carrier');
await page.click('#ed-title');
await page.keyboard.type('All Scripts');
await page.click('#ed-content');
await page.keyboard.type('opening line');            // bare top-level run, left alone
const PHRASES = LANGS.map((l, i) => `alpha${i} the sea remembers the old king omega${i}`);
for(const p of PHRASES){ await page.keyboard.press('Enter'); await page.keyboard.type(p); }
await wait(page, 400);
for(let i = 0; i < LANGS.length; i++){
  await insertTranslationSpan(page, `the sea remembers the old king omega${i}`, LANGS[i].name);
}
await wait(page, 1800);
await page.click('#ed-back');
await wait(page, 600);

// ---- what the LIVE spans look like (the render we must reproduce) ----
const LIVE = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const tpl = document.createElement('template');
      tpl.innerHTML = b.chapters[0].scenes[0].doc || '';
      res([...tpl.content.querySelectorAll('.tspan')].map(s => ({
        lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom,
        scr: s.dataset.scr || null, flow: s.dataset.flow || null,
        omni: s.dataset.omni || null, dir: s.getAttribute('dir') || null,
        text: s.textContent,
      })));
    };
  };
}));
console.log('live spans:', LIVE.length);
for(const s of LIVE) console.log('   ', s.lang.padEnd(14), 'flow=' + String(s.flow).padEnd(10), 'pua=' + PUA_RE.test(s.text), 'rom=' + JSON.stringify(s.rom).slice(0, 46));
ck('setup: one live span per codex tongue', LIVE.length === LANGS.length, `${LIVE.length}/${LANGS.length}`);
ck('setup: every live span carries PUA script text', LIVE.every(s => PUA_RE.test(s.text) && s.scr === s.text),
   LIVE.filter(s => !PUA_RE.test(s.text)).map(s => s.lang).join(','));

// ---- export the EPUB ----
await page.click('#bk-share'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await dl.path());
await wait(page, 500);
await writeFile(`${OUT}/book.epub`, epub);
console.log(`epub: ${dl.suggestedFilename()} ${epub.length} B`);

function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map(); const order = [];
  let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    if(method !== 0) throw new Error('unexpected compression on ' + name);
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    order.push({ name, extraLen });
    off += 30 + nameLen + extraLen + csize;
  }
  return { files, order };
}
const ez = unzipStored(epub);
const txt = n => Buffer.from(ez.files.get(n) || '').toString('utf8');
console.log('entries:', ez.order.map(o => o.name).join(' '));

// ================= 1. spans in the XHTML =================
const ch1 = txt('OEBPS/ch1.xhtml');
await writeFile(`${OUT}/ch1.xhtml`, ch1);
const spanRe = /<span class="tspan"([^>]*)>([\s\S]*?)<\/span>/g;
const epubSpans = [];
let m;
while((m = spanRe.exec(ch1))){
  const attrs = m[1];
  const at = k => { const r = new RegExp(`${k}="([^"]*)"`).exec(attrs); return r ? r[1] : null; };
  epubSpans.push({ lang: at('data-lang'), src: at('data-src'), rom: at('data-rom'), flow: at('data-flow'), dir: at('dir'), text: m[2] });
}
console.log('epub spans:', epubSpans.length);
ck('TX-10 every live span reached the EPUB', epubSpans.length === LIVE.length, `${epubSpans.length}/${LIVE.length}`);

const byLang = new Map(LIVE.map(s => [s.lang, s]));
const decodeEnt = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
let attrOK = true, puaOK = true, flowOK = true;
for(const s of epubSpans){
  const live = byLang.get(s.lang);
  const okAttrs = !!live && s.src === live.src && s.rom === live.rom;
  const okPua = PUA_RE.test(decodeEnt(s.text)) && decodeEnt(s.text) === live.scr;
  const okFlow = (live.flow || null) === (s.flow || null);
  if(!okAttrs){ attrOK = false; console.log('   attr mismatch', s.lang, JSON.stringify(s).slice(0, 200)); }
  if(!okPua){ puaOK = false; console.log('   script-text mismatch', s.lang, JSON.stringify(decodeEnt(s.text)).slice(0, 120)); }
  if(!okFlow){ flowOK = false; console.log('   flow mismatch', s.lang, s.flow, '!=', live.flow); }
}
ck('TX-10 each span carries data-src + data-rom identical to the live span', attrOK);
ck('TX-10 each span carries the PUA script text (identical to data-scr)', puaOK);
ck('TX-10 each span carries data-flow for every non-ltr flow', flowOK,
   epubSpans.map(s => `${s.lang}:${s.flow || 'ltr'}`).join(' '));
ck('TX-10 no romanization leaked into span body', epubSpans.every(s => decodeEnt(s.text) !== byLang.get(s.lang).rom));

// ================= 2/3. fonts + CSS =================
const css = txt('OEBPS/style.css');
await writeFile(`${OUT}/style.css`, css);
const opf = txt('OEBPS/content.opf');
const fontEntries = ez.order.filter(o => /^OEBPS\/fonts\/f\d+\.ttf$/.test(o.name)).map(o => o.name);
const faces = [...css.matchAll(/@font-face\{font-family:'([^']+)';src:url\('([^']+)'\)/g)].map(x => ({ family: x[1], href: x[2] }));
console.log('font files:', fontEntries.length, '@font-face:', faces.length);
ck('TX-10 css has @font-face for every embedded font file', faces.length === fontEntries.length && faces.every(f => ez.files.has('OEBPS/' + f.href)),
   faces.map(f => f.family + '->' + f.href).join(' | '));
ck('TX-10 every font file is manifested in the OPF',
   fontEntries.every(n => opf.includes(`href="${n.replace('OEBPS/', '')}"`) && opf.includes('media-type="font/ttf"')),
   fontEntries.join(','));

// per-language rules: every language that has a span must resolve to a family
// that is actually @font-face'd
const langRules = new Map();
for(const x of css.matchAll(/\.tspan\[data-lang="([^"]+)"\]\{font-family:'([^']+)'\}/g)) langRules.set(x[1], x[2]); // last wins, as CSS does
const faceFamilies = new Set(faces.map(f => f.family));
let langCSSOK = true;
for(const s of epubSpans){
  const fam = langRules.get(s.lang);
  const forged = LANGS.find(l => l.id === s.lang);
  const wanted = forged && forged.family;
  const ok = !!fam && faceFamilies.has(fam) && (!wanted || fam === wanted);
  if(!ok){ langCSSOK = false; console.log('   lang-css miss', s.lang, 'rule=' + fam, 'wanted=' + wanted, 'faced=' + (fam ? faceFamilies.has(fam) : false)); }
}
ck('TX-10 per-language CSS points every span at an embedded family', langCSSOK,
   [...langRules].map(([k, v]) => `${k}=>${v}`).join(' | '));

const flowsUsed = [...new Set(epubSpans.map(s => s.flow).filter(Boolean))];
ck('TX-10 per-flow CSS present for every flow used', flowsUsed.every(f => css.includes(`.tspan[data-flow="${f}"]{`)), flowsUsed.join(','));
ck('TX-10 cols-rtl rule is vertical-lr (columns advance left->right, letters down)', /\.tspan\[data-flow="cols-rtl"\]\{[^}]*writing-mode:vertical-lr/.test(css));
ck('TX-10 btt-stave rule is vertical-lr + direction:rtl + pre-wrap', /\.tspan\[data-flow="btt-stave"\]\{[^}]*writing-mode:vertical-lr[^}]*direction:rtl[^}]*white-space:pre-wrap/.test(css));
ck('TX-10 rtl rule is direction:rtl + isolate-override', /\.tspan\[data-flow="rtl"\]\{direction:rtl;unicode-bidi:isolate-override\}/.test(css));

// ================= 4. strict XML, independent parser =================
const xmlParts = [...ez.files.keys()].filter(n => /\.(xhtml|xml|opf)$/.test(n));
const xmlFails = [];
for(const n of xmlParts){
  const p = `${OUT}/part-${n.replace(/[\/]/g, '_')}`;
  await writeFile(p, Buffer.from(ez.files.get(n)));
  try{
    execFileSync('python3', ['-c', 'import sys,xml.dom.minidom as m; m.parse(sys.argv[1])', p], { stdio: 'pipe' });
  }catch(e){ xmlFails.push(n + ': ' + String(e.stderr || e).trim().split('\n').pop()); }
}
ck('TX-10 every XML/XHTML part parses strictly (python minidom)', xmlFails.length === 0, xmlFails.join(' | '));

// ================= 5. fontTools validation + cmap coverage =================
// which codepoints does each language's span actually use?
const needByFamily = new Map();
for(const s of epubSpans){
  const fam = langRules.get(s.lang);
  if(!fam) continue;
  const set = needByFamily.get(fam) || new Set();
  for(const c of decodeEnt(s.text)){ const cp = c.codePointAt(0); if(cp >= 0xE000 && cp <= 0xF8FF) set.add(cp); }
  needByFamily.set(fam, set);
}
const fontJobs = [];
for(const f of faces){
  const p = `${OUT}/fonts/${f.href.split('/').pop()}`;
  await writeFile(p, Buffer.from(ez.files.get('OEBPS/' + f.href)));
  fontJobs.push({ path: p, family: f.family, need: [...(needByFamily.get(f.family) || [])] });
}
await writeFile(`${OUT}/fontjobs.json`, JSON.stringify(fontJobs));
const PY = `
import json, sys
from fontTools.ttLib import TTFont
jobs = json.load(open(sys.argv[1]))
out = []
for j in jobs:
    rec = {"family": j["family"], "path": j["path"]}
    try:
        f = TTFont(j["path"], lazy=False)
        for t in f.keys():
            _ = f[t]                       # force decompile of every table
        rec["tables"] = sorted(f.keys())
        cmap = f.getBestCmap()
        rec["cmapSize"] = len(cmap)
        rec["nameFamily"] = f["name"].getDebugName(1)
        rec["missing"] = [hex(c) for c in j["need"] if c not in cmap]
        rec["numGlyphs"] = f["maxp"].numGlyphs
        rec["upem"] = f["head"].unitsPerEm
        rec["ok"] = True
    except Exception as e:
        rec["ok"] = False; rec["err"] = repr(e)
    out.append(rec)
print(json.dumps(out))
`;
const fontRes = JSON.parse(execFileSync('python3', ['-c', PY, `${OUT}/fontjobs.json`], { encoding: 'utf8' }));
for(const r of fontRes) console.log('   font', String(r.family).padEnd(30), r.ok ? `tables=${r.tables.length} glyphs=${r.numGlyphs} cmap=${r.cmapSize} name=${JSON.stringify(r.nameFamily)} missing=${r.missing.length}` : r.err);
ck('TX-10 every embedded font decompiles under fontTools', fontRes.every(r => r.ok), fontRes.filter(r => !r.ok).map(r => r.family + ':' + r.err).join(' | '));
ck('TX-10 every embedded font cmap covers the codepoints its spans use',
   fontRes.every(r => r.ok && r.missing.length === 0),
   fontRes.filter(r => r.ok && r.missing.length).map(r => `${r.family}:${r.missing.join(',')}`).join(' | '));
ck('TX-10 embedded font name records match the CSS family names',
   fontRes.every(r => r.ok && r.nameFamily === r.family),
   fontRes.filter(r => r.ok && r.nameFamily !== r.family).map(r => `${r.family}!=${r.nameFamily}`).join(' | '));

// which families do the spans need, and did they all ride along?
const neededFamilies = [...new Set(epubSpans.map(s => langRules.get(s.lang)).filter(Boolean))];
ck('TX-10 every family a span needs is embedded', neededFamilies.every(f => faceFamilies.has(f)),
   neededFamilies.filter(f => !faceFamilies.has(f)).join(','));

// ================= 6. re-import through the real UI =================
async function importFile(path, headingMode){
  if(await page.$('#scr-book.on')) { await page.click('#bk-back'); await wait(page, 500); }
  await page.click('#lib-more');
  await wait(page, 400);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await chooser.setFiles(path);
  await page.waitForSelector('#imp-go', { timeout: 15000 });
  await wait(page, 400);
  if(headingMode){ const seg = await page.$('#imp-seg button[data-mode="h"]'); if(seg){ await seg.click(); await wait(page, 500); } }
  await page.click('#imp-go');
  await wait(page, 1400);
}
await importFile(`${OUT}/book.epub`, true);
await wait(page, 1200);

const BACK = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => {
      const b = g.result.books[g.result.books.length - 1];
      const docs = [];
      b.chapters.forEach(c => c.scenes.forEach(s => docs.push(s.doc || '')));
      const tpl = document.createElement('template');
      tpl.innerHTML = docs.join('');
      res({ title: b.title, spans: [...tpl.content.querySelectorAll('.tspan')].map(s => ({
        lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom,
        scr: s.dataset.scr || null, flow: s.dataset.flow || null, omni: s.dataset.omni || null,
        text: s.textContent,
      })) });
    };
  };
}));
console.log('re-imported book:', JSON.stringify(BACK.title), 'spans:', BACK.spans.length);
for(const s of BACK.spans) console.log('   back', String(s.lang).padEnd(14), 'omni=' + s.omni, 'flow=' + s.flow, 'pua=' + PUA_RE.test(s.text), 'rom=' + JSON.stringify(s.rom).slice(0, 40));

ck('TX-10 re-import restores the same number of spans', BACK.spans.length === LIVE.length, `${BACK.spans.length}/${LIVE.length}`);
const srcSetLive = LIVE.map(s => s.src).sort();
const srcSetBack = BACK.spans.map(s => s.src).sort();
ck('TX-10 re-import keeps every English source intact', JSON.stringify(srcSetLive) === JSON.stringify(srcSetBack),
   JSON.stringify(srcSetBack).slice(0, 260));
ck('TX-10 re-import keeps the tongue id on every span',
   BACK.spans.every((s, i) => s.lang === LIVE[i].lang),
   BACK.spans.map((s, i) => `${LIVE[i].lang}->${s.lang}`).join(' '));
ck('TX-10 re-imported spans re-render identically (romanization)',
   BACK.spans.every((s, i) => s.rom === LIVE[i].rom),
   BACK.spans.map((s, i) => s.rom === LIVE[i].rom ? '' : `${LIVE[i].lang}: ${JSON.stringify(s.rom)} != ${JSON.stringify(LIVE[i].rom)}`).filter(Boolean).join(' | ').slice(0, 400));
ck('TX-10 re-imported spans re-render identically (script text)',
   BACK.spans.every((s, i) => s.text === LIVE[i].text),
   BACK.spans.map((s, i) => s.text === LIVE[i].text ? '' : `${LIVE[i].lang}: ${JSON.stringify(s.text)} != ${JSON.stringify(LIVE[i].text)}`).filter(Boolean).join(' | ').slice(0, 400));
ck('TX-10 re-imported spans are still codex spans (data-omni kept)',
   BACK.spans.every(s => s.omni === '1'), BACK.spans.map(s => `${s.lang}:${s.omni}`).join(' '));
ck('TX-10 re-imported spans never degrade to Latin', BACK.spans.every(s => PUA_RE.test(s.text)),
   BACK.spans.filter(s => !PUA_RE.test(s.text)).map(s => `${s.lang}:${JSON.stringify(s.text).slice(0, 40)}`).join(' | '));

// WHOSE ENGINE wrote the restored romanizations? Ask the legacy sample cipher
// (window.tenebrae.translate) for the same lang+source and compare byte for byte.
const IDENT = await page.evaluate(spans => spans.map(s => {
  let sample = null;
  try{ sample = window.tenebrae.translate(s.lang, s.src).romanization; }catch(e){ sample = 'ERR:' + e.message; }
  return { lang: s.lang, restored: s.rom, sample, same: s.rom === sample };
}), BACK.spans);
console.log('engine identification (restored vs legacy sample cipher):');
for(const r of IDENT) console.log(`   ${String(r.lang).padEnd(14)} same=${r.same}  restored=${JSON.stringify(r.restored).slice(0, 52)}  sample=${JSON.stringify(r.sample).slice(0, 52)}`);
ck('TX-10 the restored romanizations are NOT the legacy sample cipher\'s output',
   IDENT.every(r => !r.same), IDENT.filter(r => r.same).map(r => r.lang).join(','));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-10 EPUB carries the script', checks.every(c => c[1]));
console.log('artifacts in', OUT);
await browser.close();
await srv.close();
