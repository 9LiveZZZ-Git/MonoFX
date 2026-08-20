// TX-2 follow-up — the ONE divergence tx-parity-corpus found, isolated and
// characterised, with its user-visible blast radius measured.
//
// Mechanism (step1.html L3068-3072, the Celan Basic branch of omniTranslate):
//     const clean = String(p.cel).replace(/[^\w…'’-]/g, '');
//     const at = clean ? String(p.cel).indexOf(clean) : 0;
//     return { t: clean, punct: clean ? String(p.cel).slice(at + clean.length) : String(p.cel), … };
// `at` assumes the cleaned string is a CONTIGUOUS substring of the codex word.
// When the codex emits a word with an INTERIOR stripped character — a space
// ("my" -> "na mé"), a dot ("1,234.56" -> "123456.56"), an equals/quote
// ("attr=\"v\"" -> "atrth=\"v\">") — indexOf returns -1, so `punct` is sliced
// from (len-1) and a fragment of the word is emitted twice.
// Romanization and gloss are built straight from p.cel and stay correct; only
// the TOKEN STREAM (which drives rune rendering) is corrupted.
//
// This probe: (1) proves the mechanism against the standalone codex, (2) sweeps
// a corpus for the frequency, (3) drives the REAL UI ("Preview a Phrase" in the
// Tenebrae Codex sheet) to show the corruption reaching rendered glyphs, and
// (4) bounds the damage: editor spans are NOT affected because Celan Basic has
// no forged font and falls back to rendering the (correct) romanization.
// Run: cd probes && node tx-celan-token-split.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
import { wait } from './ex-lib.mjs';

const PATCHED = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/tx-codex-patched.html';
const checks = [];
const ck = (label, ok, extra) => { checks.push([label, ok]); console.log((ok ? 'ok  ' : 'FAIL'), label, extra === undefined ? '' : extra); };

const CORPUS = [
  'The sea remembers', 'my mana let it stand as coa', 'the old king returns',
  'Declared: my mana - let it stand as coa.', 'Chapter 3: 1,234.56 units',
  '<tag attr="v"> & </tag>', 'she walks alone tonight', 'my name is my own',
  '42 tides, 7 storms', "don't stop my heart", 'my my my', 'the sea',
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---- 1. the codex's own Celan Basic words, standalone ----
const pageA = await browser.newPage();
pageA.on('pageerror', e => console.log('CODEX PAGE EXCEPTION:', e.message));
await pageA.goto('file://' + PATCHED);
await pageA.waitForFunction(() => typeof window.translateE2C === 'function', null, { timeout: 40000 });
const codexWordsRendered = await pageA.evaluate(inputs => inputs.map(s =>
  window.translateE2C(String(s)).filter(p => p.cel && !p.drop).map(p => String(p.cel))), CORPUS);
console.log('codex Celan words for "my mana let it stand as coa":', JSON.stringify(codexWordsRendered[1]));
ck('codex compiler emits at least one part containing an interior space', codexWordsRendered.some(ws => ws.some(w => /\S\s\S/.test(w))),
   JSON.stringify(codexWordsRendered.flat().filter(w => /\S\s\S/.test(w)).slice(0, 4)));

// ---- 2. the writer's token stream for the same inputs ----
const srv = await startServer();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(3500);

const writerToks = await page.evaluate(async inputs => {
  const out = [];
  for (const s of inputs) {
    const r = await window.tenebrae.translate2('celan_basic', s);
    out.push({ rom: r.romanization, toks: (r.toks || []).map(t => ({ t: t.t, p: t.punct || '' })) });
  }
  return out;
}, CORPUS);

let lossy = 0;
for (let i = 0; i < CORPUS.length; i++) {
  // transcribeScriptHTML/SVG split the romanization on whitespace before
  // drawing, so a compiler part holding "na mé" is TWO rendered words
  const want = codexWordsRendered[i].flatMap(x => String(x).split(/\s+/).filter(Boolean));
  const got = writerToks[i].toks.map(t => t.t + t.p);
  const same = JSON.stringify(want) === JSON.stringify(got);
  if (!same) { lossy++; console.log(`  DIVERGES ${JSON.stringify(CORPUS[i])}\n     codex words : ${JSON.stringify(want)}\n     writer toks : ${JSON.stringify(got)}`); }
  // romanization stays correct in every case
  if (writerToks[i].rom !== want.join(' ')) console.log(`  ROM ALSO WRONG ${JSON.stringify(CORPUS[i])}`);
}
console.log(`token divergence: ${lossy}/${CORPUS.length} inputs`);
ck('romanization is correct on every input (the defect is token-only)',
   CORPUS.every((_, i) => writerToks[i].rom === codexWordsRendered[i].join(' ')));
ck('Celan Basic token stream equals the codex word list on every input', lossy === 0, `${lossy}/${CORPUS.length} inputs corrupted`);

// ---- 3. does it reach the UI? "Preview a Phrase" renders from r.toks ----
await page.click('#lib-more');
await wait(page, 400);
await page.locator('#sheet .sh-item', { hasText: 'Tenebrae Codex' }).click();
await wait(page, 1200);
await page.locator('#sheet .sh-item', { hasText: 'Preview a phrase' }).click();
await wait(page, 600);
await page.fill('#ps-input', 'my mana let it stand');
await page.click('#ps-save');
await wait(page, 1500);
const preview = await page.evaluate(() => {
  const notes = [...document.querySelectorAll('#sheet .sheet-note')];
  const celan = notes.find(n => /Celan Basic/.test(n.textContent));
  if (!celan) return { missing: [...document.querySelectorAll('#sheet .sheet-note')].map(n => n.textContent.slice(0, 40)) };
  return { titles: [...celan.querySelectorAll('.tn-w')].map(w => w.getAttribute('title')),
           svgs: celan.querySelectorAll('.tn-w svg').length,
           rom: (celan.querySelector('.ts-rom') || {}).textContent || '' };
});
console.log('UI preview (Celan Basic):', JSON.stringify(preview));
const codexPreview = await pageA.evaluate(() =>
  window.translateE2C('my mana let it stand').filter(p => p.cel && !p.drop)
    .map(p => ({ cel: String(p.cel), unknown: !!p.unknown })));
const codexPreviewWords = codexPreview.map(p => p.cel);
// tokens the codex marks unknown are deliberately shown as Latin (.tn-unk), so
// the rune-rendered set is exactly the KNOWN codex words
// rendered units again: split each known part on whitespace, the way the
// codex's own transcribers do before drawing each word
const codexKnown = codexPreview.filter(p => !p.unknown)
  .flatMap(p => String(p.cel).split(/\s+/).filter(Boolean));
console.log('codex words for the same phrase:', JSON.stringify(codexPreviewWords), 'known:', JSON.stringify(codexKnown));
ck('rune-rendered words in the real UI match the codex\'s known words',
   !!preview && JSON.stringify(preview.titles) === JSON.stringify(codexKnown),
   `ui=${JSON.stringify(preview && preview.titles)} codex-known=${JSON.stringify(codexKnown)}`);
ck('the romanization shown beside it is still correct',
   !!preview && preview.rom.replace(/\s+/g, ' ').trim() === codexPreviewWords.join(' '), preview && preview.rom);

// ---- 4. blast radius: editor spans render from romanization, not toks ----
const spanScr = await page.evaluate(async () => {
  const r = await window.tenebrae.translate2('celan_basic', 'my mana let it stand');
  return { forged: !!(window.tenebrae._forge.map() || {}).celan_basic,
           fromToks: window.tenebrae._forge.textForToks('celan_basic', r.toks), rom: r.romanization };
});
console.log('celan_basic forge state:', JSON.stringify(spanScr));
// Celan Basic is forged now, as a word-script: one Auric rune per romanized
// word, carved by the codex's own composeWord
ck('Celan Basic is forged, one Auric rune per romanized word',
   spanScr.forged === true && typeof spanScr.fromToks === 'string' &&
   [...spanScr.fromToks].filter(c => c.charCodeAt(0) >= 0xE800).length ===
     spanScr.rom.split(/\s+/).filter(Boolean).length,
   JSON.stringify(spanScr));

ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('CELAN TOKEN SPLIT VERDICT:', checks.every(c => c[1]) ? 'PASS' : 'FAIL');
await browser.close();
await srv.close();
