// TX-7 VERIFIER — highlight -> translate, on selection SHAPES the writer's
// tx-select-translate-all probe never makes.
//
// That probe selects a clean run of plain prose inside a plain paragraph, six
// times (once per tongue). Authors do not write in plain paragraphs. This probe
// keeps the same acceptance bar (source / tongue / romanization / script form
// all stored, romanization byte-identical to the codex's own compiler) but
// makes the selection inside a bold run, a heading, a blockquote and a list
// item, plus a selection carrying a trailing space — and it records the block's
// HTML before and after so a structural regression cannot hide behind a span
// that merely "exists".
//
// Run: cd probes && node tx-vp-selection-shapes.mjs
import { launch, wait, createBook, selectWord, verdict } from './ex-lib.mjs';

const PUA = /[-]/g;
const checks = [];
const ck = (label, ok, detail) => { checks.push({ label, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ' — ' + detail}`); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);
await createBook(page, 'TX7 Selection Shapes');

await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers the drowned fleet');
await page.keyboard.press('Enter');
await page.keyboard.type('a heading of stone');
await page.keyboard.press('Enter');
await page.keyboard.type('the quoted oath holds');
await page.keyboard.press('Enter');
await page.keyboard.type('the bullet item burns');
await page.keyboard.press('Enter');
await page.keyboard.type('the old king waits alone');
await wait(page, 400);

await selectWord(page, 'the sea remembers the drowned fleet');
await page.click('[data-cmd="bold"]');
await wait(page, 300);
const caret = w => page.evaluate(word => {
  const ed = document.querySelector('#ed-content');
  const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n; while ((n = tw.nextNode())) { const i = n.nodeValue.indexOf(word); if (i > -1) {
    const r = document.createRange(); r.setStart(n, i + 1); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
  return false;
}, w);
await page.click('#fb-aa'); await wait(page, 250);
await caret('heading of stone'); await page.click('#aa-panel [data-block="h2"]'); await wait(page, 300);
await caret('quoted oath');      await page.click('#aa-panel [data-block="blockquote"]'); await wait(page, 300);
await page.click('#fb-aa'); await wait(page, 200);
await caret('bullet item');      await page.click('[data-cmd="insertUnorderedList"]'); await wait(page, 400);

const structure = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return {
    html: ed.innerHTML,
    blocks: [...ed.children].map(el => el.tagName + ':' + el.textContent.trim().slice(0, 28)),
    counts: { b: ed.querySelectorAll('b,strong').length, h2: ed.querySelectorAll('h2').length,
              bq: ed.querySelectorAll('blockquote').length, li: ed.querySelectorAll('li').length,
              ul: ed.querySelectorAll('ul').length, p: ed.querySelectorAll('p').length },
  };
});
const built = await structure();
console.log('built blocks:', JSON.stringify(built.blocks, null, 0));
console.log('built counts:', JSON.stringify(built.counts));
ck('the fixture really has a bold run, a heading, a blockquote and a list item',
   built.counts.b >= 1 && built.counts.h2 === 1 && built.counts.bq === 1 && built.counts.li >= 1,
   JSON.stringify(built.counts));

async function translateRange(sel, phrase, langLabel) {
  const ok = await page.evaluate(({ sel, phrase }) => {
    const host = document.querySelector(sel);
    if (!host) return 'no host ' + sel;
    const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) {
      const i = n.nodeValue.indexOf(phrase);
      if (i > -1) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
    }
    return 'phrase not in ' + sel;
  }, { sel, phrase });
  if (ok !== true) return { placed: false, why: ok };
  await page.evaluate(() => {
    const sel2 = getSelection();
    const r = sel2.getRangeAt(0).getBoundingClientRect();
    const el = sel2.anchorNode.nodeType === 1 ? sel2.anchorNode : sel2.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await wait(page, 400);
  const menu = await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count();
  if (!menu) return { placed: false, why: 'no Translate item in the context menu' };
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 600);
  await page.locator('#sheet .sh-item', { hasText: langLabel }).click();
  await wait(page, 900);
  return { placed: true };
}

const CASES = [
  { name: 'bold run',       sel: '#ed-content b, #ed-content strong', phrase: 'sea remembers',    lang: 'Celan High',   keep: 'b,strong' },
  { name: 'heading',        sel: '#ed-content h2',                    phrase: 'heading of stone', lang: 'Kildaren',     keep: 'h2' },
  { name: 'blockquote',     sel: '#ed-content blockquote',            phrase: 'quoted oath',      lang: 'Kerrackian',   keep: 'blockquote' },
  { name: 'list item',      sel: '#ed-content li',                    phrase: 'bullet item',      lang: 'Calgridarian', keep: 'li' },
  { name: 'trailing space', sel: '#ed-content',                       phrase: 'the old king ',    lang: 'Evernessian',  keep: null },
];

for (const c of CASES) {
  const beforeS = await structure();
  const r = await translateRange(c.sel, c.phrase, c.lang);
  const afterS = await structure();
  const got = await page.evaluate(({ phrase }) => {
    const ed = document.querySelector('#ed-content');
    const spans = [...ed.querySelectorAll('.tspan')];
    const el = spans.find(s => s.dataset.src === phrase) || spans.find(s => s.dataset.src === phrase.trim());
    if (!el) return { found: false, srcs: spans.map(s => JSON.stringify(s.dataset.src)) };
    const anc = []; for (let p = el.parentElement; p && p.id !== 'ed-content'; p = p.parentElement) anc.push(p.tagName);
    const t = el.textContent;
    return { found: true, exact: el.dataset.src === phrase, lang: el.dataset.lang, src: el.dataset.src,
      rom: el.dataset.rom, scr: el.dataset.scr, flow: el.dataset.flow || null,
      latin: /[A-Za-z]/.test(t), svg: el.querySelectorAll('svg').length,
      pua: (t.match(/[-]/g) || []).length, ancestors: anc,
      font: getComputedStyle(el).fontFamily };
  }, { phrase: c.phrase });

  console.log(`\n--- ${c.name} (${c.lang}) placed=${r.placed}${r.why ? ' why=' + r.why : ''}`);
  console.log(`    blocks after: ${JSON.stringify(afterS.blocks)}`);
  ck(`${c.name}: the translate action reaches the sheet and places a span`, r.placed && got.found,
     r.why || JSON.stringify(got.srcs));
  if (!got.found) continue;
  ck(`${c.name}: data-src is the exact selection (${JSON.stringify(c.phrase)})`, got.exact,
     `stored ${JSON.stringify(got.src)}`);
  ck(`${c.name}: script is text — no SVG, no Latin, real PUA glyphs`,
     got.svg === 0 && !got.latin && got.pua > 0, JSON.stringify({ svg: got.svg, latin: got.latin, pua: got.pua, font: got.font }));
  if (c.keep) {
    const kept = c.keep.split(',').some(tag => got.ancestors.includes(tag.toUpperCase()));
    const key = t => (t === 'strong' ? 'b' : t === 'blockquote' ? 'bq' : t);
    const survives = c.keep.split(',').every(t => afterS.counts[key(t)] >= beforeS.counts[key(t)]);
    ck(`${c.name}: no block is destroyed by the translation`, survives,
       `before=${JSON.stringify(beforeS.counts)} after=${JSON.stringify(afterS.counts)}`);
    ck(`${c.name}: the span sits inside the <${c.keep}> it replaced text in`, kept,
       `ancestors=${JSON.stringify(got.ancestors)} — the span was hoisted out of its block`);
  }
  // the cardinal sin: the English disappears and nothing replaces it
  ck(`${c.name}: the selected English is never destroyed without a span to show for it`,
     got.found, `"${c.phrase.trim()}" gone from the document, spans=${JSON.stringify(got.srcs || [])}`);
}

/* ---- romanization + glyph parity against the codex's own compiler ---- */
const parity = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const matchKeys = (word, matcher) => {
    const o = []; let i = 0; const s = String(word).toLowerCase();
    while (i < s.length) {
      let hit = null;
      for (const k of matcher.keys) if (s.startsWith(k, i)) { hit = k; break; }
      if (hit) { o.push(hit); i += hit.length; } else { if (/\S/.test(s[i])) o.push('·'); i++; }
    }
    return o;
  };
  const out = [];
  for (const el of document.querySelectorAll('#ed-content .tspan')) {
    const id = el.dataset.lang, src = el.dataset.src;
    let codexRom;
    if (id === 'celan_basic') codexRom = w.translateE2C(src).filter(p => p.cel && !p.drop).map(p => p.cel).join(' ');
    else {
      const T = C.TRANS[id], res = C.compileText(T, src, 'e2l');
      const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
      codexRom = lines.map(l => l.map(p => p.t).join(' ')).join(' ');
    }
    let keysOK = null, decoded = null, expect = null;
    const f = (window.tenebrae._forge.map() || {})[id];
    if (f) {
      const sc = C.TRANS[id].L.script, m = C.makeMatcher(sc);
      decoded = (el.dataset.scr || '').split(/[\n ]+/).filter(Boolean).map(word =>
        [...word].map(ch => { const i = ch.charCodeAt(0) - f.base;
          return i >= 0 && i < sc.glyphs.length ? sc.glyphs[i].k.toLowerCase() : (i === sc.glyphs.length ? '·' : '?'); }));
      expect = codexRom.split(/\s+/).filter(Boolean).map(word => matchKeys(word, m));
      keysOK = JSON.stringify(decoded) === JSON.stringify(expect);
    }
    out.push({ id, src, rom: el.dataset.rom, codexRom, romOK: el.dataset.rom === codexRom, keysOK,
      decoded: keysOK === false ? decoded : undefined, expect: keysOK === false ? expect : undefined });
  }
  return out;
});
console.log('\nromanization / glyph parity vs the codex:');
for (const p of parity) console.log(`   ${p.romOK && p.keysOK !== false ? 'ok  ' : 'FAIL'} ${p.id.padEnd(13)} ${JSON.stringify(p.src)} -> ${JSON.stringify(p.rom)}${p.romOK ? '' : ' CODEX SAYS ' + JSON.stringify(p.codexRom)} glyphKeys=${p.keysOK}`);
ck('every span\'s romanization is byte-identical to the codex\'s own compiler output',
   parity.every(p => p.romOK), JSON.stringify(parity.filter(p => !p.romOK)));
ck('every forged-script span\'s PUA run decodes to the codex matcher\'s own glyph keys',
   parity.filter(p => p.keysOK !== null).every(p => p.keysOK === true),
   JSON.stringify(parity.filter(p => p.keysOK === false).map(p => ({ id: p.id, got: p.decoded, want: p.expect }))).slice(0, 400));

/* ---- one stave/word-group per romanized word, as the codex's typesetter does ---- */
const staves = await page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan[data-omni]')]
  .filter(el => el.dataset.lang !== 'celan_basic')
  .map(el => ({ lang: el.dataset.lang, romWords: (el.dataset.rom || '').split(/\s+/).filter(Boolean).length,
                scrGroups: (el.dataset.scr || '').split(/[\n ]+/).filter(Boolean).length, rom: el.dataset.rom })));
console.log('\nword groups:', JSON.stringify(staves));
ck('the script form carries one word-group per romanized word (as the codex typesetter splits it)',
   staves.every(s => s.romWords === s.scrGroups),
   JSON.stringify(staves.filter(s => s.romWords !== s.scrGroups)));

/* ---- prose integrity, block by block ---- */
const finalS = await structure();
const proseNow = await page.evaluate(() => document.querySelector('#ed-content').textContent);
console.log('\nfinal blocks:', JSON.stringify(finalS.blocks));
console.log('final text :', JSON.stringify(proseNow));
const survivors = ['opening line', 'the drowned fleet', 'holds', 'burns', 'waits alone'];
const lost = survivors.filter(x => !proseNow.includes(x));
ck('every untranslated fragment of the document survives the five translations',
   lost.length === 0, 'lost: ' + JSON.stringify(lost));
const eaten = CASES.map(c => c.phrase.trim()).filter(x => !proseNow.includes(x));
console.log('   translated-away phrases (expected, one per case):', JSON.stringify(eaten));

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
const bad = checks.filter(c => !c.ok).length;
console.log(`${checks.length - bad}/${checks.length} checks ok`);
verdict('SELECTION SHAPES', bad === 0 && errors.length === 0);
await browser.close();
await srv.close();
