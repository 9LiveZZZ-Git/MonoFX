// TX-10 (round-trip clause) — "re-importing restores live spans with source
// intact", on the shapes nobody exported to EPUB before: a chapter that is
// EMPTY, a scene carrying an in-scene ⁂ break, and two different tongues
// (a cols-rtl one and the horizontal rtl one) in the same scene.
//
// Checks the EPUB is self-consistent from the outside (every span's PUA
// codepoints are covered by the cmap of the font its data-lang maps to), then
// feeds the file back through the real importer and looks at the LIVE spans.
//
// Run: cd probes && node cf-ex-epub-roundtrip-shape.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfepub';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra)); return ok; };

const { srv, browser, page, errors } = await launch();

const snap = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('tenebrae-writer', 1);
  req.onsuccess = () => {
    const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    r.onsuccess = () => { const st = r.result; resolve(!st ? [] : st.books.map(b => ({
      title: b.title,
      chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc })) }))
    }))); };
    r.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));

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

const langs = (await page.evaluate(() => window.tenebrae.langs())).langs;
console.log('tongues:', langs.map(l => l.id + '/' + l.name).join(', '));
const kerr = langs.find(l => /kerrack/i.test(l.name)) || langs[1];

await createBook(page, 'Epub Shape Book');
await page.click('#ed-title');
await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('the sea remembers tonight');
await page.keyboard.press('Enter');
await page.keyboard.type('the dark harbor waits below');
await wait(page, 400);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await insertTranslationSpan(page, 'dark harbor', kerr.name);
await wait(page, 500);
// in-scene ⁂ break at the end
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, hit = null;
  while((n = w.nextNode())) if(n.nodeValue.includes('waits below')) hit = n;
  if(hit){ const r = document.createRange(); r.setStart(hit, hit.nodeValue.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
});
await page.keyboard.press('Enter');
await page.click('#fb-break');
await wait(page, 300);
await page.keyboard.type('after the break line');
await wait(page, 1700);
await page.click('#ed-back');
await wait(page, 600);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Second Sight');
await page.click('#ed-content');
await page.keyboard.type('beta two words');
await wait(page, 1700);
await page.click('#ed-back');
await wait(page, 600);

await page.click('#bk-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
await wait(page, 500);
await page.fill('#ps-input', 'The Empty Gate');
await page.click('#ps-save');
await wait(page, 1500);

const before = (await snap())[0];
console.log('ORIGINAL:', JSON.stringify(before.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));

await page.click('#bk-share');
await wait(page, 500);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 500);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await dl.path());
await wait(page, 700);
await writeFile(OUT + '/shape.epub', epub);
const ez = unzipStored(epub);
const names = [...ez.keys()];
console.log('epub entries:', names.join(', '));
const css = new TextDecoder().decode(ez.get('OEBPS/style.css'));
const parts = names.filter(n => /OEBPS\/ch\d+\.xhtml$/.test(n)).map(n => new TextDecoder().decode(ez.get(n)));
const allX = parts.join('\n');
await writeFile(OUT + '/ch-all.xhtml', allX);

const spans = [...allX.matchAll(/<span class="tspan"([^>]*)>([^<]*)<\/span>/g)].map(m => ({ attrs: m[1], body: m[2] }));
console.log('spans found:', spans.length, spans.map(s => s.attrs.match(/data-lang="([^"]+)"/)[1]).join(','));
ck('epub: both spans present as PUA text with data-src/data-rom',
   spans.length === 2 && spans.every(s => PUA_RE.test(s.body) && /data-src="/.test(s.attrs) && /data-rom="/.test(s.attrs)));
ck('epub: the rtl span carries data-flow="rtl"', spans.some(s => /data-flow="rtl"/.test(s.attrs)),
   spans.map(s => (s.attrs.match(/data-flow="[^"]*"/) || ['(none)'])[0]).join(' '));
ck('epub: the in-scene ⁂ travels as <p class="ast">', /<p class="ast">⁂<\/p>/.test(allX));
ck('epub: the EMPTY chapter still gets its own part (one part per chapter)',
   names.filter(n => /ch\d+\.xhtml$/.test(n)).length === before.chapters.length,
   names.filter(n => /ch\d+\.xhtml$/.test(n)).join(',') + ' for ' + before.chapters.length + ' chapters');

// font truth: every span's PUA codepoints must be in the cmap of the font its
// data-lang maps to, via style.css
// NOTE: epubLangCSS emits the legacy SAMPLE codex rules FIRST and the forged
// codex rules LAST (step1.html L2535-2547), and four ids collide (kerrackian,
// kildaren, calgridarian, evernessian). Equal specificity means the LAST rule
// wins, so the resolver must take the last match, not the first. Family names
// are single-quoted with \' escaping (cssq, L2533).
const unq = t => t.replace(/\\(.)/g, '$1');
const fontFor = lang => {
  const rx = new RegExp('\\.tspan\\[data-lang="' + lang + '"\\]\\{font-family:\'((?:[^\'\\\\]|\\\\.)+)\'', 'g');
  let fam = null, m;
  while((m = rx.exec(css))) fam = unq(m[1]);
  if(!fam) return null;
  const frx = /@font-face\{font-family:'((?:[^'\\]|\\.)+)';src:url\('(fonts\/f\d+\.ttf)'\)/g;
  let href = null, f;
  while((f = frx.exec(css))) if(unq(f[1]) === fam) href = f[2];
  return { fam, href };
};
for(const s of spans){
  const lang = s.attrs.match(/data-lang="([^"]+)"/)[1];
  const f = fontFor(lang);
  if(!f || !f.href){ ck(`epub: ${lang} resolves to an embedded face`, false, JSON.stringify(f)); continue; }
  const p = OUT + '/' + f.href.replace('/', '_');
  await writeFile(p, ez.get('OEBPS/' + f.href));
  const cps = [...new Set([...s.body].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0)))];
  const out = execFileSync('python3', ['-c', `
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
cmap = f.getBestCmap()
print(','.join(str(int(c in cmap)) for c in map(int, sys.argv[2].split(','))))
`, p, cps.join(',')]).toString().trim();
  ck(`epub: ${lang} font "${f.fam}" cmaps every PUA codepoint it is asked to show`,
     out.split(',').every(x => x === '1'), `${f.href} cps=${cps.map(c=>c.toString(16)).join(' ')} covered=${out}`);
}

/* ---------- re-import ---------- */
for(const sel of ['#ed-back', '#bk-back']){
  if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
}
await page.click('#lib-more');
await wait(page, 450);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(OUT + '/shape.epub');
await page.waitForSelector('#imp-go', { timeout: 20000 });
await wait(page, 600);
console.log('preview stats:', await page.locator('.imp-stats').innerText());
console.log('preview tree :', (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '));
await page.click('#imp-go');
await wait(page, 3000);

const books = await snap();
const after = books[books.length - 1];
console.log('ROUNDTRIP:', JSON.stringify(after.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));
const doc = after.chapters.map(c => c.scenes.map(s => s.doc).join('')).join('');
const got = [...doc.matchAll(/<span class="tspan"([^>]*)>/g)].map(m => ({
  lang: (m[1].match(/data-lang="([^"]+)"/) || [])[1],
  src: (m[1].match(/data-src="([^"]+)"/) || [])[1],
  rom: (m[1].match(/data-rom="([^"]+)"/) || [])[1],
}));
console.log('re-imported spans:', JSON.stringify(got));
const want = [...before.chapters[0].scenes[0].doc.matchAll(/<span class="tspan"([^>]*)>/g)].map(m => ({
  lang: (m[1].match(/data-lang="([^"]+)"/) || [])[1],
  src: (m[1].match(/data-src="([^"]+)"/) || [])[1],
  rom: (m[1].match(/data-rom="([^"]+)"/) || [])[1],
}));
console.log('original   spans:', JSON.stringify(want));
ck('epub re-import: both spans come back live', got.length === want.length, `${got.length} vs ${want.length}`);
ck('epub re-import: tongue + English source + romanization intact',
   JSON.stringify(got) === JSON.stringify(want));
ck('epub re-import: no romanization-as-Latin fallback (spans are real spans)',
   got.every(g => g.lang && g.src));
ck('epub re-import: chapter titles survive',
   JSON.stringify(after.chapters.map(c => c.title)) === JSON.stringify(before.chapters.map(c => c.title)),
   JSON.stringify(after.chapters.map(c => c.title)));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-10 epub round-trip shape', checks.every(c => c[1]) && errors.length === 0);
console.log('FAILED CHECKS:', checks.filter(c => !c[1]).map(c => c[0]));

await browser.close();
await srv.close();
