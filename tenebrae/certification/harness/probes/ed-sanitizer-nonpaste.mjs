// ED-6 (adversarial round) — hostile HTML that reaches the LIVE contenteditable
// through a path the paste handler never sees. step1.html has NO 'drop'
// handler on #ed-content (grep: zero matches for drop/dragover/beforeinput), so
// a native drag-and-drop inserts browser HTML unsanitized into the live DOM.
// A synthetic drop event cannot trigger the browser's default insertion, so
// this probe simulates the aftermath: hostile markup appended straight into
// #ed-content.innerHTML + a real 'input' event, exactly what the app observes
// after a native drop. The requirement is on the STORED scene doc: the
// persist-time sanitize (persistEditor, step1.html L1414) plus the load-time
// re-sanitize (L4070) must normalize it. Live-DOM side effects (img onerror
// firing at insertion time) are recorded for the anomaly report.
// Run: cd probes && node ed-sanitizer-nonpaste.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

const HOSTILE = [
  '<script>window.__pwn4 = 1<\/script>',
  '<style>.evil{color:red}</style>',
  '<img src="x" onerror="window.__pwn4 = 2">',
  '<div onclick="window.__pwn4 = 3" style="color:red">dropped text</div>',
  '<a href="javascript:window.__pwn4=4">droplink</a>',
].join('');

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'DropSim Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('seed ');
await T(300);

// simulate the DOM state right after a native drop: raw HTML in the live
// editor, followed by the input event contenteditable fires (insertFromDrop)
await page.evaluate(html => {
  const ed = document.querySelector('#ed-content');
  ed.innerHTML += html;
  ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
}, HOSTILE);
await T(300);

const liveSideEffect = await page.evaluate(() => window.__pwn4);
console.log('live side effect (img onerror fired in live DOM):', liveSideEffect);

// wait out the 450ms editor debounce + 600ms save debounce, then reload
await T(1600);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'DropSim Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);

const stored = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const all = [...ed.querySelectorAll('*')];
  return {
    html: ed.innerHTML,
    pwn4: window.__pwn4,
    forbidden: all.filter(el =>
      /^(SCRIPT|STYLE|IFRAME|IMG|OBJECT|EMBED|LINK|META|FORM|INPUT|A|SVG)$/.test(el.tagName))
      .map(el => el.tagName),
    handlers: all.flatMap(el => [...el.attributes]
      .filter(a => /^on/i.test(a.name)).map(a => `${el.tagName}@${a.name}`)),
    styleAttrs: all.filter(el => el.hasAttribute('style')).map(el => el.tagName),
    jsLeak: ed.innerHTML.includes('javascript:') || ed.innerHTML.includes('__pwn4'),
    textKept: ed.textContent.includes('dropped text') && ed.textContent.includes('droplink')
      && ed.textContent.includes('seed'),
  };
});
console.log('STORED DOM:', stored.html);
console.log('stored: pwn4=%s forbidden=%j handlers=%j styleAttrs=%j jsLeak=%s textKept=%s',
  stored.pwn4, stored.forbidden, stored.handlers, stored.styleAttrs, stored.jsLeak, stored.textKept);

// the stored doc must be clean regardless of what happened in the live DOM;
// after reload window.__pwn4 must be gone (nothing executable persisted)
const ok = stored.pwn4 === undefined && stored.forbidden.length === 0 &&
  stored.handlers.length === 0 && stored.styleAttrs.length === 0 &&
  !stored.jsLeak && stored.textKept;
console.log(ok ? 'ED-6-NONPASTE VERDICT: PASS' : 'ED-6-NONPASTE VERDICT: FAIL');
console.log('NOTE for anomalies: live-DOM side effect before sanitize =', liveSideEffect === 2
  ? 'img onerror DID fire in the live DOM (no drop interception)' : 'none observed');

await browser.close();
await srv.close();
