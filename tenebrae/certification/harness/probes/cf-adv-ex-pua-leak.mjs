// ADVERSARY / TX-11 — isolating the raw-PUA leak found by
// cf-adv-ex-legible-alltongues.mjs.
//
// TX-11: "DOCX/Markdown/plain text carry romanization (never raw PUA)".
// The auditor filed the empty-data-rom fallback as an unreachable anomaly.
// This probe reaches raw PUA in all three legible formats through the ordinary
// UI, and narrows WHICH shape does it: a VERTICAL tongue (btt-stave/cols-rtl,
// whose script text contains newlines) translated inside a LIST ITEM, versus
// the same tongue in a plain paragraph, versus a horizontal tongue in a list.
//
// Run: cd probes && node cf-adv-ex-pua-leak.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, insertTranslationSpan, caretIn, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfpua';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + l + (x === undefined ? '' : '  ' + String(x).slice(0, 400))); };
const puaOf = s => [...String(s)].filter(c => PUA_RE.test(c)).map(c => c.codePointAt(0).toString(16));

function unzipStored(buf){
  const out = new Map();
  for(let i = 0; i < buf.length - 3; i++){
    if(buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const csize = buf.readUInt32LE(i + 18);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    out.set(name, buf.slice(start, start + csize)); i = start + csize - 1;
  }
  return out;
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
const langs = (await page.evaluate(() => window.tenebrae.langs())).langs;
const N = id => langs.find(l => l.id === id).name;

await createBook(page, 'Pua Leak Book');
await page.click('#ed-title'); await page.keyboard.type('Leak Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
for(const l of ['alpha of cold water here', 'beta of dark harbor here', 'gamma of old king here'])
  { await page.keyboard.press('Enter'); await page.keyboard.type(l); }
await wait(page, 1200);

// lines 1+2 become list items; line 3 stays a paragraph
await caretIn(page, 'alpha of cold');
await page.click('.fb-row [data-cmd="insertUnorderedList"]'); await wait(page, 500);
await caretIn(page, 'beta of dark');
await page.click('.fb-row [data-cmd="insertUnorderedList"]'); await wait(page, 500);

const shots = {};
for(const [phrase, id, tag] of [['cold water','kildaren','vertical-in-list'],
                                ['dark harbor','kerrackian','horizontal-in-list'],
                                ['old king','celan_high','vertical-in-paragraph']]){
  await insertTranslationSpan(page, phrase, N(id));
  await wait(page, 800);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 300);
  shots[tag] = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
}
await wait(page, 1500);
await page.click('#ed-back'); await wait(page, 1200);

const book = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const r = rq.result.transaction('kv','readonly').objectStore('kv').get('state');
    r.onsuccess = () => res(r.result.books[0]); r.onerror = () => res(null); };
}));
const doc = book.chapters[0].scenes[0].doc;
await writeFile(OUT + '/doc.html', doc);
console.log('STORED DOC:\n' + doc.replace(/[-]/g, c => '\\u' + c.codePointAt(0).toString(16)) + '\n');

// PUA that is NOT inside a .tspan element = a bare script text node the
// exporters have no romanization for
const strayLive = await page.evaluate(() => {
  const tpl = document.createElement('template'); tpl.innerHTML = arguments0 || '';
  return null;
}).catch(()=>null);
const stray = await page.evaluate(html => {
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  tpl.content.querySelectorAll('.tspan').forEach(s => s.remove());
  const t = tpl.content.textContent || '';
  return [...t].filter(c => c >= '' && c <= '').map(c => c.codePointAt(0).toString(16));
}, doc);
console.log('PUA outside any .tspan in the stored doc:', JSON.stringify(stray));
ck('stored doc: no private-use text outside a translation span', stray.length === 0, stray.join(' '));

for(const [tag, html] of Object.entries(shots)){
  const bare = await page.evaluate(h => {
    const tpl = document.createElement('template'); tpl.innerHTML = h;
    tpl.content.querySelectorAll('.tspan').forEach(s => s.remove());
    return [...(tpl.content.textContent||'')].filter(c => c >= '' && c <= '').map(c => c.codePointAt(0).toString(16));
  }, html);
  console.log(`after "${tag}": stray PUA =`, JSON.stringify(bare));
}

await page.click('#bk-share'); await wait(page, 700);
const md = (await downloadFromSheet(page, 'Markdown (.md)')).text;
await page.click('#bk-share').catch(()=>{}); await wait(page, 600);
const txt = (await downloadFromSheet(page, 'plain text (.txt)')).text;
await page.click('#bk-share').catch(()=>{}); await wait(page, 600);
const [ddl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'Word (.docx)' }).click(),
]);
const dxml = new TextDecoder().decode(unzipStored(await readFile(await ddl.path())).get('word/document.xml'));
await wait(page, 500);
await writeFile(OUT + '/book.md', md); await writeFile(OUT + '/book.txt', txt); await writeFile(OUT + '/document.xml', dxml);

console.log('\nMD:\n' + md.replace(/[-]/g, c => '\\u' + c.codePointAt(0).toString(16)));
console.log('\nTXT:\n' + txt.replace(/[-]/g, c => '\\u' + c.codePointAt(0).toString(16)));

ck('TX-11 md: not one private-use codepoint', !PUA_RE.test(md), puaOf(md).join(' '));
ck('TX-11 txt: not one private-use codepoint', !PUA_RE.test(txt), puaOf(txt).join(' '));
ck('TX-11 docx: not one private-use codepoint', !PUA_RE.test(dxml), puaOf(dxml).join(' '));

const kild = puaOf(md).filter(h => h >= 'e600' && h < 'e680').length;
const kerr = puaOf(md).filter(h => h >= 'e580' && h < 'e600').length;
const high = puaOf(md).filter(h => h >= 'e500' && h < 'e580').length;
console.log(`leak by tongue in .md — kildaren(btt-stave, in list): ${kild}  kerrackian(rtl, in list): ${kerr}  celan_high(cols-rtl, in paragraph): ${high}`);

ck('no page exceptions', errors.length === 0, errors.slice(0,4).join(' | '));
verdict('TX-11 ADVERSARY: raw PUA leak into the legible formats', checks.every(c => c[1]));
console.log('FAILED:', checks.filter(c => !c[1]).map(c => c[0]));
await browser.close(); await srv.close();
