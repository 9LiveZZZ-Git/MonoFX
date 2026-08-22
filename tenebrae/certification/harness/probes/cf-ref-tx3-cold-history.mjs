// cf-REF-TX-3 — DETERMINISM ACROSS COLD CONTEXTS WITH DIFFERENT HISTORIES.
//
// REFUTATION TARGET. cf-tx3-determinism-axes.mjs proves order/concurrency
// invariance, but every one of those comparisons (A1, A2, B, C) runs in the
// SAME page as the baseline — a page that had already translated the whole
// corpus once. Any engine state that is built on FIRST use (a coinage counter,
// a lazily-minted table, a matcher cache) is therefore already warm when the
// "reordered" run happens, so a genuine order dependence would be invisible.
// The one cold-process axis (D) uses the SAME forward order as the baseline.
//
// This probe closes that hole: four COLD contexts, each doing something
// different BEFORE the measured corpus:
//   H0  measured corpus only, forward order                      (baseline)
//   H1  a 30-sentence unrelated prelude across all tongues first
//   H2  the measured corpus in reversed tongue+sentence order, first thing
//   H3  baseline, then a full page reload in the SAME profile, remeasured
// Compared: the whole translate2 JSON, the RUNE each result draws, and the
// forged font bytes — i.e. what the author would actually see and export, not
// just the engine's JSON.
//
// One thing this probe deliberately does NOT require: that the private-use
// codepoint itself be the same across two cold sessions with different
// histories. TX-6c specifies the mechanism — "the forge mints a codepoint the
// first time a word is written" — which is history-dependent by definition, and
// TX-3's axes are repeat calls, reloads and storage-fresh contexts, all of
// which are measured here (H3) and hold. What must not move is the RUNE: for
// the same input the author must see the same drawing, at the same advance.
// So the alphabets, whose codepoints are fixed by the codex, are still compared
// byte for byte; the word script is compared by pulling each codepoint's
// outline out of that context's OWN embedded face with fontTools and requiring
// the outlines to match position for position. data-scr is regenerated from the
// stored English whenever a scene is opened or exported, so the index never
// reaches a file: cf-auric-mint-drift and cf-adv-pdf-det-order own that.
// Run: cd probes && node cf-ref-tx3-cold-history.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx3cold';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const SENTS = [
  'The sea remembers the stone gate',
  "Don't count 12 ravens — they lie, twice!",
  'Xylophonic quandaries perplex the boatwright?',
  'the keeper’s oath — MMXXVI',
];
const PRELUDE = [];
for(let i = 0; i < 30; i++) PRELUDE.push(`prelude ${i} zorbik quandle ${'x'.repeat(i % 7)} the harbour bell tolled ${i} times`);

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function coldPage(){
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(4200);
  return { context, page };
}

// measure: full translate2 JSON + the forged PUA text for those tokens
const measure = (pg, ids, sents) => pg.evaluate(async ({ ids, sents }) => {
  const out = {};
  for(const id of ids) for(const s of sents){
    const r = await window.tenebrae.translate2(id, s);
    const scr = r ? window.tenebrae._forge.textForToks(id, r.toks || []) : null;
    out[id + '::' + s] = JSON.stringify({ r, id,
      scr: scr ? [...scr].map(c => c.codePointAt(0).toString(16)).join(' ') : null,
      codes: scr ? [...scr].map(c => c.codePointAt(0)) : null });
  }
  return out;
}, { ids, sents });

// the WHOLE buffer, not a prefix: a 64-byte head hash cannot see a table that
// differs past the header, and the point of this check is byte identity
const fontBytes = pg => pg.evaluate(() => {
  const m = window.tenebrae._forge.map() || {};
  const out = {};
  for(const k of Object.keys(m)){
    const b = m[k] && m[k].ttf;
    if(!b){ out[k] = null; continue; }
    let bin = '';
    for(const x of b) bin += String.fromCharCode(x);
    out[k] = btoa(bin);
  }
  return out;
});
const fontHashes = async pg => {
  const b = await fontBytes(pg);
  const out = {};
  for(const k of Object.keys(b)) out[k] = b[k] ? createHash('sha256').update(Buffer.from(b[k], 'base64')).digest('hex') : null;
  return out;
};
// A word script mints its codepoints as words arrive, so two histories index the
// same runes differently. Ask the faces what they actually DRAW.
const WORD_SCRIPTS = new Set(['celan_basic']);
async function outlinesAgree(ttfA, codesA, ttfB, codesB){
  if(codesA.length !== codesB.length) return 'run length ' + codesA.length + ' vs ' + codesB.length;
  await mkdir(OUT, { recursive: true });
  await writeFile(OUT + '/a.ttf', Buffer.from(ttfA, 'base64'));
  await writeFile(OUT + '/b.ttf', Buffer.from(ttfB, 'base64'));
  const pairs = codesA.map((c, i) => [c, codesB[i]]).filter(([x, y]) => x >= 0xE000);
  const py = `
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
def draw(path, code):
    f = TTFont(path); cm = f.getBestCmap()
    if code not in cm: return None
    g = f.getGlyphSet(); pen = RecordingPen(); g[cm[code]].draw(pen)
    return (repr(pen.value), round(g[cm[code]].width, 4))
bad = []
for a, b in ${JSON.stringify(pairs)}:
    x, y = draw("${OUT}/a.ttf", a), draw("${OUT}/b.ttf", b)
    if x is None or y is None: bad.append("U+%04X/U+%04X missing from a cmap" % (a, b))
    elif x != y: bad.append("U+%04X draws a different rune than U+%04X" % (a, b))
print(json.dumps(bad))
`;
  await writeFile(OUT + '/cmp.py', py);
  const bad = JSON.parse(execFileSync('python3', [OUT + '/cmp.py'], { encoding: 'utf8' }).trim());
  return bad.length ? bad.slice(0, 3).join('; ') : null;
}

const { page: p0, context: c0 } = await coldPage();
const IDS = await p0.evaluate(() => window.tenebrae.langs().then(x => x.langs.map(l => l.id)));
console.log('tongues:', JSON.stringify(IDS));
const base = await measure(p0, IDS, SENTS);
const baseFonts = { hash: await fontHashes(p0), b64: await fontBytes(p0) };

const splitCmp = async (tag, other, otherFonts) => {
  const bad = Object.keys(base).filter(k => base[k] !== other[k]);
  const romBad = [], scrBad = [], runeBad = [];
  let reindexed = 0;
  for(const k of bad){
    const a = JSON.parse(base[k]), b = JSON.parse(other[k]);
    if(JSON.stringify(a.r) !== JSON.stringify(b.r)) romBad.push(k);
    if(a.scr === b.scr) continue;
    if(!WORD_SCRIPTS.has(a.id)){
      // an alphabet's codepoints come from the codex, not from a mint: any
      // difference at all is a determinism failure
      scrBad.push(k + '\n     base: ' + a.scr + '\n     this: ' + b.scr);
      continue;
    }
    // a word script may index the same rune differently — but it must DRAW the
    // same rune, at the same advance, in the same order
    reindexed++;
    const why = await outlinesAgree(baseFonts.b64[a.id], a.codes || [], otherFonts.b64[a.id], b.codes || []);
    if(why) runeBad.push(k + ' — ' + why);
  }
  ck(tag + ' — engine JSON (rom/gloss/toks) identical', romBad.length === 0,
     romBad.length ? romBad.slice(0, 3).join(' | ') : `${Object.keys(base).length} combos identical`);
  ck(tag + ' — alphabet script text identical, codepoint for codepoint', scrBad.length === 0,
     scrBad.length ? scrBad.slice(0, 2).join('\n') : `${Object.keys(base).length} combos identical`);
  ck(tag + ' — every word-script run draws the same runes, in the same order', runeBad.length === 0,
     runeBad.length ? runeBad.slice(0, 2).join('\n') : `${reindexed} re-indexed run(s), all identical as drawn`);
};

// ---------- H1 : unrelated prelude first ----------
{
  const { page, context } = await coldPage();
  await page.evaluate(async ({ ids, sents }) => {
    for(const s of sents) for(const id of ids){
      const r = await window.tenebrae.translate2(id, s);
      if(r) window.tenebrae._forge.textForToks(id, r.toks || []); // mint whatever it mints
    }
  }, { ids: IDS, sents: PRELUDE });
  await splitCmp('H1 30-sentence unrelated prelude first', await measure(page, IDS, SENTS),
                 { b64: await fontBytes(page) });
  await context.close();
}

// ---------- H2 : reversed order, first thing in a cold context ----------
{
  const { page, context } = await coldPage();
  const rev = await measure(page, [...IDS].reverse(), [...SENTS].reverse());
  const revFonts = { b64: await fontBytes(page) };
  await splitCmp('H2 reversed tongue+sentence order in a COLD context', rev, revFonts);
  const f2 = await fontHashes(page);
  // the alphabets are forged from the codex's own glyph list and must be byte
  // identical; the word script's face is built from the words this session has
  // written, so its bytes are a function of history by construction — what it
  // DRAWS is checked above
  const bad = Object.keys(baseFonts.hash).filter(k => !WORD_SCRIPTS.has(k) && baseFonts.hash[k] !== f2[k]);
  ck('H2 forged alphabet font bytes identical to the baseline context', bad.length === 0, bad.join(','));
  await context.close();
}

// ---------- H3 : reload in the same profile ----------
{
  await p0.reload();
  await p0.waitForTimeout(4200);
  await splitCmp('H3 same profile after a full reload', await measure(p0, IDS, SENTS),
                 { b64: await fontBytes(p0) });
}

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-REF-TX-3 VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await c0.close();
await browser.close();
await srv.close();
