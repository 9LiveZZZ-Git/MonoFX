// DIAGNOSTIC (no VERDICT): dump the real shape of window.tenebrae._forge.map()
// entries, to repair cc-probe1.mjs's __forgeMap projection.
import { launch, wait } from './ex-lib.mjs';
const { srv, browser, page } = await launch();
await wait(page, 4000);
const shape = await page.evaluate(async () => {
  await window.tenebrae.translate2('celan_basic', 'the sea remembers');
  await window.tenebrae.translate2('celan_high', 'the sea remembers');
  const m = window.tenebrae._forge.map() || {};
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = { keys: Object.keys(v), types: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Array.isArray(b) ? 'array[' + b.length + ']' : (b && typeof b === 'object' ? 'obj{' + Object.keys(b).length + '}' : typeof b + ':' + String(b).slice(0, 24))])) };
  }
  return out;
});
console.log(JSON.stringify(shape, null, 1));
await browser.close(); await srv.close();
