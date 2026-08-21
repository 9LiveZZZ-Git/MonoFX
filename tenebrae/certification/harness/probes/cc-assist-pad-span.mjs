// COVERAGE GAP — the assist layer meeting the translation loop's PAD.
//
// No probe has ever put an accepted Claude edit next to a translated span.
// placeTSpan writes an NBSP pad after the span and records who owns the gap on
// data-pad (step1.html:4059-4076); rangeAround(el,true) (L3974-3987) absorbs
// exactly that pad on revert/remove. claudeApplyFix (L4655-4677) walks the text
// nodes OUTSIDE spans and rewrites one of them through execCommand — including
// the very node that holds the pad — and nothing re-derives data-pad afterwards.
// The scene text the model reads has already had its NBSPs folded to spaces
// (claudeSceneText L4538-4541), so an anchor can straddle the gap the pad rule
// is guarding.
//
// Chain measured here, all through the real UI: translate -> Copy-edit ->
// Accept -> read the span back -> Revert to plain text -> export .md/.txt.
// Run: cd probes && node cc-assist-pad-span.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, insertTranslationSpan, downloadFromSheet } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };
const show = s => JSON.stringify(String(s).replace(/ /g, '[NB]').replace(/[-]/g, '@'));

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await context.addInitScript(() => {
  window.__reply = { fixes: [], cards: [] };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {},
    content: [{ type: 'text', text: JSON.stringify(window.__reply) }] }) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const T = ms => page.waitForTimeout(ms);
const close = async () => { await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); }); await T(400); };
const spanMeta = () => page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  if(!sp) return null;
  const next = sp.nextSibling;
  return { lang: sp.dataset.lang, src: sp.dataset.src, rom: sp.dataset.rom,
           scr: (sp.dataset.scr || '').length, pad: sp.dataset.pad || null,
           nextIsNBSP: !!(next && next.nodeType === 3 && next.nodeValue.charCodeAt(0) === 0x00A0),
           nextVal: next ? (next.nodeType === 3 ? next.nodeValue : next.textContent).slice(0, 24) : null };
});
const docText = () => page.evaluate(() => document.querySelector('#ed-content').textContent);
const docHTML = () => page.evaluate(() => document.querySelector('#ed-content').innerHTML);

await page.goto(srv.url + 'step1.html');
await T(3800);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-api03-PAD-PROBE'));

await createBook(page, 'Pad Book');
await page.click('#ed-title'); await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady over the water.');
await page.keyboard.press('Enter');
await page.keyboard.type('She said the sea remembers');
await T(900);
await insertTranslationSpan(page, 'the sea remembers', 'Kildaren');
await T(900);
await close();

const AUTHOR_LINE = 'She said the sea remembers';
const m0 = await spanMeta();
console.log('   span after translate:', JSON.stringify(m0));
console.log('   editor html         :', show(await docHTML()));
ck('setup: the span owns a pad (data-pad) and the pad is really there',
   m0 && m0.pad === '1' && m0.nextIsNBSP, JSON.stringify(m0));

/* ---- what the model is shown: the pad is folded to an ordinary space ---- */
const nbspBefore = await page.evaluate(() => (document.querySelector('#ed-content').innerHTML.match(/\u00a0|&nbsp;/g) || []).length);
const payload = await page.evaluate(() =>
  window.tenebrae._claude.sceneText(window.tenebrae._omni.probe.sceneDoc()));
console.log('   payload the model reads:', show(payload));
ck('the payload carries the span as the author\'s English with the pad folded away',
   payload.includes('She said the sea remembers') && payload.indexOf('\u00a0') === -1, show(payload));

/* ---- a copy-edit whose anchor sits in the very node that holds the pad ---- */
await page.evaluate(() => { window.__reply = { fixes: [
  { before: 'said', after: 'whispered', why: 'clearer', kind: 'word choice' } ] }; });
await page.click('#ed-more'); await T(500);
await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click(); await T(1500);
await page.locator('#sheet .sh-item', { hasText: 'Accept this change' }).click(); await T(1100);
await close();

const m1 = await spanMeta();
const t1 = await docText();
console.log('   after the accepted edit:', show(t1));
console.log('   span now               :', JSON.stringify(m1));
console.log('   editor html            :', show(await docHTML()));
ck('the accepted edit did not land inside the span',
   m1 && m1.src === 'the sea remembers' && m1.rom === m0.rom && m1.scr === m0.scr, JSON.stringify(m1));
ck('the edit landed (said -> whispered) and the span is still in the line',
   t1.includes('She whispered') && (await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length)) === 1, show(t1));
ck('the line has no doubled or missing gap where the pad was',
   !/\S {2,}\S/.test(t1.replace(/ /g, ' ')) && !/[a-z]at dusk/.test(t1), show(t1));
ck('the pad is still owned by the span after the edit (revert must know)',
   m1 && m1.pad === '1' && m1.nextIsNBSP, JSON.stringify({ pad: m1 && m1.pad, nbsp: m1 && m1.nextIsNBSP, next: m1 && m1.nextVal }));

/* ---- the exports must show the same sentence ---- */
await page.click('#ed-share'); await T(600);
const mdF = await downloadFromSheet(page, 'Download Markdown (.md)');
await close();
await page.click('#ed-share'); await T(600);
const txtF = await downloadFromSheet(page, 'Download plain text (.txt)');
await close();
const nb = t => (String(t).match(/\u00a0/g) || []).length;
console.log('   NBSP count — md:', nb(mdF.text), ' txt:', nb(txtF.text));
console.log('   md :', show(mdF.text.split('\n').filter(l => l.includes('tenebrae') || l.includes('whispered')).join(' / ')));
console.log('   txt:', show(txtF.text.replace(/\n+/g, ' | ')));
ck('the edited sentence exports correctly in .md', /She whispered/.test(mdF.text) && !/She said/.test(mdF.text), show(mdF.text.slice(-220)));
const nbspAfter = await page.evaluate(() => (document.querySelector('#ed-content').innerHTML.match(/\u00a0|&nbsp;/g) || []).length);
console.log('   NBSP in the editor — before the assist edit:', nbspBefore, ' after:', nbspAfter);
ck('the assist edit added no new non-breaking space of its own', nbspAfter <= nbspBefore, 'before=' + nbspBefore + ' after=' + nbspAfter);
console.log('   NOTE: the ' + nb(mdF.text) + ' NBSP the .md carries is placeTSpan\'s insertHTML artifact, present before the assist edit — already on record as an exports anomaly, not caused by the assist layer.');
ck('the edited sentence exports correctly in .txt with the gap intact',
   /She whispered/.test(txtF.text) && !/\][a-z]/.test(txtF.text), show(txtF.text.slice(-180)));

/* ---- revert must still hand back exactly the author's line ---- */
await page.evaluate(() => {
  const sp = document.querySelector('#ed-content .tspan');
  sp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await T(900);
await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click(); await T(1000);
await close();
const t2 = await docText();
const want = AUTHOR_LINE.replace('said', 'whispered');
console.log('   after revert:', show(t2));
console.log('   wanted      :', show(want));
ck('after an assist edit beside it, revert still hands back the exact line',
   t2.includes(want), show(t2));
ck('revert left no span and no script behind',
   (await page.evaluate(() => document.querySelectorAll('#ed-content .tspan').length)) === 0
   && !/[-]/.test(t2), show(t2));

console.log('   page exceptions:', JSON.stringify(errors));
console.log('\ncc-ASSIST-PAD VERDICT:', checks.every(Boolean) && !errors.length ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.every(Boolean) ? 'none' : checks.filter(x => !x).length);
await browser.close(); await srv.close();
