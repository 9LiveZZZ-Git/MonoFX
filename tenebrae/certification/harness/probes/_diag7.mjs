import { launch, wait, createBook } from './ex-lib.mjs';
const { srv, browser, page, errors } = await launch();
await createBook(page, 'MarkIn');
await wait(page, 3000);
const show = t => [...String(t)].map(c=>{const n=c.charCodeAt(0);
  return n===0xA0?'[NB]':n===0x20?'·':n===0x0A?'\\n':n===0xFEFF?'^':(n>=0xE000&&n<=0xF8FF)?'@':c;}).join('');
const out = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const M = String.fromCharCode(0xFEFF), NB = String.fromCharCode(0xA0);
  const RUN = String.fromCharCode(0xE597,0xE594,0xE589);
  const SPAN = '<span class="tspan" data-lang="x" data-src="y" contenteditable="false">' + RUN + '</span>';
  const res = [];
  const cases = {
    'p-start':  ['<p id="h">the sea remembers alpha bravo</p>', 0, 17],
    'p-end':    ['<p id="h">alpha bravo the sea remembers</p>', 12, 29],
    'h2-b-end': ['<h2>a <b id="h">the old king</b></h2><p>tail</p>', 0, 12],
    'li-all':   ['<ul><li id="h">the drover walks</li><li>second item</li></ul>', 0, 16],
  };
  for(const [name, [html, so, eo]] of Object.entries(cases)){
    for(const variant of ['plain', 'marked']){
      ed.innerHTML = html; ed.focus();
      const host = ed.querySelector('#h');
      const t = host.firstChild;
      const r = document.createRange(); r.setStart(t, so); r.setEnd(t, eo);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const frag = variant === 'marked' ? (M + SPAN + NB + M) : (SPAN + NB);
      document.execCommand('insertHTML', false, frag);
      const sp = ed.querySelector('.tspan');
      const chain = []; if(sp) for(let n = sp.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) chain.push(n.tagName);
      res.push([name + '/' + variant, sp ? chain.join('>') : 'DROPPED', ed.innerHTML]);
    }
  }
  ed.innerHTML = '';
  return res;
});
for(const [k, chain, html] of out) console.log(k.padEnd(20), chain.padEnd(12), show(html).replace(/data-(scr|src|lang)="[^"]*"/g,'').slice(0,150));
await browser.close(); await srv.close();
