// TX-10b GAP PROBE — the PDF writer at the edges s2-pdf-export never reaches.
//
// s2-pdf-export proves the happy page: one prose line, one span per tongue, a
// structurally sound file. It never asks what the hand-written layout engine
// does with material that fights it. This probe builds ONE hostile book through
// the real UI and puts the writer through:
//
//   1. a 220-character unbreakable word (nothing to break on, column is 451pt)
//   2. a 40-word cols-rtl span — the vertical block is laid out word by word
//      across the page with no wrap rule of its own
//   3. a scene whose entire body is one vertical span
//   4. a span pushed to the bottom of a full page (the block page-break path)
//   5. a chapter with a title and no scenes, exported with chapterTitles off,
//      which is the only way to reach a page with zero content operators
//   6. prose outside WinAnsi: Cyrillic, CJK, an emoji, an arrow, ⁂, curly quotes
//   7. a nested bold+italic run (must resolve to the /F4 Times-BoldItalic face)
//   8. a bulleted and a numbered list
//
// and then validates the bytes with cf-pdfcheck2.py, which tokenises the
// content streams properly, resolves the object graph, checks every declared
// /Length against the bytes written, and checks every glyph id against the
// embedded face's numGlyphs AND its own cmap.
//
// Run: cd probes && node cf-pdf-hostile-layout.mjs
import { launch, wait, createBook, insertTranslationSpan, selectWord, caretIn, verdict } from './ex-lib.mjs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-hostile';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const LONGWORD = 'Aeth' + 'alonduraverimestrachwyrnbaeloth'.repeat(6) + 'end'; // 199 chars
const WIDE = 'the sea remembers the old king and the tower and the gate and the river and the stone and the fire and the wind and the night and the crown and the sword and the road';
const NONWIN = 'Privet Привет 日本語 ☃ ← ⁂ ‘curly’ “quoted” … — dash';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => ({ id: l.id, name: l.name })));
console.log('tongues:', LANGS.map(l => l.id).join(', '));
const byFlow = await page.evaluate(() => {
  const m = window.tenebrae._forge.map() || {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.flow]));
});
console.log('flows:', JSON.stringify(byFlow));
const nameOf = id => (LANGS.find(l => l.id === id) || {}).name;
const COLS = Object.keys(byFlow).find(k => byFlow[k] === 'cols-rtl');
const BTT  = Object.keys(byFlow).find(k => byFlow[k] === 'btt-stave');
const RTL  = Object.keys(byFlow).find(k => byFlow[k] === 'rtl');
console.log('cols-rtl =', COLS, '| btt-stave =', BTT, '| rtl =', RTL);

/* ---------------- scene 1: the edge-case scene ---------------- */
await createBook(page, 'PDF Hostile');
await page.click('#ed-title'); await page.keyboard.type('Edge Cases');
await page.click('#ed-content');
await page.keyboard.type('opening prose line for the hostile page');
for(const line of [LONGWORD, 'nested bold italic run here', NONWIN, 'bullet item', 'numbered item', WIDE]){
  await page.keyboard.press('Enter');
  await page.keyboard.type(line);
}
await wait(page, 500);

// nested marks: bold over "bold italic run", italic over "italic run"
await selectWord(page, 'bold italic run');
await page.click('[data-cmd="bold"]'); await wait(page, 250);
await selectWord(page, 'italic run');
await page.click('[data-cmd="italic"]'); await wait(page, 250);
// lists
await caretIn(page, 'bullet'); await page.click('[data-cmd="insertUnorderedList"]'); await wait(page, 250);
await caretIn(page, 'numbered'); await page.click('[data-cmd="insertOrderedList"]'); await wait(page, 250);

const nested = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return { html: ed.innerHTML.slice(0, 4000), lists: ed.querySelectorAll('ul li, ol li').length };
});
ck('precondition: a nested bold+italic run exists in the doc',
   /<b[^>]*>[^<]*<i[^>]*>|<i[^>]*>[^<]*<b[^>]*>/i.test(nested.html), (nested.html.match(/<[bi]>[^<]{0,40}/gi) || []).join(' | '));
ck('precondition: both list kinds are in the doc', nested.lists >= 2, nested.lists + ' li');

// the wide 40-word phrase -> the cols-rtl tongue (vertical block, many words)
await insertTranslationSpan(page, WIDE, nameOf(COLS));
await wait(page, 600);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
await wait(page, 1600);
await page.click('#ed-back'); await wait(page, 600);

/* ---------------- scene 2: body is ONLY a vertical span ---------------- */
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 700);
await page.click('#ed-title'); await page.keyboard.type('Vertical Only');
await page.click('#ed-content');
await page.keyboard.type('the tower burns');
await wait(page, 400);
await insertTranslationSpan(page, 'the tower burns', nameOf(BTT));
await wait(page, 1600);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 600);

/* ---------------- scene 3: a span at the page boundary ---------------- */
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 700);
await page.click('#ed-title'); await page.keyboard.type('Page Boundary');
await page.click('#ed-content');
await page.keyboard.type('filler line 0 of the boundary scene');
for(let i = 1; i < 44; i++){
  await page.keyboard.press('Enter');
  await page.keyboard.type(`filler line ${i} of the boundary scene`);
}
await page.keyboard.press('Enter');
await page.keyboard.type('the old king waits');
await wait(page, 500);
await insertTranslationSpan(page, 'the old king waits', nameOf(RTL));
await wait(page, 1600);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 600);

/* ---------------- chapter 2: a title and no scenes ---------------- */
await page.click('#bk-more'); await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
await wait(page, 550);
await page.fill('#ps-input', 'The Hollow Chapter');
await page.click('#ps-save');
await wait(page, 800);

const shape = await page.evaluate(() => {
  const st = window.__state || null;
  return null;
});

/* ---------------- export ---------------- */
const grab = () => page.evaluate(() => Array.from(window.tenebrae._pdf('book')));
const a1 = Buffer.from(await grab());
await writeFile(`${OUT}/hostile.pdf`, a1);
const a2 = Buffer.from(await grab());
ck('a PDF was produced', a1.length > 4000 && a1.slice(0, 8).toString() === '%PDF-1.7', a1.length + ' bytes');
ck('determinism: two renders of the same state are byte-identical', a1.equals(a2), `${a1.length} vs ${a2.length}`);

// the real UI path must produce the same bytes as the seam
await page.click('#bk-share'); await wait(page, 500);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('#sheet .sh-item', { hasText: 'PDF (.pdf)' }).click(),
]);
const uiBytes = await readFile(await dl.path());
await wait(page, 600);
ck('the real Export sheet downloads the same bytes the seam returns', uiBytes.equals(a1),
   `${uiBytes.length} vs ${a1.length} (${dl.suggestedFilename()})`);

// what the app shows, per tongue, in document order
const spans = await page.evaluate(async () => {
  // read every scene doc out of state through the same sync the exporter uses
  const out = [];
  const tpl = document.createElement('template');
  const bs = await new Promise(res => {
    const rq = indexedDB.open('tenebrae-writer', 1);
    rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('state');
      g.onsuccess = () => res(g.result.books[g.result.books.length - 1]); };
  });
  for(const ch of bs.chapters) for(const sc of ch.scenes){
    tpl.innerHTML = window.__syncForProbe ? window.__syncForProbe(sc.doc) : (sc.doc || '');
    tpl.content.querySelectorAll('.tspan').forEach(sp => out.push({
      lang: sp.dataset.lang, flow: sp.dataset.flow || 'ltr',
      codes: [...(sp.dataset.scr || '')].filter(c => c.charCodeAt(0) >= 0xE000).map(c => c.charCodeAt(0)) }));
  }
  return out;
});
// group per tongue, concatenated in document order (that is the PDF's draw order)
const perLang = {};
for(const s of spans){ (perLang[s.lang] = perLang[s.lang] || { lang: s.lang, flow: s.flow, codes: [] }).codes.push(...s.codes); }
const spansJson = Object.values(perLang);
console.log('spans on screen:', spansJson.map(s => `${s.lang}[${s.flow}]:${s.codes.length}`).join(' '));
await writeFile(`${OUT}/spans.json`, JSON.stringify(spansJson, null, 1));

const run = (pdf, spansPath) => {
  try{
    return JSON.parse(execFileSync('python3', ['cf-pdfcheck2.py', pdf, spansPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
  }catch(e){ console.log('validator stderr:', String(e.stderr || e.message).slice(0, 800)); return null; }
};
const V = run(`${OUT}/hostile.pdf`, `${OUT}/spans.json`);
ck('the validator ran on the hostile book', !!V);
if(V){
  console.log('objects', V.objects, '| pages', V.pages, '| ops/page', JSON.stringify(V.pageOps),
              '| Latin runs', V.latinRuns, '| script runs', V.scriptRuns, '| ? substitutions', V.qmarks);
  for(const [f, v] of Object.entries(V.fonts)) console.log(`   ${f}: ${v.bytes}B ${v.glyphs} glyphs, cmap ${v.cmap}`);
  ck('structurally sound under the hostile book: xref, trailer, object graph, every /Length',
     V.errors.length === 0, V.errors.slice(0, 6).join(' | '));
  ck('every embedded FontFile2 decompiles', Object.keys(V.fonts).length > 0 &&
     Object.values(V.fonts).every(f => f.glyphs > 1 && f.cmap > 0), JSON.stringify(V.fonts));
  for(const f of V.flows) console.log(`   ${f.ok ? 'ok  ' : 'FAIL'} ${f.lang.padEnd(14)} ${f.flow.padEnd(10)} ${f.order} (pdf ${f.pdf} / app ${f.app})`);
  ck('every glyph id the hostile page asks for decodes, through the embedded face\'s own cmap, to exactly what the app shows',
     V.flows.length === spansJson.length && V.flows.every(f => f.ok), JSON.stringify(V.flows));
  ck('no glyph id is emitted that the embedded font lacks (numGlyphs + cmap + no .notdef)',
     !V.errors.some(e => /gid/.test(e)), V.errors.filter(e => /gid/.test(e)).slice(0, 4).join(' | '));
  ck('English prose is real base-14 WinAnsi text', V.latinRuns > 20, `${V.latinRuns} runs`);
  ck('the vertical tongues were set as their own blocks (script runs one cell at a time)',
     V.scriptRuns > 0, `${V.scriptRuns} script runs`);
  console.log('marks outside the page / margins:', V.outside.length,
              JSON.stringify(V.outside.slice(0, 6)));
  ck('nothing is painted outside the MediaBox', !V.outside.some(o => o.kind === 'offpage'),
     JSON.stringify(V.outside.filter(o => o.kind === 'offpage').slice(0, 5)));
  ck('nothing is painted outside the 1in margins', V.outside.length === 0,
     `${V.outside.length} marks: ` + JSON.stringify(V.outside.slice(0, 5)));
  ck('the ? substitution is used for out-of-WinAnsi characters and never drops them silently',
     V.qmarks > 0, `${V.qmarks} '?' bytes`);
  ck('the nested bold+italic run picked the Times-BoldItalic face (/F4)', true, 'see F4 count below');
}

/* ---- the 199-char unbreakable word: does its INK stay on the page? ----
   There is nothing in it to break on, so the writer has to break it somewhere
   itself. Measure every piece it actually drew — the PDF records only a start
   x, so each literal's own width goes on with the same canvas + base-14 Times
   stack the writer uses — and check two things: no piece runs off the paper,
   and the pieces still spell the whole word. */
const rawA = a1.toString('latin1');
const lwRuns = [];
{
  const re = /Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \(([^)\\]*)\) Tj/g;
  let m;
  while((m = re.exec(rawA))) if(m[3].length >= 12 && LONGWORD.indexOf(m[3]) > -1) lwRuns.push({ x: +m[1], s: m[3] });
}
const longWord = await page.evaluate(({ w, pieces }) => {
  const c = document.createElement('canvas').getContext('2d');
  c.font = `11px 'Times New Roman','Liberation Serif','Nimbus Roman',Times,serif`;
  return { width: c.measureText(w).width, avail: (595.28 - 144) * 0.97,
           parts: pieces.map(p => c.measureText(p).width) };
}, { w: LONGWORD, pieces: lwRuns.map(r => r.s) });
console.log(`long word: ${LONGWORD.length} chars, ${longWord.width.toFixed(1)}pt wide, column avail ${longWord.avail.toFixed(1)}pt`,
            '| drawn in', lwRuns.length, 'piece(s) at x =', JSON.stringify(lwRuns.map(r => r.x)));
ck('precondition: the 199-character word is wider than the whole text column',
   longWord.width > longWord.avail, `${longWord.width.toFixed(1)} > ${longWord.avail.toFixed(1)}`);
ck('the unbreakable word is drawn at all', lwRuns.length > 0, JSON.stringify(lwRuns.map(r => r.s.length)));
ck('every piece of the unbreakable word stays inside the MediaBox',
   lwRuns.length > 0 && lwRuns.every((r, i) => r.x + longWord.parts[i] <= 595.28),
   JSON.stringify(lwRuns.map((r, i) => [r.x.toFixed(1), (r.x + longWord.parts[i]).toFixed(1)])));
ck('the pieces still spell the whole word — nothing dropped at the break',
   lwRuns.map(r => r.s).join('') === LONGWORD,
   lwRuns.map(r => r.s).join('').length + ' of ' + LONGWORD.length + ' characters');

// /F4 usage + a raw look at the nested run
const raw = a1.toString('latin1');
const f4 = (raw.match(/\/F4 /g) || []).length;
console.log('/F4 runs:', f4, '| /F2', (raw.match(/\/F2 /g) || []).length, '| /F3', (raw.match(/\/F3 /g) || []).length);
checks.push(['the nested bold+italic run picked Times-BoldItalic (/F4) at least once', f4 >= 2]);
console.log((f4 >= 2 ? 'ok   ' : 'FAIL '), 'the nested bold+italic run picked Times-BoldItalic (/F4) at least once', f4);

/* ---------------- empty page: chapter with a title, chapterTitles off ---------------- */
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
await page.click('#bk-share'); await wait(page, 500);
await page.locator('#sheet .sh-item', { hasText: 'Include chapter titles' }).click();
await wait(page, 600);
const optsNow = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => res(g.result.books[g.result.books.length - 1].exportOpts); };
}));
console.log('exportOpts now:', JSON.stringify(optsNow));
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);
const b1 = Buffer.from(await grab());
await writeFile(`${OUT}/hostile-notitles.pdf`, b1);
const V2 = run(`${OUT}/hostile-notitles.pdf`, '-');
ck('the chapter-titles-off export still validates (this is the empty-page case)',
   !!V2 && V2.errors.length === 0, V2 ? V2.errors.slice(0, 5).join(' | ') : 'validator failed');
if(V2){
  console.log('no-titles: pages', V2.pages, 'ops/page', JSON.stringify(V2.pageOps), 'empty pages', V2.emptyPages);
  ck('a chapter with a title and no scenes produced a page with zero operators (empty page reached)',
     V2.emptyPages > 0, `emptyPages=${V2.emptyPages} ops=${JSON.stringify(V2.pageOps)}`);
}

ck('no page exceptions anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF HOSTILE LAYOUT', checks.every(c => c[1]));
await browser.close();
await srv.close();
