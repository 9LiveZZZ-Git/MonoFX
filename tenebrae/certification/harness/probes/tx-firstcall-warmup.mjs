// Side-finding turned up while proving TX-10: the FIRST translate2 call after
// the engine reports ready can return a different (truncated) romanization from
// every later call with the same input. Not a TX-10/TX-11 clause — recorded
// here with a reproducible witness so the TX-3 (determinism) / TX-12 (engine
// still waking) owners have something concrete.
//
// Run: cd probes && node tx-firstcall-warmup.mjs
import { launch, wait } from './ex-lib.mjs';

const SRC = 'the sea remembers the old king';
const rows = [];
for(const waitMs of [3500, 3500, 6000]){
  const { srv, browser, page, errors } = await launch();
  await wait(page, waitMs);
  const r = await page.evaluate(async src => {
    const a = await window.tenebrae.translate2('celan_high', src);
    const b = await window.tenebrae.translate2('celan_high', src);
    const c = await window.tenebrae.translate2('celan_high', src);
    const w = await window.tenebrae.engine();
    const T = w.CODEX.TRANS.celan_high;
    const res = w.CODEX.compileText(T, src, 'e2l');
    const lines = res.lines || [(res.parts || []).filter(p => !p.drop && p.out).map(p => ({ t: p.out }))];
    return { call1: a.romanization, call2: b.romanization, call3: c.romanization,
             codexOwn: lines.map(l => l.map(p => p.t).join(' ')).join(' ') };
  }, SRC);
  rows.push({ waitMs, ...r, errs: errors.length });
  console.log(`wait=${waitMs}ms`);
  console.log('   call1    :', JSON.stringify(r.call1));
  console.log('   call2    :', JSON.stringify(r.call2));
  console.log('   call3    :', JSON.stringify(r.call3));
  console.log('   codexOwn :', JSON.stringify(r.codexOwn));
  console.log('   stable across repeats:', r.call1 === r.call2 && r.call2 === r.call3);
  await browser.close();
  await srv.close();
}
const anyDrift = rows.some(r => !(r.call1 === r.call2 && r.call2 === r.call3 && r.call3 === r.codexOwn));
console.log('FIRST-CALL DRIFT OBSERVED:', anyDrift);
