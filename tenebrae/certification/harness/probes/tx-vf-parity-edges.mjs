// TX-VF: the three disputed TX-2 divergences, checked against the codex itself.
//   (a) celan_basic gloss drops p.tag (codex renders gloss + tagnote)
//   (b) celan_basic token split corrupts words with an INTERIOR stripped char
//   (c) multi-sentence line flattening
// Run: cd probes && node tx-vf-parity-edges.mjs
import { launch, wait, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const out = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  const C = w.CODEX;
  const R = { tag: [], split: [], multi: [] };

  // ---------- (a) celan_basic: does any part carry a tag the writer drops? ----------
  const tagInputs = [
    'the king will remember', 'she will walk', 'the sea will remember the name',
    'he will not return', 'they will stand', 'the tower will fall',
  ];
  for(const s of tagInputs){
    const parts = w.translateE2C(s);
    const tagged = parts.filter(p => p.tag);
    if(!tagged.length) continue;
    const r = await window.tenebrae.translate2('celan_basic', s);
    // codex's own gloss cell = esc(p.gloss||'') + (p.tag ? tagnote(p.tag) : '')
    const codexGloss = parts.map(p => (p.gloss || '') + (p.tag ? ' · ' + p.tag : ''));
    const writerGloss = (r.gloss || []).map(g => g.g);
    R.tag.push({ s, tagged: tagged.map(p => ({ tok: p.tok, cel: p.cel, gloss: p.gloss, tag: p.tag })),
                 codexGloss, writerGloss,
                 lossless: JSON.stringify(codexGloss) === JSON.stringify(writerGloss) });
  }

  // ---------- (b) celan_basic token split ----------
  const splitInputs = [
    'my mana let it stand', 'the sea remembers', '123456.56 stones',
    'a b c', 'the king of the sea', 'she does not remember',
  ];
  for(const s of splitInputs){
    const parts = w.translateE2C(s);
    const kept = parts.filter(p => p.cel && !p.drop);
    const codexWords = kept.flatMap(p => String(p.cel).split(/\s+/).filter(Boolean));
    const r = await window.tenebrae.translate2('celan_basic', s);
    const writerToks = (r.toks || []).map(t => ({ t: t.t, punct: t.punct }));
    // faithful reassembly would be t + punct === the codex word
    const bad = codexWords.map((cw, i) => {
      const tk = writerToks[i] || { t: '', punct: '' };
      return { cw, t: tk.t, punct: tk.punct, ok: (tk.t + (tk.punct || '')) === cw };
    }).filter(x => !x.ok);
    R.split.push({ s, rom: r.romanization, codexWords, writerToks, bad });
  }

  // ---------- (c) multi-sentence flattening ----------
  const multi = 'The sea remembers. The king waits. The tower falls.';
  for(const id of ['celan_high', 'kildaren', 'kerrackian']){
    const T = C.TRANS[id];
    const res = C.compileText(T, multi, 'e2l');
    const lines = res.lines;
    const r = await window.tenebrae.translate2(id, multi);
    R.multi.push({
      id, nLines: lines ? lines.length : 0,
      writerRom: r.romanization,
      codexClipboard: lines ? lines.map(l => l.map(p => p.t).join(' ')).join('\n') : null,
      codexDisplay: lines ? lines.map(l => l.map(p => p.t).join(' ')).join('<br>') : null,
      codexCleanText: lines ? lines.map(l => l.filter(p => !p.u).map(p => p.t).join(' ')).join(' ') : null,
      spaceJoined: lines ? lines.map(l => l.map(p => p.t).join(' ')).join(' ') : null,
      sepToks: (r.toks || []).filter(t => t.sep).length,
    });
  }
  return R;
});

console.log('=== (a) celan_basic gloss vs codex gloss cell (gloss + tag) ===');
let tagLoss = 0;
for(const c of out.tag){
  console.log(`  "${c.s}"  lossless=${c.lossless}`);
  console.log(`     tagged parts : ${JSON.stringify(c.tagged)}`);
  if(!c.lossless){
    tagLoss++;
    console.log(`     codex gloss  : ${JSON.stringify(c.codexGloss)}`);
    console.log(`     writer gloss : ${JSON.stringify(c.writerGloss)}`);
  }
}
if(!out.tag.length) console.log('  (no tagged part produced by any probe input — claim (a) unexercised)');

console.log('\n=== (b) celan_basic token split (t + punct must rebuild the codex word) ===');
let splitBad = 0;
for(const c of out.split){
  if(c.bad.length){
    splitBad++;
    console.log(`  "${c.s}"  BAD ${c.bad.length}`);
    console.log(`     codex words : ${JSON.stringify(c.codexWords)}`);
    console.log(`     writer toks : ${JSON.stringify(c.writerToks)}`);
    console.log(`     broken      : ${JSON.stringify(c.bad)}`);
  } else console.log(`  "${c.s}"  ok (${c.codexWords.length} words)`);
}

console.log('\n=== (c) multi-sentence flattening ===');
for(const m of out.multi){
  console.log(`  ${m.id}: ${m.nLines} lines, ${m.sepToks} sep toks`);
  console.log(`     writer rom      : ${JSON.stringify(m.writerRom)}`);
  console.log(`     codex clipboard : ${JSON.stringify(m.codexClipboard)}`);
  console.log(`     space-joined    : ${JSON.stringify(m.spaceJoined)}`);
  console.log(`     writer==spaceJoined: ${m.writerRom === m.spaceJoined}`);
}

console.log('\npageerrors:', errors.length ? errors.slice(0, 3) : 'none');
verdict('TX-VF PARITY EDGES (no divergence)', tagLoss === 0 && splitBad === 0 && errors.length === 0);
await browser.close();
await srv.close();
