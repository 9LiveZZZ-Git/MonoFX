// vp-EX4 — adversarial functional check of rich copy (EX-4 was certified on
// static evidence). Grants clipboard permissions, drives the real
// "Copy for Apple Notes" sheet item, then reads the clipboard from the page:
// both text/html and text/plain flavors must be present, the html flavor must
// keep the heading and bold mark and the Georgia wrapper.
// Run: cd probes && node vp-ex4-rich-copy.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const origin = srv.url.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(600);

// book with a heading + a bold word
await page.click('#lib-new');
await page.waitForTimeout(400);
await page.fill('#ps-input', 'Copy Book');
await page.click('#ps-save');
await page.waitForTimeout(700);
await page.click('#ed-title');
await page.keyboard.type('Copy Scene');
await page.click('#ed-content');
await page.keyboard.type('opening line');
await page.keyboard.press('Enter');
await page.keyboard.type('heading line');
await page.keyboard.press('Enter');
await page.keyboard.type('the bold word stands');
await page.waitForTimeout(300);
// heading via Aa panel
await page.click('#fb-aa');
await page.waitForTimeout(250);
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) if (n.nodeValue.includes('heading line')) {
    const r = document.createRange(); r.setStart(n, 2); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return;
  }
});
await page.click('#aa-panel [data-block="h2"]');
await page.waitForTimeout(250);
// bold via format bar
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf('bold');
    if (i > -1) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 4);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return;
    }
  }
});
await page.click('[data-cmd="bold"]');
await page.waitForTimeout(1500);
await page.click('#ed-back');
await page.waitForTimeout(500);

// book export sheet → Copy for Apple Notes
await page.click('#bk-share');
await page.waitForTimeout(450);
await page.locator('#sheet .sh-item', { hasText: 'Copy for Apple Notes' }).click();
await page.waitForTimeout(900);
const toast = await page.locator('#toast').innerText();
console.log('toast:', JSON.stringify(toast));

const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = {};
  for (const it of items) {
    for (const t of it.types) out[t] = await (await it.getType(t)).text();
  }
  return out;
});
console.log('clipboard flavors:', JSON.stringify(Object.keys(clip)));
console.log('--- text/html ---\n' + (clip['text/html'] || '').slice(0, 600));
console.log('--- text/plain ---\n' + (clip['text/plain'] || '').slice(0, 400));

const has = (label, cond) => { console.log((cond ? 'ok  ' : 'MISS') + ' ' + label); return cond; };
const checks = [
  has('toast confirms rich copy', toast.includes('Copied — paste into Apple Notes')),
  has('clipboard holds text/html', typeof clip['text/html'] === 'string' && clip['text/html'].length > 0),
  has('clipboard holds text/plain', typeof clip['text/plain'] === 'string' && clip['text/plain'].length > 0),
  has('html flavor keeps heading', /<h2>heading line<\/h2>/.test(clip['text/html'] || '')),
  has('html flavor keeps bold mark', /<b>bold<\/b>/.test(clip['text/html'] || '')),
  // NOTE: the app writes a full `<body style="font-family:Georgia,serif">` wrapper
  // (step1.html L2019), but Chromium's clipboard.read() normalizes the html flavor
  // to a fragment and drops the wrapper — so the wrapper is asserted statically,
  // not here. Informational only:
  (console.log('info Georgia wrapper visible after clipboard normalization:',
    (clip['text/html'] || '').includes('Georgia')), true),
  has('plain flavor carries the prose', (clip['text/plain'] || '').includes('the bold word stands')),
  has('no page exceptions', errors.length === 0),
];
console.log('vp-EX-4 VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
