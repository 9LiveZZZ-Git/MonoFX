// TX-VF: independent re-verification of the disputed data-loss claims.
//   A. TX-9  / TX-12 : data-src silently truncated at 2000 chars on persist
//   B. TX-12         : a selection that swallows an existing span replaces that
//                      span's ENGLISH with its romanization in the new source
//   C. TX-8          : revert-to-plain leaves the insertion NBSP behind, and it
//                      compounds across cycles
//   D. TX-12         : a degenerate selection can yield an EMPTY span (the
//                      author's characters vanish from the page)
//   E. TX-12         : reload immediately after a translation loses it
// Run: cd probes && node tx-vf-loss.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? '  ok   ' : '  FAIL '), label, extra === undefined ? '' : extra); };

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

// ================= A. sanitizer truncation, through the app's own seam =======
console.log('\n=== A. sanitizer caps on a stored span ===');
const caps = await page.evaluate(() => {
  const mk = (n, attr) => {
    const src = attr === 'src' ? 'x'.repeat(n) : 'short source';
    const rom = attr === 'rom' ? 'y'.repeat(n) : 'rr';
    const scr = attr === 'scr' ? ''.repeat(n) : '';
    return `<p><span class="tspan" data-omni="1" data-lang="celan_high" data-src="${src}" data-rom="${rom}" data-scr="${scr}" contenteditable="false">${scr}</span></p>`;
  };
  const read = html => {
    const d = document.createElement('div');
    d.innerHTML = window.tenebrae._omni.probe.sanitize(html);
    const s = d.querySelector('.tspan');
    return s ? { src: s.dataset.src.length, rom: s.dataset.rom.length, scr: (s.dataset.scr || '').length, text: s.textContent.length } : null;
  };
  return {
    src1999: read(mk(1999, 'src')), src2001: read(mk(2001, 'src')), src5000: read(mk(5000, 'src')),
    rom6000: read(mk(6000, 'rom')), scr6000: read(mk(6000, 'scr')),
  };
});
console.log(JSON.stringify(caps, null, 1));
ck('sanitizer preserves a 2001-char data-src', caps.src2001 && caps.src2001.src === 2001, `kept ${caps.src2001 && caps.src2001.src}`);
ck('sanitizer preserves a 5000-char data-src', caps.src5000 && caps.src5000.src === 5000, `kept ${caps.src5000 && caps.src5000.src}`);
ck('data-scr and rendered text agree above 4000 glyphs',
   caps.scr6000 && caps.scr6000.scr === caps.scr6000.text,
   `data-scr=${caps.scr6000 && caps.scr6000.scr} textContent=${caps.scr6000 && caps.scr6000.text}`);

// end-to-end: a >2000-char selection through the real UI, then reload
await createBook(page, 'VF Loss');
await page.click('#ed-title'); await page.keyboard.type('Long');
await page.click('#ed-content');
const LONG = ('the sea remembers the old king and the lamp holds steady tonight ').repeat(40).trim(); // ~2560 chars
await page.evaluate(t => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>' + t + '</p>';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
}, LONG);
await wait(page, 900);
await page.evaluate(() => {
  const p = document.querySelector('#ed-content p');
  const r = document.createRange(); r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.evaluate(() => {
  const sel = getSelection(); const r = sel.getRangeAt(0).getBoundingClientRect();
  const el = document.querySelector('#ed-content p');
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click();
await wait(page, 2500);
const liveLong = await page.evaluate(() => { const s = document.querySelector('#ed-content .tspan'); return s ? { src: s.dataset.src.length, scr: (s.dataset.scr || '').length } : null; });
console.log('live long span:', JSON.stringify(liveLong), 'selection was', LONG.length, 'chars');
// read the STORED doc (the app's own persist path) rather than racing a reload
await wait(page, 1500);
const storedLong = await page.evaluate(() => {
  const doc = window.tenebrae._omni.probe.sceneDoc() || '';
  const d = document.createElement('div'); d.innerHTML = doc;
  const s = d.querySelector('.tspan');
  return s ? { src: s.dataset.src.length, scr: (s.dataset.scr || '').length, text: s.textContent.length } : null;
});
console.log('stored span   :', JSON.stringify(storedLong));
ck('a >2000-char translated selection is stored with its English intact',
   !!storedLong && !!liveLong && storedLong.src === liveLong.src,
   `live src=${liveLong && liveLong.src} -> stored src=${storedLong && storedLong.src}`);

// ================= B. selection swallowing an existing span =================
console.log('\n=== B. selection that swallows an existing span ===');
await page.evaluate(() => { const s = document.querySelector('#ed-content'); s.innerHTML = ''; });
await wait(page, 400);
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>first para the sea remembers here</p><p>second para lamp holds steady</p><p>third para she walks alone tonight</p>';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
});
await wait(page, 900);
await insertTranslationSpan(page, 'lamp holds', 'Celan High');
await wait(page, 1200);
const seeded = await page.evaluate(() => { const s = document.querySelector('#ed-content .tspan'); return s && { src: s.dataset.src, rom: s.dataset.rom }; });
console.log('seed span:', JSON.stringify(seeded));
await page.evaluate(() => {
  const ps = document.querySelectorAll('#ed-content p');
  const r = document.createRange(); r.setStartBefore(ps[0]); r.setEndAfter(ps[2]);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const b = r.getBoundingClientRect();
  ps[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(10, b.left + 4), clientY: Math.max(10, b.top + 4) }));
});
await wait(page, 400);
await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
await wait(page, 700);
await page.locator('#sheet .sh-item', { hasText: 'Kildaren' }).click();
await wait(page, 2000);
const swallowed = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#ed-content .tspan')];
  const big = spans.find(s => s.dataset.lang === 'kildaren');
  return { n: spans.length, src: big && big.dataset.src };
});
console.log('new span src:', JSON.stringify(swallowed));
ck('a swallowed span contributes its ENGLISH to the new source, not its romanization',
   !!swallowed.src && swallowed.src.includes('lamp holds') && !swallowed.src.includes(seeded.rom.split(' ')[0]),
   `src=${JSON.stringify(swallowed.src)} (swallowed span's rom was ${JSON.stringify(seeded.rom)})`);

// ================= C. revert leaves the insertion NBSP behind ===============
console.log('\n=== C. revert-to-plain whitespace fidelity ===');
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>at dusk the drover walks a long road and sleeps</p>';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
});
await wait(page, 900);
const before = await page.evaluate(() => {
  const p = document.querySelector('#ed-content p');
  return { text: p.textContent, nbsp: (p.textContent.match(/ /g) || []).length, len: p.textContent.length };
});
const cycle = async () => {
  await insertTranslationSpan(page, 'the drover walks', 'Kerrackian');
  await wait(page, 900);
  await page.evaluate(() => { const s = document.querySelector('#ed-content .tspan'); if(s) s.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(page, 700);
  await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
  await wait(page, 900);
  return page.evaluate(() => {
    const p = document.querySelector('#ed-content p');
    return { text: p.textContent, nbsp: (p.textContent.match(/ /g) || []).length, len: p.textContent.length };
  });
};
const c1 = await cycle(), c2 = await cycle(), c3 = await cycle();
console.log('before :', JSON.stringify(before));
console.log('cycle1 :', JSON.stringify(c1));
console.log('cycle2 :', JSON.stringify(c2));
console.log('cycle3 :', JSON.stringify(c3));
ck('revert restores the EXACT English (no residual NBSP)', c1.text === before.text,
   `${JSON.stringify(before.text)} -> ${JSON.stringify(c1.text)}`);
ck('translate/revert cycles do not grow the paragraph', c3.len === before.len,
   `len ${before.len} -> ${c1.len} -> ${c2.len} -> ${c3.len}`);

// ================= D. degenerate selection -> empty span ====================
console.log('\n=== D. degenerate selections ===');
const degen = [];
for(const [phrase, tongue] of [['...', 'Celan Basic'], ['...', 'Kildaren'], ['— " ’ —', 'Kildaren'], ['the', 'Celan Basic']]){
  await page.evaluate(p => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = `<p>the gate opened ${p} and then silence</p>`;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, phrase);
  await wait(page, 700);
  try{ await insertTranslationSpan(page, phrase, tongue); }catch(e){ degen.push({ phrase, tongue, err: e.message.split('\n')[0] }); continue; }
  await wait(page, 700);
  const r = await page.evaluate(() => {
    const s = document.querySelector('#ed-content .tspan');
    if(!s) return { none: true };
    const b = s.getBoundingClientRect();
    return { src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr || null,
             text: s.textContent, w: Math.round(b.width), h: Math.round(b.height),
             page: document.querySelector('#ed-content p').textContent };
  });
  degen.push({ phrase, tongue, ...r });
}
for(const d of degen) console.log('  ', JSON.stringify(d));
const emptySpans = degen.filter(d => d.text === '');
ck('no degenerate selection produces an EMPTY (invisible) span', emptySpans.length === 0,
   `${emptySpans.length} empty spans: ${JSON.stringify(emptySpans.map(d => [d.phrase, d.tongue]))}`);

// ================= E. reload immediately after a translation ================
console.log('\n=== E. reload right after a translation ===');
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>the winter sea remembers every name</p>';
  ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
});
await wait(page, 1200);
await insertTranslationSpan(page, 'winter sea remembers', 'Evernessian');
const present = await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length);
await page.reload();
await wait(page, 3200);
await page.evaluate(() => { const r = document.querySelector('#lib-list .row'); if(r) r.click(); });
await wait(page, 900);
await page.evaluate(() => { const r = document.querySelector('#bk-list [data-scene]'); if(r) r.click(); });
await wait(page, 1500);
const survived = await page.evaluate(() => ({ n: document.querySelectorAll('#ed-content .tspan').length,
  text: (document.querySelector('#ed-content') || {}).textContent }));
console.log('spans before reload:', present, ' after:', JSON.stringify(survived));
ck('a completed translation survives an immediate reload', survived.n === present,
   `${present} -> ${survived.n}`);

console.log('\npageerrors:', errors.length ? errors.slice(0, 5) : 'none');
verdict('TX-VF LOSS', checks.every(c => c[1]) && errors.length === 0);
await browser.close();
await srv.close();
