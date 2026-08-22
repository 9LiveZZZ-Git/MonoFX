// cf-assist-mechanical — spec §3.4's structural defence:
//
//   "any suggestion whose `suggestion` diverges from `original` beyond a
//    mechanical-edit threshold (length ratio / semantic-rewrite heuristic) is
//    dropped client-side, so the model cannot smuggle in prose rewriting."
//
// This is the one guardrail in §3.4 that nothing was enforcing. It matters more
// than it looks: a rewrite offered one fix at a time, in a sheet that says
// "Copy-edit 3 of 7", reads exactly like a correction. The schema cannot
// express the difference and the prompt can only ask for it, so the client has
// to measure it. TX-15 owns the clause ("Constrained answers, verified claims").
//
// Every request is answered locally; nothing reaches the wire.
// Run: cd probes && node cf-assist-mechanical.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { createBook, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 260)); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
const wire = [];
page.on('request', r => { if(/anthropic/.test(r.url())) wire.push(r.url()); });
await context.addInitScript(() => {
  window.__reply = { fixes: [] };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'text', text: JSON.stringify(window.__reply) }] }) });
});
const T = ms => page.waitForTimeout(ms);
await page.goto(srv.url + 'step1.html');
await T(3600);
await page.evaluate(() => window.tenebrae._claude.setKey('sk-ant-probe-mech'));
await createBook(page, 'Mechanical Book');

// the scene every anchor is quoted against
const LONG = 'The drover walks the long road home under a sky the colour of wet slate, ' +
             'and the lamp at the gate has not been lit since the the reeve left.';
const SCENE = 'Alpha stands at teh gate. ' + LONG + ' She said: my mana let it stand , and the road ran on.';
await page.click('#ed-content');
await page.keyboard.type(SCENE);
await T(900);

const run = fixes => page.evaluate(async ({ fixes, text }) => {
  window.__reply = { fixes };
  const kept = await window.tenebrae._claude.grammar(text);
  return { kept: kept.map(f => ({ before: f.before, after: f.after })),
           rewrites: (window.tenebrae._claude.last() || {}).rewrites };
}, { fixes, text: SCENE });

const fix = (before, after, why) => ({ before, after, why: why || 'x', kind: 'grammar' });

/* ---------- 1. real copy-edits survive ---------- */
const MECHANICAL = [
  fix('teh gate', 'the gate', 'transposition'),
  fix('stand , and', 'stand, and', 'space before a comma'),
  fix('the the reeve', 'the reeve', 'doubled word'),
  fix('has not been lit', 'had not been lit', 'tense'),
];
for(const f of MECHANICAL){
  const r = await run([f]);
  ck(`kept: ${JSON.stringify(f.before)} -> ${JSON.stringify(f.after)}`,
     r.kept.length === 1 && r.rewrites === 0, JSON.stringify(r));
}

/* ---------- 2. rewrites are dropped ---------- */
const REWRITES = [
  [fix('The drover walks the long road home',
       'Beneath a bruised and failing sky the ferryman wandered the endless highway toward a hearth he no longer remembered'),
   'a whole sentence replaced with different words'],
  [fix('the lamp at the gate', 'the lantern that hangs above the western arch of the old toll gate, unlit these many years'),
   'a short anchor expanded past the length ratio'],
  [fix('under a sky the colour of wet slate', 'grimly'),
   'a clause collapsed past the length ratio'],
  // the case a length ratio and an edit FRACTION both miss: a long anchor whose
  // changes are individually small and collectively a rewrite. 45% of 143
  // characters is sixty-four edits; the absolute cap is what stops it.
  [fix(LONG, LONG.replace('drover', 'ferryman').replace('walks', 'wandered')
                 .replace('long road home', 'endless highway').replace('wet slate', 'old pewter')
                 .replace('has not been lit', 'had gone dark')),
   'many small changes across a long anchor, which is a rewrite in pieces'],
];
for(const [f, why] of REWRITES){
  const r = await run([f]);
  ck(`dropped (${why})`, r.kept.length === 0 && r.rewrites === 1, JSON.stringify(r).slice(0, 220));
}

/* ---------- 3. the boundary is measured, not guessed ---------- */
{
  // same anchor, one edit apart vs rewritten: the rule must separate them
  const near = await run([fix('the colour of wet slate', 'the color of wet slate')]);
  const far  = await run([fix('the colour of wet slate', 'a bruised and unlovely grey')]);
  ck('a spelling change inside a long anchor is kept', near.kept.length === 1, JSON.stringify(near));
  ck('a reword of the same anchor is dropped', far.kept.length === 0 && far.rewrites === 1, JSON.stringify(far));
}

/* ---------- 4. a mixed answer keeps the fixes and drops the rewrites ---------- */
{
  const r = await run([MECHANICAL[0], REWRITES[0][0], MECHANICAL[1], REWRITES[2][0]]);
  ck('a mixed answer keeps only the corrections',
     r.kept.length === 2 && r.rewrites === 2 &&
     r.kept.every(k => MECHANICAL.some(m => m.before === k.before)), JSON.stringify(r));
}

/* ---------- 5. the author is told, rather than told the scene reads clean ---------- */
{
  await page.evaluate(() => { window.__toasts = []; const t = window.tenebrae._probe && window.tenebrae._probe.onToast; });
  await page.evaluate(fixes => { window.__reply = { fixes }; },
    [{ before: 'The drover walks the long road home',
       after: 'Beneath a bruised and failing sky the ferryman wandered the endless highway toward a hearth he no longer remembered',
       why: 'x', kind: 'grammar' }]);
  await page.click('#ed-more'); await T(500);
  await page.locator('#sheet .sh-item', { hasText: 'Copy-edit this scene' }).click();
  await T(1500);
  const toast = await page.evaluate(() => {
    const t = document.querySelector('#toast');
    return t ? t.textContent : null;
  });
  console.log('   toast:', JSON.stringify(toast));
  ck('an answer that was all rewrites does not report "the scene reads clean"',
     !!toast && !/reads clean$/.test(toast.trim()), JSON.stringify(toast));
  ck('and it says what happened to them', !!toast && /rewrit/i.test(toast), JSON.stringify(toast));
}

ck('nothing reached the wire', wire.length === 0, wire.join(' '));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('MECHANICAL-EDIT THRESHOLD', checks.every(c => c[1]) && errors.length === 0);
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
