// cf-tx12-hostile — TX-12, which no probe has ever owned.
//
//   "Long selections, selections spanning paragraphs and existing spans,
//    XML/HTML metacharacters, emoji and combining marks, over-long words,
//    translating while the engine wakes, rapid translate/undo cycles, and
//    reload mid-flight produce no page exceptions, no data loss, no corrupted
//    spans, and no Latin fallback."
//
// The full certification report recorded TX-12 as a FAIL *derived* from other
// domains' defects, with the derivation stated — no adversarial work was ever
// aimed at the id. This probe aims at it, clause by clause, and its rule
// throughout is the one the requirement states: whatever else happens, the
// author's characters are still in the document.
// Run: cd probes && node cf-tx12-hostile.mjs
import { launch, wait, createBook, verdict, PUA_RE } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 280)); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x0A ? '\\n' : (n >= 0xE000 && n <= 0xF8FF) ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await createBook(page, 'Hostile Book');
await wait(page, 3200);

const setDoc = async html => {
  await page.evaluate(h => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = h;
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  }, html);
  await wait(page, 400);
};
const text = () => page.evaluate(() => document.querySelector('#ed-content').textContent || '');
const html = () => page.evaluate(() => document.querySelector('#ed-content').innerHTML);
const spans = () => page.evaluate(() => [...document.querySelectorAll('#ed-content .tspan')].map(s => ({
  lang: s.dataset.lang || null, src: s.dataset.src || null, rom: s.dataset.rom || null,
  pua: [...(s.textContent || '')].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length,
  latin: /[A-Za-z]/.test(s.textContent || ''),
})));

// select a phrase and translate it through the real context menu
async function translate(phrase, tongue){
  const ok = await page.evaluate(p => {
    const ed = document.querySelector('#ed-content');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n; while((n = w.nextNode())){
      const i = n.nodeValue.indexOf(p);
      if(i > -1){
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + p.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        const bb = r.getBoundingClientRect();
        (n.parentElement || ed).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
          clientX: Math.max(10, bb.left + 4), clientY: Math.max(10, bb.top + 4) }));
        return true;
      }
    }
    return false;
  }, phrase);
  if(!ok) return false;
  await wait(page, 400);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  const item = page.locator('#sheet .sh-item', { hasText: tongue });
  if(!(await item.count())) return false;
  await item.click();
  await wait(page, 1500);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 300);
  return true;
}
// select across two elements by their text, then translate
async function translateAcross(a, b, tongue){
  const ok = await page.evaluate(({ a, b }) => {
    const ed = document.querySelector('#ed-content');
    const nodes = []; const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n; while((n = w.nextNode())) nodes.push(n);
    let sN = null, sO = 0, eN = null, eO = 0, si = -1;
    for(let k = 0; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(a); if(i > -1){ sN = nodes[k]; sO = i; si = k; break; } }
    if(sN) for(let k = si; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(b, k === si ? sO : 0); if(i > -1){ eN = nodes[k]; eO = i + b.length; break; } }
    if(!sN || !eN) return false;
    const r = document.createRange(); r.setStart(sN, sO); r.setEnd(eN, eO);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const bb = r.getBoundingClientRect();
    (sN.parentElement || ed).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, bb.left + 4), clientY: Math.max(10, bb.top + 4) }));
    return true;
  }, { a, b });
  if(!ok) return false;
  await wait(page, 400);
  if(!(await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count())) return false;
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  const item = page.locator('#sheet .sh-item', { hasText: tongue });
  if(!(await item.count())) return false;
  await item.click();
  await wait(page, 1500);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 300);
  return true;
}
const noCorruptSpans = async label => {
  const sp = await spans();
  ck(label + ': no span degraded to Latin, none left without a source',
     sp.every(s => s.src && s.lang && !s.latin && s.pua > 0), JSON.stringify(sp).slice(0, 240));
};

/* ---- 1. XML / HTML metacharacters in the author's prose ---- */
{
  const HOST = 'She said <b>&amp; "the sea remembers" & <script>alert(1)</script></b> at the gate.';
  await setDoc('<p></p>');
  await page.click('#ed-content');
  await page.keyboard.type(HOST);
  await wait(page, 600);
  const before = await text();
  ck('metacharacters are typed as literal text, not markup',
     before.includes('<script>') && !(await html()).includes('<script'), JSON.stringify(show(before)).slice(0, 160));
  await translate('the sea remembers', 'Celan High');
  const after = await text();
  ck('the surrounding metacharacters survive the translation',
     after.includes('<script>alert(1)</script>') && after.includes('&amp;'), JSON.stringify(show(after)).slice(0, 200));
  await noCorruptSpans('metacharacters');
}

/* ---- 2. emoji and combining marks around the selection ---- */
{
  await setDoc('<p>🜍 má̈ña 👁️‍🗨️ the sea remembers 🕯️ taiĺ</p>');
  const before = await text();
  await translate('the sea remembers', 'Kildaren');
  const after = await text();
  ck('emoji, ZWJ sequences and combining marks all survive',
     ['🜍', '👁️‍🗨️', '🕯️', 'má̈ña', 'taiĺ'].every(x => after.includes(x)),
     JSON.stringify(after));
  ck('and nothing was silently normalized away', after.length >= before.length - 'the sea remembers'.length,
     `${before.length} -> ${after.length}`);
  await noCorruptSpans('emoji');
}

/* ---- 3. an over-long word, and a very long selection ---- */
{
  const LONG_WORD = 'the' + 'sea'.repeat(120) + 'remembers';
  await setDoc(`<p>opening ${LONG_WORD} closing</p>`);
  await translate(LONG_WORD, 'Evernessian');
  const t3 = await text();
  ck('an over-long word leaves the block intact',
     t3.includes('opening') && t3.includes('closing'), JSON.stringify(show(t3)).slice(0, 120));
  await noCorruptSpans('over-long word');

  const LONG_SEL = Array.from({ length: 90 }, (_, i) => `the sea remembers line ${i}`).join(' ');
  await setDoc(`<p>head ${LONG_SEL} tail</p>`);
  await translate(LONG_SEL, 'Kerrackian');
  const t4 = await text();
  ck('a 90-clause selection leaves the block intact',
     t4.includes('head') && t4.includes('tail'), JSON.stringify(show(t4)).slice(0, 120));
  await noCorruptSpans('long selection');
}

/* ---- 4. a selection spanning paragraphs AND an existing span ---- */
{
  await setDoc('<p>alpha the sea remembers bravo</p><p>charlie the old king delta</p>');
  await translate('the sea remembers', 'Celan High');
  const mid = await spans();
  ck('setup: one span exists to be swallowed', mid.length === 1, JSON.stringify(mid));
  await translateAcross('bravo', 'the old king', 'Kildaren');
  const t5 = await text();
  const sp5 = await spans();
  console.log('   after swallowing a span:', JSON.stringify(show(t5)).slice(0, 200));
  ck('the author\'s untouched words survive on both sides',
     t5.includes('alpha') && t5.includes('delta'), JSON.stringify(show(t5)).slice(0, 200));
  ck('a swallowed span contributes its ENGLISH to the new source, never its script',
     sp5.length >= 1 && sp5.every(s => s.src && !PUA_RE.test(s.src)),
     JSON.stringify(sp5.map(s => s.src)));
  await noCorruptSpans('cross-block over a span');
}

/* ---- 5. rapid translate / undo cycles ---- */
{
  await setDoc('<p>and the sea remembers now</p>');
  const base = await text();
  for(let i = 0; i < 6; i++){
    await translate('the sea remembers', 'Celan High');
    await page.evaluate(() => document.querySelector('#ed-content').focus());
    await page.keyboard.press('Control+z');
    await wait(page, 350);
  }
  const t6 = await text();
  const sp6 = await spans();
  ck('six rapid translate/undo cycles leave the author\'s line exactly as it was',
     t6 === base, JSON.stringify(show(t6)) + ' vs ' + JSON.stringify(show(base)));
  ck('and leave no span behind', sp6.length === 0, JSON.stringify(sp6));
  // past the 500 ms autosave debounce: an undo reaches storage through the same
  // input path as a keystroke, so reading sooner reads the state before it
  await wait(page, 1200);
  const saved = await page.evaluate(() => window.tenebrae._omni.probe.sceneDoc());
  console.log('   persisted after the cycles:', show(saved).slice(0, 160));
  ck('and nothing accumulated in what would be persisted',
     !/<(b|i|u|s|strong|em|del|strike)><\/\1>/i.test(saved) && !PUA_RE.test(saved), show(saved).slice(0, 200));
}

/* ---- 6. reload mid-flight ---- */
{
  await setDoc('<p>the gate the sea remembers closed</p>');
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    const n = w.nextNode();
    const i = n.nodeValue.indexOf('the sea remembers');
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'the sea remembers'.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const bb = r.getBoundingClientRect();
    n.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: Math.max(10, bb.left + 4), clientY: Math.max(10, bb.top + 4) }));
  });
  await wait(page, 350);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 500);
  await page.locator('#sheet .sh-item', { hasText: 'Celan High' }).click();
  await page.waitForTimeout(120);          // reload while the translation is in flight
  await page.reload();
  await page.waitForTimeout(4200);
  const reloadErrs = errors.length;
  await page.locator('#lib-list button.row').first().click();
  await wait(page, 800);
  await page.locator('#bk-list .row[data-scene]').first().click();
  await wait(page, 2500);
  const t7 = await text();
  console.log('   after reload mid-flight:', JSON.stringify(show(t7)).slice(0, 200));
  ck('a reload mid-translation loses none of the author\'s words',
     t7.includes('the gate') && t7.includes('closed') &&
     (t7.includes('the sea remembers') || (await spans()).some(s => s.src === 'the sea remembers')),
     JSON.stringify(show(t7)).slice(0, 200));
  ck('and raises no page exception', errors.length === reloadErrs, errors.slice(-2).join(' | '));
  await noCorruptSpans('after reload');
}

ck('no page exceptions anywhere in the hostile suite', errors.length === 0, errors.slice(0, 4).join(' | '));
verdict('TX-12 HOSTILE INPUT', checks.every(c => c[1]) && errors.length === 0);
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
