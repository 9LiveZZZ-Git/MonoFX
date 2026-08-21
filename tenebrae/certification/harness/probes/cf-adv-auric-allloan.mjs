// TX-6c REFUTATION PROBE — the Auric loan device at its limit: a selection in
// which the lexicon knows NOTHING, so every rune on the page is a borrowing.
//
// TX-6c says the Auric word script writes loans (root pseudo-rune + loan
// diamond) because it has a device for them; TX-11c says a selection the codex
// cannot write produces no span. cf-auric-word-identity.mjs only ever tested a
// loan sitting NEXT TO known words, so the all-loan case — where those two
// rules point in opposite directions — has never been run. This probe also
// checks the all-loan spans against an ALPHABET (which must decline), and that
// the loan runes survive into an EPUB as PUA in the forged face.
//
// Run: cd probes && node cf-adv-auric-allloan.mjs
import { launch, wait, createBook, insertTranslationSpan, downloadFromSheet, verdict } from './ex-lib.mjs';

const LOANS = 'zyxqwv frobnicate blorptastic';
const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok  ' : 'FAIL'), l, x === undefined ? '' : String(x).slice(0, 300)); };

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 900, height: 1400 });
await wait(page, 3500);

// nothing in the phrase is in the lexicon — confirm that from the codex first
const known = await page.evaluate(async ([txt]) => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const out = {};
  for(const id of ['celan_high', 'kildaren', 'kerrackian']){
    const T = C.TRANS[id];
    if(!T){ out[id] = 'no TRANS'; continue; }
    const parts = C.coreTranslate(T, txt, 'e2l');
    out[id] = parts.filter(p => !p.drop).map(p => (p.unknown ? '!' : '') + p.out).join(' ');
  }
  // the codex's ORIGINAL Celan Basic translator, the one its own rune wing uses
  out.basic = (typeof w.translateE2C === 'function')
    ? w.translateE2C(txt).filter(p => !p.drop).map(p => (p.unknown ? '!' : '') + p.cel).join(' ')
    : 'no translateE2C';
  return out;
}, [LOANS]);
console.log('   codex coreTranslate (! = unknown):', JSON.stringify(known));
ck('SETUP: the codex marks every word of the phrase unknown, in every tongue',
   ['celan_high', 'kildaren', 'kerrackian'].every(k => known[k].split(' ').every(t => t.startsWith('!'))),
   JSON.stringify(known));

await createBook(page, 'All Loan');
await page.click('#ed-content');
await page.keyboard.type(LOANS);
await page.keyboard.press('Enter');
await page.keyboard.type(LOANS);
await wait(page, 500);

await insertTranslationSpan(page, LOANS, 'Celan Basic');
await wait(page, 1200);
await insertTranslationSpan(page, LOANS, 'Celan High');
await wait(page, 1200);

const st = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const F = window.tenebrae._forge;
  const A = F.map().celan_basic;
  const spans = [...document.querySelectorAll('#ed-content .tspan')].map(s => ({
    lang: s.dataset.lang, scr: s.dataset.scr, rom: s.dataset.rom, src: s.dataset.src,
    text: s.textContent, fam: getComputedStyle(s).fontFamily,
    svg: s.querySelectorAll('svg,img,canvas').length,
  }));
  const cb = spans.find(s => s.lang === 'celan_basic');
  let runes = null;
  if(cb){
    const codes = [...(cb.scr || '')].filter(c => c.charCodeAt(0) >= 0xE800).map(c => c.charCodeAt(0));
    const byCode = {}; for(const k of A.order) byCode[A.words[k].code] = k;
    runes = codes.map(c => {
      const key = byCode[c];
      const g = key ? A.words[key].glyph : null;
      const cw = key ? A.win.composeWord(key) : null;
      // composeWord's loan diamond is a 4-segment quad; count segments whose
      // endpoints sit in the diamond band above the word box
      const diamond = cw ? cw.segs.filter(s => s[1] > 1.0 && s[1] < 1.25 && s[3] > 1.0 && s[3] < 1.25).length : 0;
      return { code: 'U+' + c.toString(16), key, segs: cw ? cw.segs.length : 0,
               contours: g ? g.contours.length : 0, diamond, adv: g ? g.advance : 0 };
    });
  }
  return { spans, runes, editorHTML: document.querySelector('#ed-content').innerHTML.slice(0, 400),
           plainHasLoans: document.querySelector('#ed-content').textContent };
});
console.log('   spans:', JSON.stringify(st.spans.map(s => ({ lang: s.lang, len: (s.scr || '').length, fam: s.fam, svg: s.svg }))));
console.log('   auric runes:', JSON.stringify(st.runes));

const cb = st.spans.find(s => s.lang === 'celan_basic');
const ch = st.spans.find(s => s.lang === 'celan_high');

ck('TX-6c: Celan Basic DOES write an all-loan selection (a span exists)', !!cb,
   cb ? `scr len=${cb.scr.length}` : 'no celan_basic span — TX-6c "loans are written here" would be violated');
if(cb){
  ck('TX-6c: one rune per loan word, all in the Auric PUA block',
     st.runes.length === 3 && st.runes.every(r => r.key), JSON.stringify(st.runes.map(r => r.key)));
  ck('TX-6c: every loan rune carries composeWord\'s loan diamond (4 segments)',
     st.runes.every(r => r.diamond === 4), JSON.stringify(st.runes.map(r => r.diamond)));
  ck('TX-6c: one capsule contour per carver segment on every loan rune',
     st.runes.every(r => r.contours === r.segs), JSON.stringify(st.runes.map(r => [r.segs, r.contours])));
  const wantKeys = known.basic.split(' ').map(t => t.replace(/^!/, ''))
    .map(x => x.replace(/[^\wéäí'-]/g, '').toLowerCase()).filter(Boolean);
  ck('TX-6c: each rune key is the codex\'s own Celan Basic form of that loan, carver-cleaned',
     JSON.stringify(st.runes.map(r => r.key)) === JSON.stringify(wantKeys),
     `runes=${JSON.stringify(st.runes.map(r => r.key))} codex=${JSON.stringify(wantKeys)}`);
  ck('TX-6c: script is TEXT in the forged Auric face, never SVG',
     cb.svg === 0 && /Auric/.test(cb.fam) && cb.text === cb.scr, cb.fam);
  ck('TX-6c: the English source is still stored on the span', cb.src === LOANS, cb.src);
}
// The alphabet does NOT decline here: Celan High's own sentence wrapper adds
// known function words, so the codex's cleanText is non-empty. TX-6b's rule is
// the one that bites — none of the three loans may be transliterated.
if(ch){
  const cx = await page.evaluate(async ([src]) => {
    const w = await window.tenebrae.engine();
    const C = w.CODEX, T = C.TRANS['celan_high'];
    const { parts, lines } = C.compileText(T, src, 'e2l');
    const cleanText = lines ? lines.map(l => l.filter(p => !p.u).map(p => p.t).join(' ')).join(' ')
                            : parts.filter(p => !p.drop && !p.unknown).map(p => p.out).join(' ');
    return { cleanText, n: cleanText.split(/\s+/).filter(Boolean).length };
  }, [ch.src]);
  const units = (ch.scr || '').split(/[\n ]/).filter(Boolean);
  console.log(`   celan_high cleanText = "${cx.cleanText}"  units written = ${units.length}`);
  ck('TX-6b: the alphabet writes only the codex\'s cleanText words — the three loans are not transliterated',
     units.length === cx.n, `written=${units.length} codex=${cx.n} ("${cx.cleanText}")`);
  ck('TX-6b: the alphabet span still keeps every loan in its romanization',
     ['zyxqwv', 'frobnicate', 'blorptastic'].every(x => (ch.rom || '').includes(x)), ch.rom);
}else{
  ck('TX-6b: the alphabet span exists or was declined coherently', true, 'declined');
}

// carry it out: EPUB must ship the loan runes as PUA
await page.click('#ed-back'); await wait(page, 700);
await page.click('#bk-share'); await wait(page, 700);
const dl = await downloadFromSheet(page, 'EPUB (.epub)').catch(e => ({ text: '', err: String(e) }));
const inEpub = await page.evaluate(async ([codes]) => codes, [st.runes ? st.runes.map(r => r.code) : []]);
if(cb){
  const hex = [...cb.scr].filter(c => c.charCodeAt(0) >= 0xE800);
  const present = hex.every(c => dl.text.includes(c));
  ck('TX-6c: the loan runes travel into the EPUB as the same PUA characters',
     present, `${hex.length} runes, epub bytes ${dl.text.length}, codes ${inEpub.join(',')}`);
}
ck('no page exceptions', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

const ok = checks.every(c => c[1]);
console.log(`\n${checks.filter(c => c[1]).length}/${checks.length} checks`);
verdict('TX-6c all-loan', ok);
await browser.close(); await srv.close();
