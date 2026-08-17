// TX-10 (rendering half) — "would this EPUB render right in a reader?"
//
// The structural probe (tx-epub-allscripts.mjs) proves the bytes are present.
// This one proves the bytes WORK: the exported style.css is fed to a real CSS
// parser, the exported XHTML + CSS + fonts are reassembled into a standalone
// reader page, and each span is measured to see whether it actually painted in
// its forged face — and what a reader WITHOUT the fonts would show instead.
//
// Run: cd probes && node tx-epub-reader-render.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict, PUA_RE } from './ex-lib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx10r';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL '), label, extra === undefined ? '' : extra); };

const { srv, browser, context, page, errors } = await launch();
await wait(page, 3500);

const LANGS = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  return langs.map(l => ({ id: l.id, name: l.name }));
});
await createBook(page, 'TX10 Reader Render');
await page.click('#ed-title'); await page.keyboard.type('Faces');
await page.click('#ed-content');
await page.keyboard.type('opening line');
for(let i = 0; i < LANGS.length; i++){ await page.keyboard.press('Enter'); await page.keyboard.type(`alpha${i} the sea remembers the old king omega${i}`); }
await wait(page, 400);
for(let i = 0; i < LANGS.length; i++) await insertTranslationSpan(page, `the sea remembers the old king omega${i}`, LANGS[i].name);
await wait(page, 1800);
await page.click('#ed-back'); await wait(page, 600);

await page.click('#bk-share'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('#sheet .sh-item', { hasText: 'EPUB (.epub)' }).click(),
]);
const epub = await readFile(await dl.path());
await wait(page, 400);
await writeFile(`${OUT}/book.epub`, epub);

function unzipStored(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = new Map(); const order = [];
  let off = 0;
  while(off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50){
    const csize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = Buffer.from(buf.subarray(off + 30, off + 30 + nameLen)).toString('utf8');
    files.set(name, buf.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize));
    order.push(name);
    off += 30 + nameLen + extraLen + csize;
  }
  return { files, order };
}
const ez = unzipStored(epub);
const css = Buffer.from(ez.files.get('OEBPS/style.css')).toString('utf8');
const ch1 = Buffer.from(ez.files.get('OEBPS/ch1.xhtml')).toString('utf8');
const fontFiles = ez.order.filter(n => /^OEBPS\/fonts\//.test(n));
await writeFile(`${OUT}/style.css`, css);

// ---------- 1. does a real CSS parser accept every @font-face? ----------
const cssRules = await page.evaluate(async src => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(src);
  const out = { faces: [], langRules: [], flowRules: [], total: sheet.cssRules.length };
  for(const r of sheet.cssRules){
    if(r.constructor.name === 'CSSFontFaceRule' || r.type === 5){
      out.faces.push({ family: r.style.getPropertyValue('font-family'), src: r.style.getPropertyValue('src'), text: r.cssText.slice(0, 200) });
    }else if(r.selectorText && /data-lang/.test(r.selectorText)){
      out.langRules.push({ sel: r.selectorText, family: r.style.getPropertyValue('font-family') });
    }else if(r.selectorText && /data-flow/.test(r.selectorText)){
      out.flowRules.push(r.selectorText);
    }
  }
  return out;
}, css);
const declaredFaces = (css.match(/@font-face\{/g) || []).length;
console.log(`style.css: ${declaredFaces} @font-face written, ${cssRules.faces.length} survive the CSS parser, ${fontFiles.length} font files, ${cssRules.total} rules total`);
for(const f of cssRules.faces) console.log('   parsed face:', JSON.stringify(f.family), '->', f.src.slice(0, 40));
ck('TX-10 every @font-face written is accepted by the CSS parser', cssRules.faces.length === declaredFaces,
   `${cssRules.faces.length}/${declaredFaces}`);
ck('TX-10 a font file exists for every @font-face and vice versa',
   cssRules.faces.length === fontFiles.length, `parsed=${cssRules.faces.length} files=${fontFiles.length}`);
ck('TX-10 every parsed @font-face has a usable family name',
   cssRules.faces.every(f => f.family && f.family.trim()), JSON.stringify(cssRules.faces.map(f => f.family)));

// ---------- 1b. ROOT CAUSE: which rule kills the stylesheet, and does escaping fix it? ----------
const written = {
  faces: declaredFaces,
  lang: (css.match(/\.tspan\[data-lang=/g) || []).length,
  // count RULES whose selector mentions data-flow — the compound
  // .tspan[data-block="1"][data-flow="…"] rules are per-flow rules too
  flow: css.split('}').filter(seg => /\[data-flow=/.test(seg.split('{')[0] || '')).length,
  base: (css.match(/^(body|h1,h2,h3,h4|blockquote|\.ast|\.sc|\.tspan)\{/gm) || []).length,
};
// escape ASCII apostrophes that sit INSIDE a single-quoted CSS string
const fixedCSS = css.replace(/@font-face\{font-family:'(.*?)';src:/g, (a, fam) => `@font-face{font-family:"${fam}";src:`);
const cmp = await page.evaluate(([bad, good]) => {
  const count = src => {
    const s = new CSSStyleSheet(); s.replaceSync(src);
    let faces = 0, lang = 0, flow = 0, other = 0;
    for(const r of s.cssRules){
      if(r.type === 5) faces++;
      else if(r.selectorText && /data-lang/.test(r.selectorText)) lang++;
      else if(r.selectorText && /data-flow/.test(r.selectorText)) flow++;
      else other++;
    }
    return { total: s.cssRules.length, faces, lang, flow, other, texts: [...s.cssRules].map(r => r.cssText.slice(0, 90)) };
  };
  return { bad: count(bad), good: count(good) };
}, [css, fixedCSS]);
console.log('as-exported  ->', JSON.stringify({ total: cmp.bad.total, faces: cmp.bad.faces, lang: cmp.bad.lang, flow: cmp.bad.flow, other: cmp.bad.other }));
for(const t of cmp.bad.texts) console.log('     rule:', t);
console.log('apostrophe-escaped ->', JSON.stringify({ total: cmp.good.total, faces: cmp.good.faces, lang: cmp.good.lang, flow: cmp.good.flow, other: cmp.good.other }));
console.log(`written into the file: ${written.faces} @font-face, ${written.lang} per-language, ${written.flow} per-flow, ${written.base} base rules`);
ck('TX-10 the exported CSS survives parsing intact (no rules swallowed)',
   cmp.bad.total === cmp.good.total,
   `as-exported ${cmp.bad.total} rules vs ${cmp.good.total} once the ASCII apostrophe in the font family is escaped`);
ck('TX-10 the per-language rules survive parsing', cmp.bad.lang === written.lang, `${cmp.bad.lang}/${written.lang}`);
ck('TX-10 the per-flow rules survive parsing', cmp.bad.flow === written.flow, `${cmp.bad.flow}/${written.flow}`);

// ---------- 2. reassemble the EPUB as a standalone reader page ----------
const b64 = buf => Buffer.from(buf).toString('base64');
let readerCSS = css;
for(const n of fontFiles){
  const rel = n.replace('OEBPS/', '');
  readerCSS = readerCSS.split(`url('${rel}')`).join(`url(data:font/ttf;base64,${b64(ez.files.get(n))})`);
}
const body = ch1.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
const readerHTML = `<!doctype html><meta charset="utf-8"><style>${readerCSS}</style><body>${body}</body>`;
await writeFile(`${OUT}/reader.html`, readerHTML);
// same page WITHOUT any of the embedded fonts — the "reader lacking the fonts" case
const nofontHTML = `<!doctype html><meta charset="utf-8"><style>${css.replace(/@font-face\{[\s\S]*?\}\n/g, '')}</style><body>${body}</body>`;
await writeFile(`${OUT}/reader-nofonts.html`, nofontHTML);

const reader = await context.newPage();
const rErr = [];
reader.on('pageerror', e => rErr.push(e.message));
await reader.setContent(readerHTML, { waitUntil: 'load' });
await reader.waitForTimeout(1200);

const rendered = await reader.evaluate(async () => {
  await document.fonts.ready;
  const out = [];
  for(const sp of document.querySelectorAll('span.tspan')){
    const cs = getComputedStyle(sp);
    const fam = cs.fontFamily.replace(/^["']|["']$/g, '');
    const bb = sp.getBoundingClientRect();
    // control: identical text in a face that certainly is not loaded
    const ctl = sp.cloneNode(true);
    ctl.removeAttribute('data-lang');
    ctl.style.fontFamily = 'NoSuchFaceAtAll';
    sp.parentNode.appendChild(ctl);
    const cb = ctl.getBoundingClientRect();
    ctl.remove();
    out.push({
      lang: sp.getAttribute('data-lang'), flow: sp.getAttribute('data-flow'),
      family: fam, loaded: document.fonts.check(`40px "${fam}"`),
      box: [Math.round(bb.width), Math.round(bb.height)],
      ctlBox: [Math.round(cb.width), Math.round(cb.height)],
      writingMode: cs.writingMode, direction: cs.direction, bidi: cs.unicodeBidi,
      pua: [...sp.textContent].some(c => { const p = c.codePointAt(0); return p >= 0xE000 && p <= 0xF8FF; }),
      rom: sp.getAttribute('data-rom'), src: sp.getAttribute('data-src'),
    });
  }
  return { spans: out, faces: [...document.fonts].map(f => f.family + ':' + f.status) };
});
console.log('reader page: loaded faces =', rendered.faces.join(', ') || '(none)');
for(const s of rendered.spans)
  console.log(`   ${String(s.lang).padEnd(14)} family=${String(s.family).padEnd(26)} loaded=${String(s.loaded).padEnd(5)} box=${s.box.join('x').padEnd(10)} vs fallback ${s.ctlBox.join('x').padEnd(10)} wm=${s.writingMode} dir=${s.direction}`);

// families the export MEANT to use, read from the raw CSS text (not the parser)
const writtenFamilies = new Set([...css.matchAll(/@font-face\{font-family:'(.*?)';src:/g)].map(x => x[1]));
ck('TX-10 every span actually paints in one of the embedded script families',
   rendered.spans.every(s => writtenFamilies.has(s.family)),
   rendered.spans.map(s => `${s.lang}->${s.family}`).join(' | '));
ck('TX-10 every span paints differently from an unavailable-face fallback',
   rendered.spans.every(s => s.box[0] !== s.ctlBox[0] || s.box[1] !== s.ctlBox[1]),
   rendered.spans.filter(s => s.box[0] === s.ctlBox[0] && s.box[1] === s.ctlBox[1]).map(s => `${s.lang} ${s.box.join('x')}`).join(' | '));
ck('TX-10 the per-flow CSS actually applies in the reader',
   rendered.spans.every(s => s.flow !== 'cols-rtl' || s.writingMode === 'vertical-lr') &&
   rendered.spans.every(s => s.flow !== 'btt-stave' || (s.writingMode === 'vertical-lr' && s.direction === 'rtl')) &&
   rendered.spans.every(s => s.flow !== 'rtl' || s.direction === 'rtl'),
   rendered.spans.map(s => `${s.lang}:${s.flow || 'ltr'}/${s.writingMode}/${s.direction}`).join(' '));
ck('reader page raises no exceptions', rErr.length === 0, rErr.join(' | '));
await reader.screenshot({ path: `${OUT}/reader.png`, fullPage: true });

// ---------- 2b. counterfactual: the SAME package with the apostrophe escaped ----------
// Proves the payload (fonts, PUA text, data-flow) is sound and the only thing
// standing between it and a correct render is that one CSS string.
let fixedReaderCSS = fixedCSS;
for(const n of fontFiles){
  const rel = n.replace('OEBPS/', '');
  fixedReaderCSS = fixedReaderCSS.split(`url('${rel}')`).join(`url(data:font/ttf;base64,${b64(ez.files.get(n))})`);
}
await writeFile(`${OUT}/reader-fixed.html`, `<!doctype html><meta charset="utf-8"><style>${fixedReaderCSS}</style><body>${body}</body>`);
const fixedPage = await context.newPage();
await fixedPage.setContent(`<!doctype html><meta charset="utf-8"><style>${fixedReaderCSS}</style><body>${body}</body>`, { waitUntil: 'load' });
await fixedPage.waitForTimeout(1500);
const fixedRender = await fixedPage.evaluate(async () => {
  await document.fonts.ready;
  return [...document.querySelectorAll('span.tspan')].map(sp => {
    const cs = getComputedStyle(sp);
    return { lang: sp.getAttribute('data-lang'), flow: sp.getAttribute('data-flow'),
      family: cs.fontFamily.replace(/^["']|["']$/g, ''), wm: cs.writingMode, dir: cs.direction };
  });
});
console.log('counterfactual (apostrophe escaped):');
for(const s of fixedRender) console.log(`   ${String(s.lang).padEnd(14)} family=${String(s.family).padEnd(28)} wm=${s.wm} dir=${s.dir}`);
ck('COUNTERFACTUAL: with the apostrophe escaped, every span paints in its forged family',
   fixedRender.every(s => writtenFamilies.has(s.family)), fixedRender.map(s => s.family).join(' | '));
ck('COUNTERFACTUAL: with the apostrophe escaped, every flow applies',
   fixedRender.every(s => s.flow !== 'cols-rtl' || s.wm === 'vertical-lr') &&
   fixedRender.every(s => s.flow !== 'btt-stave' || (s.wm === 'vertical-lr' && s.dir === 'rtl')),
   fixedRender.map(s => `${s.lang}:${s.flow || 'ltr'}/${s.wm}`).join(' '));
await fixedPage.screenshot({ path: `${OUT}/reader-fixed.png`, fullPage: true });
await fixedPage.close();

// ---------- 3. a reader that has NO fonts ----------
const nofont = await context.newPage();
await nofont.setContent(nofontHTML, { waitUntil: 'load' });
await nofont.waitForTimeout(600);
const bare = await nofont.evaluate(() => [...document.querySelectorAll('span.tspan')].map(sp => ({
  lang: sp.getAttribute('data-lang'),
  visible: sp.textContent,
  romInText: document.body.innerText.includes(sp.getAttribute('data-rom') || '@@'),
  srcInText: document.body.innerText.includes(sp.getAttribute('data-src') || '@@'),
})));
await nofont.screenshot({ path: `${OUT}/reader-nofonts.png`, fullPage: true });
console.log('reader WITHOUT the embedded fonts:');
for(const b of bare) console.log(`   ${String(b.lang).padEnd(14)} shows PUA=${PUA_RE.test(b.visible)} romanization visible=${b.romInText} source visible=${b.srcInText}`);
ck('NOTE (not a TX-10 clause): a font-less reader shows only PUA, no romanization fallback',
   true, bare.every(b => !b.romInText) ? 'confirmed: data-rom is metadata only, never rendered' : 'some romanization is visible');
await nofont.close();
await reader.close();

ck('no page exceptions in the app', errors.length === 0, errors.join(' | '));
verdict('TX-10 reader rendering', checks.every(c => c[1]));
console.log('artifacts in', OUT);
await browser.close();
await srv.close();
