// TX-10b GAP PROBE — pdfLiteral / pdfWinAnsi under hostile text.
//
// Every string the PDF carries goes through pdfLiteral (step1.html:2607): a
// PDF literal string ends at an unbalanced ')' and a stray '\' eats the next
// byte, so one unescaped character in a book title corrupts the /Info object
// and one in a prose line corrupts the whole content stream — and the offsets
// in the xref, which are computed from byte lengths, would still "look" right.
// Nothing has ever put a ')' or a '\' into a Tenebrae document.
//
// This probe puts them in the BOOK TITLE, the SCENE TITLE and the PROSE, plus a
// line that is nothing but characters WinAnsi cannot hold, and then re-parses
// the file with cf-pdfcheck2.py (which tokenises literals properly, so an
// escaping bug shows up as an unterminated string / bad operator, not as a
// silently different page).
//
// Run: cd probes && node cf-pdf-literal-escapes.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-esc';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

const TITLE = 'Ha)ha\\(ha — 50% “quoted”';
const PROSE = 'a (paren) and a \\backslash\\ and ((nested)) and a lone ) here';
const OUTSIDE = 'Привет 日本語 ☃ ← ⁂ Ω ∑';   // nothing in this line is WinAnsi

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

await createBook(page, TITLE);
await page.click('#ed-title'); await page.keyboard.type('Sce)ne \\ Ti(tle');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter'); await page.keyboard.type(PROSE);
await page.keyboard.press('Enter'); await page.keyboard.type(OUTSIDE);
await wait(page, 1800);
await page.click('#ed-back'); await wait(page, 700);

const stored = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('tenebrae-writer', 1);
  rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('state');
    g.onsuccess = () => { const b = g.result.books[g.result.books.length - 1];
      res({ title: b.title, scene: b.chapters[0].scenes[0].title, doc: b.chapters[0].scenes[0].doc }); }; };
}));
console.log('stored title  :', JSON.stringify(stored.title));
console.log('stored scene  :', JSON.stringify(stored.scene));
console.log('stored doc    :', JSON.stringify(stored.doc).slice(0, 300));
ck('precondition: the hostile characters really reached the state',
   stored.title.includes(')') && stored.title.includes('\\') && stored.doc.includes('\\'),
   JSON.stringify(stored.title));

const buf = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/escapes.pdf`, buf);
const raw = buf.toString('latin1');
console.log('pdf bytes:', buf.length);

const V = (() => { try{
  return JSON.parse(execFileSync('python3', ['cf-pdfcheck2.py', `${OUT}/escapes.pdf`, '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }));
}catch(e){ console.log('validator stderr:', String(e.stderr || e.message).slice(0, 600)); return null; } })();
ck('the file still parses: xref offsets, object graph, every declared /Length',
   !!V && V.errors.length === 0, V ? V.errors.slice(0, 5).join(' | ') : 'validator failed');
if(V) console.log('objects', V.objects, '| pages', V.pages, '| Latin runs', V.latinRuns, '| ? bytes', V.qmarks, '| errors', V.errors.length);

// /Info /Title must be an escaped literal
const info = /\/Title \((.*?)\) \/Producer/s.exec(raw);
console.log('/Title literal:', info ? JSON.stringify(info[1]) : 'NOT FOUND');
ck('the book title reaches /Info /Title as a properly escaped PDF literal',
   !!info && info[1].includes('\\)') && info[1].includes('\\(') && info[1].includes('\\\\'),
   info && info[1]);

// every ( ) \ inside a content-stream literal must be backslash-escaped
const bad = [];
for(const m of raw.matchAll(/Tf 1 0 0 1 [\d.-]+ [\d.-]+ Tm \((.*?)\) Tj ET/gs)){
  const s = m[1];
  for(let i = 0; i < s.length; i++){
    if(s[i] === '\\'){ i++; continue; }
    if(s[i] === '(' || s[i] === ')') bad.push(s);
  }
}
ck('no unescaped ( or ) survives into a content-stream literal', bad.length === 0, JSON.stringify(bad.slice(0, 3)));

// the prose parens/backslashes are present, escaped
const hasParen = /\\\(paren\\\)/.test(raw);
const hasSlash = /\\\\backslash/.test(raw);
ck('the prose parentheses were written, escaped, not dropped', hasParen, hasParen ? 'found \\(paren\\)' : 'missing');
ck('the prose backslash was written, escaped, not dropped', hasSlash, hasSlash ? 'found \\\\backslash' : 'missing');

// the out-of-WinAnsi line: every character substituted, none dropped
const q = /Tm \((\?+)\) Tj/.exec(raw);
const qruns = [...raw.matchAll(/Tm \(([^)]*\?[^)]*)\) Tj/g)].map(m => m[1]);
console.log('runs containing ?:', JSON.stringify(qruns).slice(0, 200));
const wantQ = [...OUTSIDE].filter(c => c !== ' ').length;
const gotQ = qruns.join('').split('').filter(c => c === '?').length;
ck('every character WinAnsi cannot hold became a "?" and none was silently dropped',
   gotQ >= wantQ, `${gotQ} '?' for ${wantQ} out-of-WinAnsi characters`);
ck('no raw byte above 0x7F leaked into a base-14 literal unescaped',
   ![...raw.matchAll(/Tm \((.*?)\) Tj/gs)].some(m => /[\x80-\xff]/.test(m[1])),
   'literals are octal-escaped');

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b PDF LITERAL ESCAPES', checks.every(c => c[1]));
await browser.close();
await srv.close();
