// COVERAGE GAP — TX-10 / TX-11 / TX-9, across a seam no single domain could see:
// a span whose recorded tongue is not one THIS codex has, arriving through the
// app's own Markdown door and then leaving through all five export formats.
//
// Why this is reachable: the Markdown marker records the tongue by id
// (step1.html:1976), and the importer trusts it (inlineMD L5347 -> tspanHTML ->
// makeTSpan L3825). Rath-Speech was one of the seven tongues step 1 offered
// (step1-requirements TR-1) and the codex now marks it dead — OMNI_ALIAS maps it
// to null (L3573) — so an author's OWN earlier .md carries spans this build has
// no face for. omniTranslate then does `omniLangId(raw) || 'celan_basic'`
// (L3654) and ANSWERS, while nothing rewrites data-lang: decorateAll (L4300)
// and syncScriptDoc (L2442) both refresh rom/scr and leave the tongue alone.
//
// The question this probe asks: what does the author see, and what do the five
// files contain, when the script written into the span belongs to a tongue that
// has no font rule anywhere?
// Run: cd probes && node cc-legacy-tongue-crossformat.mjs
import { launch, wait } from './ex-lib.mjs';
import { writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const sh = promisify(execFile);

const SCRATCH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad';
const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };
const PUA = s => (String(s).match(/[-]/g) || []);

const mark = (lang, src, rom) => `<!--tenebrae:begin {"language":"${lang}","source":"${src}"}-->${rom}<!--tenebrae:end-->`;
const MD = [
  '<!--tenebrae:doc-->',
  '# Legacy Book',
  '',
  '## Chapter 1',
  '',
  '<!--tenebrae:scene-->',
  '### First Light',
  '',
  'The lamp holds ' + mark('rath-speech', 'the sea remembers', 'ath merath') + ' over the water.',
  '',
  'A control line ' + mark('celan_high', 'the old king', 'aevolan sa-dorotiarnus') + ' stands here.',
  '',
  'And a tongue that never was ' + mark('klingon', 'the stone gate', 'nuqneH') + ' ends it.',
  ''
].join('\n');
const mdPath = SCRATCH + '/cc-legacy-tongue.md';
await writeFile(mdPath, MD);

const { srv, browser, page, errors } = await launch();
await wait(page, 3400);

/* ---------- import our own-format file through the real door ---------- */
await page.click('#lib-more'); await wait(page, 450);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(mdPath);
await page.waitForSelector('#imp-go', { timeout: 15000 });
console.log('   preview:', JSON.stringify((await page.locator('.imp-stats').innerText()).replace(/\s+/g, ' ')));
await page.click('#imp-go');
await wait(page, 2400);

const onBook = await page.locator('#scr-book.on').count();
console.log('   after commit, book screen already open:', onBook > 0);
if(!onBook){ await page.locator('#lib-list .row', { hasText: 'Legacy Book' }).click(); await wait(page, 700); }
await page.locator('#bk-list .row[data-scene]').first().click(); await wait(page, 2600); // decorateAll

/* ---------- what the author sees ---------- */
const seen = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('#ed-content .tspan').forEach(sp => {
    const cs = getComputedStyle(sp);
    const txt = sp.textContent || '';
    const codes = Array.from(txt).filter(c => c >= '' && c <= '').map(c => c.codePointAt(0).toString(16));
    let covers = null;
    try{ covers = document.fonts.check(cs.fontSize + ' ' + cs.fontFamily, txt); }catch(e){ covers = 'threw'; }
    return out.push({
      lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom,
      scrCodes: codes, family: cs.fontFamily, fontCovers: covers,
      w: Math.round(sp.getBoundingClientRect().width)
    });
  });
  return out;
});
seen.forEach(s => console.log('   SPAN', JSON.stringify(s)));
const rath = seen.find(s => s.lang === 'rath-speech') || {};
const ctrl = seen.find(s => s.lang === 'celan_high') || {};
const klin = seen.find(s => s.lang === 'klingon') || {};

ck('control: the celan_high span is script in a forged face',
   ctrl.scrCodes && ctrl.scrCodes.length > 0 && /Tenebrae/.test(ctrl.family || '') && ctrl.fontCovers === true,
   JSON.stringify({ family: ctrl.family, covers: ctrl.fontCovers, n: (ctrl.scrCodes || []).length }));
ck('the dead tongue does not put private-use characters on screen in a font that cannot show them',
   !(rath.scrCodes && rath.scrCodes.length) || (/Tenebrae/.test(rath.family || '') && rath.fontCovers === true),
   JSON.stringify({ lang: rath.lang, codes: rath.scrCodes, family: rath.family, covers: rath.fontCovers }));
ck('the never-existed tongue did not silently become the codex\'s default tongue',
   klin.lang === 'klingon', JSON.stringify({ lang: klin.lang, rom: klin.rom }));

/* ---------- and now out through all five doors ---------- */
await page.click('#ed-back'); await wait(page, 700);
const grab = async (label, bin) => {
  await page.click('#bk-share'); await wait(page, 600);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const p = SCRATCH + '/cc-legacy-' + dl.suggestedFilename();
  await dl.saveAs(p);
  await wait(page, 700);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 400);
  return bin ? p : { path: p, text: await readFile(p, 'utf8') };
};
const md = await grab('Download Markdown (.md)');
const txt = await grab('Download plain text (.txt)');
const docxP = await grab('Download Word (.docx)', true);
const pdfP = await grab('Download PDF (.pdf)', true);
const epubP = await grab('Download EPUB (.epub)', true);

const unzip = async (zip, name) => (await sh('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile('${zip}')
print('\\n'.join(n for n in z.namelist()))
print('@@@')
for n in z.namelist():
  if '${name}' in n:
    sys.stdout.write(z.read(n).decode('utf8','replace'))
`])).stdout;

const docxXML = (await unzip(docxP, 'document.xml')).split('@@@')[1] || '';
const epubAll = await unzip(epubP, 'ch1.xhtml');
const epubNames = epubAll.split('@@@')[0];
const epubCh = epubAll.split('@@@')[1] || '';
const epubCSS = (await unzip(epubP, 'style.css')).split('@@@')[1] || '';

console.log('   md  :', JSON.stringify(md.text.split('\n').filter(l => l.includes('tenebrae:begin') || /lamp|control|never/.test(l)).join(' / ').slice(0, 400)));
console.log('   txt :', JSON.stringify(txt.text.replace(/\n+/g, ' | ').slice(0, 300)));
console.log('   docx PUA:', JSON.stringify(PUA(docxXML)), '| epub ch1 PUA count:', PUA(epubCh).length);

ck('md carries no raw private-use character', PUA(md.text).length === 0, PUA(md.text).slice(0, 12).join(' '));
ck('txt carries no raw private-use character', PUA(txt.text).length === 0, PUA(txt.text).slice(0, 12).join(' '));
ck('docx carries no raw private-use character', PUA(docxXML).length === 0, PUA(docxXML).slice(0, 12).join(' '));
ck('md keeps the dead tongue recoverable (marker + source)', md.text.includes('"source":"the sea remembers"'), (md.text.match(/tenebrae:begin[\s\S]{0,70}/g) || []).join(' ; '));

/* the EPUB: every span that ships PUA must have a font rule that covers it */
const epubSpans = [...epubCh.matchAll(/<span class="tspan"[^>]*>([\s\S]*?)<\/span>/g)].map(m => {
  const tag = m[0].slice(0, m[0].indexOf('>'));
  const lang = (tag.match(/data-lang="([^"]+)"/) || [])[1];
  return { lang, pua: PUA(m[1]).length, cssRule: new RegExp('data-lang="' + (lang || '') + '"').test(epubCSS) };
});
console.log('   epub spans:', JSON.stringify(epubSpans));
console.log('   epub per-language rules:', JSON.stringify((epubCSS.match(/\.tspan\[data-lang="[^"]+"\]\{font-family:[^}]+\}/g) || []).slice(0, 12)));
ck('every EPUB span that ships script has a per-language font rule for its tongue',
   epubSpans.every(s => s.pua === 0 || s.cssRule),
   JSON.stringify(epubSpans.filter(s => s.pua > 0 && !s.cssRule)));

/* the PDF: what happened to the dead-tongue span */
const pdfInfo = (await sh('python3', ['-c', `
import re,zlib
d=open('${pdfP}','rb').read()
streams=[]
for m in re.finditer(rb'stream\\r?\\n',d):
    s=m.end(); e=d.find(b'endstream',s)
    raw=d[s:e]
    try: raw=zlib.decompress(raw)
    except Exception: pass
    streams.append(raw)
txt=b'\\n'.join(streams)
lits=re.findall(rb'\\((?:[^()\\\\]|\\\\.)*\\)\\s*Tj',txt)
print('LATIN:', b' '.join(lits[:400]).decode('latin1')[:1200])
print('GLYPHRUNS:', len(re.findall(rb'/S_[A-Za-z_]+',txt)), sorted(set(x.decode() for x in re.findall(rb'/S_[A-Za-z_]+',txt))))
`])).stdout;
console.log('   pdf:', pdfInfo.replace(/\s+/g, ' ').slice(0, 700));
ck('the PDF is still a PDF (no exception) and prints something for every span',
   /LATIN:/.test(pdfInfo) && /lamp/.test(pdfInfo));

console.log('pageerrors:', errors.length ? errors : 'none');
console.log('\ncc-LEGACY-TONGUE VERDICT:', checks.every(Boolean) && !errors.length ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.every(Boolean) ? 'none' : checks.filter(x => !x).length);
await browser.close();
await srv.close();
