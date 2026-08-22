// ADVERSARY / TX-11 — "DOCX/Markdown/plain text carry romanization (never raw
// PUA) and keep the English source recoverable."
//
// The auditor proved this with ONE tongue (celan_basic) sitting in ordinary
// paragraphs. The clause is about the format, not about one tongue: this probe
// puts ALL SIX tongues — including the two VERTICAL ones, whose data-scr
// contains embedded NEWLINES, and the horizontal rtl one — into the structural
// positions the exporters treat specially: a heading, a blockquote, a list
// item, the first thing in a paragraph, and two spans side by side.
//
// Then it asserts, for .md / .txt / .docx: not one private-use codepoint
// anywhere; every romanization present; every English source recoverable (the
// marker in .md, the bracket in .txt/.docx); the docx romanization is its own
// italic run with the gloss upright beside it; and re-importing the .md brings
// all six back live with their tongue and English exact.
//
// Run: cd probes && node cf-adv-ex-legible-alltongues.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, insertTranslationSpan, selectWord, caretIn, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cflegible';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + l + (x === undefined ? '' : '  ' + String(x).slice(0, 300))); };
const PUA_G = /[-]/g;

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

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
const langs = (await page.evaluate(() => window.tenebrae.langs())).langs;
const N = id => langs.find(l => l.id === id).name;
console.log('tongues:', langs.map(l => l.id).join(','));

await createBook(page, 'Legible Book');
await page.click('#ed-title'); await page.keyboard.type('All Tongues');
await page.click('#ed-content');
await page.keyboard.type('opening line');
for(const line of ['the sea remembers tonight',
                   'chapter of dark harbor here',
                   'quote of old king now',
                   'list of cold water there',
                   'smoke rises and ash falls']){
  await page.keyboard.press('Enter');
  await page.keyboard.type(line);
}
await wait(page, 1200);

// block formats
await caretIn(page, 'chapter of dark');
await page.click('#fb-aa'); await wait(page, 300);
await page.click('#aa-panel [data-block="h2"]'); await wait(page, 400);
await caretIn(page, 'quote of old');
await page.click('#aa-panel [data-block="blockquote"]'); await wait(page, 400);
await caretIn(page, 'list of cold');
await page.click('.fb-row [data-cmd="insertUnorderedList"]'); await wait(page, 400);
await page.click('#fb-aa').catch(()=>{});
await wait(page, 500);

const PLAN = [
  ['sea remembers', 'celan_basic'],
  ['dark harbor',   'kerrackian'],
  ['old king',      'celan_high'],
  ['cold water',    'kildaren'],
  ['smoke',         'calgridarian'],
  ['ash',           'evernessian'],
];
for(const [phrase, id] of PLAN){
  await insertTranslationSpan(page, phrase, N(id));
  await wait(page, 700);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 250);
}
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 1200);

const live = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => res(r.result.books[0]); r.onerror = () => res(null); };
}));
const doc = live.chapters.map(c => c.scenes.map(s => s.doc).join('')).join('');
const dec = v => v == null ? null : v.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const want = [...doc.matchAll(/<span class="tspan"([^>]*)>/g)].map(m => ({
  lang: dec((m[1].match(/data-lang="([^"]*)"/)||[])[1]),
  src:  dec((m[1].match(/data-src="([^"]*)"/)||[])[1]),
  rom:  dec((m[1].match(/data-rom="([^"]*)"/)||[])[1]),
  scr:  dec((m[1].match(/data-scr="([^"]*)"/)||[])[1]),
}));
console.log('LIVE spans:', JSON.stringify(want.map(w => ({ lang: w.lang, src: w.src, rom: w.rom,
  scrHasNL: /\n|&#10;/.test(String(w.scr)) }))));
ck('precondition: all six tongues are live spans', want.length === 6 && new Set(want.map(w=>w.lang)).size === 6,
   want.map(w=>w.lang).join(','));
ck('precondition: the two vertical tongues carry NEWLINES inside data-scr (one word per column/stave)',
   ['celan_high','kildaren'].every(id => { const w = want.find(x=>x.lang===id); return w && /\n/.test(String(w.scr)); }),
   JSON.stringify(want.filter(w=>['celan_high','kildaren'].includes(w.lang)).map(w=>({l:w.lang, lines:String(w.scr).split('\n').length}))));

await page.click('#bk-share'); await wait(page, 700);
const md  = (await downloadFromSheet(page, 'Markdown (.md)')).text;
await page.click('#bk-share').catch(()=>{}); await wait(page, 600);
const txt = (await downloadFromSheet(page, 'plain text (.txt)')).text;
await writeFile(OUT + '/book.md', md); await writeFile(OUT + '/book.txt', txt);

await page.click('#bk-share').catch(()=>{}); await wait(page, 600);
const [ddl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Word (.docx)' }).click(),
]);
const docxBuf = await readFile(await ddl.path());
await wait(page, 600);
await writeFile(OUT + '/book.docx', docxBuf);
const dz = unzipStored(docxBuf);
const dxml = new TextDecoder().decode(dz.get('word/document.xml'));
await writeFile(OUT + '/document.xml', dxml);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });

console.log('--- md ---\n' + md + '\n--- txt ---\n' + txt);

ck('md: not one private-use codepoint', !PUA_RE.test(md), (md.match(PUA_G)||[]).map(c=>c.codePointAt(0).toString(16)).join(' '));
ck('txt: not one private-use codepoint', !PUA_RE.test(txt), (txt.match(PUA_G)||[]).map(c=>c.codePointAt(0).toString(16)).join(' '));
ck('docx: not one private-use codepoint in document.xml', !PUA_RE.test(dxml), (dxml.match(PUA_G)||[]).map(c=>c.codePointAt(0).toString(16)).join(' '));

const unesc = s => s.replace(/\\([\\`*_~\[\]<])/g, '$1');
for(const w of want){
  ck(`md: ${w.lang} — marker carries the tongue + English, body carries the romanization`,
     md.includes(`"language":"${w.lang}"`) && md.includes(`"source":"${w.src}"`) &&
     // the marker's JSON closes with } before the comment does: "source" is the
     // last field, but "…"-->' is not what the file says
     new RegExp('<!--tenebrae:begin[^>]*"source":"' + w.src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '"[^>]*-->(.*?)<!--tenebrae:end-->')
       .test(md.replace(/\n/g,' ')) &&
     unesc(md).includes(w.rom),
     JSON.stringify((md.match(new RegExp('<!--tenebrae:begin [^-]*?"source":"' + w.src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '"[^>]*-->[^<]*<!--tenebrae:end-->'))||[])[0]));
  ck(`txt: ${w.lang} — romanization with the English bracketed beside it`,
     txt.includes(`${w.rom} [${w.src}]`), txt.includes(w.rom) ? 'rom present' : 'ROM MISSING');
  const romRun = `<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${w.rom.replace(/&/g,'&amp;')}</w:t>`;
  const glossRun = `<w:r><w:t xml:space="preserve"> [${w.src.replace(/&/g,'&amp;')}]</w:t></w:r>`;
  ck(`docx: ${w.lang} — italic romanization run + separate upright gloss run`,
     dxml.includes(romRun) && dxml.includes(glossRun),
     (dxml.includes(romRun) ? '' : 'no italic rom run; ') + (dxml.includes(glossRun) ? '' : 'no gloss run'));
}
// per marker, not across them: a lazy [^]*? still runs from the FIRST begin to
// the SECOND end, so the old form reported a newline whenever two markers sat
// on two lines — which is every ordinary document
{
  const bodies = [...md.matchAll(/<!--tenebrae:begin[\s\S]*?-->([\s\S]*?)<!--tenebrae:end-->/g)].map(m => m[1]);
  ck('md: the vertical tongues\' newlines never leak into the marker body (a line break would split the paragraph)',
     bodies.length === want.length && bodies.every(b => b.indexOf('\n') === -1),
     JSON.stringify(bodies));
}

/* ---------- re-import the .md ---------- */
if(await page.locator('#bk-back').isVisible().catch(()=>false)){ await page.click('#bk-back'); await wait(page, 700); }
await page.click('#lib-more'); await wait(page, 500);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
]);
await chooser.setFiles(OUT + '/book.md');
await page.waitForSelector('#imp-go', { timeout: 20000 });
await wait(page, 700);
console.log('preview:', await page.locator('.imp-stats').innerText());
await page.click('#imp-go'); await wait(page, 3500);

const books = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => res(r.result.books); r.onerror = () => res([]); };
}));
const after = books[books.length - 1];
const adoc = after.chapters.map(c => c.scenes.map(s => s.doc).join('')).join('');
const got = [...adoc.matchAll(/<span class="tspan"([^>]*)>/g)].map(m => ({
  lang: dec((m[1].match(/data-lang="([^"]*)"/)||[])[1]),
  src:  dec((m[1].match(/data-src="([^"]*)"/)||[])[1]),
}));
console.log('re-imported spans:', JSON.stringify(got));
ck('md re-import: all six spans come back live with tongue + English exact',
   JSON.stringify(got) === JSON.stringify(want.map(w => ({ lang: w.lang, src: w.src }))),
   JSON.stringify(want.map(w => ({ lang: w.lang, src: w.src }))));
ck('md re-import: the span inside the HEADING is still inside a heading',
   /<h2>[^]*?<span class="tspan"[^>]*data-lang="kerrackian"/.test(adoc), (adoc.match(/<h2>[^<]*<span[^>]*data-lang="[a-z_]+"/)||['(none)'])[0]);
ck('md re-import: the span inside the BLOCKQUOTE is still inside a blockquote',
   /<blockquote>[^]*?<span class="tspan"[^>]*data-lang="celan_high"/.test(adoc));
ck('md re-import: the span inside the LIST ITEM is still inside a list item',
   /<li>[^]*?<span class="tspan"[^>]*data-lang="kildaren"/.test(adoc));

ck('no page exceptions', errors.length === 0, errors.slice(0,4).join(' | '));
console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11 ADVERSARY: six tongues through md/txt/docx', checks.every(c => c[1]));
console.log('FAILED:', checks.filter(c => !c[1]).map(c => c[0]));
await browser.close(); await srv.close();
