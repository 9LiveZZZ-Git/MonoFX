// cf-ex-rtf — spec §6's .doc-compatibility export.
//
//   "Ship RTF (universally readable by Word/Pages/WordPad, text-based,
//    macro-safe)... Conlang runs use the PUA/image fallback since RTF has no
//    OpenType shaping."
//
// The app has read .rtf since step 1; it could not write one. TX-11 governs
// what a translated span looks like in a format that cannot carry the script:
// the romanization, never a raw private-use run, with the English recoverable
// beside it. RTF is one more format that rule has to hold in.
//
// Also checked: the file is well-formed (balanced braces, one group), it is
// pure ASCII on the wire (everything above 0x7F escaped as \uN?), the escapes
// decode back to the characters the author wrote, and the export options that
// govern .md and .docx govern this too.
// Run: cd probes && node cf-ex-rtf.mjs
import { launch, wait, buildRichBook, downloadFromSheet, PUA_RE, verdict } from './ex-lib.mjs';

const checks = [];
const ck = (l, ok, x) => { checks.push([l, ok]); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 300)); };

// \uN? back to text, so the file can be compared against what the author typed
function rtfDecode(src){
  let out = '';
  for(let i = 0; i < src.length; i++){
    if(src[i] === '\\'){
      const m = /^\\u(-?\d+)\??/.exec(src.slice(i));
      if(m){ const n = +m[1]; out += String.fromCharCode(n < 0 ? n + 65536 : n); i += m[0].length - 1; continue; }
      const w = /^\\([a-z]+)-?\d*\s?/.exec(src.slice(i));
      if(w){ if(w[1] === 'par' || w[1] === 'line') out += '\n'; else if(w[1] === 'tab') out += '\t'; i += w[0].length - 1; continue; }
      if('\\{}'.includes(src[i + 1])){ out += src[i + 1]; i++; continue; }
      continue;
    }
    if(src[i] === '{' || src[i] === '}') continue;
    out += src[i];
  }
  return out;
}

const { srv, browser, page, errors } = await launch();
await buildRichBook(page, 'RTF Book');
await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 450);
const book = await downloadFromSheet(page, 'Download rich text (.rtf)');
console.log('file:', book.name);
console.log('--- first 700 chars ---\n' + book.text.slice(0, 700) + '\n-----------------------');

ck('the export item exists and names the format honestly', /\.rtf$/.test(book.name), book.name);
ck('it opens as an RTF document', /^\{\\rtf1\\ansi/.test(book.text), book.text.slice(0, 40));
ck('there is a font table', /\{\\fonttbl\{/.test(book.text));

// balanced braces, and exactly one outermost group
let depth = 0, minDepth = 1, closedEarly = false;
for(let i = 0; i < book.text.length; i++){
  const c = book.text[i];
  if(c === '\\'){ i++; continue; }              // escaped brace or control word
  if(c === '{') depth++;
  else if(c === '}'){ depth--; if(depth === 0 && i < book.text.length - 1) closedEarly = true; if(depth < minDepth) minDepth = depth; }
}
ck('braces balance', depth === 0, 'depth=' + depth);
ck('nothing escapes the outermost group', !closedEarly && minDepth === 0, `closedEarly=${closedEarly} min=${minDepth}`);

// RTF is a 7-bit format: everything else must be escaped
const highBytes = [...book.text].filter(c => c.charCodeAt(0) > 0x7F);
ck('the file is pure ASCII on the wire', highBytes.length === 0,
   highBytes.slice(0, 8).map(c => 'U+' + c.charCodeAt(0).toString(16)).join(' '));
ck('no raw private-use codepoint, escaped or not', !PUA_RE.test(rtfDecode(book.text)),
   [...rtfDecode(book.text)].filter(c => PUA_RE.test(c)).slice(0, 6).join(' '));

const plain = rtfDecode(book.text);
ck('the book title is in it', plain.includes('RTF Book'), plain.slice(0, 60));
ck('chapter titles are in it', plain.includes('Chapter 1') && plain.includes('The Second Gate'));
ck('scene titles are in it', plain.includes('First Light') && plain.includes('Second Scene'));
ck('ordinary prose survives', plain.includes('bullet') && plain.includes('quote line'));
ck('the ⁂ separator decodes back to an asterism', plain.includes('⁂'), JSON.stringify(plain.match(/⁂/g) || []));
ck('markdown specials are literal, not escaped for markdown',
   plain.includes('*stars*') && plain.includes('_unders_') && !plain.includes('\\*stars'),
   JSON.stringify(plain.split('\n').filter(l => l.includes('stars')).slice(0, 2)));

// the translated span, which is the whole reason this format is hard
ck('a translated span rides as italic romanization',
   /\\i [^\\]*[a-z]/.test(book.text), (book.text.match(/\\i [^\\]{0,40}/) || [''])[0]);
ck('and the English is recoverable beside it (gloss on by default)',
   /\[[^\]]+\]/.test(plain), JSON.stringify((plain.match(/\[[^\]]{0,50}\]/g) || []).slice(0, 3)));

// single scene, from the editor
await page.locator('#bk-list .row[data-scene]').first().click();
await wait(page, 500);
await page.click('#ed-share');
await wait(page, 450);
const scene = await downloadFromSheet(page, 'Download rich text (.rtf)');
console.log('scene file:', scene.name);
ck('a single scene exports too', /^\{\\rtf1/.test(scene.text) && scene.text.trim().endsWith('}'), scene.name);
ck('the scene file is ASCII too', ![...scene.text].some(c => c.charCodeAt(0) > 0x7F));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('RTF EXPORT', checks.every(c => c[1]) && errors.length === 0);
console.log('failed checks:', checks.filter(c => !c[1]).map(c => c[0]).join(' ; ') || 'none');
await browser.close();
await srv.close();
