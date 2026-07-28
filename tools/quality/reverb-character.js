/* Reverb modal character: decay linearity, echo density, and the spectrogram of
   the impulse response. These are the "does it sound like a room or like eight
   discrete echoes" questions that scalar T60 cannot answer. */
'use strict';
const path=require('path');
const R=require(path.join(__dirname,'../../src/monofx-reverb.js'));
const {Canvas,frame,grid,lines,xticks,yticks,spectro}=require('./plot.js');
const {hann,fft}=require('./lib.js');
const SR=48000;
const OUT=process.argv[2]||path.join(__dirname,'../../quality-out');
require('fs').mkdirSync(OUT,{recursive:true});

function ir(opts,secs){
  const N=Math.round(SR*secs);
  const iL=new Float64Array(N),iR=new Float64Array(N),oL=new Float64Array(N),oR=new Float64Array(N);
  iL[0]=iR[0]=1;
  const c=new R(SR);Object.assign(c,Object.assign({mix:1,width:0,pre:0},opts));
  c.refresh();c.resetStreams();
  c.processBlock(iL,iR,oL,oR,N);
  const m=new Float64Array(N);for(let i=0;i<N;i++)m[i]=0.5*(oL[i]+oR[i]);
  return m;
}
// Schroeder backward integration -> decay curve in dB
function schroeder(h){
  const N=h.length,e=new Float64Array(N);let acc=0;
  for(let i=N-1;i>=0;i--){acc+=h[i]*h[i];e[i]=acc;}
  const e0=e[0]||1e-30;
  const d=new Float64Array(N);
  for(let i=0;i<N;i++)d[i]=10*Math.log10(e[i]/e0+1e-30);
  return d;
}
/* Abel-Huang normalised echo density. Fraction of samples in a window that
   exceed the window's standard deviation, divided by the 0.3173 expected of
   Gaussian noise. ~1.0 means the response has become indistinguishable from
   noise, i.e. fully diffuse; low values mean you can still hear individual
   echoes. This is the standard measure of how quickly a reverb "fills in". */
function echoDensity(h,winMs){
  const W=Math.round(winMs*0.001*SR),half=W>>1,N=h.length;
  const step=Math.max(1,Math.round(W/8));
  const ts=[],ds=[];
  for(let c=half;c+half<N;c+=step){
    let s=0;for(let i=c-half;i<c+half;i++)s+=h[i]*h[i];
    const sd=Math.sqrt(s/W);
    if(sd<1e-18){ts.push(c/SR*1000);ds.push(0);continue;}
    let cnt=0;for(let i=c-half;i<c+half;i++)if(Math.abs(h[i])>sd)cnt++;
    ts.push(c/SR*1000);ds.push((cnt/W)/0.3173);
  }
  return {ts,ds};
}
function spectrogram(h,W,hop,dbFloor){
  const win=hann(W),H=W>>1,frames=[];
  const re=new Float64Array(W),im=new Float64Array(W);
  let peak=-1e9;
  for(let off=0;off+W<=h.length;off+=hop){
    for(let i=0;i<W;i++){re[i]=h[off+i]*win[i];im[i]=0;}
    fft(re,im,false);
    const col=new Float64Array(H+1);
    for(let k=0;k<=H;k++){col[k]=20*Math.log10(Math.hypot(re[k],im[k])+1e-12);peak=Math.max(peak,col[k]);}
    frames.push(col);
  }
  for(const f of frames)for(let k=0;k<f.length;k++)f[k]=Math.max(dbFloor,f[k]-peak);
  return frames;
}

// ---------- 1. decay linearity across DECAY settings ----------
{
  const c=new Canvas(920,520);
  c.text(20,16,'REVERB DECAY CURVES  SCHROEDER INTEGRATION  MIX=1 WIDTH=0',[230,230,230],2);
  const box=[70,60,890,430];
  frame(c,...box,null,'TIME (SECONDS)',null);
  grid(c,...box,8,6);
  const decays=[0.3,0.5,1,2.2,5,8,12];
  const data=decays.map(d=>{
    const secs=Math.min(16,d*1.6+1);
    const h=ir({decay:d,damp:16000},secs);
    const s=schroeder(h);
    const xs=[],ys=[];
    for(let i=0;i<s.length;i+=64){xs.push(i/SR);ys.push(s[i]);}
    return {name:'DECAY '+d,xs,ys};
  });
  lines(c,box,data,[0,14],[-70,0]);
  xticks(c,box,[0,14],v=>v.toFixed(0),7);
  yticks(c,box,[-70,0],v=>v.toFixed(0),7);
  c.text(20,445,'A LINEAR DECAY IS A STRAIGHT LINE. CURVATURE = MULTI SLOPE DECAY',[150,155,165],1);
  c.text(20,462,'THE -60 DB CROSSING SHOULD LAND AT THE DECAY SETTING',[150,155,165],1);
  c.save(path.join(OUT,'reverb-decay.png'));
}
// ---------- 2. echo density ----------
{
  const c=new Canvas(920,470);
  c.text(20,16,'REVERB ECHO DENSITY  ABEL HUANG NORMALISED  1.0 = FULLY DIFFUSE',[230,230,230],2);
  const box=[70,60,890,380];
  frame(c,...box,null,'TIME (MILLISECONDS)',null);
  grid(c,...box,8,5);
  const sizes=[0.4,1,2];
  const data=sizes.map(sz=>{
    const h=ir({decay:2.2,size:sz,damp:16000},2);
    const e=echoDensity(h,20);
    return {name:'SIZE '+sz,xs:e.ts,ys:e.ds};
  });
  lines(c,box,data,[0,400],[0,1.4]);
  xticks(c,box,[0,400],v=>v.toFixed(0),8);
  yticks(c,box,[0,1.4],v=>v.toFixed(1),7);
  // 1.0 reference
  const y1=380-Math.round((380-60)*(1.0-0)/1.4);
  for(let x=70;x<890;x+=6)c.hline(x,x+2,y1,[120,120,130]);
  c.text(760,y1-12,'DIFFUSE',[120,120,130],1);
  c.text(20,398,'TIME TO REACH 1.0 IS THE MIX TIME. A GOOD SMALL ROOM IS UNDER 100 MS',[150,155,165],1);
  c.text(20,415,'IF IT NEVER REACHES 1.0 YOU HEAR DISCRETE ECHOES NOT A ROOM',[150,155,165],1);
  c.save(path.join(OUT,'reverb-echo-density.png'));
}
// ---------- 3. IR spectrogram: modal ringing / flutter / colouration ----------
{
  const c=new Canvas(940,760);
  c.text(20,16,'REVERB IMPULSE RESPONSE SPECTROGRAMS  0 TO 2 S  0 TO 12 KHZ',[230,230,230],2);
  const cases=[['SIZE 0.4 DECAY 2.2',{size:0.4,decay:2.2}],
               ['SIZE 1.0 DECAY 2.2',{size:1,decay:2.2}],
               ['SIZE 2.0 DECAY 2.2',{size:2,decay:2.2}]];
  cases.forEach(([nm,o],i)=>{
    const h=ir(Object.assign({damp:16000},o),2);
    const sp=spectrogram(h,2048,512,-75);
    // crop to 0-12 kHz
    const kMax=Math.round(12000/SR*2048);
    const cropped=sp.map(col=>col.subarray(0,kMax));
    const y0=60+i*230;
    const box=[70,y0,900,y0+180];
    spectro(c,box,cropped,-75,0);
    c.text(70,y0-14,nm,[210,214,220],1);
    yticks(c,box,[0,12],v=>v.toFixed(0),3);
  });
  c.text(20,720,'HORIZONTAL STRIPES = MODAL RINGING AT FIXED FREQUENCIES',[150,155,165],1);
  c.text(20,737,'VERTICAL STRIPES = FLUTTER  SMOOTH WASH = GOOD DIFFUSION',[150,155,165],1);
  c.save(path.join(OUT,'reverb-spectrogram.png'));
}
console.log('wrote reverb-decay.png, reverb-echo-density.png, reverb-spectrogram.png to '+OUT);
