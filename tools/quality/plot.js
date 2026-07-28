/* Line/heatmap plotting on top of png.js. */
'use strict';
const {Canvas,heat}=require('./png.js');
const FG=[210,214,220],AX=[80,86,96],GRID=[38,42,50];
const SERIES=[[250,120,80],[100,200,255],[130,230,150],[240,200,90],[220,130,240],[255,90,120],[90,220,220],[200,200,200]];

function frame(c,x0,y0,x1,y1,title,xlab,ylab){
  c.rect(x0,y0,x1,y1,[12,14,18]);
  c.hline(x0,x1,y1,AX);c.vline(x0,y0,y1,AX);
  if(title)c.text(x0,y0-22,title,FG,2);
  if(xlab)c.text(x0+((x1-x0)>>1)-xlab.length*3,y1+22,xlab,[150,155,165],1);
  if(ylab)c.text(x0-6,y0-12,ylab,[150,155,165],1);
}
function grid(c,x0,y0,x1,y1,nx,ny){
  for(let i=1;i<nx;i++){const x=x0+Math.round((x1-x0)*i/nx);c.vline(x,y0,y1,GRID);}
  for(let i=1;i<ny;i++){const y=y0+Math.round((y1-y0)*i/ny);c.hline(x0,x1,y,GRID);}
}
// data: array of {name, xs, ys}; xr/yr are [min,max]
function lines(c,box,data,xr,yr,opt){
  const [x0,y0,x1,y1]=box;
  const sx=v=>x0+Math.round((x1-x0)*(v-xr[0])/(xr[1]-xr[0]));
  const sy=v=>y1-Math.round((y1-y0)*(v-yr[0])/(yr[1]-yr[0]));
  data.forEach((d,i)=>{
    const col=d.color||SERIES[i%SERIES.length];
    let px=null,py=null;
    for(let k=0;k<d.xs.length;k++){
      const X=sx(d.xs[k]),Y=sy(Math.max(yr[0],Math.min(yr[1],d.ys[k])));
      if(px!==null)c.line(px,py,X,Y,col);
      px=X;py=Y;
    }
    if(d.name&&(!opt||opt.legend!==false))
      c.text(x1-Math.max(...data.map(q=>(q.name||'').length))*6-10, y0+8+i*10, d.name, col, 1);
  });
}
function xticks(c,box,xr,fmt,n){
  const [x0,y0,x1,y1]=box;n=n||5;
  for(let i=0;i<=n;i++){
    const v=xr[0]+(xr[1]-xr[0])*i/n;
    const x=x0+Math.round((x1-x0)*i/n);
    c.vline(x,y1,y1+4,AX);
    const s=fmt(v);c.text(x-s.length*3,y1+8,s,[150,155,165],1);
  }
}
function yticks(c,box,yr,fmt,n){
  const [x0,y0,x1,y1]=box;n=n||5;
  for(let i=0;i<=n;i++){
    const v=yr[0]+(yr[1]-yr[0])*i/n;
    const y=y1-Math.round((y1-y0)*i/n);
    c.hline(x0-4,x0,y,AX);
    const s=fmt(v);c.text(x0-8-s.length*6,y-3,s,[150,155,165],1);
  }
}
// m[t][f] in dB, already normalised; draws a spectrogram
function spectro(c,box,m,dbLo,dbHi){
  const [x0,y0,x1,y1]=box;
  const W=x1-x0,H=y1-y0;
  for(let px=0;px<W;px++){
    const ti=Math.min(m.length-1,Math.floor(px/W*m.length));
    const col=m[ti];
    for(let py=0;py<H;py++){
      const fi=Math.min(col.length-1,Math.floor((1-py/H)*col.length));
      c.set(x0+px,y0+py,heat((col[fi]-dbLo)/(dbHi-dbLo)));
    }
  }
}
module.exports={Canvas,heat,frame,grid,lines,xticks,yticks,spectro,SERIES,FG};
