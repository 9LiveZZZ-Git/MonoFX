// VISUAL PARITY: the writer's rendered span vs the codex's own typeset SVG for
// the same romanization, side by side. The numbers can lie; the picture cannot.
// Run: cd probes && node s2-visual-parity.mjs
import { launch, wait } from './ex-lib.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vis';
await mkdir(OUT, { recursive: true });
const PHRASE = 'The sea remembers the old king';

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 1100, height: 700 });
await wait(page, 3500);

const ids = await page.evaluate(async () => {
  const w = await window.tenebrae.engine();
  return Object.keys(w.CODEX.TRANS).filter(id => {
    const sc = w.CODEX.TRANS[id].L && w.CODEX.TRANS[id].L.script;
    return sc && (sc.glyphs || []).length;
  });
});

for(const id of ids){
  const info = await page.evaluate(async ({ id, phrase }) => {
    document.querySelectorAll('.vis-host').forEach(n => n.remove());
    const w = await window.tenebrae.engine();
    const C = w.CODEX, T = C.TRANS[id], sc = T.L.script;
    const flow = C.scriptDir(sc);
    const r = await window.tenebrae.translate2(id, phrase);
    const scr = window.tenebrae._forge.textForToks(id, r.toks);

    const host = document.createElement('div');
    host.className = 'vis-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#111;padding:14px;display:flex;gap:34px;align-items:flex-start;overflow:hidden;font-family:system-ui';
    const label = t => `<div style="font:600 12px system-ui;margin-bottom:8px;letter-spacing:.08em">${t}</div>`;
    const a = document.createElement('div');
    a.innerHTML = label('CODEX — its own typesetter') + C.transcribeScriptSVG(r.romanization, sc, C.makeMatcher(sc), 30, '#111', null);
    const b = document.createElement('div');
    b.innerHTML = label('WRITER — forged font, real DOM');
    const holder = document.createElement('div');
    holder.style.cssText = 'font-size:30px;line-height:1';
    const sp = document.createElement('span');
    sp.className = 'tspan';
    sp.dataset.omni = '1'; sp.dataset.lang = id; sp.dataset.rom = r.romanization; sp.dataset.scr = scr;
    if(flow !== 'ltr' && flow !== 'rtl') sp.dataset.flow = flow;
    if(r.dir === 'rtl') sp.setAttribute('dir', 'rtl');
    sp.textContent = scr;
    holder.appendChild(sp); b.appendChild(holder);
    host.appendChild(a); host.appendChild(b);
    document.body.appendChild(host);
    await document.fonts.ready;
    const cs = getComputedStyle(sp), bb = sp.getBoundingClientRect();
    return { id, name: T.L.name || id, flow, rom: r.romanization,
      chars: scr.length, font: cs.fontFamily, wm: cs.writingMode,
      box: `${bb.width.toFixed(0)}x${bb.height.toFixed(0)}` };
  }, { id, phrase: PHRASE });
  await wait(page, 350);
  await page.locator('.vis-host').screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${info.name.padEnd(14)} ${info.flow.padEnd(10)} chars=${String(info.chars).padEnd(4)} box=${info.box.padEnd(10)} font=${info.font.slice(0, 28)}`);
}
await page.evaluate(() => document.querySelectorAll('.vis-host').forEach(n => n.remove()));
console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
await srv.close();
