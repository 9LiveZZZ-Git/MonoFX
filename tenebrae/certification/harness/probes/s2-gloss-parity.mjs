// GLOSS PARITY — the writer's live text span against the codex's own gloss
// render (transcribeScriptHTML), which is the view the author reads the script
// from. Same phrase, same size, stacked: codex on top, writer below.
// Run: cd probes && node s2-gloss-parity.mjs
import { launch, wait } from './ex-lib.mjs';
import { mkdir } from 'node:fs/promises';

const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vis';
await mkdir(OUT, { recursive: true });
const PHRASE = process.argv[2] || 'The sea remembers the old king';

const { srv, browser, page, errors } = await launch();
await page.setViewportSize({ width: 1200, height: 900 });
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
    document.querySelectorAll('.gp-host').forEach(n => n.remove());
    const w = await window.tenebrae.engine();
    const C = w.CODEX, T = C.TRANS[id], sc = T.L.script;
    const r = await window.tenebrae.translate2(id, phrase);
    const scr = window.tenebrae._forge.textForToks(id, r.toks);
    const flow = C.scriptDir(sc);

    const host = document.createElement('div');
    host.className = 'gp-host';
    host.style.cssText = 'position:fixed;inset:0;background:#12100e;color:#e8e2d6;z-index:99999;padding:22px 26px;font:14px system-ui;overflow:auto';
    // the codex app feeds its script wing cleanText — compiled lines with the
    // untranslated parts filtered out — NOT the full romanization
    const comp = C.compileText(C.TRANS[id], phrase, 'e2l');
    const cleanText = comp.lines
      ? comp.lines.map(l => l.filter(p2 => !p2.u).map(p2 => p2.t).join(' ')).join(' ')
      : (comp.parts || []).filter(p2 => !p2.drop && !p2.unknown).map(p2 => p2.out).join(' ');
    const codexHTML = C.transcribeScriptHTML(cleanText, sc, C.makeMatcher(sc), 34, '#e8c07a');
    host.innerHTML =
      `<style>.runeword{display:inline-block;margin:0 6px;text-align:center}.wlabel{font:11px system-ui;opacity:.55;margin-top:3px}</style>
       <div style="opacity:.6;letter-spacing:.08em;font-size:11px">CODEX GLOSS — ${T.L.name} [${flow}]</div>
       <div style="margin:8px 0 26px">${codexHTML}</div>
       <div style="opacity:.6;letter-spacing:.08em;font-size:11px">WRITER SPAN — same romanization, live text</div>
       <div style="margin:8px 0 0;font-size:34px"><span class="tspan" data-omni="1" data-lang="${id}"${flow !== 'ltr' ? ` data-flow="${flow}"` : ''}${r.dir === 'rtl' ? ' dir="rtl"' : ''}></span></div>
       <div style="opacity:.55;margin-top:22px">${r.romanization}</div>
       <div style="opacity:.4;margin-top:4px;font-size:12px">written: ${cleanText}</div>`;
    host.querySelector('.tspan').textContent = scr;
    document.body.appendChild(host);
    await document.fonts.ready;
    return { name: T.L.name, flow, rom: r.romanization, clean: cleanText };
  }, { id, phrase: PHRASE });

  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/gloss-${id}.png` });
  console.log(`${info.name.padEnd(16)} [${info.flow}] -> gloss-${id}.png   ${info.rom}` + (info.clean !== info.rom ? `\n${' '.repeat(18)}written: ${info.clean}` : ''));
}

console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
await srv.close();
