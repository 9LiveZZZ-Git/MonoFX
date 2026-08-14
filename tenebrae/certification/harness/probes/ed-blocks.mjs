// ED-3 — Blocks: H2/H3 headings, blockquote, unordered + ordered lists,
// ⁂ scene-break. Types five lines, places the caret in each (Selection API),
// applies the block via the real format-bar controls (Aa panel data-block
// buttons, data-cmd list buttons, #fb-break), verifies the DOM in
// #ed-content, then reloads and verifies the blocks survived persist.
// Run: cd probes && node ed-blocks.mjs
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

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Blocks Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('heading line');
await page.keyboard.press('Enter');
await page.keyboard.type('sub line');
await page.keyboard.press('Enter');
await page.keyboard.type('quote line');
await page.keyboard.press('Enter');
await page.keyboard.type('bullet item');
await page.keyboard.press('Enter');
await page.keyboard.type('numbered item');
await page.keyboard.press('Enter');
await page.keyboard.type('tail line');
await T(300);

// caret into a given word (collapsed selection) via Selection API
const caretIn = word => page.evaluate(w => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf(w);
    if (i > -1) {
      const r = document.createRange();
      r.setStart(n, i + 1); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
  }
  return false;
}, word);

// open the Aa block panel once
await page.click('#fb-aa');
await T(250);

console.log('caret heading:', await caretIn('heading'));
await page.click('#aa-panel [data-block="h2"]');
await T(250);
console.log('caret sub:', await caretIn('sub'));
await page.click('#aa-panel [data-block="h3"]');
await T(250);
console.log('caret quote:', await caretIn('quote'));
await page.click('#aa-panel [data-block="blockquote"]');
await T(250);
console.log('caret bullet:', await caretIn('bullet'));
await page.click('[data-cmd="insertUnorderedList"]');
await T(250);
console.log('caret numbered:', await caretIn('numbered'));
await page.click('[data-cmd="insertOrderedList"]');
await T(250);
console.log('caret tail:', await caretIn('tail'));
await page.click('#fb-break'); // ⁂ scene break
await T(250);

const inspect = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const has = (sel, word) => [...ed.querySelectorAll(sel)].some(el => el.textContent.includes(word));
  const ast = ed.querySelector('div.asterism');
  return {
    html: ed.innerHTML,
    h2: has('h2', 'heading line'),
    h3: has('h3', 'sub line'),
    quote: has('blockquote', 'quote line'),
    ul: has('ul > li', 'bullet item'),
    ol: has('ol > li', 'numbered item'),
    brk: !!ast && ast.textContent === '⁂' && ast.getAttribute('contenteditable') === 'false',
  };
});

const live = await inspect();
console.log('LIVE DOM:', live.html);
console.log('live blocks: h2=%s h3=%s quote=%s ul=%s ol=%s break=%s',
  live.h2, live.h3, live.quote, live.ul, live.ol, live.brk);

// persist, reload, reopen scene
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Blocks Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await inspect();
console.log('STORED DOM:', stored.html);
console.log('stored blocks: h2=%s h3=%s quote=%s ul=%s ol=%s break=%s',
  stored.h2, stored.h3, stored.quote, stored.ul, stored.ol, stored.brk);

const ok = ['h2','h3','quote','ul','ol','brk'].every(k => live[k] && stored[k]);
console.log(ok ? 'ED-3 VERDICT: PASS' : 'ED-3 VERDICT: FAIL');

await browser.close();
await srv.close();
