// Shared helpers for the EX-* / PR-5 certification probes.
// Not a probe itself — imported by ex-*.mjs files in this directory.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

export async function launch(){
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(600);
  return { srv, browser, context, page, errors };
}

export const wait = (page, ms) => page.waitForTimeout(ms);

// Create a book through the real UI; promptNewBook opens the editor on an
// empty first scene of "Chapter 1".
export async function createBook(page, title){
  await page.click('#lib-new');
  await wait(page, 400);
  await page.fill('#ps-input', title);
  await page.click('#ps-save');
  await wait(page, 700);
}

// Non-collapsed selection over the first occurrence of `word` in #ed-content.
export const selectWord = (page, word) => page.evaluate(w => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf(w);
    if (i > -1) {
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + w.length);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
  }
  return false;
}, word);

// Collapsed caret inside the first occurrence of `word`.
export const caretIn = (page, word) => page.evaluate(w => {
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

// Selection → right-click context menu → “Translate …” → pick a tongue by
// label in the action sheet. Drives the real UI path (showCtx → translateSheet
// → insertTranslation).
export async function insertTranslationSpan(page, phrase, langLabel){
  const selected = await selectWord(page, phrase);
  if(!selected) throw new Error('phrase not found for selection: ' + phrase);
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4)
    }));
  });
  await wait(page, 400);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await wait(page, 600); // tonguesList + sheet animation
  await page.locator('#sheet .sh-item', { hasText: langLabel }).click();
  await wait(page, 700); // close + deferred onTap + resolveTranslate + placeTSpan
}

// Click a labeled item in the open sheet and capture the resulting download.
// Returns { name, text }.
export async function downloadFromSheet(page, label){
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#sheet .sh-item', { hasText: label }).click(),
  ]);
  const path = await dl.path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');
  await wait(page, 500);
  return { name: dl.suggestedFilename(), text };
}

// Build the “everything” book used by the md/txt export probes:
// 2 chapters, 3 scenes; scene 1 holds every mark (b/i/u/s/small-caps), every
// block (h2/h3/blockquote/ul/ol), a ⁂ break, literal * _ ` in prose, and a
// Celan Basic translation span over "sea remembers".
export async function buildRichBook(page, title){
  await createBook(page, title); // editor open on Chapter 1 / scene 1

  await page.click('#ed-title');
  await page.keyboard.type('First Light');
  await page.click('#ed-content');
  // NOTE: the first typed line of a fresh scene stays a bare top-level text
  // run in #ed-content (Chromium never wraps it in <p>), and mdFromDoc
  // fragments top-level inline runs — see ex-md-firstline.mjs. Keep the
  // canonical mark/escape lines in wrapped <p> paragraphs (line 2+).
  await page.keyboard.type('opening line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('intro bold italic under strike caps end');
  await page.keyboard.press('Enter');
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
  await page.keyboard.type('keep *stars* _unders_ and `ticks` safe');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tail line');
  await wait(page, 300);

  // marks
  for(const [word, cmd] of [['bold','bold'], ['italic','italic'], ['under','underline'], ['strike','strikeThrough']]){
    await selectWord(page, word);
    await page.click(`[data-cmd="${cmd}"]`);
    await wait(page, 200);
  }
  await selectWord(page, 'caps');
  await page.click('#fb-sc'); // small caps
  await wait(page, 200);

  // blocks (Aa panel)
  await page.click('#fb-aa');
  await wait(page, 250);
  await caretIn(page, 'heading');
  await page.click('#aa-panel [data-block="h2"]');
  await wait(page, 200);
  await caretIn(page, 'sub');
  await page.click('#aa-panel [data-block="h3"]');
  await wait(page, 200);
  await caretIn(page, 'quote');
  await page.click('#aa-panel [data-block="blockquote"]');
  await wait(page, 200);
  await caretIn(page, 'bullet');
  await page.click('[data-cmd="insertUnorderedList"]');
  await wait(page, 200);
  await caretIn(page, 'numbered');
  await page.click('[data-cmd="insertOrderedList"]');
  await wait(page, 200);

  // ⁂ scene break on a fresh empty paragraph after the tail line
  await page.evaluate(() => {
    const ed = document.querySelector('#ed-content');
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, hit = null;
    while ((n = walker.nextNode())) if (n.nodeValue.includes('tail line')) hit = n;
    if (hit) {
      const r = document.createRange();
      r.setStart(hit, hit.nodeValue.length); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  });
  await page.keyboard.press('Enter');
  await page.click('#fb-break');
  await wait(page, 300);
  await page.keyboard.type('the sea remembers tonight');
  await wait(page, 200);

  // translation span over "sea remembers" (Celan Basic)
  await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');

  await wait(page, 1500); // debounced save
  await page.click('#ed-back');
  await wait(page, 500);

  // scene 2 in Chapter 1
  await page.locator('.chapter-block').first().locator('.add').click();
  await wait(page, 600);
  await page.click('#ed-title');
  await page.keyboard.type('Second Scene');
  await page.click('#ed-content');
  await page.keyboard.type('second body words');
  await wait(page, 1500);
  await page.click('#ed-back');
  await wait(page, 500);

  // chapter 2 + scene 3
  await page.click('#bk-more');
  await wait(page, 400);
  await page.locator('#sheet .sh-item', { hasText: 'Add chapter' }).click();
  await wait(page, 500);
  await page.fill('#ps-input', 'The Second Gate');
  await page.click('#ps-save');
  await wait(page, 600);
  await page.locator('.chapter-block', { hasText: 'The Second Gate' }).locator('.add').click();
  await wait(page, 600);
  await page.click('#ed-title');
  await page.keyboard.type('Third Scene');
  await page.click('#ed-content');
  await page.keyboard.type('third body words');
  await wait(page, 1500);
  await page.click('#ed-back');
  await wait(page, 500);
}

export const PUA_RE = /[\uE000-\uF8FF]/; // private-use glyph range used by the sample codex scripts

export function verdict(id, ok){
  console.log(`${id} VERDICT: ${ok ? 'PASS' : 'FAIL'}`);
}
