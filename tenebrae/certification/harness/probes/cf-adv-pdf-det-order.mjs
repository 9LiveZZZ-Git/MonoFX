// TX-10b ADVERSARY PROBE — how far does the Auric byte-drift actually reach?
//
// The audit found the PDF's bytes change across a reload because the Celan
// Basic face is minted in the order words are first WRITTEN. Two questions that
// decides how serious that is, and neither was asked:
//
//   A. is a COLD start reproducible? reload -> export vs reload -> export.
//      If two cold starts agree, the drift is "authoring session vs cold file"
//      only. If they do not, nothing about the file is reproducible.
//   B. inside ONE cold session, does an unrelated EXPORT ACTION change the
//      next export's bytes? auricEnsure() mints at export time, so exporting
//      scene 2 first should renumber the runes the book export then writes.
//      That would mean the same book, same state, same session, produces two
//      different files depending on which button the author pressed first.
//   C. is the drift visual-neutral? decode both files through their own
//      embedded cmaps and compare the word sequence and the placements.
//
// Everything is read from the file: gid runs, per-file cmap, /W, placements.
//
// Run: cd probes && node cf-adv-pdf-det-order.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/pdf-det2';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for(let i = 0; i < n; i++) if(a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };

function auricRuns(buf, path){
  const s = buf.toString('latin1');
  const objs = {};
  for(const m of s.matchAll(/(\d+) 0 obj\n/g)){ const id = +m[1], st = m.index + m[0].length; objs[id] = { body: s.slice(st, s.indexOf('endobj', st)), start: st }; }
  const pg = Object.values(objs).find(o => /\/Type \/Page[^s]/.test(o.body)).body;
  const t0id = (/\/S_celan_basic (\d+) 0 R/.exec(pg) || [])[1];
  if(!t0id) return null;
  const cid = objs[+(/\/DescendantFonts \[(\d+) 0 R\]/.exec(objs[+t0id].body))[1]].body;
  const desc = objs[+(/\/FontDescriptor (\d+) 0 R/.exec(cid))[1]].body;
  const ff = objs[+(/\/FontFile2 (\d+) 0 R/.exec(desc))[1]];
  const len = +(/\/Length (\d+)/.exec(ff.body))[1];
  const b0 = s.indexOf('stream\n', ff.start) + 7;
  const ttf = buf.subarray(b0, b0 + len);
  const runs = [];
  for(const m of s.matchAll(/BT \/S_celan_basic ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]+)> Tj ET/g))
    runs.push({ size: +m[1], x: +m[2], y: +m[3], gids: m[4].match(/.{4}/g).map(h => parseInt(h, 16)) });
  return { ttf, runs, path };
}
// outline signature per placement: what the reader actually paints
function outlineSig(f){
  const p = `${f.path}.ttf`;
  execFileSync('bash', ['-c', `cp /dev/null ${p}`]);
  return null;
}

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const A = 'the gate opens at dawn';
const B = 'the sea remembers the old king';
await createBook(page, 'Order Book');
await page.click('#ed-title'); await page.keyboard.type('Scene One');
await page.click('#ed-content'); await page.keyboard.type(A);
await wait(page, 1200);
await insertTranslationSpan(page, A, 'Celan Basic');
await wait(page, 1400);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 800);
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 800);
await page.click('#ed-title'); await page.keyboard.type('Scene Two');
await page.click('#ed-content'); await page.keyboard.type(B);
await wait(page, 1200);
await insertTranslationSpan(page, B, 'Celan Basic');
await wait(page, 1400);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await page.click('#ed-back'); await wait(page, 800);
// NOTE: translated in DOCUMENT order this time — the ordinary way an author works.
const order0 = await page.evaluate(() => window.tenebrae._forge.map().celan_basic.order.slice());
console.log('authoring-session mint order:', order0.join(' '));
const book = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
await writeFile(`${OUT}/authoring.pdf`, book);

/* ---- A: two cold starts ---- */
const cold = async (tag, pre) => {
  await page.reload();
  await wait(page, 4200);
  await page.locator('[data-book]').first().click();
  await wait(page, 1300);
  if(pre) await pre();
  const b = Buffer.from(await page.evaluate(() => Array.from(window.tenebrae._pdf('book'))));
  const ord = await page.evaluate(() => window.tenebrae._forge.map().celan_basic.order.slice());
  await writeFile(`${OUT}/${tag}.pdf`, b);
  console.log(`   ${tag}: ${b.length} bytes, mint order [${ord.join(' ')}]`);
  return { b, ord };
};
const c1 = await cold('cold1');
const c2 = await cold('cold2');
ck('A: two cold starts from the same stored state produce the same file',
   c1.b.equals(c2.b), `${c1.b.length} vs ${c2.b.length}, first difference at ${firstDiff(c1.b, c2.b)}`);
ck('A: the authoring session and a cold start produce the same file',
   book.equals(c1.b), `${book.length} vs ${c1.b.length}, first difference at ${firstDiff(book, c1.b)}; ` +
   `authoring [${order0.join(' ')}] cold [${c1.ord.join(' ')}]`);

/* ---- B: an unrelated export action first, same cold session ---- */
const c3 = await cold('cold3-after-scene-export', async () => {
  // open scene TWO and export just that scene — the author checking a scene
  await page.locator('[data-scene]').nth(1).click();
  await wait(page, 1200);
  const sc = await page.evaluate(() => { const u = window.tenebrae._pdf('scene'); return u ? u.length : 0; });
  console.log('   scene-2-only export first:', sc, 'bytes');
  await page.click('#ed-back'); await wait(page, 800);
});
ck('B: exporting one scene first does not change the bytes of the book export',
   c1.b.equals(c3.b), `${c1.b.length} vs ${c3.b.length}, first difference at ${firstDiff(c1.b, c3.b)}; ` +
   `plain cold [${c1.ord.join(' ')}] after scene export [${c3.ord.join(' ')}]`);

/* ---- C: is the drift visual-neutral? ---- */
const files = { authoring: book, cold1: c1.b, cold3: c3.b };
const infos = {};
for(const [k, b] of Object.entries(files)){
  const r = auricRuns(b, `${OUT}/${k}`);
  await writeFile(`${OUT}/${k}-auric.ttf`, r.ttf);
  infos[k] = r;
}
const py = `
import sys, json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
out={}
for a in sys.argv[1:]:
    k,p=a.split('=',1)
    f=TTFont(p); f.ensureDecompiled(); g=f.getGlyphSet(); order=f.getGlyphOrder()
    sig={}
    for i,n in enumerate(order):
        pen=RecordingPen(); g[n].draw(pen)
        sig[i]=str(pen.value)
    out[k]=sig
print(json.dumps(out))
`;
await writeFile(`${OUT}/sig.py`, py);
const SIG = JSON.parse(execFileSync('python3', [`${OUT}/sig.py`, ...Object.keys(infos).map(k => `${k}=${OUT}/${k}-auric.ttf`)]).toString());
const paint = k => infos[k].runs.map(r => `${r.x},${r.y},` + r.gids.map(g => SIG[k][g]).join('|')).join(' ;; ');
ck('C: the drift is visual-neutral — authoring and cold paint the same outlines at the same places',
   paint('authoring') === paint('cold1'), `runs ${infos.authoring.runs.length} vs ${infos.cold1.runs.length}`);
ck('C: the same holds after the scene-export contamination',
   paint('cold1') === paint('cold3'), `runs ${infos.cold1.runs.length} vs ${infos.cold3.runs.length}`);

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-10b AURIC BYTE-DRIFT REACH', checks.every(c => c[1]));
await browser.close();
await srv.close();
