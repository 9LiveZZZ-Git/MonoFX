// ED-6 (third adversarial round) — a paste that carries ONLY text/plain whose
// content LOOKS like HTML (<script>, <img onerror>) must be inserted literally
// as text (paste handler L1465-1467 uses execCommand('insertText')), never
// parsed into elements, and must survive persist+reload as escaped text.
// Run: cd probes && node ed-sanitizer-plaintext.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

const PLAIN = 'before <script>window.__pwn5=1</script> mid <img src=x onerror="window.__pwn5=2"> after';

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'PlainPaste Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('seed ');
await T(200);

// paste with ONLY text/plain on the clipboard (no text/html flavor)
await page.evaluate(text => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, PLAIN);
await T(400);

const inspect = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  return {
    html: ed.innerHTML,
    pwn5: window.__pwn5,
    elements: [...ed.querySelectorAll('script,img')].map(e => e.tagName),
    literalKept: ed.textContent.includes('<script>window.__pwn5=1</script>')
      && ed.textContent.includes('onerror="window.__pwn5=2"'),
  };
});

const live = await inspect();
console.log('LIVE DOM:', live.html);
console.log('live: pwn5=%s elements=%j literalKept=%s', live.pwn5, live.elements, live.literalKept);

await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'PlainPaste Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await inspect();
console.log('STORED DOM:', stored.html);
console.log('stored: pwn5=%s elements=%j literalKept=%s', stored.pwn5, stored.elements, stored.literalKept);

const ok = live.pwn5 === undefined && stored.pwn5 === undefined &&
  live.elements.length === 0 && stored.elements.length === 0 &&
  live.literalKept && stored.literalKept;
console.log(ok ? 'ED-6-PLAINTEXT VERDICT: PASS' : 'ED-6-PLAINTEXT VERDICT: FAIL');

await browser.close();
await srv.close();
