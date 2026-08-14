// vf-CD-3 — adversarial verification of the block-junction under-count claim.
// buildMentions (step1.html L2969) extracts scene text via plainOfHTML (L3434-3438),
// which uses bare template textContent: adjacent blocks concatenate with NO
// separator. Claim under test: a block that ENDS with the card name followed by a
// block that STARTS with a letter merges ("...saw Kael" + "Then..." ->
// "saw KaelThen"), so the trailing lookahead (?![\p{L}\p{N}]) rejects a real
// mention deterministically.
//
// Scene built through the real UI (keyboard + Aa format bar):
//   <h2>Kael</h2>                      <- realistic trigger: heading = bare name
//   <p>He entered the hall.</p>
//   <p>Nobody saw Kael</p>             <- junction victim (no trailing punctuation)
//   <p>Then he ran fast.</p>
//   <p>Later Kael returned home.</p>   <- control: mid-paragraph, must count
//
// Correct count: 3 mentions. Defect prediction: 1 mention (heading + junction lost).
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
console.log('---');
console.log('expected (correct extraction):', expected, '| app reports:', appN);
if (appN < expected && ev.junctionMerged) {
  console.log('VF-CD3 VERDICT: DEFECT CONFIRMED — block-junction mentions are lost',
    `(app counts ${appN}/${expected}; control mention still detected: ${appN >= 1})`);
} else if (appN === expected) {
  console.log('VF-CD3 VERDICT: NO DEFECT — app counts all block-junction mentions');
} else {
  console.log('VF-CD3 VERDICT: INCONCLUSIVE — inspect output above');
}

await browser.close();
await srv.close();
