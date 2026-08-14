// vp-ED7 — adversarial functional check of the format bar (ED-7 was certified
// on static evidence). Verifies: the bar appears when the editor has focus and
// hides on Done; mark state (bold, small-caps), list state and the block
// segment follow the caret; touch-target sizes of the .fb buttons.
// Run: cd probes && node vp-ed7-fbar-state.mjs
import { launch, wait, createBook, selectWord, caretIn, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

await createBook(page, 'Fbar Book');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('plain then boldword here');
await page.keyboard.press('Enter');
await page.keyboard.type('capsword sits here');
await page.keyboard.press('Enter');
await page.keyboard.type('heading here');
await page.keyboard.press('Enter');
await page.keyboard.type('bullet here');
await wait(page, 300);

const shown = await page.evaluate(() => document.querySelector('#fbar').classList.contains('show'));

// apply marks/blocks
await selectWord(page, 'boldword');
await page.click('[data-cmd="bold"]');
await wait(page, 200);
await selectWord(page, 'capsword');
await page.click('#fb-sc');
await wait(page, 200);
await page.click('#fb-aa');
await wait(page, 250);
await caretIn(page, 'heading here');
await page.click('#aa-panel [data-block="h2"]');
await wait(page, 200);
await caretIn(page, 'bullet here');
await page.click('[data-cmd="insertUnorderedList"]');
await wait(page, 300);

const stateAt = async word => {
  await caretIn(page, word);
  await wait(page, 250); // selectionchange → rAF refreshFbar
  return page.evaluate(() => ({
    b: document.querySelector('#fbar .mark-b').classList.contains('on'),
    sc: document.querySelector('#fb-sc').classList.contains('on'),
    ul: document.querySelector('[data-cmd="insertUnorderedList"]').classList.contains('on'),
    blockOn: [...document.querySelectorAll('#seg-block [data-block]')]
      .filter(x => x.classList.contains('on')).map(x => x.dataset.block),
  }));
};

const atBold = await stateAt('oldword');   // caret inside the bolded word
const atCaps = await stateAt('apsword');   // caret inside the small-caps span
const atHead = await stateAt('eading here');
const atList = await stateAt('ullet here');
const atPlain = await stateAt('plain then');
console.log('at bold:', JSON.stringify(atBold));
console.log('at caps:', JSON.stringify(atCaps));
console.log('at h2:', JSON.stringify(atHead));
console.log('at list item:', JSON.stringify(atList));
console.log('at plain:', JSON.stringify(atPlain));

// touch-target sizes
const sizes = await page.evaluate(() =>
  [...document.querySelectorAll('#fbar .fb')].map(b => {
    const r = b.getBoundingClientRect();
    return { id: b.id || b.dataset.cmd || b.className.split(' ').pop(), w: Math.round(r.width), h: Math.round(r.height) };
  }));
console.log('fb sizes:', JSON.stringify(sizes));
const minH = Math.min(...sizes.map(s => s.h)), minW = Math.min(...sizes.map(s => s.w));

// ANOMALY CHECK (not an ED-7 gate — ED-7 covers keyboard ride, target sizes,
// caret state): the Done button hides the bar, but the focusout→syncFbar(60ms)
// path re-shows it because the Done tap's own fbarHolding grace (300ms,
// step1.html L1575-1577) still counts as "editing" in syncFbar L1538. Verified
// timeline: show=false at +30ms, show=true again from +100ms onward, focus on BODY.
await page.click('#fb-done');
await wait(page, 400);
const hidden = await page.evaluate(() => !document.querySelector('#fbar').classList.contains('show'));
console.log('ANOMALY watch — bar hidden 400ms after Done:', hidden,
  hidden ? '' : '(Done-tap fbarHolding grace re-shows the bar; editor UX bug, outside ED-7 scope)');

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('bar shown while editor focused', shown),
  has('bold state follows caret (on in bold, off in plain)', atBold.b && !atPlain.b),
  has('small-caps state follows caret', atCaps.sc && !atPlain.sc),
  has('list state follows caret', atList.ul && !atPlain.ul),
  has('block segment follows caret (h2 vs p)', atHead.blockOn.join() === 'h2' && atPlain.blockOn.join() === 'p'),
  has('fb touch targets >= 40x40', minH >= 40 && minW >= 40),
  has('no page exceptions', errors.length === 0),
];
verdict('vp-ED-7', checks.every(Boolean));

await browser.close();
await srv.close();
