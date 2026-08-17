// TX-12 — HOSTILE INPUT through the REAL UI.
// Cases: 2000+ char selection; selection spanning paragraphs AND an existing
// span; translating a span's own script text; XML/HTML metacharacters incl. a
// literal </span>; emoji + combining marks; RTL source; a word longer than a
// column.
// Asserts per case: no page exception, no data loss (data-src round-trips
// through sanitize + reload), no Latin fallback inside a span, no corrupted /
// nested spans, and the app still works afterwards.
// Run: cd probes && node tx-hostile-input.mjs
import { launch, wait, createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : String(extra).slice(0, 300)); };
const note = (l, v) => console.log('    ·', l, typeof v === 'string' ? v.slice(0, 240) : JSON.stringify(v).slice(0, 240));

const { srv, browser, page, errors } = await launch();
await wait(page, 3500); // embedded engine wakes + forges

// ---------- helpers ----------
const errMark = () => errors.length;
const noNewErrors = (from, label) => ck(`${label}: no page exception`, errors.length === from, errors.slice(from).join(' | '));

// a full-editor span swallows the click target, so never page.click('#ed-content')
async function closeSheets(){
  await page.evaluate(() => {
    const s = document.querySelector('#scrim');
    if(s && s.classList.contains('show')) s.click();
    document.querySelectorAll('#ctx').forEach(n => n.remove());
  });
  await wait(page, 450);
}
async function focusEditorEnd(){
  await closeSheets();
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await wait(page, 120);
}
// select-all + delete through the real editing pipeline; returns what survived
async function selectAllDelete(){
  await closeSheets();
  const res = await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('delete');
    return { spansLeft: ed.querySelectorAll('.tspan').length, text: ed.innerText.trim().length };
  });
  await wait(page, 250);
  return res;
}
// guarantee an empty scene for the next case (setup, not a claim)
async function clearEditor(){
  const res = await selectAllDelete();
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    ed.innerHTML = '';
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
    ed.focus();
  });
  await wait(page, 300);
  return res;
}
// type through the real input pipeline (insertText fires real beforeinput/input)
async function typeLine(text){ await page.keyboard.insertText(text); }

// selection from the FIRST occurrence of `fromNeedle` to the LAST occurrence of
// `toNeedle` (last wins, so a repeated sentence still yields a long selection)
const selectSpanning = (page, fromNeedle, toNeedle) => page.evaluate(([a, b]) => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, s = null, e = null;
  while((n = w.nextNode())){
    if(s === null){ const i = n.nodeValue.indexOf(a); if(i > -1){ s = [n, i]; } }
    if(s !== null){ const j = n.nodeValue.lastIndexOf(b); if(j > -1 && (n !== s[0] || j >= s[1])){ e = [n, j + b.length]; } }
  }
  if(!s || !e) return false;
  const r = document.createRange();
  r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
}, [fromNeedle, toNeedle]);

const selectAllInEditor = page => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const r = document.createRange(); r.selectNodeContents(ed);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
});

// right-click at the selection → "Translate …" → pick a tongue by label
async function ctxTranslate(langLabel, { anchorOutsideSpan = true } = {}){
  await page.evaluate(outside => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if(outside && el.closest && el.closest('.tspan')) el = el.closest('.tspan').parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4)
    }));
  }, anchorOutsideSpan);
  await wait(page, 400);
  const ctxOpen = await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).count();
  if(!ctxOpen) return { opened: false };
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 700);
  const item = page.locator('#sheet .sh-item', { hasText: langLabel });
  if(!(await item.count())) return { opened: true, tongue: false };
  await item.click();
  await wait(page, 1200);
  return { opened: true, tongue: true };
}

const spanDump = page => page.evaluate(() => {
  const F = window.tenebrae._forge.map() || {};
  const bases = {}; for(const [k, v] of Object.entries(F)) bases[k] = v.base;
  return [...document.querySelectorAll('#ed-content .tspan')].map(sp => {
    const txt = sp.textContent;
    const base = bases[sp.dataset.lang];
    const pua = [...txt].filter(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF).length;
    const inRange = base == null ? 0 : [...txt].filter(c => c.charCodeAt(0) >= base && c.charCodeAt(0) < base + 0x80).length;
    const latin = (txt.match(/[A-Za-z]/g) || []).length;
    return {
      lang: sp.dataset.lang, omni: sp.dataset.omni || null, flow: sp.dataset.flow || null,
      srcLen: (sp.dataset.src || '').length, src: sp.dataset.src || '',
      romLen: (sp.dataset.rom || '').length, scrLen: (sp.dataset.scr || '').length,
      textLen: txt.length, pua, inRange, latin,
      nested: sp.querySelectorAll('.tspan').length,
      elemKids: sp.children.length,
      ce: sp.getAttribute('contenteditable'),
      scrMatchesText: (sp.dataset.scr || '') === txt,
      font: getComputedStyle(sp).fontFamily,
      box: (() => { const b = sp.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()
    };
  });
});

const sceneDoc = page => page.evaluate(() => { try{ return window.tenebrae._omni.probe.sceneDoc(); }catch(e){ return null; } });
const persist = async () => { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await wait(page, 300); };

async function openScene(){
  await page.locator('#lib-list .row[data-book]', { hasText: 'Hostile Book' }).click();
  await wait(page, 700);
  await page.locator('.row[data-scene]').first().click();
  await wait(page, 900);
  await page.waitForFunction(() => window.tenebrae && window.tenebrae._forge.map(), null, { timeout: 30000 }).catch(() => {});
  await wait(page, 2000);
}
async function reopenScene(){
  await page.reload();
  await wait(page, 1400);
  await openScene();
}

// ---------- setup ----------
await createBook(page, 'Hostile Book');

/* ========== A. 2000+ character selection ========== */
{
  const e0 = errMark();
  await clearEditor();
  const SENT = 'The sea remembers the old king and the lamp holds steady over the water tonight. ';
  const LONG = SENT.repeat(30).trim(); // ~2400 chars
  note('A input length', LONG.length);
  await focusEditorEnd();
  await typeLine('anchor start ');
  await typeLine(LONG);
  await wait(page, 600);
  await selectSpanning(page, 'The sea remembers', 'water tonight.');
  const selLen = await page.evaluate(() => getSelection().toString().length);
  note('A selection length', selLen);
  ck('A(2400ch): selection is >2000 chars', selLen > 2000, selLen);
  const r = await ctxTranslate('Celan High');
  ck('A: translate ran through the real ctx menu + sheet', r.opened && r.tongue, JSON.stringify(r));
  let d = (await spanDump(page))[0];
  note('A span (live DOM)', d);
  ck('A: one span, no nesting, contenteditable=false', !!d && d.nested === 0 && d.elemKids === 0 && d.ce === 'false');
  ck('A: live span keeps the FULL English source', !!d && d.srcLen === selLen, d && `src=${d.srcLen} sel=${selLen}`);
  ck('A: no Latin inside the span', !!d && d.latin === 0, d && `latin=${d.latin}`);
  ck('A: span text is forged-PUA in its own language block', !!d && d.inRange > 0 && d.inRange === d.pua, d && `inRange=${d.inRange} pua=${d.pua}`);

  await persist();
  const doc = await sceneDoc(page);
  const persistedSrcLen = await page.evaluate(doc => {
    const t = document.createElement('template'); t.innerHTML = doc;
    const sp = t.content.querySelector('.tspan');
    return sp ? { src: (sp.dataset.src || '').length, scr: (sp.dataset.scr || '').length, rom: (sp.dataset.rom || '').length, text: sp.textContent.length } : null;
  }, doc);
  note('A persisted span lens', persistedSrcLen);
  ck('A: SAVED span keeps the full English source (no truncation)',
     !!persistedSrcLen && persistedSrcLen.src === selLen,
     persistedSrcLen && `saved src=${persistedSrcLen.src} of ${selLen}`);
  ck('A: SAVED span keeps its script text intact',
     !!persistedSrcLen && persistedSrcLen.scr === persistedSrcLen.text,
     persistedSrcLen && `scr=${persistedSrcLen.scr} text=${persistedSrcLen.text}`);

  await reopenScene();
  d = (await spanDump(page))[0];
  note('A span after reload', d && { srcLen: d.srcLen, scrLen: d.scrLen, textLen: d.textLen, latin: d.latin, pua: d.pua });
  ck('A: span survives reload with source intact', !!d && d.srcLen === selLen, d && `src=${d.srcLen} want=${selLen}`);
  ck('A: no Latin fallback after reload', !!d && d.latin === 0, d && `latin=${d.latin}`);
  noNewErrors(e0, 'A(2400ch)');
}

/* ===== A1b. where exactly the loss happens: the sanitizer's own caps ===== */
{
  const caps = await page.evaluate(() => {
    const P = String.fromCharCode(0xE500);
    const mk = (n, m, k) => `<span class="tspan" data-omni="1" data-lang="celan_high" data-src="${'x'.repeat(n)}" data-rom="${'y'.repeat(m)}" data-scr="${P.repeat(k)}">${P.repeat(k)}</span>`;
    const out = {};
    for(const n of [1999, 2000, 2001, 2400, 5000]){
      const h = window.tenebrae._omni.probe.sanitize(mk(n, 100, 10));
      const t = document.createElement('template'); t.innerHTML = h;
      out['src' + n] = (t.content.querySelector('.tspan').dataset.src || '').length;
    }
    for(const m of [3999, 4000, 4001, 6000]){
      const h = window.tenebrae._omni.probe.sanitize(mk(10, m, 10));
      const t = document.createElement('template'); t.innerHTML = h;
      out['rom' + m] = (t.content.querySelector('.tspan').dataset.rom || '').length;
    }
    for(const k of [3999, 4000, 4001, 6000]){
      const h = window.tenebrae._omni.probe.sanitize(mk(10, 10, k));
      const t = document.createElement('template'); t.innerHTML = h;
      const sp = t.content.querySelector('.tspan');
      out['scr' + k] = (sp.dataset.scr || '').length;
      out['txt' + k] = sp.textContent.length;
    }
    return out;
  });
  note('A1b sanitizer caps', caps);
  ck('A1b: sanitizer does not cap data-src', caps.src2400 === 2400 && caps.src5000 === 5000, JSON.stringify(caps));
  ck('A1b: sanitizer does not cap data-rom', caps.rom6000 === 6000, JSON.stringify(caps));
  ck('A1b: sanitizer does not cap data-scr', caps.scr6000 === 6000, JSON.stringify(caps));
  ck('A1b: data-scr and the rendered text stay in sync through sanitize',
     caps.scr6000 === caps.txt6000, `scr=${caps.scr6000} text=${caps.txt6000}`);
}

/* ===== A2. select-all + Delete over a scene that contains a span ===== */
{
  const residue = await clearEditor(); // A's giant span is in the editor
  note('A2 after select-all + delete', residue);
  ck('A2: select-all + Delete removes translation spans (span is not undeletable residue)',
     residue.spansLeft === 0, `spans left=${residue.spansLeft}, text left=${residue.text}`);
}

/* ========== B. selection spanning paragraphs AND an existing span ========== */
{
  const e0 = errMark();
  await focusEditorEnd();
  await typeLine('first para the sea remembers here');
  await page.keyboard.press('Enter');
  await typeLine('second para the lamp holds steady');
  await page.keyboard.press('Enter');
  await typeLine('third para she walks alone tonight');
  await wait(page, 500);

  // an existing span in paragraph 2
  await selectSpanning(page, 'lamp holds', 'lamp holds');
  await ctxTranslate('Kildaren');
  await wait(page, 600);
  let before = await spanDump(page);
  ck('B: seed span created in paragraph 2', before.length === 1 && before[0].lang === 'kildaren', JSON.stringify(before.map(s => s.lang)));
  const seedSrc = before[0] && before[0].src;

  // now select across p1 → p3, swallowing the existing span
  const spanned = await selectSpanning(page, 'first para', 'alone tonight');
  ck('B: cross-paragraph selection made', spanned);
  const selPreview = await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0);
    const holder = document.createElement('div'); holder.appendChild(r.cloneContents());
    return { text: sel.toString().slice(0, 200), spansInside: holder.querySelectorAll('.tspan').length, blocks: holder.querySelectorAll('p,div').length };
  });
  note('B selection', selPreview);
  ck('B: selection really spans 3 paragraphs and contains the existing span', selPreview.spansInside >= 1 && selPreview.blocks >= 2, JSON.stringify(selPreview));

  const r2 = await ctxTranslate('Celan High');
  ck('B: cross-paragraph translate completed', r2.opened && r2.tongue, JSON.stringify(r2));
  const after = await spanDump(page);
  note('B spans after', after.map(s => ({ lang: s.lang, srcLen: s.srcLen, latin: s.latin, nested: s.nested })));
  ck('B: no nested spans produced', after.every(s => s.nested === 0 && s.elemKids === 0));
  ck('B: no Latin fallback in any span', after.every(s => s.latin === 0), JSON.stringify(after.map(s => s.latin)));
  const newSpan = after.find(s => s.lang === 'celan_high');
  ck('B: the new span stores an English source', !!newSpan && /[A-Za-z]/.test(newSpan.src), newSpan && newSpan.src.slice(0, 120));
  const engLost = !!newSpan && !/lamp holds/.test(newSpan.src);
  note('B new span src', newSpan && newSpan.src);
  note('B seed span src was', seedSrc);
  ck('B: swallowed span\'s English source is carried into the new source (not replaced by romanization)',
     !engLost, newSpan && `src="${newSpan.src.slice(0, 140)}"`);

  const bodyText = await page.evaluate(() => document.querySelector('#ed-content').innerText);
  ck('B: editor still holds text and is usable', bodyText.length > 0);
  await focusEditorEnd();
  await typeLine(' STILLTYPING');
  await wait(page, 400);
  const typed = await page.evaluate(() => document.querySelector('#ed-content').innerText.includes('STILLTYPING'));
  ck('B: can still type after a cross-paragraph translate', typed);
  noNewErrors(e0, 'B(cross-paragraph)');
}

/* ========== C. translating a span's own script text ========== */
{
  const e0 = errMark();
  await clearEditor();
  await focusEditorEnd();
  await typeLine('carrier line the sea remembers here');
  await wait(page, 400);
  await selectSpanning(page, 'the sea remembers', 'the sea remembers');
  await ctxTranslate('Celan High');
  await wait(page, 500);
  const puaText = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    return sp ? sp.textContent : null;
  });
  note('C PUA text length', puaText && puaText.length);

  // C1 — seam: feed the raw script run straight back into the engine
  const back = await page.evaluate(async pua => {
    const out = {};
    for(const id of ['celan_high', 'kildaren', 'kerrackian']){
      try{
        const r = await window.tenebrae.translate2(id, pua);
        const scr = r ? window.tenebrae._forge.textForToks(id, r.toks) : null;
        out[id] = { ok: !!r, rom: r ? r.romanization.slice(0, 60) : null, romLen: r ? r.romanization.length : 0,
                    toks: r ? r.toks.length : 0, scr: scr ? scr.length : 0 };
      }catch(e){ out[id] = { throw: String(e.message || e) }; }
    }
    return out;
  }, puaText);
  note('C translate2(script text)', back);
  ck('C: engine survives being fed its own PUA script run (no throw)', Object.values(back).every(v => !v.throw), JSON.stringify(back));

  // C2 — UI: select the span node and translate it again (script-in, script-out)
  const sel2 = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    if(!sp) return false;
    const r = document.createRange(); r.selectNode(sp);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return true;
  });
  ck('C: span node selected for re-translation', sel2);
  const r3 = await ctxTranslate('Kildaren');
  note('C ctx result', r3);
  const after = await spanDump(page);
  note('C spans after re-translate', after.map(s => ({ lang: s.lang, src: s.src.slice(0, 60), latin: s.latin, nested: s.nested })));
  ck('C: no nested/corrupted span from translating a span', after.every(s => s.nested === 0 && s.elemKids === 0));
  ck('C: no Latin fallback', after.every(s => s.latin === 0), JSON.stringify(after.map(s => s.latin)));
  ck('C: no raw PUA leaked into a data-src', after.every(s => ![...s.src].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF)),
     JSON.stringify(after.map(s => s.src.slice(0, 40))));
  noNewErrors(e0, 'C(script re-translate)');
}

/* ========== D. XML/HTML metacharacters ========== */
{
  const e0 = errMark();
  await clearEditor();
  const HOSTILE = `sea & king < lamp > water " quote ' apos </span><img src=x onerror=alert(1)> <script>bad()</script> &amp; &lt;b&gt; end`;
  await focusEditorEnd();
  await typeLine('pad ');
  await typeLine(HOSTILE);
  await wait(page, 500);
  await selectSpanning(page, 'sea & king', 'end');
  const selText = await page.evaluate(() => getSelection().toString());
  note('D selection', selText);
  const r = await ctxTranslate('Kerrackian');
  ck('D: hostile-metachar translate completed', r.opened && r.tongue, JSON.stringify(r));
  const d = (await spanDump(page))[0];
  note('D span', d && { src: d.src, latin: d.latin, nested: d.nested, elemKids: d.elemKids });
  ck('D: source stored verbatim (metacharacters intact)', !!d && d.src === selText, d && JSON.stringify(d.src));
  ck('D: no element injected into the span', !!d && d.elemKids === 0 && d.nested === 0);
  const injected = await page.evaluate(() => ({
    imgs: document.querySelectorAll('#ed-content img').length,
    scripts: document.querySelectorAll('#ed-content script').length,
    strayB: document.querySelectorAll('#ed-content b').length
  }));
  note('D injection check', injected);
  ck('D: no <img>/<script> smuggled into the document', injected.imgs === 0 && injected.scripts === 0, JSON.stringify(injected));
  ck('D: no Latin fallback', !!d && d.latin === 0, d && d.latin);

  // the tap sheet must render the hostile source as text, not markup
  await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
  await wait(page, 900);
  const sheet = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    const src = s && s.querySelector('.ts-src');
    return { open: !!s && s.classList.contains('show'), srcText: src ? src.textContent : null,
             imgs: s ? s.querySelectorAll('img').length : -1, scripts: s ? s.querySelectorAll('script').length : -1 };
  });
  note('D sheet', sheet);
  ck('D: tap sheet shows the hostile source as literal text (no markup executed)',
     sheet.open && sheet.imgs === 0 && sheet.scripts === 0 && (sheet.srcText || '').includes('</span>'),
     JSON.stringify(sheet).slice(0, 240));
  await closeSheets();

  await persist();
  const doc = await sceneDoc(page);
  const survived = await page.evaluate(([doc, want]) => {
    const t = document.createElement('template'); t.innerHTML = doc;
    const sp = t.content.querySelector('.tspan');
    return { src: sp ? sp.dataset.src : null, eq: sp ? sp.dataset.src === want : false,
             imgs: t.content.querySelectorAll('img').length, scripts: t.content.querySelectorAll('script').length,
             spans: t.content.querySelectorAll('.tspan').length };
  }, [doc, selText]);
  note('D persisted', survived);
  ck('D: sanitizer keeps the hostile source byte-exact and injects nothing',
     survived.eq && survived.imgs === 0 && survived.scripts === 0 && survived.spans === 1, JSON.stringify(survived).slice(0, 240));
  noNewErrors(e0, 'D(metacharacters)');
}

/* ========== E. emoji + combining marks ========== */
{
  const e0 = errMark();
  await clearEditor();
  const EMO = 'the sea ☕ remembers 👍🏽 café niño 🌊️ king';
  await focusEditorEnd();
  await typeLine('pad2 ');
  await typeLine(EMO);
  await wait(page, 500);
  await selectSpanning(page, 'the sea', 'king');
  const selText = await page.evaluate(() => getSelection().toString());
  note('E selection', JSON.stringify(selText));
  const r = await ctxTranslate('Evernessian');
  ck('E: emoji/combining translate completed', r.opened && r.tongue, JSON.stringify(r));
  const d = (await spanDump(page))[0];
  note('E span', d && { src: JSON.stringify(d.src), textLen: d.textLen, pua: d.pua, latin: d.latin, romLen: d.romLen });
  ck('E: source stored verbatim incl. emoji + combining marks', !!d && d.src === selText, d && JSON.stringify(d.src));
  ck('E: span is non-empty', !!d && d.textLen > 0, d && d.textLen);
  ck('E: no Latin fallback', !!d && d.latin === 0, d && d.latin);
  ck('E: no emoji/combining leaked into the rendered script', !!d && !/[̀-ͯ☀-➿️]|[\uD800-\uDBFF]/.test(await page.evaluate(() => document.querySelector('#ed-content .tspan').textContent)));

  // an emoji-ONLY selection: the pathological case
  await clearEditor();
  await focusEditorEnd();
  await typeLine('pad3 ☕👍🌊 done');
  await wait(page, 400);
  await selectSpanning(page, '☕', '🌊');
  const onlyEmoji = await page.evaluate(() => getSelection().toString());
  note('E2 selection', JSON.stringify(onlyEmoji));
  const r2 = await ctxTranslate('Celan High');
  const spans = await spanDump(page);
  note('E2 spans', spans.map(s => ({ src: JSON.stringify(s.src), textLen: s.textLen, romLen: s.romLen, pua: s.pua, box: s.box })));
  const empty = spans.filter(s => s.textLen === 0);
  ck('E2: an emoji-only selection never yields an empty/invisible span',
     empty.length === 0, `empty spans=${empty.length} ` + JSON.stringify(spans.map(s => ({ t: s.textLen, w: s.box.w, h: s.box.h }))));
  ck('E2: emoji-only span (if made) has no Latin fallback', spans.every(s => s.latin === 0), JSON.stringify(spans.map(s => s.latin)));
  note('E2 ctx result', r2);
  noNewErrors(e0, 'E(emoji/combining)');
}

/* ========== F. RTL source text ========== */
{
  const e0 = errMark();
  await clearEditor();
  const RTL = 'שלום the sea مرحبا remembers המלך';
  await focusEditorEnd();
  await typeLine('pad4 ');
  await typeLine(RTL);
  await wait(page, 500);
  await selectSpanning(page, 'שלום', 'המלך');
  const selText = await page.evaluate(() => getSelection().toString());
  note('F selection', JSON.stringify(selText));
  const r = await ctxTranslate('Kerrackian');
  ck('F: RTL-source translate completed', r.opened && r.tongue, JSON.stringify(r));
  const d = (await spanDump(page))[0];
  note('F span', d && { src: JSON.stringify(d.src), flow: d.flow, latin: d.latin, pua: d.pua, textLen: d.textLen });
  ck('F: RTL source stored verbatim', !!d && d.src === selText, d && JSON.stringify(d.src));
  ck('F: no Hebrew/Arabic leaked into the rendered script',
     !/[֐-׿؀-ۿ]/.test(await page.evaluate(() => document.querySelector('#ed-content .tspan').textContent)));
  ck('F: no Latin fallback', !!d && d.latin === 0, d && d.latin);
  noNewErrors(e0, 'F(RTL source)');
}

/* ========== G. a word longer than a column ========== */
{
  const e0 = errMark();
  await clearEditor();
  const LONGWORD = 'supercalifragilisticexpialidociousantidisestablishmentarianismpneumonoultramicroscopicsilicovolcanoconiosis';
  await focusEditorEnd();
  await typeLine('pad5 ');
  await typeLine(LONGWORD);
  await wait(page, 500);
  await selectSpanning(page, LONGWORD.slice(0, 20), LONGWORD.slice(-20));
  const selText = await page.evaluate(() => getSelection().toString());
  note('G selection length', selText.length);
  const r = await ctxTranslate('Celan High'); // cols-rtl, max-height:13em
  ck('G: over-long-word translate completed', r.opened && r.tongue, JSON.stringify(r));
  const geo = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    if(!sp) return null;
    const t = sp.firstChild, txt = sp.textContent, rects = [];
    for(let i = 0; i < txt.length; i++){
      const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
      const b = rg.getBoundingClientRect();
      if(b.width > 0 && txt[i] !== ' ' && txt[i] !== '\n') rects.push({ x: b.x, y: b.y, h: b.height });
    }
    const cols = [...new Set(rects.map(r2 => Math.round(r2.x)))].sort((a, b) => a - b);
    const ed = document.querySelector('#ed-content');
    const bb = sp.getBoundingClientRect(), eb = ed.getBoundingClientRect();
    return { chars: txt.length, glyphs: rects.length, cols: cols.length,
      firstIsRightmost: rects.length ? Math.round(rects[0].x) === cols[cols.length - 1] : false,
      spanW: Math.round(bb.width), spanH: Math.round(bb.height), edW: Math.round(eb.width),
      overflowsEditorBox: bb.width > eb.width + 1,
      hScroll: ed.scrollWidth > ed.clientWidth + 2,
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      allVisible: rects.every(r2 => r2.x >= eb.left - 1 && r2.x <= eb.right + 1)
    };
  });
  note('G geometry', geo);
  ck('G: the over-long word wraps into multiple columns', !!geo && geo.cols > 1, JSON.stringify(geo));
  ck('G: columns still advance right→left (first glyph rightmost)', !!geo && geo.firstIsRightmost, JSON.stringify(geo));
  ck('G: span stays inside the editor box (no horizontal blow-out)',
     !!geo && !geo.overflowsEditorBox && !geo.hScroll && !geo.pageHScroll, JSON.stringify(geo));
  const d = (await spanDump(page))[0];
  ck('G: source intact, no Latin fallback', !!d && d.src === selText && d.latin === 0, d && `srcEq=${d.src === selText} latin=${d.latin}`);
  noNewErrors(e0, 'G(over-long word)');
}

/* ========== app still usable at the end ========== */
{
  const e0 = errMark();
  await focusEditorEnd();
  await typeLine(' final check line');
  await wait(page, 400);
  await page.click('#ed-back');
  await wait(page, 700);
  const onBook = await page.evaluate(() => document.querySelector('#scr-book').className);
  note('book screen state', onBook);
  await page.locator('.row[data-scene]').first().click();
  await wait(page, 1200);
  const usable = await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    return { text: ed.innerText.includes('final check line'), spans: ed.querySelectorAll('.tspan').length };
  });
  note('final usability', usable);
  ck('APP: navigation + reopen still works, content preserved', usable.text, JSON.stringify(usable));
  noNewErrors(e0, 'APP');
}

console.log('\npageerrors total:', errors.length, errors.slice(0, 5));
const failed = checks.filter(c => !c[1]);
console.log(`\n${checks.length - failed.length}/${checks.length} checks ok`);
for(const f of failed) console.log('  FAILED:', f[0]);
verdict('TX-12 HOSTILE INPUT', failed.length === 0 && errors.length === 0);
await browser.close();
await srv.close();
