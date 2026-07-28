/* Aliasing and modulation-artefact sweep across the PARAMETER SPACE, not just at
   defaults. Time-varying delays (chorus, phaser sweep) generate sidebands by
   design; what matters is energy that folds back from above Nyquist, which
   appears as spurs that are NOT harmonically or sideband-related to the input. */
'use strict';
const path=require('path');
const CORES={
  PHASER:require(path.join(__dirname,'../../src/monofx-phaser.js')),
  DELAY :require(path.join(__dirname,'../../src/monofx-delay.js')),
  REVERB:require(path.join(__dirname,'../../src/monofx-reverb.js')),
  CHORUS:require(path.join(__dirname,'../../src/monofx-chorus.js')),
};
const {Canvas,frame,grid,lines,xticks,yticks,spectro}=require('./plot.js');
const {hann,fft}=require('./lib.js');
const SR=48000;
const OUT=process.argv[2]||path.join(__dirname,'../../quality-out');
require('fs').mkdirSync(OUT,{recursive:true});

function render(E,ov,f0,secs){
  const N=Math.round(SR*secs);
  const iL=new Float64Array(N),iR=new Float64Array(N),oL=new Float64Array(N),oR=new Float64Array(N);
  for(let i=0;i<N;i++)iL[i]=iR[i]=0.5*Math.sin(2*Math.PI*f0*i/SR);
  const c=new E(SR);Object.assign(c,ov);if(c.refresh)c.refresh();
  c.processBlock(iL,iR,oL,oR,N);
  return oL;
}
function spectrum(x,W){
  const win=hann(W),H=W>>1;
  const acc=new Float64Array(H+1);let cnt=0;
  const re=new Float64Array(W),im=new Float64Array(W);
  for(let off=x.length-W*8;off+W<=x.length;off+=W/2){
    if(off<0)continue;
    for(let i=0;i<W;i++){re[i]=x[off+i]*win[i];im[i]=0;}
    fft(re,im,false);
    for(let k=0;k<=H;k++)acc[k]+=re[k]*re[k]+im[k]*im[k];
    cnt++;
  }
  const db=new Float64Array(H+1);
  let pk=-1e9;
  for(let k=0;k<=H;k++){db[k]=10*Math.log10(acc[k]/Math.max(1,cnt)+1e-30);pk=Math.max(pk,db[k]);}
  for(let k=0;k<=H;k++)db[k]-=pk;
  return db;
}
/* Worst spur outside +/-`guard` Hz of the carrier and its harmonics. Harmonic
   distortion and intended modulation sidebands are excluded; what remains is
   aliasing and noise. */
function worstSpur(db,f0,W,guard){
  const H=db.length-1;
  let worst=-200,at=0;
  for(let k=Math.round(30/SR*W);k<=H;k++){
    const f=k*SR/W;
    let near=false;
    for(let h=1;h<=12;h++)if(Math.abs(f-h*f0)<guard){near=true;break;}
    if(near)continue;
    if(db[k]>worst){worst=db[k];at=f;}
  }
  return {worst,at};
}

// ---------- sweep: worst spur across the modulation parameter space ----------
const W=8192;
const GRIDS={
  PHASER:{x:'rate',xs:[0.05,0.5,2,4,8],y:'depth',ys:[0,0.25,0.5,0.75,1],fix:{mix:1,fb:0.9,width:1}},
  CHORUS:{x:'rate',xs:[0.05,0.5,1,2,3],y:'depth',ys:[0,0.25,0.5,0.75,1],fix:{mix:1,width:1,voxmix:1}},
  DELAY :{x:'time',xs:[30,100,380,800,1500],y:'fb',ys:[0,0.25,0.5,0.75,0.95],fix:{mix:1,width:1,tone:12000}},
  REVERB:{x:'size',xs:[0.4,0.8,1.2,1.6,2],y:'decay',ys:[0.3,1,2.2,6,12],fix:{mix:1,width:1,damp:16000}},
};
console.log('Worst non-harmonic spur (dB below carrier), 1 kHz input, per parameter cell:');
const report={};
for(const [nm,E] of Object.entries(CORES)){
  const G=GRIDS[nm];
  console.log('\n'+nm+'   rows = '+G.y+', cols = '+G.x);
  let hdr='        ';for(const xv of G.xs)hdr+=String(xv).padStart(9);
  console.log(hdr);
  const cells=[];
  for(const yv of G.ys){
    let row=String(yv).padEnd(8);
    const r=[];
    for(const xv of G.xs){
      const ov=Object.assign({},G.fix,{[G.x]:xv,[G.y]:yv});
      const db=spectrum(render(E,ov,1000,2.2),W);
      const s=worstSpur(db,1000,W,60);
      r.push(s.worst);
      row+=s.worst.toFixed(1).padStart(9);
    }
    cells.push(r);
    console.log(row);
  }
  report[nm]={G,cells};
}

// ---------- graph: worst spur heat grid + the worst-case spectrum ----------
{
  const c=new Canvas(980,720);
  c.text(20,16,'ALIASING SWEEP  WORST NON HARMONIC SPUR  1 KHZ INPUT',[230,230,230],2);
  let i=0;
  for(const nm of Object.keys(CORES)){
    const {G,cells}=report[nm];
    const bx=40+(i%2)*490, by=70+Math.floor(i/2)*310;
    c.text(bx,by-14,nm+'   '+G.x+' ACROSS   '+G.y+' UP',[210,214,220],1);
    const cw=70,ch=34;
    for(let r=0;r<cells.length;r++)for(let k=0;k<cells[r].length;k++){
      const v=cells[cells.length-1-r][k];
      // -100 dB (clean) -> dark ; -40 dB (dirty) -> hot
      const t=Math.max(0,Math.min(1,(v+100)/60));
      const col=[Math.round(20+t*235),Math.round(24+t*100),Math.round(30+t*30)];
      c.rect(bx+k*cw,by+r*ch,bx+k*cw+cw-3,by+r*ch+ch-3,col);
      c.text(bx+k*cw+6,by+r*ch+13,v.toFixed(0),[10,10,12],1);
    }
    for(let k=0;k<G.xs.length;k++)c.text(bx+k*cw+6,by+cells.length*ch+4,String(G.xs[k]),[150,155,165],1);
    for(let r=0;r<G.ys.length;r++)c.text(bx-34,by+r*ch+13,String(G.ys[G.ys.length-1-r]),[150,155,165],1);
    i++;
  }
  c.text(20,690,'NUMBERS ARE DB BELOW CARRIER. MORE NEGATIVE IS CLEANER.',[150,155,165],1);
  c.text(20,705,'BRIGHT CELLS ARE THE DIRTIEST SETTINGS.',[150,155,165],1);
  c.save(path.join(OUT,'aliasing-grid.png'));
}
// ---------- worst-case spectra, overlaid ----------
{
  const c=new Canvas(960,520);
  c.text(20,16,'WORST CASE SPECTRA  1 KHZ INPUT  MAX MODULATION SETTINGS',[230,230,230],2);
  const box=[70,60,930,420];
  frame(c,...box,null,'FREQUENCY (KHZ)',null);
  grid(c,...box,8,6);
  const worstOv={
    PHASER:{mix:1,fb:0.9,width:1,rate:8,depth:1},
    CHORUS:{mix:1,width:1,voxmix:1,rate:3,depth:1},
    DELAY :{mix:1,width:1,tone:12000,time:30,fb:0.95},
    REVERB:{mix:1,width:1,damp:16000,size:0.4,decay:12},
  };
  const data=Object.keys(CORES).map(nm=>{
    const db=spectrum(render(CORES[nm],worstOv[nm],1000,2.2),W);
    const xs=[],ys=[];
    for(let k=1;k<db.length;k+=4){xs.push(k*SR/W/1000);ys.push(db[k]);}
    return {name:nm,xs,ys};
  });
  lines(c,box,data,[0,20],[-140,5]);
  xticks(c,box,[0,20],v=>v.toFixed(0),8);
  yticks(c,box,[-140,5],v=>v.toFixed(0),7);
  c.text(20,440,'PEAKS AT MULTIPLES OF 1 KHZ ARE HARMONIC DISTORTION',[150,155,165],1);
  c.text(20,457,'SKIRTS AROUND 1 KHZ ARE INTENDED MODULATION SIDEBANDS',[150,155,165],1);
  c.text(20,474,'ANYTHING ELSE IS ALIASING OR NOISE',[150,155,165],1);
  c.save(path.join(OUT,'aliasing-spectra.png'));
}
console.log('\nwrote aliasing-grid.png, aliasing-spectra.png to '+OUT);
