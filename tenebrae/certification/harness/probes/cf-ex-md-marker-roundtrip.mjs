// TX-11b — "Our own Markdown round-trips exactly."
//
// No probe in the suite exercises the tenebrae:doc / tenebrae:scene marker
// scheme at all (grep for 'tenebrae:doc' across probes/ returns nothing), so
// this is the gap. It builds a book whose scene structure is genuinely
// ambiguous in markdown — a scene title AND an in-scene H2 both compile to
// '###', plus an in-scene ⁂ break that looks exactly like the between-scene
// separator — exports .md, feeds the exact bytes back through the real
// importer, commits, and compares the resulting state.books entry against the
// original: chapter titles, scene titles, scene count, scene prose.
//
// Two configurations, because the markers are only emitted for scene titles
// when 'Include scene titles' is on (defaultExportOpts sceneTitles:false,
// step1.html L976):
//   A. sceneTitles ON  — markers present, structure must be exact.
//   B. sceneTitles OFF — the default. Scene titles cannot survive (they are
//      not written), but the chapter/scene COUNT must still be right.
//
// Run: cd probes && node cf-ex-md-marker-roundtrip.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { launch, wait, createBook, caretIn, downloadFromSheet, verdict } from './ex-lib.mjs';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfmd';
await mkdir(OUT, { recursive: true });
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra)); return ok; };

const { srv, browser, page, errors } = await launch();

// the app runs inside an IIFE, so `state` is not reachable from page.evaluate;
// read the persisted copy straight out of its IndexedDB kv store instead
const snap = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('tenebrae-writer', 1);
  req.onsuccess = () => {
    const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    r.onsuccess = () => {
      const st = r.result;
      resolve(!st ? [] : st.books.map(b => ({
        title: b.title,
        chapters: b.chapters.map(c => ({
          title: c.title,
          scenes: c.scenes.map(s => ({ title: s.title, doc: s.doc }))
        }))
      })));
    };
    r.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));

// text of a scene doc, block-separated, for structural comparison
const norm = doc => String(doc || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* ---------- build the book ---------- */
await createBook(page, 'Marker Book');
await page.click('#ed-title');
await page.keyboard.type('First Light');
await page.click('#ed-content');
await page.keyboard.type('opening prose line');
await page.keyboard.press('Enter');
await page.keyboard.type('midpoint heading');       // becomes an in-scene H2 -> '###'
await page.keyboard.press('Enter');
await page.keyboard.type('closing prose line');
await wait(page, 300);
await page.click('#fb-aa');
await wait(page, 250);
await caretIn(page, 'midpoint');
await page.click('#aa-panel [data-block="h2"]');
await wait(page, 400);
// an in-scene ⁂ break at the end of the scene, then more prose
await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let n, hit = null;
  while((n = w.nextNode())) if(n.nodeValue.includes('closing prose line')) hit = n;
  if(hit){ const r = document.createRange(); r.setStart(hit, hit.nodeValue.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
});
await page.keyboard.press('Enter');
await page.click('#fb-break');
await wait(page, 300);
await page.keyboard.type('after the break line');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// scene 2 in chapter 1
await page.locator('.chapter-block').first().locator('.add').click();
await wait(page, 600);
await page.click('#ed-title');
await page.keyboard.type('Second Sight');
await page.click('#ed-content');
await page.keyboard.type('beta two words');
await wait(page, 1500);
await page.click('#ed-back');
await wait(page, 500);

// chapter 2 + one scene
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
await page.keyboard.type('Third Watch');
await page.click('#ed-content');
await page.keyboard.type('gamma three words');
await wait(page, 1600);
await page.click('#ed-back');
await wait(page, 600);

const before = (await snap())[0];
console.log('ORIGINAL:', JSON.stringify(before, null, 1));

/* ---------- A. sceneTitles ON ---------- */
await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click();
await wait(page, 450);
const mdOn = await downloadFromSheet(page, 'Download Markdown (.md)');
await page.keyboard.press('Escape').catch(()=>{});
await wait(page, 300);
console.log('--- book.md (sceneTitles ON) ---\n' + mdOn.text + '\n--------------------------------');
await writeFile(OUT + '/marker-on.md', mdOn.text);

ck('doc marker is the first line', mdOn.text.split('\n')[0] === '<!--tenebrae:doc-->');
const sceneMarks = (mdOn.text.match(/<!--tenebrae:scene-->/g) || []).length;
ck('one scene marker per scene title (3)', sceneMarks === 3, 'got ' + sceneMarks);
ck('scene markers immediately precede their ###',
   /<!--tenebrae:scene-->\n### First Light\n/.test(mdOn.text) &&
   /<!--tenebrae:scene-->\n### Second Sight\n/.test(mdOn.text) &&
   /<!--tenebrae:scene-->\n### Third Watch\n/.test(mdOn.text));
ck('the in-scene H2 is an UNMARKED ###',
   /(^|\n)### midpoint heading\n/.test(mdOn.text) &&
   !/<!--tenebrae:scene-->\n### midpoint heading/.test(mdOn.text));

/* re-import the exact bytes */
async function reimport(file){
  await page.click('#bk-back').catch(()=>{});
  await wait(page, 500);
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
  await wait(page, 2000);
  return { stats, tree };
}

await reimport(OUT + '/marker-on.md');
let books = await snap();
const afterOn = books[books.length - 1];
console.log('ROUNDTRIP A:', JSON.stringify(afterOn, null, 1));

ck('A: book title round-trips', afterOn.title === before.title, JSON.stringify(afterOn.title));
ck('A: chapter count round-trips', afterOn.chapters.length === before.chapters.length,
   `${afterOn.chapters.length} vs ${before.chapters.length}`);
ck('A: chapter titles round-trip',
   JSON.stringify(afterOn.chapters.map(c => c.title)) === JSON.stringify(before.chapters.map(c => c.title)),
   JSON.stringify(afterOn.chapters.map(c => c.title)));
ck('A: scene counts round-trip',
   JSON.stringify(afterOn.chapters.map(c => c.scenes.length)) === JSON.stringify(before.chapters.map(c => c.scenes.length)),
   JSON.stringify(afterOn.chapters.map(c => c.scenes.length)));
ck('A: scene titles round-trip',
   JSON.stringify(afterOn.chapters.map(c => c.scenes.map(s => s.title))) ===
   JSON.stringify(before.chapters.map(c => c.scenes.map(s => s.title))),
   JSON.stringify(afterOn.chapters.map(c => c.scenes.map(s => s.title))));
ck('A: scene prose round-trips',
   JSON.stringify(afterOn.chapters.map(c => c.scenes.map(s => norm(s.doc)))) ===
   JSON.stringify(before.chapters.map(c => c.scenes.map(s => norm(s.doc)))),
   JSON.stringify(afterOn.chapters.map(c => c.scenes.map(s => norm(s.doc)))));
ck('A: the in-scene H2 stays an <h2> inside its scene, not a scene title',
   /<h2>midpoint heading<\/h2>/.test(afterOn.chapters[0].scenes[0].doc || ''));
ck('A: the in-scene ⁂ stays an asterism inside its scene',
   /asterism/.test(afterOn.chapters[0].scenes[0].doc || ''));

/* ---------- B. sceneTitles OFF (the default) ---------- */
async function openBook(title){
  // wherever we are, get to the library, then open the named book
  for(const sel of ['#imp-cancel', '#ed-back', '#bk-back']){
    if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
  }
  for(const sel of ['#ed-back', '#bk-back']){
    if(await page.locator(sel).isVisible().catch(()=>false)){ await page.click(sel); await wait(page, 500); }
  }
  await page.locator('#lib-list button.row', { hasText: title }).first().click();
  await wait(page, 800);
}

await openBook('Marker Book');
await page.click('#bk-share');
await wait(page, 450);
await page.locator('#sheet .sh-item', { hasText: 'Include scene titles' }).click(); // back OFF
await wait(page, 450);
const mdOff = await downloadFromSheet(page, 'Download Markdown (.md)');
console.log('--- book.md (sceneTitles OFF, the default) ---\n' + mdOff.text + '\n----------------------------------------------');
await writeFile(OUT + '/marker-off.md', mdOff.text);
ck('B: doc marker still stamped with scene titles off', mdOff.text.split('\n')[0] === '<!--tenebrae:doc-->');
ck('B: no scene markers when scene titles are off', !mdOff.text.includes('<!--tenebrae:scene-->'));

await reimport(OUT + '/marker-off.md');
books = await snap();
const afterOff = books[books.length - 1];
console.log('ROUNDTRIP B:', JSON.stringify(afterOff, null, 1));
ck('B: chapter titles round-trip',
   JSON.stringify(afterOff.chapters.map(c => c.title)) === JSON.stringify(before.chapters.map(c => c.title)),
   JSON.stringify(afterOff.chapters.map(c => c.title)));
ck('B: scene COUNTS round-trip (⁂ is the only scene boundary left)',
   JSON.stringify(afterOff.chapters.map(c => c.scenes.length)) === JSON.stringify(before.chapters.map(c => c.scenes.length)),
   JSON.stringify(afterOff.chapters.map(c => c.scenes.length)));
ck('B: no prose lost',
   afterOff.chapters.map(c => c.scenes.map(s => norm(s.doc)).join(' ')).join(' ').includes('after the break line'));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11b md marker round-trip', checks.every(c => c[1]) && errors.length === 0);
console.log('FAILED CHECKS:', checks.filter(c => !c[1]).map(c => c[0]));

await browser.close();
await srv.close();
