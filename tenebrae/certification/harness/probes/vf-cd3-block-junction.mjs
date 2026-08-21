// vf-CD-3 — adversarial verification of the block-junction under-count claim.
//
// CONTRACT UPDATE (2026-08 triage): the defect this probe was written to
// substantiate has been FIXED. plainOfHTML (step1.html L5318-5328) now injects
// a space either side of every block element before reading textContent:
//   // textContent has no block separators — 'KaelHe' at a block junction would
//   // hide a mention from the word-boundary scan
//   t.content.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,br')
//     .forEach(b => { b.before(...' '); b.after(...' '); });
// so the governing contract, CD-3 (certification/step1-requirements.md L53,
// "card title + aliases scanned across every scene (word-boundary,
// case-insensitive)"), now holds at block junctions.
//
// The probe keeps every original measurement — including the demonstration
// that BARE textContent still merges 'KaelHe'/'KaelThen', which is what makes
// the separator injection load-bearing rather than cosmetic — and asserts the
// app's own mention count is the correct 3, stable across a reload.
//
// Scene built through the real UI (keyboard + Aa format bar):
//   <h2>Kael</h2>                      <- realistic trigger: heading = bare name
//   <p>He entered the hall.</p>
//   <p>Nobody saw Kael</p>             <- junction victim (no trailing punctuation)
//   <p>Then he ran fast.</p>
//   <p>Later Kael returned home.</p>   <- control: mid-paragraph, must count
//
// Correct count: 3 mentions. (Pre-fix behaviour was 1: heading + junction lost.)
// Run: cd probes && node vf-cd3-block-junction.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
const T = ms => page.waitForTimeout(ms);

await page.goto(srv.url + 'step1.html');
await T(600);

// book -> lands in editor
await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'VF CD3 Junction');
await page.click('#ps-save');
await T(700);

await page.click('#ed-title');
await page.keyboard.type('Junction');
await page.click('#ed-content');
await page.keyboard.type('Kael');
await page.keyboard.press('Enter');
await page.keyboard.type('He entered the hall.');
await page.keyboard.press('Enter');
await page.keyboard.type('Nobody saw Kael');
await page.keyboard.press('Enter');
await page.keyboard.type('Then he ran fast.');
await page.keyboard.press('Enter');
await page.keyboard.type('Later Kael returned home.');
await T(300);

// caret into the first line ("Kael" heading-to-be) via Selection API, then H2
const caretFirstLine = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue.trim() === 'Kael') {
      const r = document.createRange();
      r.setStart(n, 1); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
  }
  return false;
});
console.log('caret on bare-name line:', await caretFirstLine());
await page.click('#fb-aa');
await T(250);
await page.click('#aa-panel [data-block="h2"]');
await T(300);

// Evidence A: the live doc's block structure + what bare textContent yields
const ev = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const html = ed.innerHTML;
  const t = document.createElement('template');
  t.innerHTML = html;
  const flat = (t.content.textContent || '').trim(); // == plainOfHTML(doc)
  // nameRegex copied VERBATIM from step1.html L2944-2948 (giu path)
  const re = new RegExp('(?<![\\p{L}\\p{N}])(?:Kael)(?![\\p{L}\\p{N}])', 'giu');
  const count = s => { re.lastIndex = 0; let n = 0; while (re.exec(s)) n++; return n; };
  // block-aware extraction (what plainFromDoc-style walking would give)
  const withSeps = html.replace(/<\/(p|div|h2|h3|blockquote|li|ul|ol)>/gi, '\n')
                       .replace(/<[^>]+>/g, '');
  return {
    html,
    flatSample: flat.slice(0, 120),
    flatCount: count('Junction ' + flat),          // mirrors L2969 title+' '+plain
    blockAwareCount: count('Junction ' + withSeps),
    junctionMerged: /KaelThen/.test(flat),
    headingMerged: /KaelHe/.test(flat),
  };
});
console.log('doc html:', ev.html);
console.log('bare textContent (plainOfHTML equivalent):', JSON.stringify(ev.flatSample));
console.log('junction merged ("KaelThen"):', ev.junctionMerged,
  '| heading merged ("KaelHe"):', ev.headingMerged);
console.log('verbatim-regex count on flat text:', ev.flatCount,
  '| on block-separated text:', ev.blockAwareCount);

// persist, then create the card and read the APP's own mention count
await T(1400);
await page.click('#ed-back');
await T(500);
await page.click('#bk-cardsrow');
await T(500);
await page.click('#cd-new');
await T(450);
await page.fill('#ps-input', 'Kael');
await page.click('#ps-save');
await T(700);

const mcount = await page.locator('#cc-mcount').innerText();
const mrows = await page.$$eval('#cc-mentions .ment',
  els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('APP mention count:', JSON.stringify(mcount));
console.log('APP mention rows:', JSON.stringify(mrows));

// reload to confirm the count is stable (deterministic, not a render race)
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'VF CD3 Junction' }).click();
await T(500);
await page.click('#bk-cardsrow');
await T(500);
await page.locator('#cd-list [data-card]', { hasText: 'Kael' }).click();
await T(600);
const mcount2 = await page.locator('#cc-mcount').innerText();
console.log('APP mention count after reload:', JSON.stringify(mcount2));

const expected = 3; // heading Kael + "saw Kael" + "Later Kael"
const appN = parseInt(mcount, 10) || 0;
const appN2 = parseInt(mcount2, 10) || 0;
console.log('---');
console.log('expected (correct extraction):', expected, '| app reports:', appN);

const checks = [];
const ok = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('the adversarial doc really has both junction shapes (heading+para, para+para)',
   ev.junctionMerged && ev.headingMerged);
ok('bare textContent still under-counts (1) — the separator injection is load-bearing',
   ev.flatCount === 1);
ok('block-separated extraction finds all 3', ev.blockAwareCount === expected);
ok('APP counts every block-junction mention', appN === expected);
ok('count is deterministic across reload', appN2 === expected);
console.log('VF-CD3 VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
