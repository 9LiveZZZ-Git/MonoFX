// DIAGNOSTIC (no VERDICT): compare window.tenebrae.translate (legacy sample seam)
// against translate2 (real engine) for every tongue tonguesList() reports.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:390,height:844} });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(4000);
const S = "The sea remembers the stone bridge.";
const out = await page.evaluate(async (s) => {
  const { langs } = await window.tenebrae.langs();
  const rows = [];
  for(const l of langs){
    const a = await window.tenebrae.translate(l.id, s);
    const b = await window.tenebrae.translate2(l.id, s);
    rows.push({ id:l.id, name:l.name, dir:l.dir, script:l.script,
      legacy:a.romanization, real:b.romanization,
      realKeys:Object.keys(b), flow:b.flow, hasRendered: !!b.rendered });
  }
  return rows;
}, S);
console.log(JSON.stringify(out, null, 1));
await browser.close(); await srv.close();
