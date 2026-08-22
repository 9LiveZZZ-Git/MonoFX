import { launch, wait, createBook } from './ex-lib.mjs';
const { srv, browser, page, errors } = await launch();
await createBook(page, 'BlockRep');
await wait(page, 3000);
const show = t => [...String(t)].map(c=>{const n=c.charCodeAt(0);
  return n===0xA0?'[NB]':n===0x20?'·':n===0x0A?'\\n':n===0xFEFF?'^':(n>=0xE000&&n<=0xF8FF)?'@':c;}).join('');
const out = await page.evaluate(() => {
  const ed = document.querySelector('#ed-content');
  const NB = String.fromCharCode(0xA0);
  const RUN = String.fromCharCode(0xE597,0xE594,0xE589);
  const SPAN = '<span class="tspan" data-lang="x" data-src="y" contenteditable="false">' + RUN + '</span>';
  const ser = rg => { const d = document.createElement('div'); d.appendChild(rg.cloneContents()); return d.innerHTML; };
  const res = [];
  const cases = {
    'p-start':  ['<p id="h">the sea remembers alpha bravo</p>', 'h', 0, 17, []],
    'p-mid':    ['<p id="h">alpha the sea remembers bravo</p>', 'h', 6, 23, []],
    'p-end':    ['<p id="h">alpha bravo the sea remembers</p>', 'h', 12, 29, []],
    'h2-b-end': ['<h2 id="k">a <b id="h">the old king</b></h2><p>tail</p>', 'h', 0, 12, ['B']],
    'bi-u':     ['<p id="k">and <b><i><u id="h">the sea remembers</u></i></b> now</p>', 'h', 0, 17, ['U','I','B']],
    'li-all':   ['<ul><li id="h">the drover walks</li><li>second item</li></ul>', 'h', 0, 16, []],
  };
  for(const [name, [html, hid, so, eo, chainWanted]] of Object.entries(cases)){
    ed.innerHTML = html; ed.focus();
    const host = ed.querySelector('#' + hid);
    const t = host.firstChild;
    const blk = (function(n){ while(n && n !== ed && !/^(P|H2|H3|BLOCKQUOTE|LI|DIV)$/.test(n.nodeName)) n = n.parentNode; return n && n !== ed ? n : null; })(host);
    if(!blk){ res.push([name, 'NO BLOCK', '']); continue; }
    const pre = document.createRange(); pre.setStart(blk, 0); pre.setEnd(t, so);
    const post = document.createRange(); post.setStart(t, eo); post.setEnd(blk, blk.childNodes.length);
    let wrapped = SPAN;
    for(const tag of chainWanted) wrapped = '<' + tag.toLowerCase() + '>' + wrapped + '</' + tag.toLowerCase() + '>';
    const frag = ser(pre) + wrapped + NB + ser(post);
    const r = document.createRange(); r.selectNodeContents(blk);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertHTML', false, frag);
    const sp = ed.querySelector('.tspan');
    const chain = []; if(sp) for(let n = sp.parentElement; n && n.id !== 'ed-content'; n = n.parentElement) chain.push(n.tagName);
    res.push([name, sp ? chain.join('>') : 'DROPPED', ed.innerHTML]);
  }
  ed.innerHTML = '';
  return res;
});
for(const [k, chain, html] of out) console.log(k.padEnd(12), chain.padEnd(14), show(html).replace(/ data-(scr|src|lang)="[^"]*"/g,'').replace(/ class="tspan"| contenteditable="false"/g,'').slice(0,170));
await browser.close(); await srv.close();
