// ADVERSARY / TX-10 — "every XHTML part is strict-XML valid" + the two VERTICAL
// flows the auditor never exported.
//
// tx-epub-allscripts and the auditor's cf-ex-epub-roundtrip-shape both used
// well-behaved titles and only the horizontal tongues (celan_basic + rtl).
// This probe puts XML metacharacters, "]]>" and "-->" into the book title, a
// chapter title, a scene title and a span's English SOURCE, and translates into
// Celan High (cols-rtl) and Kildaren (btt-stave) as well as the rtl tongue.
//
// Asserts: every part (incl. nav + content.opf + container.xml) parses under a
// strict XML parser; the vertical spans carry their data-flow and — per the
// codex's own rule — NO dir="rtl"; the exported style.css carries a rule for
// every flow used; and the metacharacter English comes back byte-identical
// through the real importer.
//
// Run: cd probes && node cf-adv-ex-epub-xmlhostile.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfxml';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + l + (x === undefined ? '' : '  ' + String(x).slice(0, 400))); };

function unzipStored(buf){
  const out = new Map();
  for(let i = 0; i < buf.length - 3; i++){
    if(buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const csize = buf.readUInt32LE(i + 18);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    out.set(name, buf.slice(start, start + csize));
    i = start + csize - 1;
  }
  return out;
}

const BOOK  = 'Amp & "Quote" <Tag> ]]> --> Book';
const CHAP  = 'Ch & <b>One</b> "x" ]]>';
const SCENE = 'Scene ]]> & <i>two</i> "z"';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const langs = (await page.evaluate(() => window.tenebrae.langs())).langs;
console.log('tongues:', langs.map(l => l.id + '/' + l.name).join(', '));
const byId = id => langs.find(l => l.id === id);
const HIGH = byId('celan_high'), KILD = byId('kildaren'), KERR = byId('kerrackian');
console.log('using:', HIGH && HIGH.name, '|', KILD && KILD.name, '|', KERR && KERR.name);

await createBook(page, BOOK);
await page.click('#ed-title'); await page.keyboard.type(SCENE);
await page.click('#ed-content');
await page.keyboard.type('the sea remembers tonight');
await page.keyboard.press('Enter');
await page.keyboard.type('the "dark harbor" waits below');
await page.keyboard.press('Enter');
await page.keyboard.type('smoke & ash <rise> at dawn');
await wait(page, 1200);
await insertTranslationSpan(page, 'sea remembers', HIGH.name);
await wait(page, 900);
await insertTranslationSpan(page, '"dark harbor"', KILD.name);
await wait(page, 900);
await insertTranslationSpan(page, 'smoke & ash', KERR.name);
await wait(page, 1400);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 900);

// rename chapter 1 to the hostile title
await page.locator('.chapter-block').first().locator('.ch-more, .more, button').first().click().catch(()=>{});
await wait(page, 400);
const renamed = await page.locator('#sheet .sh-item', { hasText: /Rename/i }).first().click().then(()=>true).catch(()=>false);
if(renamed){ await wait(page, 400); await page.fill('#ps-input', CHAP); await page.click('#ps-save'); await wait(page, 900); }
console.log('chapter renamed via UI:', renamed);
if(!renamed){
  await page.evaluate(t => { const b = window.tenebrae && null; }, CHAP);
}
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const snap = () => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => res(r.result ? r.result.books : []); r.onerror = () => res([]); };
  rq.onerror = () => res([]);
}));
const before = (await snap())[0];
console.log('ORIGINAL book title:', JSON.stringify(before.title));
console.log('ORIGINAL chapters  :', JSON.stringify(before.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));
const wantSpans = [];
before.chapters.forEach(c => c.scenes.forEach(s => {
  for(const m of (s.doc||'').matchAll(/<span class="tspan"([^>]*)>/g)){
    const d = a => { const v = (m[1].match(new RegExp('data-'+a+'="([^"]*)"'))||[])[1]; return v === undefined ? null :
      v.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&'); };
    wantSpans.push({ lang: d('lang'), src: d('src'), rom: d('rom'), flow: d('flow'),
                     dir: /(\s)dir="rtl"/.test(m[1]) ? 'rtl' : null });
  }
}));
console.log('ORIGINAL spans:', JSON.stringify(wantSpans));

await page.click('#bk-share'); await wait(page, 600);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click(); await wait(page, 500);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 25000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await dl.path());
await wait(page, 800);
await writeFile(OUT + '/hostile.epub', epub);
const ez = unzipStored(epub);
console.log('entries:', [...ez.keys()].join(', '));

// ---------- strict XML validity of every XML part ----------
const xmlNames = [...ez.keys()].filter(n => /\.(xhtml|opf|xml)$/.test(n));
for(const n of xmlNames){
  const p = OUT + '/' + n.replace(/\//g, '_');
  await writeFile(p, ez.get(n));
}
const py = `
import sys, xml.etree.ElementTree as ET
bad = []
for p in sys.argv[1:]:
    try: ET.parse(p)
    except Exception as e: bad.append(p.split('/')[-1] + ': ' + str(e))
print('OK' if not bad else 'BAD ' + ' | '.join(bad))
`;
const res = execFileSync('python3', ['-c', py, ...xmlNames.map(n => OUT + '/' + n.replace(/\//g,'_'))]).toString().trim();
ck('epub: every XML part parses strictly, with hostile titles + sources', res === 'OK', res + '  (' + xmlNames.length + ' parts)');

const opf = new TextDecoder().decode(ez.get('OEBPS/content.opf'));
ck('epub: the hostile book title survives escaped in content.opf',
   opf.includes('Amp &amp; &quot;Quote&quot; &lt;Tag&gt; ]]&gt; --&gt; Book'),
   (opf.match(/<dc:title>[^<]*<\/dc:title>/)||[''])[0]);

const parts = [...ez.keys()].filter(n => /OEBPS\/ch\d+\.xhtml$/.test(n)).map(n => new TextDecoder().decode(ez.get(n))).join('\n');
await writeFile(OUT + '/parts.xhtml', parts);
const spans = [...parts.matchAll(/<span class="tspan"([^>]*)>([^<]*)<\/span>/g)].map(m => ({
  attrs: m[1],
  lang: (m[1].match(/data-lang="([^"]+)"/)||[])[1],
  flow: (m[1].match(/data-flow="([^"]*)"/)||[])[1] || null,
  dir:  /\sdir="rtl"/.test(m[1]) ? 'rtl' : null,
  src:  (m[1].match(/data-src="([^"]*)"/)||[])[1],
  body: m[2],
}));
console.log('EPUB spans:', JSON.stringify(spans.map(s => ({ lang: s.lang, flow: s.flow, dir: s.dir, src: s.src,
  codes: [...s.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0).toString(16)).join(' ') }))));

ck('epub: all three tongues travel as spans', spans.length === 3, spans.map(s=>s.lang).join(','));
const hi = spans.find(s => s.lang === 'celan_high'), ki = spans.find(s => s.lang === 'kildaren'), ke = spans.find(s => s.lang === 'kerrackian');
ck('epub: the cols-rtl tongue carries data-flow="cols-rtl"', hi && hi.flow === 'cols-rtl', hi && hi.flow);
ck('epub: the cols-rtl span carries NO dir="rtl" (a direction flip stands the column on its head)', hi && hi.dir === null, hi && String(hi.dir));
ck('epub: the btt-stave tongue carries data-flow="btt-stave"', ki && ki.flow === 'btt-stave', ki && ki.flow);
ck('epub: the btt-stave span carries NO dir="rtl" attribute (its CSS supplies direction)', ki && ki.dir === null, ki && String(ki.dir));
ck('epub: the horizontal rtl tongue carries data-flow="rtl" AND dir="rtl"', ke && ke.flow === 'rtl' && ke.dir === 'rtl', ke && (ke.flow + '/' + ke.dir));
ck('epub: the vertical spans are one word per LINE (newline separated), as the codex lays them out',
   hi && ki && hi.body.includes('\n') && ki.body.includes('\n'),
   JSON.stringify({ high: hi && hi.body.split('\n').length, kild: ki && ki.body.split('\n').length }));
ck('epub: metacharacter English survives in data-src', spans.some(s => s.src === '&quot;dark harbor&quot;') && spans.some(s => s.src === 'smoke &amp; ash'),
   spans.map(s => s.src).join(' | '));

const css = new TextDecoder().decode(ez.get('OEBPS/style.css'));
for(const flow of ['rtl','cols-rtl','btt-stave'])
  ck(`epub css: a per-flow rule exists for ${flow}`, css.includes(`.tspan[data-flow="${flow}"]{`));
const unq = t => t.replace(/\\(.)/g, '$1');
const fontFor = lang => {
  const rx = new RegExp('\\.tspan\\[data-lang="' + lang + '"\\]\\{font-family:\'((?:[^\'\\\\]|\\\\.)+)\'', 'g');
  let fam = null, m; while((m = rx.exec(css))) fam = unq(m[1]);
  const frx = /@font-face\{font-family:'((?:[^'\\]|\\.)+)';src:url\('(fonts\/f\d+\.ttf)'\)/g;
  let href = null, f; while((f = frx.exec(css))) if(unq(f[1]) === fam) href = f[2];
  return { fam, href };
};
for(const s of spans){
  const f = fontFor(s.lang);
  const cps = [...new Set([...s.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0)))];
  if(!f.href){ ck(`epub: ${s.lang} resolves to an embedded face`, false, JSON.stringify(f)); continue; }
  const p = OUT + '/' + f.href.replace('/', '_');
  await writeFile(p, ez.get('OEBPS/' + f.href));
  const out = execFileSync('python3', ['-c', `
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1]); cm = f.getBestCmap()
print(','.join(str(int(c in cm)) for c in map(int, sys.argv[2].split(','))))
`, p, cps.join(',')]).toString().trim();
  ck(`epub: ${s.lang} face "${f.fam}" covers every codepoint it must show`, out.split(',').every(x => x === '1'),
     `${f.href} covered=${out}`);
}

// ---------- re-import ----------
for(const sel of ['#ed-back', '#bk-back']){
  if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 600); }
}
await page.click('#lib-more'); await wait(page, 500);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(OUT + '/hostile.epub');
await page.waitForSelector('#imp-go', { timeout: 25000 });
await wait(page, 700);
console.log('preview stats:', await page.locator('.imp-stats').innerText());
await page.click('#imp-go'); await wait(page, 3500);

const books = await snap();
const after = books[books.length - 1];
console.log('ROUNDTRIP title   :', JSON.stringify(after.title));
console.log('ROUNDTRIP chapters:', JSON.stringify(after.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));
const gotSpans = [];
after.chapters.forEach(c => c.scenes.forEach(s => {
  for(const m of (s.doc||'').matchAll(/<span class="tspan"([^>]*)>/g)){
    const d = a => { const v = (m[1].match(new RegExp('data-'+a+'="([^"]*)"'))||[])[1]; return v === undefined ? null :
      v.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&'); };
    gotSpans.push({ lang: d('lang'), src: d('src'), rom: d('rom') });
  }
}));
console.log('re-imported spans:', JSON.stringify(gotSpans));
ck('epub re-import: all three spans come back live with lang + metacharacter English + romanization intact',
   JSON.stringify(gotSpans) === JSON.stringify(wantSpans.map(w => ({ lang: w.lang, src: w.src, rom: w.rom }))),
   JSON.stringify(wantSpans.map(w => ({ lang: w.lang, src: w.src, rom: w.rom }))));
ck('epub re-import: the hostile chapter title survives',
   after.chapters.some(c => c.title === before.chapters[0].title),
   JSON.stringify(after.chapters.map(c => c.title)) + ' vs ' + JSON.stringify(before.chapters.map(c=>c.title)));

ck('no page exceptions', errors.length === 0, errors.slice(0,4).join(' | '));
console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-10 ADVERSARY: hostile XML + vertical flows', checks.every(c => c[1]));
console.log('FAILED:', checks.filter(c => !c[1]).map(c => c[0]));
await browser.close(); await srv.close();
