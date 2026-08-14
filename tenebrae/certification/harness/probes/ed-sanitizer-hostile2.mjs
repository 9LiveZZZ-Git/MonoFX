// ED-6 (second adversarial round) — hostile vectors the first probe didn't
// cover: a spoofed translation span (span.tspan with onclick + hostile
// data-lang), mixed-case <ScRiPt>, <svg onload>, <iframe srcdoc>, <math>,
// <table> unwrapping, <a href="data:...">, <video>/<audio>, template smuggling.
// Same delivery path: real 'paste' listener via synthetic ClipboardEvent.
// Run: cd probes && node ed-sanitizer-hostile2.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

const T = ms => page.waitForTimeout(ms);

const HOSTILE = [
  '<ScRiPt>window.__pwn2 = 1</ScRiPt>',
  '<svg onload="window.__pwn2=2"><circle r="9"/></svg>',
  '<iframe srcdoc="&lt;script&gt;parent.__pwn2=3&lt;/script&gt;"></iframe>',
  '<span class="tspan" data-lang="x" onclick="window.__pwn2=4" data-src="evil&quot;&gt;&lt;img src=x onerror=window.__pwn2=5&gt;" data-rom="rom-ok">spoof</span>',
  '<span class="tspan" data-lang="kerrackian" data-src="ok source" data-rom="ok rom" dir="rtl">legit-shape</span>',
  '<math><mtext onclick="window.__pwn2=6">mathtext</mtext></math>',
  '<table onclick="window.__pwn2=7"><tr><td>cellA</td><td>cellB</td></tr></table>',
  '<a href="data:text/html,<script>window.__pwn2=8<\/script>">datalink</a>',
  '<video src="x" onerror="window.__pwn2=9"></video><audio src="x" onerror="window.__pwn2=10"></audio>',
  '<template><script>window.__pwn2=11<\/script></template>trailer',
].join('\n');

await page.goto(srv.url + 'step1.html');
await T(600);

await page.click('#lib-new');
await T(400);
await page.fill('#ps-input', 'Hostile2 Book');
await page.click('#ps-save');
await T(700);

await page.click('#ed-content');
await page.keyboard.type('base ');
await T(200);

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
await T(500);

const inspect = () => page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const all = [...ed.querySelectorAll('*')];
  const tspans = [...ed.querySelectorAll('span.tspan')].map(t => ({
    lang: t.dataset.lang, src: t.dataset.src, rom: t.dataset.rom,
    dir: t.getAttribute('dir'), ce: t.getAttribute('contenteditable'),
    attrs: [...t.attributes].map(a => a.name).sort().join(','),
    text: t.textContent,
  }));
  return {
    html: ed.innerHTML,
    pwn2: window.__pwn2,
    forbidden: all.filter(el =>
      /^(SCRIPT|STYLE|IFRAME|IMG|SVG|MATH|TABLE|TR|TD|VIDEO|AUDIO|TEMPLATE|A|OBJECT|EMBED)$/i.test(el.tagName))
      .map(el => el.tagName),
    handlers: all.flatMap(el => [...el.attributes]
      .filter(a => /^on/i.test(a.name)).map(a => `${el.tagName}@${a.name}`)),
    tspans,
    textKept: ['cellA', 'cellB', 'mathtext', 'datalink', 'trailer'].every(t => ed.textContent.includes(t)),
  };
});

const live = await inspect();
console.log('LIVE DOM:', live.html.slice(0, 700));
console.log('live: pwn2=%s forbidden=%j handlers=%j textKept=%s', live.pwn2, live.forbidden, live.handlers, live.textKept);
console.log('live tspans:', JSON.stringify(live.tspans, null, 1));

await T(1400);
await page.reload();
await T(800);
await page.locator('#lib-list .row', { hasText: 'Hostile2 Book' }).click();
await T(500);
await page.locator('#bk-list .row[data-scene]').first().click();
await T(500);
const stored = await inspect();
console.log('STORED DOM:', stored.html.slice(0, 700));
console.log('stored: pwn2=%s forbidden=%j handlers=%j textKept=%s', stored.pwn2, stored.forbidden, stored.handlers, stored.textKept);
console.log('stored tspans:', JSON.stringify(stored.tspans, null, 1));

const clean = r => r.pwn2 === undefined && r.forbidden.length === 0 && r.handlers.length === 0;
// every surviving tspan must carry ONLY the whitelisted attribute set
// (handler attributes are already caught globally by the `handlers` array,
// which matches /^on/i against attribute NAMES — "contenteditable" merely
// contains the substring "on" and must not trip this)
const tspanSafe = r => r.tspans.every(t =>
  /^(class,contenteditable,data-lang,data-rom,data-src(,dir)?)$/.test(t.attrs));
const ok = clean(live) && clean(stored) && live.textKept && stored.textKept &&
  tspanSafe(live) && tspanSafe(stored);
console.log(ok ? 'ED-6-HOSTILE2 VERDICT: PASS' : 'ED-6-HOSTILE2 VERDICT: FAIL');

await browser.close();
await srv.close();
