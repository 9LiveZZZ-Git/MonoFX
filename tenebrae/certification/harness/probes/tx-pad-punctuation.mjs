// TX-8 — the pad beside a span must not read as a typo.
//
// placeTSpan writes the span followed by a NBSP so the caret has somewhere to
// land after an atomic node. Where the author's own space follows, that pad
// merges with it into the single gap the revert path absorbs — correct, leave
// it. Where PUNCTUATION follows, the pad is a space before a comma: "…stand ,
// and" instead of "…stand, and". This probe pins both halves, because fixing
// the first by removing the pad everywhere costs the space on revert.
// Run: cd probes && node tx-pad-punctuation.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : x); };
const show = t => [...String(t)].map(c => { const n = c.charCodeAt(0);
  return n === 0xA0 ? '[NB]' : n === 0x20 ? '·' : n >= 0xE000 ? '@' : c; }).join('');

const { srv, browser, page, errors } = await launch();
await wait(page, 3500);

const CASES = [
  { line: 'She said: my mana let it stand, and the road ran on.', sel: 'my mana let it stand', after: ',', kind: 'comma' },
  { line: 'The gate is the sea remembers; then it closed.',       sel: 'the sea remembers',    after: ';', kind: 'semicolon' },
  { line: 'He called it the old king. Nothing more.',             sel: 'the old king',         after: '.', kind: 'period' },
  { line: 'at dusk the drover walks a long road and sleeps',      sel: 'the drover walks',     after: ' ', kind: 'word' },
];

for(const c of CASES){
  await createBook(page, 'Pad ' + c.kind);
  await page.click('#ed-content');
  await page.keyboard.type('padding opener line');
  await page.keyboard.press('Enter');
  await page.keyboard.type(c.line);
  await wait(page, 700);
  await insertTranslationSpan(page, c.sel, 'Celan Basic');
  await wait(page, 800);
  await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
  await wait(page, 350);

  const got = await page.evaluate(() => {
    const sp = document.querySelector('#ed-content .tspan');
    if(!sp) return null;
    const p = sp.closest('p') || sp.parentElement;
    let tail = '';
    for(let n = sp.nextSibling; n && tail.length < 12; n = n.nextSibling)
      tail += n.nodeType === 3 ? n.nodeValue : n.textContent;
    return { tail, text: p.textContent };
  });
  console.log(`  ${c.kind.padEnd(10)} after span: ${JSON.stringify(show(got && got.tail))}`);
  if(c.after === ' '){
    // the author's space survives as exactly one gap, and the revert path can
    // still find it — never zero, never two
    ck(`${c.kind}: exactly one gap between the span and the next word`,
       !!got && /^[\s ][^\s ]/.test(got.tail), show(got && got.tail));
  }else{
    ck(`${c.kind}: no gap between the span and the "${c.after}"`,
       !!got && got.tail.charAt(0) === c.after, show(got && got.tail));
  }

  // and revert must still hand back the author's line, unchanged
  await page.evaluate(() => document.querySelector('#ed-content .tspan').click());
  await wait(page, 800);
  await page.locator('#sheet .sh-item', { hasText: 'Revert to plain text' }).click();
  await wait(page, 700);
  const back = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('#ed-content p')];
    return (ps[ps.length - 1] || {}).textContent || '';
  });
  ck(`${c.kind}: revert restores the line exactly`,
     back.replace(/ /g, ' ') === c.line, `${JSON.stringify(show(back))} vs ${JSON.stringify(show(c.line))}`);
  await page.click('#ed-back'); await wait(page, 400);
  await page.click('#bk-back'); await wait(page, 400);
}

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('TX-8 pad vs punctuation', checks.every(Boolean));
await browser.close();
await srv.close();
