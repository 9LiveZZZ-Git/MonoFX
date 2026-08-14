// vf-EX-3 — adversarial re-check of the plain-text paragraph-fusion finding.
// Minimal reproduction, independent of the rich buildRichBook fixture: a
// two-paragraph scene typed through the real keyboard, exported via the real
// export sheet (book .txt and single-scene .txt). If EX-3 were healthy the
// files would contain a blank line (or at least a newline) between the two
// paragraphs; the finding says they fuse into one run.
// Also demonstrates the mechanism in-page: innerText of a DETACHED element
// (exactly what plainFromDoc L1954-1959 reads via textOf L886-887) vs the
// same element attached to the document.
// Run: cd probes && node vf-ex3-plaintext.mjs
import { launch, wait, createBook, downloadFromSheet, verdict } from './ex-lib.mjs';

const { srv, browser, page, errors } = await launch();

// Mechanism check first (pure DOM, no app code involved):
const mech = await page.evaluate(() => {
  const d = document.createElement('div');
  d.innerHTML = '<p>One.</p><p>Two.</p>';
  const detached = d.innerText;               // what plainFromDoc reads
  document.body.appendChild(d);
  const attached = d.innerText;               // what a rendered element gives
  d.remove();
  return { detached, attached };
});
console.log('detached innerText:', JSON.stringify(mech.detached));
console.log('attached innerText:', JSON.stringify(mech.attached));

await createBook(page, 'VF TXT Book');
await page.click('#ed-title');
await page.keyboard.type('Two Paragraphs');
await page.click('#ed-content');
await page.keyboard.type('first paragraph ends here');
await page.keyboard.press('Enter');
await page.keyboard.type('second paragraph starts here');
await wait(page, 1500);

// scene DOM really is two blocks?
const dom = await page.evaluate(() => document.querySelector('#ed-content').innerHTML);
console.log('editor DOM:', dom);

// single-scene .txt
await page.click('#ed-share');
await wait(page, 450);
const scene = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- scene.txt ---\n' + scene.text + '\n-----------------');

// book .txt
await page.click('#ed-back');
await wait(page, 500);
await page.click('#bk-share');
await wait(page, 450);
const book = await downloadFromSheet(page, 'Download plain text (.txt)');
console.log('--- book.txt ---\n' + book.text + '\n-----------------');

const fusedScene = /here\s*second/.test(scene.text) ? !/here\n+\s*second/.test(scene.text) : null;
const sceneFused = scene.text.includes('heresecond paragraph');
const bookFused = book.text.includes('heresecond paragraph');
console.log('scene.txt paragraphs fused (no separator):', sceneFused);
console.log('book.txt paragraphs fused (no separator):', bookFused);
console.log('pageerrors:', errors.length ? errors : 'none');

// PASS = the defect is absent (paragraph break survives)
verdict('vf-EX-3 (paragraph separation intact)', !sceneFused && !bookFused && errors.length === 0);
if (sceneFused && bookFused)
  console.log('CONFIRMED: plainFromDoc fuses adjacent paragraphs — detached innerText has no block separators (' +
    JSON.stringify(mech.detached) + ' vs attached ' + JSON.stringify(mech.attached) + ')');

await browser.close();
await srv.close();
