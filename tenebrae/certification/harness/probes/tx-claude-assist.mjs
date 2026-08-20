// v1.5 — Claude assist (BYOK).
//
// The app is offline by design; this is the one feature that is not. So the bar
// is: it must not exist until the author opts in, it must never send the
// Tenebrae, it must never let a fabricated claim through, and the key must
// never leave the device in a backup.
//
// The network call itself cannot be exercised without a real API key, so fetch
// is stubbed and everything around it is tested for real: the request shape
// against the documented API, what the payload contains, both guardrails, and
// the error paths.
// Run: cd probes && node tx-claude-assist.mjs
import { launch, wait, createBook, insertTranslationSpan, verdict } from './ex-lib.mjs';
import { readFile } from 'node:fs/promises';

const checks = [];
const ck = (l, ok, x) => { checks.push(ok); console.log((ok ? 'ok   ' : 'FAIL '), l, x === undefined ? '' : String(x).slice(0, 200)); };

const { srv, browser, page, errors } = await launch();
const requests = [];
page.on('request', r => { if(/anthropic/.test(r.url())) requests.push(r.url()); });
await wait(page, 3500);

/* ---------- 1. off until asked ---------- */
const cold = await page.evaluate(() => ({ ready: window.tenebrae._claude.ready(), model: window.tenebrae._claude.model() }));
ck('off at boot: no key, nothing enabled', cold.ready === false, JSON.stringify(cold));
ck('the default model is Opus 5', cold.model === 'claude-opus-5', cold.model);
ck('no request to Anthropic was made at boot', requests.length === 0, requests.join(','));

/* ---------- 2. what the model is allowed to see ---------- */
await createBook(page, 'Assist Book');
await page.click('#ed-content');
await page.keyboard.type('The lamp holds steady over the water. She said the sea remembers the old king.');
await wait(page, 800);
await insertTranslationSpan(page, 'the sea remembers the old king', 'Celan High');
await wait(page, 900);
await page.evaluate(() => { const s = document.querySelector('#scrim'); if(s && s.classList.contains('show')) s.click(); });
await wait(page, 400);

const payload = await page.evaluate(() => {
  const doc = window.tenebrae._omni.probe.sceneDoc();
  const sent = window.tenebrae._claude.sceneText(doc);
  return { sent, docHasPUA: /[-]/.test(doc) };
});
console.log('   sent to the API:', JSON.stringify(payload.sent));
ck('the scene really does contain script (so the next check has teeth)', payload.docHasPUA);
ck('no script codepoint is ever sent', !/[-]/.test(payload.sent), JSON.stringify(payload.sent).slice(0, 120));
ck('a translated span is sent as the author\'s English', payload.sent.includes('the sea remembers the old king'), payload.sent);

/* ---------- 3. the request shape, against a stubbed endpoint ---------- */
const shape = await page.evaluate(async () => {
  const real = window.fetch;
  let seen = null;
  window.fetch = async (url, opts) => {
    seen = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({
      model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: JSON.stringify({ fixes: [] }) }] }) };
  };
  await window.tenebrae._claude.setKey('sk-ant-test-key');
  await window.tenebrae._claude.grammar('the lamp holds steady');
  window.fetch = real;
  return seen;
});
console.log('   headers:', JSON.stringify(shape.headers));
ck('posts to the documented endpoint', shape.url === 'https://api.anthropic.com/v1/messages' && shape.method === 'POST', shape.url);
ck('sends the API version header', shape.headers['anthropic-version'] === '2023-06-01');
ck('sends the author\'s key as x-api-key', shape.headers['x-api-key'] === 'sk-ant-test-key');
ck('opts into direct browser access explicitly', shape.headers['anthropic-dangerous-direct-browser-access'] === 'true');
ck('asks for constrained JSON, not prose',
   shape.body.output_config && shape.body.output_config.format && shape.body.output_config.format.type === 'json_schema',
   JSON.stringify(shape.body.output_config).slice(0, 120));
ck('the schema closes every object (required by the API)',
   shape.body.output_config.format.schema.additionalProperties === false
   && shape.body.output_config.format.schema.properties.fixes.items.additionalProperties === false);
ck('names a real model and a sane max_tokens',
   shape.body.model === 'claude-opus-5' && shape.body.max_tokens > 1000, `${shape.body.model} / ${shape.body.max_tokens}`);

/* ---------- 4. guardrails: nothing unverifiable gets through ---------- */
const stub = (payloadObj) => page.evaluate(async ({ obj, text, which }) => {
  const real = window.fetch;
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    model: 'claude-opus-5', stop_reason: 'end_turn', usage: {},
    content: [{ type: 'text', text: JSON.stringify(obj) }] }) });
  let out;
  try{ out = which === 'g' ? await window.tenebrae._claude.grammar(text)
                           : await window.tenebrae._claude.cards(text, []); }
  finally{ window.fetch = real; }
  return out;
}, payloadObj);

const SCENE = 'The lamp holds steady. The drover walks the long road home.';
const fixes = await stub({ obj: { fixes: [
  { before: 'The lamp holds steady', after: 'The lamp held steady', why: 'tense', kind: 'tense' },
  { before: 'a line that is not in the scene at all', after: 'x', why: 'invented', kind: 'grammar' },
  { before: 'The', after: 'A', why: 'ambiguous — occurs twice', kind: 'grammar' },
  { before: 'walks', after: 'walks', why: 'no change', kind: 'grammar' }
] }, text: SCENE, which: 'g' });
console.log('   fixes kept:', JSON.stringify(fixes.map(f => f.before)));
ck('a fix quoting text that is not in the scene is dropped', !fixes.some(f => /not in the scene/.test(f.before)));
ck('a fix whose anchor occurs twice is dropped (it could not be applied safely)', !fixes.some(f => f.before === 'The'));
ck('a no-op fix is dropped', !fixes.some(f => f.before === f.after));
ck('the one real fix survives', fixes.length === 1 && fixes[0].after === 'The lamp held steady', JSON.stringify(fixes));

const cards = await stub({ obj: { cards: [
  { title: 'The Drover', type: 'person', aliases: ['drover'], keywords: ['road'],
    quotes: ['The drover walks the long road home.', 'He wept for the lost city.'], notes: 'Walks a long road.' },
  { title: 'Nowhere', type: 'place', aliases: [], keywords: [], quotes: ['invented quote'], notes: '' }
] }, text: SCENE, which: 'c' });
console.log('   cards:', JSON.stringify(cards.map(c => ({ t: c.title, q: c.quotes }))));
ck('a verbatim quote is kept', cards[0] && cards[0].quotes.includes('The drover walks the long road home.'));
ck('a fabricated quote is dropped', cards.every(c => !c.quotes.some(q => /wept|invented/.test(q))), JSON.stringify(cards.map(c => c.quotes)));

/* ---------- 5. failure paths say something useful ---------- */
const errs = await page.evaluate(async () => {
  const real = window.fetch;
  const run = async (resp) => {
    window.fetch = async () => resp;
    try{ await window.tenebrae._claude.grammar('x'); return null; }
    catch(e){ return e.message; }
  };
  const out = {
    unauth: await run({ ok: false, status: 401, json: async () => ({ error: { message: 'x' } }) }),
    rate:   await run({ ok: false, status: 429, json: async () => ({ error: { message: 'x' } }) }),
    refuse: await run({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) }),
    junk:   await run({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }) }),
  };
  window.fetch = real;
  return out;
});
console.log('   errors:', JSON.stringify(errs));
ck('a rejected key says so plainly', /key was rejected/i.test(errs.unauth || ''), errs.unauth);
ck('a rate limit says so plainly', /rate limited/i.test(errs.rate || ''), errs.rate);
ck('a refusal is reported, not swallowed', /declined/i.test(errs.refuse || ''), errs.refuse);
ck('a malformed answer is reported, not parsed as truth', /expected shape/i.test(errs.junk || ''), errs.junk);

/* ---------- 6. the key never leaves the device ---------- */
// download a real backup and read the bytes: this is the file an author would
// hand to someone else, so the key must not be in it
await page.click('#ed-back'); await wait(page, 400);
await page.click('#bk-back'); await wait(page, 400);
await page.click('#lib-more'); await wait(page, 450);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.locator('#sheet .sh-item', { hasText: 'Back up everything (.json)' }).click(),
]);
const bpath = await dl.path();
const bjson = await readFile(bpath, 'utf8');
console.log('   backup bytes:', bjson.length);
ck('the key is not in a backup file the author might share',
   bjson.length > 100 && !bjson.includes('sk-ant'), bjson.includes('sk-ant') ? 'KEY FOUND IN BACKUP' : 'absent');
ck('the backup is still a real backup', /"app"\s*:\s*"tenebrae-writer"/.test(bjson));
await page.evaluate(() => { const s2 = document.querySelector('#scrim'); if(s2 && s2.classList.contains('show')) s2.click(); });
await wait(page, 300);

ck('still no unstubbed request reached Anthropic', requests.length === 0, requests.join(','));
ck('no page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
verdict('v1.5 CLAUDE ASSIST', checks.every(Boolean));
await browser.close();
await srv.close();
