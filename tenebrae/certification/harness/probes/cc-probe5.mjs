import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext()).newPage();
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(2500);

const LONG = 'the old king waits beneath the drowned tower while the winter sea remembers every name the charter never wrote down';
const OTHER = [
  'the old keeper of the fallen tower walked the long cold road under a silent moon while the sea remembered every oath the drowned king ever swore and the wind carried the names of the dead across the salt water toward the harbor gate where the warden waited with a lamp and a ledger and no word of comfort for anyone who came asking after the morning',
  'The sea remembers the old king', 'the third sun rose red', 'gold light on black water',
];
const r = await page.evaluate(async ({ phrases }) => {
  const w = await window.tenebrae.engine();
  const ids = Object.keys(w.CODEX.TRANS);
  const out = [];
  for (const p of phrases) for (const id of ids) {
    const t = await window.tenebrae.translate2(id, p);
    for (const k of (t.toks || [])) if (!k.sep && k.t && /\s/.test(k.t)) out.push({ id, phrase: p.slice(0, 40), token: k.t });
  }
  // also: unknown-flagged tokens still written into the script?
  const unk = [];
  for (const id of ids) {
    const t = await window.tenebrae.translate2(id, 'the zorblax remembers');
    const scr = window.tenebrae._forge.textForToks(id, t.toks || []);
    unk.push({ id, toks: (t.toks || []).map(k => k.sep ? '|' : k.t + (k.u ? '·?' : '')), runs: String(scr || '').split(/[\n ]+/).filter(Boolean).length });
  }
  return { fused: out, unk };
}, { phrases: [LONG, ...OTHER] });
console.log('FUSED tokens found for tx-layout-geometry LONG + others:');
console.log(JSON.stringify(r.fused, null, 1));
console.log('UNKNOWN-token script runs:');
console.log(JSON.stringify(r.unk, null, 1));
await browser.close(); await srv.close();
