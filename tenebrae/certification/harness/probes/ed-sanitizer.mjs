// ED-6 — Sanitizer: hostile pasted HTML (script/style/iframe/img, on* handlers,
// style attributes, javascript: links, nested divs, foreign spans, H1) must be
// normalized to the app's schema in #ed-content and NOTHING executable may
// survive into the stored scene doc. Paste is driven through the real paste
// handler via a synthetic ClipboardEvent carrying text/html, then the doc is
// checked live, and again after reload + reopening the scene (the editor is
// re-hydrated directly from the stored s.doc).
// Run: cd probes && node ed-sanitizer.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

const HOSTILE = [
  '<script>window.__pwned = 1<\/script>',
  '<style>.evil{color:red}</style>',
  '<h1 class="x" style="color:red" onclick="window.__pwned=7">Big Title</h1>',
  '<div onclick="window.__pwned=2" style="background:red">',
  '  <span style="font-size:99px" onmouseover="window.__pwned=3">Hello</span>',
  '  <div><div>nested deep</div></div>',
  '</div>',
  '<img src="x" onerror="window.__pwned=4">',
  '<iframe src="https://evil.example/"></iframe>',
  '<p style="color:blue" id="bar">World <b onclick="window.__pwned=5">bold</b></p>',
  '<span style="font-variant:small-caps">smallcapped</span>',
  '<a href="javascript:window.__pwned=6">link</a>',
].join('\n');

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Sanitize Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('start ');
await T(200);

// paste through the app's real 'paste' listener (it reads e.clipboardData)
await page.evaluate(html => {
  const ed = document.querySelector('#ed-content');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, HOSTILE);
await T(400);

const inspect = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const html = ed.innerHTML;
  const all = [...ed.querySelectorAll('*')];
  return {
    html,
    pwned: window.__pwned,
    forbiddenTags: all.filter(el =>
      /^(SCRIPT|STYLE|IFRAME|IMG|OBJECT|EMBED|LINK|META|FORM|INPUT|A|FONT)$/.test(el.tagName))
      .map(el => el.tagName),
    handlerAttrs: all.flatMap(el => [...el.attributes]
      .filter(a => /^on/i.test(a.name)).map(a => `${el.tagName}@${a.name}`)),
    styleAttrs: all.filter(el => el.hasAttribute('style')).map(el => el.tagName),
    idClassAttrs: all.filter(el =>
      (el.hasAttribute('class') && !/^(asterism|sc|tspan)$/.test(el.className)) || el.hasAttribute('id'))
      .map(el => el.tagName + '.' + (el.className || el.id)),
    scriptTextLeak: html.includes('__pwned') || html.includes('javascript:'),
    h1: !!ed.querySelector('h1'),
    h1AsH2: [...ed.querySelectorAll('h2')].some(el => el.textContent.includes('Big Title')),
    scNormalized: [...ed.querySelectorAll('span.sc')].some(el => el.textContent.includes('smallcapped')),
    textKept: ['Hello', 'nested deep', 'World', 'bold', 'link'].every(t => ed.textContent.includes(t)),
  };
});

const live = await inspect();
console.log('LIVE DOM:', live.html.slice(0, 600));
console.log('live: pwned=%s forbidden=%j handlers=%j styleAttrs=%j idClass=%j leak=%s h1=%s h1->h2=%s sc=%s textKept=%s',
  live.pwned, live.forbiddenTags, live.handlerAttrs, live.styleAttrs, live.idClassAttrs,
  live.scriptTextLeak, live.h1, live.h1AsH2, live.scNormalized, live.textKept);

// persist, reload, reopen — the editor re-hydrates from the STORED doc
await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Sanitize Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await inspect();
console.log('STORED DOM:', stored.html.slice(0, 600));
console.log('stored: pwned=%s forbidden=%j handlers=%j styleAttrs=%j idClass=%j leak=%s h1=%s h1->h2=%s sc=%s textKept=%s',
  stored.pwned, stored.forbiddenTags, stored.handlerAttrs, stored.styleAttrs, stored.idClassAttrs,
  stored.scriptTextLeak, stored.h1, stored.h1AsH2, stored.scNormalized, stored.textKept);

const clean = r =>
  r.pwned === undefined && r.forbiddenTags.length === 0 && r.handlerAttrs.length === 0 &&
  r.styleAttrs.length === 0 && r.idClassAttrs.length === 0 && !r.scriptTextLeak && !r.h1;
const ok = clean(live) && clean(stored) &&
  live.h1AsH2 && live.scNormalized && live.textKept &&
  stored.h1AsH2 && stored.scNormalized && stored.textKept;
console.log(ok ? 'ED-6 VERDICT: PASS' : 'ED-6 VERDICT: FAIL');

await browser.close();
await srv.close();
