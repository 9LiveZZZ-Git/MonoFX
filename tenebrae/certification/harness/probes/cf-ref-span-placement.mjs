// cf-REF-PLACEMENT — a translation made at the START of a paragraph.
//
// Found while building cf-ref-tx2-uiparity.mjs: translating the opening words
// of a paragraph appeared to move the span to the END of that paragraph. This
// probe isolates it: same book, same tongue, three selections that differ only
// in WHERE in the paragraph they sit (start / middle / end), each in its own
// paragraph, with the raw innerHTML dumped after each.
// Requirement touched: TX-11d ("A span lands where the author put it").
// Run: cd probes && node cf-ref-span-placement.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(4200);
await page.click('#lib-new'); await page.waitForTimeout(400);
await page.fill('#ps-input', 'Placement'); await page.click('#ps-save'); await page.waitForTimeout(800);

await page.click('#ed-content');
await page.keyboard.type('opening line');
for(const l of ['the sea remembers alpha bravo', 'alpha the sea remembers bravo', 'alpha bravo the sea remembers'])
  { await page.keyboard.press('Enter'); await page.keyboard.type(l); }
await page.waitForTimeout(600);

const selectSpan = (a, b) => page.evaluate(({ a, b }) => {
  const ed = document.querySelector('#ed-content');
  const nodes = []; const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n; while((n = w.nextNode())) nodes.push(n);
  let sN = null, sO = 0, eN = null, eO = 0, si = -1;
  for(let k = 0; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(a); if(i > -1){ sN = nodes[k]; sO = i; si = k; break; } }
  if(sN) for(let k = si; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(b, k === si ? sO : 0); if(i > -1){ eN = nodes[k]; eO = i + b.length; break; } }
  if(!sN || !eN) return false;
  const r = document.createRange(); r.setStart(sN, sO); r.setEnd(eN, eO);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true;
}, { a, b });

async function translateSelection(label){
  await page.evaluate(() => {
    const sel = getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(10, r.left + 4), clientY: Math.max(10, r.top + 4) }));
  });
  await page.waitForTimeout(400);
  await page.locator('#ctx .ctx-i', { hasText: 'Translate' }).click();
  await page.waitForTimeout(700);
  await page.locator('#sheet .sh-item', { hasText: label }).click();
  await page.waitForTimeout(900);
}

// paragraph texts, in order, as the author sees them (span shown as {T})
const paraTexts = () => page.evaluate(() => [...document.querySelectorAll('#ed-content p')].map(p => {
  let out = '';
  const walk = n => { n.childNodes.forEach(c => {
    if(c.nodeType === 3) out += c.nodeValue;
    else if(c.nodeType === 1 && c.classList && c.classList.contains('tspan')) out += '{T:' + c.dataset.src + '}';
    else if(c.nodeType === 1) walk(c); }); };
  walk(p);
  return out.replace(/ /g, '·');
}));

console.log('before:', JSON.stringify(await paraTexts()));
const runs = [
  ['START of paragraph',  'the sea', 'remembers', 'the sea remembers alpha bravo', 0],
  ['MIDDLE of paragraph', 'the sea', 'remembers', 'alpha the sea remembers bravo', 1],
  ['END of paragraph',    'the sea', 'remembers', 'alpha bravo the sea remembers', 2],
];
for(const [name, a, b, before, idx] of runs){
  // target the right paragraph by seeding the search inside it
  const ok = await page.evaluate(({ idx, a, b }) => {
    const p = document.querySelectorAll('#ed-content p')[idx];
    if(!p) return false;
    const nodes = []; const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n; while((n = w.nextNode())) nodes.push(n);
    let sN = null, sO = 0, eN = null, eO = 0, si = -1;
    for(let k = 0; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(a); if(i > -1){ sN = nodes[k]; sO = i; si = k; break; } }
    if(sN) for(let k = si; k < nodes.length; k++){ const i = nodes[k].nodeValue.indexOf(b, k === si ? sO : 0); if(i > -1){ eN = nodes[k]; eO = i + b.length; break; } }
    if(!sN || !eN) return false;
    const r = document.createRange(); r.setStart(sN, sO); r.setEnd(eN, eO);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true;
  }, { idx, a, b });
  if(!ok){ ck('setup: ' + name, false); continue; }
  const selTxt = await page.evaluate(() => String(getSelection()));
  await translateSelection('Celan High');
  const after = (await paraTexts())[idx];
  console.log(`  ${name}: selected ${JSON.stringify(selTxt)}`);
  console.log(`     before: ${JSON.stringify(before)}`);
  console.log(`     after : ${JSON.stringify(after)}`);
  const expect = before.replace('the sea remembers', '{T:the sea remembers}');
  ck(`${name}: the span sits exactly where the words were`,
     after.replace(/·/g, ' ').replace(/\s+/g, ' ').trim() === expect.replace(/\s+/g, ' ').trim(),
     `expected ${JSON.stringify(expect)}`);
}
console.log('raw DOM:', (await page.evaluate(() => document.querySelector('#ed-content').innerHTML)).replace(/data-scr="[^"]*"/g, 'data-scr="…"'));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('cf-REF-PLACEMENT VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
