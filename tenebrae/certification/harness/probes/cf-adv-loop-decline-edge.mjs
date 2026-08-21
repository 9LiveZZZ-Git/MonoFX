// cf-adv-loop-decline-edge — ADVERSARY probe for TX-11c.
//
// cf-loop-decline presses one shape: a bare untranslatable phrase sitting in a
// plain paragraph, translated from the context menu, plus one change-tongue.
// The shapes it never tries, and where a decline could still go wrong:
//
//   A  the untranslatable run is a BOLD run that reaches the block's end — the
//      placement-repair path. A decline must not repair anything, because
//      nothing was inserted.
//   B  the untranslatable run is the WHOLE block.
//   C  the run carries punctuation the codex strips ("zzqxwv, frobnak!").
//   D  the selection is emoji only.
//   E  EDIT SOURCE turns a good span's source into an untranslatable one. The
//      sheet's other rewriting action runs the identical rule (step1.html
//      L3858) and nobody has driven it: the visible span must survive, keeping
//      its old script, romanization and source.
//   F  after a decline, the very next translation must still land correctly —
//      a refused insert must not poison edSelRange.
//
// The oracle is not an expectation: window.tenebrae._forge.textForToks() is the
// same call omniScriptFor makes, so "the codex writes nothing here" is asked of
// the codex itself, per tongue, for every phrase.
//
// Run: cd probes && node cf-adv-loop-decline-edge.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 420)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Decline Edge');
await wait(page, 3500);

async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 320);
}
async function setDoc(html){
  await closeSheets();
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); ed.focus();
  }, html);
  await wait(page, 1300); // past the 500 ms typing debounce, so the persisted doc is current
}
const applySel = (spec) => page.evaluate(s => {
  const ed = document.querySelector('#ed-content');
  const r = document.createRange();
  if(s.all){ const el = ed.querySelector(s.all); if(!el) return 'no element'; r.selectNodeContents(el); }
  else{
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, done = false;
    while((n = w.nextNode())){ const i = n.nodeValue.indexOf(s.text);
      if(i > -1){ r.setStart(n, i); r.setEnd(n, i + s.text.length); done = true; break; } }
    if(!done) return 'text not found';
  }
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return 'ok';
}, spec);
async function translateVia(label){
  const ok = await page.evaluate(() => {
    const sel = getSelection();
    if(!sel.rangeCount || sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const a = sel.anchorNode; const el = a.nodeType === 1 ? a : a.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
    return true;
  });
  if(!ok) return 'no selection';
  await wait(page, 350);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return 'no ctx item';
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await wait(page, 1500);
  await closeSheets();
  return 'ok';
}
const toastText = () => page.evaluate(() => {
  const t = document.querySelector('#toast');
  return t ? t.textContent : null;
});
const snap = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return { html: ed.innerHTML, text: ed.textContent,
    spans: ed.querySelectorAll('.tspan').length,
    // an invisible, un-tappable leftover would show up here
    empties: [...ed.querySelectorAll('span,b,i,u')].filter(e => !e.textContent.trim()).map(e => e.outerHTML),
    pua: [...ed.textContent].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length };
});
const persisted = () => page.evaluate(() => {
  const d = window.tenebrae._omni.probe.sceneDoc();
  return d ? JSON.stringify(d) : null;
});
// the codex's own answer: does it write anything for this phrase in this tongue?
const codexWrites = (lang, text) => page.evaluate(async ([l, t]) => {
  const r = await window.tenebrae.translate2(l, t);
  if(!r) return { ok: false, why: 'no result' };
  const scr = window.tenebrae._forge.textForToks(l, r.toks || []);
  return { ok: !!(scr && scr.trim()), scr: scr || '', rom: r.romanization, name: r.lang.name };
}, [lang, text]);

const TONGUES = [['Celan Basic', 'celan_basic'], ['Celan High', 'celan_high'], ['Kerrackian', 'kerrackian'],
                 ['Kildaren', 'kildaren'], ['Calgridarian', 'calgridarian'], ['Evernessian', 'evernessian']];

const CASES = [
  { id: 'A bold run to block end', phrase: 'zzqxwv frobnak',
    html: '<h2>a <b id="sel">zzqxwv frobnak</b></h2><p>tail</p>', sel: { all: '#sel' } },
  { id: 'B the whole block', phrase: 'zzqxwv frobnak',
    html: '<p id="sel">zzqxwv frobnak</p><p>tail</p>', sel: { all: '#sel' } },
  { id: 'C with punctuation the codex strips', phrase: 'zzqxwv, frobnak!',
    html: '<p>the gate zzqxwv, frobnak! closed</p>', sel: { text: 'zzqxwv, frobnak!' } },
  { id: 'D emoji only', phrase: '🙂 ✦',
    html: '<p>the gate 🙂 ✦ closed</p>', sel: { text: '🙂 ✦' } },
];

for(const c of CASES){
  console.log('\n=== ' + c.id + '  ' + JSON.stringify(c.phrase));
  for(const [label, id] of TONGUES){
    await setDoc(c.html);
    const bfHTML = (await snap()).html, bfDoc = await persisted();
    const w = await codexWrites(id, c.phrase);
    const s = await applySel(c.sel);
    if(s !== 'ok'){ ck(`${c.id} / ${label}: selection made`, false, s); continue; }
    await translateVia(label);
    const d = await snap();
    const toast = await toastText();
    const tag = `${c.id} / ${label}`;
    console.log(`    ${label}: codex writes=${w.ok} scrLen=${(w.scr||'').length} -> spans=${d.spans} toast=${JSON.stringify(toast)}`);
    // the writer must agree with the codex, either way
    ck(tag + `: writer agrees with the codex (writes=${w.ok})`, (d.spans === 1) === w.ok,
       `spans=${d.spans} codexScript=${JSON.stringify((w.scr || '').slice(0, 12))}`);
    if(!w.ok){
      ck(tag + ': the author\'s characters are exactly where they were', d.html === bfHTML,
         'now=' + show(d.html).slice(0, 200) + '  was=' + show(bfHTML).slice(0, 200));
      ck(tag + ': nothing invisible was left behind', d.empties.length === 0, JSON.stringify(d.empties));
      ck(tag + ': no script leaked into the prose', d.pua === 0, d.pua);
      ck(tag + ': it says so, naming the tongue', !!toast && toast.indexOf('has no writing') > -1 && toast.indexOf(w.name || label) > -1, JSON.stringify(toast));
      await wait(page, 1300);
      ck(tag + ': the persisted scene doc is unchanged too', (await persisted()) === bfDoc);
    }else{
      ck(tag + ': what it wrote is visible', d.pua > 0, d.pua);
    }
  }
}

/* ---- E: edit source into something the codex cannot write ---- */
{
  console.log('\n=== E edit source -> untranslatable');
  await setDoc('<p>the gate the sea remembers closed</p>');
  await applySel({ text: 'the sea remembers' });
  await translateVia('Kildaren');
  const beforeSpan = await page.evaluate(() => {
    const s = document.querySelector('#ed-content .tspan');
    return s ? { src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr, text: s.textContent, lang: s.dataset.lang } : null;
  });
  ck('E: a good span to start from', !!beforeSpan, JSON.stringify(beforeSpan));
  const w = await codexWrites('kildaren', 'zzqxwv frobnak');
  ck('E: the codex writes nothing for the new source (oracle)', !w.ok, JSON.stringify(w.scr));
  await page.evaluate(() => document.querySelector('#ed-content .tspan').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(page, 900);
  await page.locator('#sheet .sh-item', { hasText: 'Edit source' }).click();
  await wait(page, 700);
  await page.fill('#ps-input', 'zzqxwv frobnak');
  await page.click('#ps-save');
  await wait(page, 1600);
  await closeSheets();
  const after = await page.evaluate(() => {
    const s = document.querySelector('#ed-content .tspan');
    const ed = document.querySelector('#ed-content');
    return { n: ed.querySelectorAll('.tspan').length, text: ed.textContent,
      s: s ? { src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr, text: s.textContent, lang: s.dataset.lang,
               w: Math.round(s.getBoundingClientRect().width), h: Math.round(s.getBoundingClientRect().height) } : null };
  });
  const toast = await toastText();
  console.log('    after edit-source:', JSON.stringify(after), 'toast=' + JSON.stringify(toast));
  ck('E: the span the author can see is still there', after.n === 1 && !!after.s, after.n);
  ck('E: it did not become an empty, un-tappable span', !!after.s && after.s.w > 0 && after.s.h > 0,
     after.s && `${after.s.w}x${after.s.h}`);
  ck('E: it kept its script rather than showing Latin', !!after.s && after.s.text === beforeSpan.text,
     after.s && show(after.s.text));
  ck('E: source and romanization survive the refusal',
     !!after.s && after.s.src === beforeSpan.src && after.s.rom === beforeSpan.rom,
     JSON.stringify([after.s && after.s.src, beforeSpan.src]));
  ck('E: it says so', !!toast && toast.indexOf('has no writing') > -1, JSON.stringify(toast));
}

/* ---- F: a decline must not poison the next translation ---- */
{
  console.log('\n=== F the next translation after a decline');
  await setDoc('<p>zzqxwv frobnak</p><p>the gate the sea remembers closed</p>');
  await applySel({ text: 'zzqxwv frobnak' });
  await translateVia('Kildaren');
  const mid = await snap();
  ck('F: the decline created nothing', mid.spans === 0, mid.spans);
  await applySel({ text: 'the sea remembers' });
  await translateVia('Kildaren');
  const d = await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    const s = ed.querySelector('.tspan');
    const c = []; if(s) for(let n = s.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) c.push(n.tagName);
    return { n: ed.querySelectorAll('.tspan').length, text: ed.textContent, chain: c.join('>'),
             src: s ? s.dataset.src : null,
             pua: s ? [...s.textContent].filter(ch => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF).length : 0 };
  });
  console.log('    after the good one:', JSON.stringify(d));
  ck('F: the next translation still lands', d.n === 1 && d.src === 'the sea remembers' && d.pua > 0, JSON.stringify(d));
  ck('F: and it lands in the right block', d.chain === 'P', d.chain);
  ck('F: the untranslatable line is still the author\'s', d.text.indexOf('zzqxwv frobnak') > -1, show(d.text));
}

ck('no page exception anywhere in the decline suite', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('');
for(const [l, ok] of checks) if(!ok) console.log('  FAILED:', l);
verdict('DECLINE EDGE CASES', checks.every(c => c[1]));
await browser.close(); await srv.close();
