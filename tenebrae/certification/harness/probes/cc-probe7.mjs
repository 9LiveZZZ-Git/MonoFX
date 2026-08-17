// COVERAGE-CRITIC probe 7: real-UI span for a codex tongue outside FORGE_BASES.
import { launch, wait, createBook, insertTranslationSpan } from './ex-lib.mjs';

const FAKE = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/fake-codex.html';
const { srv, browser, page, errors } = await launch();
await wait(page, 3000);
await page.setInputFiles('#codex-input', FAKE);
await wait(page, 3000);

await createBook(page, 'Roster Book');
await page.click('#ed-content');
await page.keyboard.type('the old sea remembers the king');
await wait(page, 500);
await insertTranslationSpan(page, 'the old sea remembers the king', 'Ninth Tongue');
const info = await page.evaluate(() => {
  const s = document.querySelector('#ed-content .tspan');
  if (!s) return { err: 'no span' };
  const cs = getComputedStyle(s);
  return {
    text: s.textContent,
    codepoints: [...s.textContent].slice(0, 12).map(c => c.codePointAt(0).toString(16)),
    lang: s.dataset.lang, src: s.dataset.src, rom: s.dataset.rom, scr: s.dataset.scr ?? null,
    flow: s.dataset.flow ?? null, dir: s.getAttribute('dir'),
    fontFamily: cs.fontFamily, fontStyle: cs.fontStyle,
    isLatin: /^[\x20-\x7E]+$/.test(s.textContent),
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('pageerrors', errors);
await browser.close(); await srv.close();
