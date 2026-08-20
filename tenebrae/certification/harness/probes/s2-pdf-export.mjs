// PDF export — the format that cannot substitute a font behind our back.
//
// DOCX asks Word to honour an embedded face and EPUB asks the reader to; both
// can decline, and then the script is gone. A PDF carries the outlines and the
// positions itself. So the bar here is higher than "a file appeared":
//   1. structural validity — xref offsets point at their objects, trailer sane
//   2. every embedded FontFile2 decompiles (fontTools) and its cmap covers what
//      the page actually asks for
//   3. the CIDs written into the content stream decode, through the embedded
//      font's OWN cmap, back to exactly the PUA the app shows on screen
//   4. Latin prose is real WinAnsi text, and no PUA leaks into a base-14 run
//   5. determinism: same book, same bytes
// Run: cd probes && node s2-pdf-export.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 220)); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const LANGS = await page.evaluate(async () => (await window.tenebrae.langs()).langs.map(l => l.name));
console.log('tongues:', LANGS.join(', '));

await createBook(page, 'PDF Certification');
await page.click('#ed-title'); await page.keyboard.type('Proof Scene');
await page.click('#ed-content');
await page.keyboard.type('opening prose line for the page');
for(let i = 0; i < LANGS.length; i++){
  await page.keyboard.press('Enter');
  await page.keyboard.type(`alpha${i} the sea remembers the old king omega${i}`);
}
await wait(page, 600);
for(let i = 0; i < LANGS.length; i++){
  await insertTranslationSpan(page, `the sea remembers the old king omega${i}`, LANGS[i]);
  await wait(page, 400);
}
await wait(page, 1500);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 500);

// what the app shows on screen, per span
const spans = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(sp => ({
  lang: sp.dataset.lang, flow: sp.dataset.flow || 'ltr', src: sp.dataset.src, rom: sp.dataset.rom,
  codes: [...(sp.dataset.scr || '')].filter(c => c.charCodeAt(0) >= 0xE000).map(c => c.charCodeAt(0)),
  family: getComputedStyle(sp).fontFamily })));
console.log('spans:', spans.map(s => `${s.lang}[${s.flow}]:${s.codes.length}`).join(' '));
ck('every tongue produced a span with script codepoints', spans.length === LANGS.length && spans.every(s => s.codes.length > 0),
   spans.map(s => `${s.lang}:${s.codes.length}`).join(' '));

const grab = () => page.evaluate(() => Array.from(window.tenebrae._pdf('book')));
const bytes = Buffer.from(await grab());
await writeFile(`${OUT}/book.pdf`, bytes);
console.log('pdf bytes:', bytes.length);
ck('a PDF was produced and starts with the header', bytes.length > 2000 && bytes.slice(0, 8).toString() === '%PDF-1.7');

const again = Buffer.from(await grab());
ck('determinism: the same book renders byte-identical', again.equals(bytes), `${bytes.length} vs ${again.length}`);
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
await writeFile(`${OUT}/spans.json`, JSON.stringify(spans, null, 1));

/* ---- structural + glyph-identity validation, fontTools doing the decompiling ---- */
let V = null;
try{
  V = JSON.parse(execFileSync('python3', ['_pdfcheck.py', `${OUT}/book.pdf`, `${OUT}/spans.json`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }));
}catch(e){ ck('the validator ran', false, e.message); }
if(V){
  console.log('objects', V.objects, '| pages', V.pages, '| Latin runs', V.latinRuns);
  for(const [f, v] of Object.entries(V.fonts)) console.log(`   ${f}: ${v.bytes}B ${v.glyphs} glyphs, cmap ${v.cmap}`);
  ck('the file is structurally sound: every xref offset lands on its object, trailer intact',
     V.errors.length === 0 && V.objects > 0, V.errors.slice(0, 3).join(' | '));
  ck('a page was produced', V.pages > 0, `pages=${V.pages}`);
  ck('every embedded FontFile2 decompiles and carries a real cmap',
     Object.keys(V.fonts).length > 0 && Object.values(V.fonts).every(f => f.glyphs > 1 && f.cmap > 0),
     JSON.stringify(V.fonts));
  ck('one embedded face per tongue that appears on the page',
     Object.keys(V.fonts).length === spans.length, `${Object.keys(V.fonts).length} faces for ${spans.length} tongues`);
  for(const f of V.flows)
    console.log(`   ${f.ok ? 'ok  ' : 'FAIL'} ${f.lang.padEnd(14)} ${f.flow.padEnd(10)} ${f.order} (pdf ${f.pdf} / app ${f.app})`);
  ck('every glyph the page asks for decodes, through the embedded font\'s own cmap, back to exactly what the app shows',
     V.flows.length === spans.length && V.flows.every(f => f.ok),
     JSON.stringify(V.flows.filter(f => !f.ok)));
  ck('the right-to-left tongue is written reversed, the rest in logical order',
     V.flows.every(f => (f.order === 'reversed') === (f.flow === 'rtl')),
     JSON.stringify(V.flows.map(f => `${f.flow}:${f.order}`)));
  ck('English prose is real base-14 text, not outlines', V.latinRuns > 5, `${V.latinRuns} runs`);
}
verdict('PDF EXPORT', checks.every(c => c[1]));
await browser.close();
await srv.close();
