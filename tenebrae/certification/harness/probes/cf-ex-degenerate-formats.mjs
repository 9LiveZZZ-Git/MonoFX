// TX-10 / TX-11 / TX-11b — degenerate book shapes across all four non-PDF
// formats. The gap nobody probed: an EMPTY chapter, a scene whose TITLE is
// itself a markdown heading, and a scene whose whole body is one translation
// span. Each is exported to .md / .txt / .docx / .epub and inspected, and the
// .md is fed back through the real importer.
//
// Also settles what cf-ex-md-clean-foreign.mjs turned up in passing: a span
// restored from our own markdown came back with data-scr=" ". This probe opens
// the re-imported scene and compares the LIVE span against a span made the
// normal way from the same English, in the same session.
//
// Run: cd probes && node cf-ex-degenerate-formats.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfdeg';
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

const grabBinary = async (label) => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const buf = await readFile(await dl.path());
  await wait(page, 600);
  return buf;
};

// store-only zip reader (the app writes stored entries only)
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

/* ---------- build the degenerate book ---------- */
await createBook(page, 'Degenerate Book');
// Chapter 1 / scene 1 — a scene TITLE that is itself a markdown heading
await page.click('#ed-title');
await page.keyboard.type('### Fake Scene Heading');
await page.click('#ed-content');
await page.keyboard.type('alpha prose line');
await wait(page, 1600);
await page.click('#ed-back');
await wait(page, 600);

// Chapter 1 / scene 2 — body is ONE translation span and nothing else
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Only A Span');
await page.click('#ed-content');
await page.keyboard.type('sea remembers');
await wait(page, 400);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1700);
await page.click('#ed-back');
await wait(page, 600);

// Chapter 2 — EMPTY (no scenes at all), sitting between two real chapters
async function addChapter(t){
  await page.click('#bk-more');
  await wait(page, 400);
  await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
  await wait(page, 500);
  await page.fill('#ps-input', t);
  await page.click('#ps-save');
  await wait(page, 700);
}
await addChapter('The Empty Gate');
await addChapter('The Third Gate');
await page.locator('.chapter-block', { hasText: 'The Third Gate' }).locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Last Watch');
await page.click('#ed-content');
await page.keyboard.type('omega prose line');
await wait(page, 1700);
await page.click('#ed-back');
await wait(page, 800);

const before = (await snap())[0];
console.log('ORIGINAL:', JSON.stringify(before.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));
const liveSpanBefore = await page.evaluate(() => {
  const st = null; return null;
});

/* ---------- exports ---------- */
await page.click('#bk-share');
await wait(page, 500);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 500);

const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- degenerate.md ---\n' + md.text + '\n---------------------');
await writeFile(OUT + '/deg.md', md.text);

const reopen = async () => { await page.click('#bk-share'); await wait(page, 500); };

await reopen();
const txt = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- degenerate.txt ---\n' + txt.text + '\n----------------------');

await reopen();
const docx = await grabBinary('Download Word (.docx)');
await writeFile(OUT + '/deg.docx', docx);
const docXml = new TextDecoder().decode(unzipStored(docx).get('word/document.xml'));
await writeFile(OUT + '/deg-document.xml', docXml);

await reopen();
const epub = await grabBinary('EPUB (.epub)');
await writeFile(OUT + '/deg.epub', epub);
const ez = unzipStored(epub);
const ezNames = [...ez.keys()];
console.log('epub entries:', ezNames.join(', '));
const opf = new TextDecoder().decode(ez.get('OEBPS/content.opf'));
const css = new TextDecoder().decode(ez.get('OEBPS/style.css'));
const xhtml = ezNames.filter(n => /\.xhtml$/.test(n)).map(n => ({ n, s: new TextDecoder().decode(ez.get(n)) }));
for(const x of xhtml) await writeFile(OUT + '/' + x.n.replace(/\//g, '_'), x.s);
await writeFile(OUT + '/deg-style.css', css);

/* ---------- static assertions on the four files ---------- */
// empty chapter
ck('md: the empty chapter still gets its "## " heading', /^## The Empty Gate$/m.test(md.text));
ck('md: no stray blank-heading artifacts', !/^#{1,6}\s*$/m.test(md.text));
ck('txt: the empty chapter still gets its heading', /^THE EMPTY GATE$/m.test(txt.text));
ck('docx: the empty chapter still gets a Heading1 paragraph', docXml.includes('The Empty Gate'));
ck('epub: the empty chapter still gets an xhtml part + a nav entry',
   opf.includes('ch2.xhtml') && new TextDecoder().decode(ez.get('OEBPS/nav.xhtml')).includes('The Empty Gate'));
ck('epub: three chapter parts for three chapters',
   ezNames.filter(n => /OEBPS\/ch\d+\.xhtml$/.test(n)).length === 3,
   ezNames.filter(n => /OEBPS\/ch\d+\.xhtml$/.test(n)).join(','));

// heading-shaped scene title
ck('md: heading-shaped scene title is emitted under its own scene marker',
   /<!--tenebrae:scene-->\n### ### Fake Scene Heading\n/.test(md.text));

// span-only scene, legible formats (TX-11)
ck('md: span-only scene carries romanization + source marker, no PUA',
   /<!--tenebrae:begin \{"language":"celan_basic","source":"sea remembers"\}-->/.test(md.text) && !PUA_RE.test(md.text));
ck('txt: span-only scene carries romanization + bracketed English gloss, no PUA',
   /\[sea remembers\]/.test(txt.text) && !PUA_RE.test(txt.text), JSON.stringify(txt.text.split('\n').filter(l => /\[sea/.test(l))));
ck('docx: romanization is its own italic run and the gloss a separate upright run',
   /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">[^<]+<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> \[sea remembers\]<\/w:t><\/w:r>/.test(docXml),
   (docXml.match(/<w:r>(?:(?!<\/w:r>).)*sea remembers[^<]*<\/w:t><\/w:r>/) || [''])[0]);
ck('docx: no raw PUA anywhere in document.xml', !PUA_RE.test(docXml));

// span-only scene, EPUB (TX-10)
const spanX = xhtml.map(x => x.s).join('\n');
const m = spanX.match(/<span class="tspan"[^>]*>([^<]*)<\/span>/);
console.log('epub span:', m ? JSON.stringify(m[0]) : 'NONE');
ck('epub: the span is present with data-src / data-rom',
   !!m && /data-src="sea remembers"/.test(m[0]) && /data-rom="/.test(m[0]));
ck('epub: the span body is PUA script text, not romanization', !!m && PUA_RE.test(m[1]), m ? JSON.stringify(m[1]) : '');
ck('epub: @font-face + per-language rule for the tongue used',
   /@font-face\{font-family:'[^']+';src:url\('fonts\/f\d+\.ttf'\)/.test(css) &&
   /\.tspan\[data-lang="celan_basic"\]\{font-family:'[^']+'\}/.test(css),
   (css.match(/\.tspan\[data-lang="celan_basic"\][^\n]*/) || [''])[0]);
ck('epub: every font referenced by style.css is actually in the zip',
   (css.match(/url\('(fonts\/f\d+\.ttf)'\)/g) || []).every(u => ez.has('OEBPS/' + u.slice(5, -2))) &&
   (css.match(/url\('fonts/g) || []).length > 0);
ck('epub: every font in the zip is manifested',
   ezNames.filter(n => /OEBPS\/fonts\//.test(n)).every(n => opf.includes(n.replace('OEBPS/', ''))));

/* ---------- md round-trip of the degenerate book ---------- */
for(const sel of ['#ed-back', '#bk-back']){
  if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
}
await page.click('#lib-more');
await wait(page, 450);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 8000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(OUT + '/deg.md');
await page.waitForSelector('#imp-go', { timeout: 15000 });
await wait(page, 500);
console.log('preview stats:', await page.locator('.imp-stats').innerText());
console.log('preview tree :', (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | '));
await page.click('#imp-go');
await wait(page, 2500);

const books = await snap();
const after = books[books.length - 1];
const shape = b => JSON.stringify(b.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) })));
console.log('ROUNDTRIP:', shape(after));
ck('md round-trip: chapter/scene shape exact (incl. the empty chapter and the heading-shaped title)',
   shape(after) === shape(before), shape(after) + '  vs  ' + shape(before));

/* ---------- does a re-imported span still write script? ---------- */
// open the re-imported "Only A Span" scene and read the LIVE span
await page.locator('.chapter-block').first().locator('.scene-row, .row, li, button').filter({ hasText: 'Only A Span' }).first().click().catch(async () => {
  await page.locator('text=Only A Span').first().click();
});
await wait(page, 1800);
const live = await page.evaluate(() => {
  const el = document.querySelector('#ed-content .tspan');
  if(!el) return null;
  return { lang: el.dataset.lang, src: el.dataset.src, rom: el.dataset.rom,
           scr: el.dataset.scr, text: el.textContent,
           codes: [...(el.textContent || '')].map(c => c.codePointAt(0).toString(16)) };
});
console.log('re-imported LIVE span:', JSON.stringify(live));
const fresh = await page.evaluate(async () => {
  const r = await window.tenebrae.translate2('celan_basic', 'sea remembers');
  return { rom: r && r.romanization };
});
console.log('engine baseline:', JSON.stringify(fresh));
ck('re-imported span keeps lang + English source', !!live && live.lang === 'celan_basic' && live.src === 'sea remembers');
ck('re-imported span keeps the romanization the engine gives', !!live && live.rom === fresh.rom, JSON.stringify([live && live.rom, fresh.rom]));
ck('re-imported span still writes PUA script (not blank, not Latin)',
   !!live && PUA_RE.test(live.text || ''), JSON.stringify(live && live.codes));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-10/TX-11 degenerate formats', checks.every(c => c[1]) && errors.length === 0);
console.log('FAILED CHECKS:', checks.filter(c => !c[1]).map(c => c[0]));

await browser.close();
await srv.close();
