// TX-11b (clean half + foreign half) and TX-11 (source recoverable).
//
// cf-ex-md-marker-roundtrip.mjs shows the marker scheme breaking on an in-scene
// ⁂. This probe isolates the rest of the contract:
//   C. a book with NO in-scene ⁂ — scene titles on, an in-scene H2/H3,
//      blockquote, list, marks and a translation span — must round-trip
//      EXACTLY through our own .md, and the span must come back live with its
//      English source intact (TX-11 "keeps the English source recoverable").
//   D. FOREIGN markdown carries no markers and must keep the heading-level
//      heuristic (## = chapter, ### = scene).
//   E. HOSTILE foreign markdown that happens to contain our marker text:
//      a bare <!--tenebrae:doc--> line, a forged tenebrae:begin whose "source"
//      is an HTML injection, one with malformed JSON, and one naming a tongue
//      that does not exist. Nothing may execute, nothing may throw, and the
//      file must still import as readable prose.
//
// Run: cd probes && node cf-ex-md-clean-foreign.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, caretIn, insertTranslationSpan, downloadFromSheet, verdict, PUA_RE } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfmd2';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra)); return ok; };

const { srv, browser, page, errors } = await launch();

const snap = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('tenebrae-writer', 1);
  req.onsuccess = () => {
    const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    r.onsuccess = () => {
      const st = r.result;
      resolve(!st ? [] : st.books.map(b => ({
        title: b.title,
        chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc })) }))
      })));
    };
    r.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));

async function reimport(file){
  for(const sel of ['#imp-cancel', '#ed-back', '#bk-back']){
    if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
  }
  for(const sel of ['#ed-back', '#bk-back']){
    if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
  }
  await page.click('#lib-more');
  await wait(page, 450);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }),
    page.locator('#sheet button', { hasText: 'Import manuscript' }).click(),
  ]);
  await chooser.setFiles(file);
  await page.waitForSelector('#imp-go', { timeout: 15000 });
  await wait(page, 500);
  const stats = await page.locator('.imp-stats').innerText();
  const tree = (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | ');
  console.log('preview stats:', JSON.stringify(stats));
  console.log('preview tree :', JSON.stringify(tree));
  await page.click('#imp-go');
  await wait(page, 2200);
  return { stats, tree };
}

/* =============== C. clean book, no in-scene ⁂ =============== */
await createBook(page, 'Clean Book');
await page.click('#ed-title');
await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('opening prose line');
await page.keyboard.press('Enter');
await page.keyboard.type('midpoint heading');
await page.keyboard.press('Enter');
await page.keyboard.type('sub heading');
await page.keyboard.press('Enter');
await page.keyboard.type('quoted line');
await page.keyboard.press('Enter');
await page.keyboard.type('bullet item');
await page.keyboard.press('Enter');
await page.keyboard.type('the sea remembers tonight');
await wait(page, 400);
await page.click('#fb-aa');
await wait(page, 250);
await caretIn(page, 'midpoint');
await page.click('#aa-panel [data-block="h2"]');
await wait(page, 250);
await caretIn(page, 'sub heading');
await page.click('#aa-panel [data-block="h3"]');
await wait(page, 250);
await caretIn(page, 'quoted');
await page.click('#aa-panel [data-block="blockquote"]');
await wait(page, 250);
await caretIn(page, 'bullet');
await page.click('[data-cmd="insertUnorderedList"]');
await wait(page, 350);
await insertTranslationSpan(page, 'sea remembers', 'Celan Basic');
await wait(page, 1600);
await page.click('#ed-back');
await wait(page, 600);

await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Second Sight');
await page.click('#ed-content');
await page.keyboard.type('beta two words');
await wait(page, 1700);
await page.click('#ed-back');
await wait(page, 700);

const before = (await snap())[0];
console.log('ORIGINAL:', JSON.stringify(before, null, 1));

await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 500);
const md = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- clean.md ---\n' + md.text + '\n----------------');
await writeFile(OUT + '/clean.md', md.text);
ck('C: md carries no raw PUA', !PUA_RE.test(md.text));

await reimport(OUT + '/clean.md');
let books = await snap();
const after = books[books.length - 1];
console.log('ROUNDTRIP C:', JSON.stringify(after, null, 1));

const shape = b => JSON.stringify(b.chapters.map(c => ({ t: c.title, s: c.scenes.map(s => s.title) })));
ck('C: chapter/scene shape round-trips exactly', shape(after) === shape(before), shape(after));
const s0 = (after.chapters[0] && after.chapters[0].scenes[0] && after.chapters[0].scenes[0].doc) || '';
ck('C: in-scene H2 stays in-scene', /<h2>midpoint heading<\/h2>/.test(s0));
ck('C: in-scene H3 stays in-scene', /<h3>sub heading<\/h3>/.test(s0));
ck('C: blockquote survives', /<blockquote>/.test(s0));
ck('C: list survives', /<ul><li>bullet item<\/li><\/ul>/.test(s0));
ck('C: span comes back live with its English source (TX-11)',
   /class="tspan"/.test(s0) && /data-src="sea remembers"/.test(s0), s0.slice(0, 400));

/* =============== D. foreign markdown, no markers =============== */
const foreign = `# Foreign Manuscript

## Chapter A

### Scene One

alpha prose here.

### Scene Two

beta prose here.

## Chapter B

### Scene Three

gamma prose here.
`;
await writeFile(OUT + '/foreign.md', foreign);
const dPrev = await reimport(OUT + '/foreign.md');
books = await snap();
const fb = books[books.length - 1];
console.log('FOREIGN:', JSON.stringify(fb.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))));
ck('D: foreign md keeps the heading heuristic (## chapter / ### scene)',
   JSON.stringify(fb.chapters.map(c => ({ t: c.title, s: c.scenes.map(x => x.title) }))) ===
   JSON.stringify([{ t: 'Chapter A', s: ['Scene One', 'Scene Two'] }, { t: 'Chapter B', s: ['Scene Three'] }]));
ck('D: foreign md title detected', fb.title === 'Foreign Manuscript', fb.title);

/* =============== E. hostile foreign markdown wearing our markers ========== */
const hostile = [
  '<!--tenebrae:doc-->',
  '# Hostile Import',
  '',
  '## Chapter Zero',
  '',
  '<!--tenebrae:scene-->',
  '### A Marked Heading',
  '',
  'an injected source: <!--tenebrae:begin {"language":"kerrackian","source":"<img src=x onerror=\\"window.__pwned=1\\">"}-->romz<!--tenebrae:end--> tail.',
  '',
  'malformed json: <!--tenebrae:begin {not json at all}-->romy<!--tenebrae:end--> tail.',
  '',
  'unknown tongue: <!--tenebrae:begin {"language":"no_such_tongue","source":"ghost words"}-->romx<!--tenebrae:end--> tail.',
  '',
  'script attempt: <!--tenebrae:begin {"language":"kerrackian","source":"</span><script>window.__pwned2=1<\\/script>"}-->romw<!--tenebrae:end--> tail.',
  ''
].join('\n');
await writeFile(OUT + '/hostile.md', hostile);
await reimport(OUT + '/hostile.md');
books = await snap();
const hb = books[books.length - 1];
const hdoc = hb.chapters.map(c => c.scenes.map(s => s.doc).join('')).join('');
console.log('HOSTILE doc:', hdoc);
ck('E: hostile file imports without a page exception', errors.length === 0, JSON.stringify(errors));
const pwned = await page.evaluate(() => ({ a: !!window.__pwned, b: !!window.__pwned2 }));
ck('E: no injected handler ran', !pwned.a && !pwned.b, JSON.stringify(pwned));
ck('E: no live <img> or <script> element made it into the doc',
   !/<img/i.test(hdoc) && !/<script/i.test(hdoc));
ck('E: the injection text is escaped, not markup', /&lt;img/.test(hdoc) || !/x onerror/.test(hdoc), hdoc.slice(0, 300));
ck('E: malformed-json marker leaves readable text behind', /romy|malformed json/.test(hdoc));
ck('E: unknown tongue does not vanish the paragraph', /unknown tongue/.test(hdoc));
ck('E: prose around the markers survives', /tail\./.test(hdoc));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11b clean/foreign/hostile', checks.every(c => c[1]) && errors.length === 0);
console.log('FAILED CHECKS:', checks.filter(c => !c[1]).map(c => c[0]));

await browser.close();
await srv.close();
