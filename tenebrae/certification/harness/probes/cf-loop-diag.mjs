import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';
const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport:{width:390,height:844} })).newPage();
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(4000);
const out = await page.evaluate(async () => {
  const { langs } = await window.tenebrae.langs();
  const probes = ['zzqxwv frobnak','frobnak zzqxwv','the sea remembers','xyzzy plugh','  the drover walks  '];
  const rows = [];
  for(const l of langs){
    const r = {};
    for(const p of probes){
      const t = await window.tenebrae.translate2(l.id, p);
      r[p] = t ? { rom: t.romanization, script: (t.script||'').slice(0,20), flow: t.flow, keys: Object.keys(t).join(',') } : null;
    }
    rows.push({ id:l.id, name:l.name, dir:l.dir, r });
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); await srv.close();
