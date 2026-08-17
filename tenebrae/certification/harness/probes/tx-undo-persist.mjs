// TX-9 — NOTHING IS TRAPPED OR LOST.
//
// Gap coverage vs the existing probes: s2-undo-translation proves each span
// operation is UNDOable but only redoes the insertion; s2-ux-undo-mixed walks
// one mixed sequence; s2-ux-undo-postimport covers a SAMPLE-era span surviving
// an import. None of them assert an exact state signature on the way back, and
// none exercise change-tongue / revert / remove REDO, a btt-stave span's
// newline-bearing script text across a reload, or a span made under the
// EMBEDDED engine surviving an import and a subsequent codex removal.
//
// Part A  per-operation undo AND redo, each verified by exact state-signature
//         equality: insert, change tongue, edit source, revert, remove.
// Part B  a mixed sequence interleaved with ordinary typing: full Ctrl+Z walk
//         to the start (no state may corrupt prose or degrade a span to Latin)
//         and a full redo walk back to the exact final signature.
// Part C  persistence: reload the app and reopen the scene — every span comes
//         back with identical lang/src/rom/scr (including a btt-stave span
//         whose script text contains newlines) and re-renders as PUA text.
// Part D  a span created BEFORE a codex import re-renders after it, and again
//         after the imported codex is removed — never degrading to Latin.
//
// Run: cd probes && node tx-undo-persist.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const CODEX_PATH = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/codex.html';
const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, ok ? '' : (extra === undefined ? '' : extra)); };

// full state signature: prose (spans stripped) + every span's stored fields
const sig = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const clone = ed.cloneNode(true);
  clone.querySelectorAll('.tspan').forEach(t => t.remove());
  const norm = s => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  return {
    prose: norm(clone.textContent),
    spans: [...ed.querySelectorAll('.tspan')].map(sp => ({
      lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom, scr: sp.dataset.scr || null,
      flow: sp.dataset.flow || null, omni: sp.dataset.omni || null, text: sp.textContent,
      svg: sp.querySelectorAll('svg').length, latin: /[A-Za-z]/.test(sp.textContent),
      pua: [...sp.textContent].filter(c => /\S/.test(c)).every(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xF8FF),
    })),
  };
});
const S = o => JSON.stringify(o);
const focusEditor = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content'); ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const closeSheet = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s) s.click(); }); await wait(page, 350); };
const undo = async () => { await closeSheet(); await focusEditor(); await page.keyboard.press('Control+z'); await wait(page, 450); };
const redo = async () => { await closeSheet(); await focusEditor(); await page.keyboard.press('Control+Shift+z'); await wait(page, 450); };
const tapSpan = async (i = 0) => { await page.evaluate(n => document.querySelectorAll('#ed-content .tspan')[n].click(), i); await wait(page, 750); };
const sheetItem = async label => { await page.locator('#sheet .sh-item', { hasText: label }).click(); await wait(page, 800); };

// one op, then undo -> must equal the state before, then redo -> must equal after
async function roundTrip(name, before, doOp){
  await doOp();
  const after = await sig();
  ck(`${name}: operation changed the document`, S(after) !== S(before));
  await undo();
  const back = await sig();
  ck(`${name}: UNDO restores the previous state exactly`, S(back) === S(before), `${S(back)}\n   expected ${S(before)}`);
  await redo();
  const fwd = await sig();
  ck(`${name}: REDO restores the operation exactly`, S(fwd) === S(after), `${S(fwd)}\n   expected ${S(after)}`);
  return after;
}

/* ============ Part A — per-operation undo + redo ============ */
await createBook(page, 'TX9 Loop Book');
await page.click('#ed-content');
await page.keyboard.type('padding opener line');
await page.keyboard.press('Enter');
await page.keyboard.type('the drover walks a long road at dusk');
await wait(page, 1200);

const S0 = await sig();
console.log('S0:', S(S0));

const S1 = await roundTrip('insert (Celan High)', S0, () => insertTranslationSpan(page, 'drover walks', 'Celan High'));
ck('insert: span carries src/rom/scr and renders as pure script',
   S1.spans.length === 1 && S1.spans[0].src === 'drover walks' && S1.spans[0].rom && S1.spans[0].scr &&
   S1.spans[0].pua && !S1.spans[0].latin && S1.spans[0].svg === 0, S(S1.spans));

const S2 = await roundTrip('change tongue (-> Kildaren, btt-stave)', S1, async () => {
  await tapSpan(); await sheetItem('Change tongue'); await sheetItem('Kildaren');
});
ck('change tongue: flow + script both changed', S2.spans[0].lang === 'kildaren' && S2.spans[0].flow === 'btt-stave' &&
   S2.spans[0].scr !== S1.spans[0].scr && S2.spans[0].src === S1.spans[0].src, S(S2.spans));

const S3 = await roundTrip('edit source & retranslate', S2, async () => {
  await tapSpan(); await sheetItem('Edit source & retranslate');
  await page.fill('#ps-input', 'the old king'); await page.click('#ps-save'); await wait(page, 900);
});
ck('edit source: new src stored, script recompiled', S3.spans[0].src === 'the old king' && S3.spans[0].rom !== S2.spans[0].rom, S(S3.spans));

const S4 = await roundTrip('revert to plain text', S3, async () => { await tapSpan(); await sheetItem('Revert to plain text'); });
ck('revert: span gone and the English is back verbatim', S4.spans.length === 0 && S4.prose.includes('the old king'), S(S4.prose));

// back to the span state, then remove
await undo(); await wait(page, 300);
const backToS3 = await sig();
ck('re-undo lands on the span state again', S(backToS3) === S(S3), S(backToS3));
const S5 = await roundTrip('remove span', S3, async () => { await tapSpan(); await sheetItem('Remove span'); });
ck('remove: span and its text are both gone', S5.spans.length === 0 && !S5.prose.includes('the old king'), S(S5.prose));

/* ============ Part B — mixed with ordinary typing ============ */
await undo(); await wait(page, 400); // back to a span present
await page.evaluate(() => { const ed = document.querySelector('#ed-content');
  ed.querySelectorAll('.tspan').forEach(t => t.remove()); });
await page.evaluate(() => { const ed = document.querySelector('#ed-content'); ed.innerHTML = '<p>alpha beta gamma</p><p>the long road home</p>'; });
await page.click('#ed-content');
await wait(page, 700);

const M = [];
M.push(await sig());                                             // M0
await focusEditor(); await page.keyboard.type(' one'); await wait(page, 600);
M.push(await sig());                                             // M1 typing
await insertTranslationSpan(page, 'long road', 'Kerrackian'); await wait(page, 500);
M.push(await sig());                                             // M2 insert
await focusEditor(); await page.keyboard.type(' two'); await wait(page, 600);
M.push(await sig());                                             // M3 typing
await tapSpan(); await sheetItem('Change tongue'); await sheetItem('Celan High');
M.push(await sig());                                             // M4 tongue change
await focusEditor(); await page.keyboard.type(' three'); await wait(page, 600);
M.push(await sig());                                             // M5 typing
await tapSpan(); await sheetItem('Remove span');
M.push(await sig());                                             // M6 remove
const FINAL = M[M.length - 1];
console.log('mixed milestones:', M.map(m => `${m.spans.length}sp${m.spans[0] ? ':' + m.spans[0].lang : ''}`).join(' -> '));
ck('mixed: the sequence built the expected milestones',
   M[2].spans.length === 1 && M[2].spans[0].lang === 'kerrackian' &&
   M[4].spans[0].lang === 'celan_high' && M[6].spans.length === 0 &&
   /one/.test(M[1].prose) && /two/.test(M[3].prose) && /three/.test(M[5].prose), S(M.map(m => m.prose)));

// full Ctrl+Z walk back to the start
const walk = [FINAL];
for(let i = 0; i < 24; i++){
  await undo();
  const s = await sig();
  walk.push(s);
  if(S(s) === S(walk[walk.length - 2]) && i > 0) break;
  if(S(s) === S(M[0])) break;
}
console.log('undo walk:', walk.map(s => `${s.spans.length}sp${s.spans[0] ? ':' + s.spans[0].lang : ''}`).join(' -> '));
const corrupt = walk.findIndex(s => s.spans.some(sp => !sp.src || !sp.rom || !sp.scr || sp.svg > 0 || sp.latin || !sp.pua) ||
                                    s.spans.length > 1 ||
                                    (s.prose.match(/long road/g) || []).length > 1);
ck('mixed: no undo state corrupts a span (no Latin, no svg, no duplicate, fields intact)', corrupt === -1,
   corrupt !== -1 ? `state ${corrupt}: ${S(walk[corrupt])}` : '');
const milestones = [4, 2].map(i => walk.findIndex(s => S(s) === S(M[i])));
ck('mixed: the walk passes back through the Celan High state', milestones[0] > 0, `idx=${milestones[0]}`);
ck('mixed: the walk passes back through the Kerrackian state', milestones[1] > milestones[0], `idx=${milestones[1]}`);
const iStart = walk.findIndex(s => s.spans.length === 0 && !/one|two|three/.test(s.prose));
ck('mixed: the walk reaches the original untranslated prose', iStart > 0 && walk[iStart].prose === M[0].prose,
   iStart > 0 ? S(walk[iStart].prose) : 'never reached');
ck('mixed: prose anchors are never lost on the way back',
   walk.slice(0, iStart + 1).every(s => s.prose.includes('alpha beta gamma')), S(walk.map(s => s.prose)));

// full redo walk forward
const undos = walk.length - 1;
for(let i = 0; i < undos; i++) await redo();
const afterRedo = await sig();
ck('mixed: the redo walk lands on the exact final state', S(afterRedo) === S(FINAL), `${S(afterRedo)}\n   expected ${S(FINAL)}`);

/* ============ Part C — persistence across reload ============ */
// rebuild a scene with one span per flow, including btt-stave (newline in scr)
await page.evaluate(() => { const ed = document.querySelector('#ed-content');
  ed.innerHTML = '<p>the drover walks a long road</p><p>the sealed writ waits</p>'; });
await page.click('#ed-content'); await wait(page, 600);
await insertTranslationSpan(page, 'drover walks', 'Kildaren');     // btt-stave, newline-joined
await insertTranslationSpan(page, 'long road', 'Kerrackian');      // rtl
await insertTranslationSpan(page, 'sealed writ', 'Celan High');    // cols-rtl
await wait(page, 1600);
const preReload = await sig();
ck('persistence: three spans across three flows built', preReload.spans.length === 3 &&
   preReload.spans.some(s => s.flow === 'btt-stave' && s.scr.includes('\n')), S(preReload.spans.map(s => s.flow)));

await page.reload();
await wait(page, 1200);
await page.locator('#lib-list .row', { hasText: 'TX9 Loop Book' }).click();
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 900);
await page.waitForFunction(() => {
  const sps = [...document.querySelectorAll('#ed-content .tspan')];
  return sps.length === 3 && sps.every(sp => sp.dataset.scr && sp.textContent === sp.dataset.scr);
}, null, { timeout: 30000 }).catch(() => {});
await wait(page, 1200);
const postReload = await sig();
ck('persistence: every span survives reload with identical fields', S(postReload) === S(preReload),
   `${S(postReload)}\n   expected ${S(preReload)}`);
ck('persistence: the btt-stave newline script text survives verbatim',
   (postReload.spans.find(s => s.flow === 'btt-stave') || {}).scr === (preReload.spans.find(s => s.flow === 'btt-stave') || {}).scr);
ck('persistence: no span degraded to Latin after reload', postReload.spans.every(s => !s.latin && s.pua && s.svg === 0), S(postReload.spans.map(s => s.text)));

/* ============ Part D — codex import / removal re-render ============ */
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 500);
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 900);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 20000 }),
  page.locator('#sheet .sh-item', { hasText: 'Import Codex' }).click(),
]);
await chooser.setFiles(CODEX_PATH);
await page.waitForFunction(() => /tongues awake/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
await wait(page, 1200);
await page.locator('#lib-list .row', { hasText: 'TX9 Loop Book' }).click();
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 900);
await page.waitForFunction(() => {
  const sps = [...document.querySelectorAll('#ed-content .tspan')];
  return sps.length === 3 && sps.every(sp => sp.dataset.scr && sp.textContent === sp.dataset.scr);
}, null, { timeout: 30000 }).catch(() => {});
await wait(page, 1200);
const postImport = await sig();
ck('import: pre-import spans re-render identically under the imported codex', S(postImport) === S(preReload),
   `${S(postImport)}\n   expected ${S(preReload)}`);
ck('import: no span fell back to Latin during the re-render',
   postImport.spans.length === 3 && postImport.spans.every(s => !s.latin && s.pua && s.svg === 0), S(postImport.spans.map(s => s.text)));

// remove the imported codex: spans must re-render again, never to Latin
await page.click('#ed-back'); await wait(page, 500);
await page.click('#bk-back'); await wait(page, 500);
await page.click('#lib-more'); await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
await page.locator('#sheet .sh-item', { hasText: 'Remove codex' }).click();
await wait(page, 800);
await page.click('#cs-yes');            // confirmSheet: "Remove"
await page.waitForFunction(() => /built-in Codex Omnilingua/.test(document.querySelector('#toast').textContent), null, { timeout: 40000 });
await wait(page, 1200);
await page.locator('#lib-list .row', { hasText: 'TX9 Loop Book' }).click();
await wait(page, 700);
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 900);
await page.waitForFunction(() => {
  const sps = [...document.querySelectorAll('#ed-content .tspan')];
  return sps.length === 3 && sps.every(sp => sp.dataset.scr && sp.textContent === sp.dataset.scr);
}, null, { timeout: 30000 }).catch(() => {});
await wait(page, 1200);
const postRemove = await sig();
console.log('after codex removal:', S(postRemove.spans.map(s => ({ lang: s.lang, rom: s.rom, latin: s.latin }))));
ck('codex removal: spans still render exactly as before (built-in codex is the engine)', S(postRemove) === S(preReload),
   `${S(postRemove)}\n   expected ${S(preReload)}`);
ck('codex removal: no span degraded to Latin or to the sample cipher',
   postRemove.spans.every(s => !s.latin && s.pua && s.svg === 0), S(postRemove.spans.map(s => s.text)));

ck('no page exceptions', errors.length === 0, errors.join(' | '));
verdict('TX-9 undo/redo + persistence', checks.every(c => c[1]));
console.log(`${checks.filter(c => c[1]).length}/${checks.length} checks passed`);
await browser.close();
await srv.close();
