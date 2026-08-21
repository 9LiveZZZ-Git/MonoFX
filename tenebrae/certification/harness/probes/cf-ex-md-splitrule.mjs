// TX-11b (adversarial follow-up) — cf-ex-md-marker-roundtrip.mjs showed our own
// .md re-importing with an extra scene wherever the author put an in-scene ⁂.
// Before calling that a defect, exhaust the author's escape hatches: the import
// preview offers a "Split scenes at" segmented control (#imp-seg, step1.html
// L5941-5946). This probe imports the SAME exported file once per available
// mode and records the detected shape for each, so the claim "no setting
// reproduces the original structure" is measured, not assumed.
//
// Input is the file cf-ex-md-marker-roundtrip.mjs already wrote; it is
// regenerated here if absent so the probe stands alone.
//
// Run: cd probes && node cf-ex-md-splitrule.mjs
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { launch, wait, verdict } from './ex-lib.mjs';

const SRC = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfmd/marker-on.md';
const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/cfsplit';
await mkdir(OUT, { recursive: true });

// the exact bytes cf-ex-md-marker-roundtrip.mjs exported (2 chapters; chapter 1
// has 2 scenes, the first of which contains an in-scene H2 AND an in-scene ⁂)
const FALLBACK = `<!--tenebrae:doc-->
# Marker Book

## Chapter 1

<!--tenebrae:scene-->
### First Light

opening prose line

### midpoint heading

closing prose line

⁂

after the break line

⁂

<!--tenebrae:scene-->
### Second Sight

beta two words

## The Second Gate

<!--tenebrae:scene-->
### Third Watch

gamma three words`;
let md;
try{ await access(SRC); md = await readFile(SRC, 'utf8'); }
catch(e){ md = FALLBACK; }
const file = OUT + '/marker-on.md';
await writeFile(file, md);
console.log('input md:\n' + md + '\n-----');

// WANTED: chapter 1 = 2 scenes (First Light, Second Sight), chapter 2 = 1 scene
const WANT = JSON.stringify([{ t: 'Chapter 1', s: ['First Light', 'Second Sight'] },
                             { t: 'The Second Gate', s: ['Third Watch'] }]);

const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra)); return ok; };

const { srv, browser, page, errors } = await launch();

const snap = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('tenebrae-writer', 1);
  req.onsuccess = () => {
    const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('state');
    r.onsuccess = () => { const st = r.result; resolve(!st ? [] : st.books.map(b => ({
      title: b.title,
      chapters: b.chapters.map(c => ({ title: c.title, scenes: c.scenes.map(s => s.title) }))
    }))); };
    r.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));

async function openImport(){
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
}

await openImport();
const modes = await page.evaluate(() => {
  const seg = document.querySelector('#imp-seg');
  return seg ? [...seg.querySelectorAll('button')].map(b => ({ mode: b.dataset.mode, label: b.textContent.trim(), on: b.classList.contains('on') })) : [];
});
console.log('split-rule control offered:', JSON.stringify(modes));
ck('the import preview offers a split-rule control for our own md', modes.length > 0);

const results = {};
// default (whatever is preselected) first
{
  const stats = await page.locator('.imp-stats').innerText();
  const tree = (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | ');
  results['(default) ' + (modes.find(m => m.on) || {}).mode] = { stats, tree };
  await page.click('#imp-go');
  await wait(page, 2200);
  const b = (await snap()).pop();
  results['(default) ' + (modes.find(m => m.on) || {}).mode].shape = JSON.stringify(b.chapters.map(c => ({ t: c.title, s: c.scenes })));
}
for(const m of modes){
  await openImport();
  await page.locator(`#imp-seg button[data-mode="${m.mode}"]`).click();
  await wait(page, 700);
  const stats = await page.locator('.imp-stats').innerText();
  const tree = (await page.locator('.imp-tree').innerText()).replace(/\n+/g, ' | ');
  await page.click('#imp-go');
  await wait(page, 2200);
  const b = (await snap()).pop();
  results[m.mode] = { stats, tree, shape: JSON.stringify(b.chapters.map(c => ({ t: c.title, s: c.scenes }))) };
}

console.log('WANT:', WANT);
for(const [k, v] of Object.entries(results)){
  console.log(`mode ${k}: ${v.stats}  ->  ${v.shape}`);
}
const anyExact = Object.entries(results).filter(([k, v]) => v.shape === WANT).map(([k]) => k);
console.log('modes that reproduce the original exactly:', JSON.stringify(anyExact));
ck('at least one split rule reproduces the original chapter/scene structure exactly',
   anyExact.length > 0, JSON.stringify(anyExact));

console.log('pageerrors:', errors.length ? errors : 'none');
verdict('TX-11b split-rule escape hatch', checks.every(c => c[1]) && errors.length === 0);

await browser.close();
await srv.close();
