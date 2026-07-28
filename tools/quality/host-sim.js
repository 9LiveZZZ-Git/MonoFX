/* Host simulator. No plugin layer exists, so nothing has ever exercised these
   cores the way a DAW does: block sizes that change every callback, parameters
   automated mid-stream, transport stops, multiple instances, and long sessions.
   These are the failures that only show up in a host, which is exactly why they
   are worth catching before there is a host. */
'use strict';
const path=require('path');
const CORES={
  PHASER:require(path.join(__dirname,'../../src/monofx-phaser.js')),
  DELAY :require(path.join(__dirname,'../../src/monofx-delay.js')),
  REVERB:require(path.join(__dirname,'../../src/monofx-reverb.js')),
  CHORUS:require(path.join(__dirname,'../../src/monofx-chorus.js')),
};
const SR=48000;
let fails=0;
const check=(name,ok,detail)=>{
  console.log('  '+(ok?'ok  ':'FAIL')+' '+name.padEnd(52)+(detail||''));
  if(!ok)fails++;
};
function src(n,seed){
  const L=new Float64Array(n),R=new Float64Array(n);let s=seed;
  const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296)*2-1;
  let b0=0,b1=0,b2=0;
  for(let i=0;i<n;i++){const w=rnd();b0=0.997*b0+0.03*w;b1=0.985*b1+0.032*w;b2=0.95*b2+0.048*w;
    L[i]=(b0+b1+b2+w*0.05)*0.5;R[i]=L[i]*0.8+rnd()*0.1;}
  return {L,R};
}
const finite=a=>{for(let i=0;i<a.length;i++)if(!isFinite(a[i]))return false;return true;};

console.log('HOST SIMULATION  ·  sr=48000\n');

console.log('RANDOM BLOCK SIZES (hosts split blocks at automation and loop points)');
for(const [nm,E] of Object.entries(CORES)){
  const N=SR*4,s=src(N,7);
  const ref={oL:new Float64Array(N),oR:new Float64Array(N)};
  {const c=new E(SR);if(c.refresh)c.refresh();c.resetStreams();
   c.processBlock(s.L,s.R,ref.oL,ref.oR,N);}
  const oL=new Float64Array(N),oR=new Float64Array(N);
  const c=new E(SR);if(c.refresh)c.refresh();c.resetStreams();
  let rs=4242;const rnd=()=>((rs=(rs*1664525+1013904223)>>>0)/4294967296);
  let off=0;
  const tL=new Float64Array(8192),tR=new Float64Array(8192),
        aL=new Float64Array(8192),aR=new Float64Array(8192);
  while(off<N){
    const q=Math.max(1,Math.min(N-off,1+Math.floor(rnd()*2048)));
    for(let i=0;i<q;i++){tL[i]=s.L[off+i];tR[i]=s.R[off+i];}
    c.processBlock(tL,tR,aL,aR,q);
    for(let i=0;i<q;i++){oL[off+i]=aL[i];oR[off+i]=aR[i];}
    off+=q;
  }
  let e=0;for(let i=0;i<N;i++)e=Math.max(e,Math.abs(oL[i]-ref.oL[i]));
  check(nm+': random 1..2048 blocks == whole render',e===0,'max diff '+e.toExponential(2));
}

console.log('\nPARAMETER AUTOMATION MID-STREAM (every parameter swept continuously)');
for(const [nm,E] of Object.entries(CORES)){
  const N=SR*6;const s=src(N,11);
  const c=new E(SR);if(c.refresh)c.refresh();c.resetStreams();
  const Q=64,tL=new Float64Array(Q),tR=new Float64Array(Q),aL=new Float64Array(Q),aR=new Float64Array(Q);
  let bad=false,peak=0,maxStep=0,prev=0;
  for(let off=0;off+Q<=N;off+=Q){
    const t=off/N;
    for(const p of E.PARAMS){
      const v=p.log?p.min*Math.pow(p.max/p.min,0.5+0.5*Math.sin(2*Math.PI*3*t+p.id.length))
                   :p.min+(p.max-p.min)*(0.5+0.5*Math.sin(2*Math.PI*3*t+p.id.length));
      c[p.id]=v;
    }
    for(let i=0;i<Q;i++){tL[i]=s.L[off+i];tR[i]=s.R[off+i];}
    c.processBlock(tL,tR,aL,aR,Q);
    for(let i=0;i<Q;i++){
      if(!isFinite(aL[i])||!isFinite(aR[i]))bad=true;
      peak=Math.max(peak,Math.abs(aL[i]));
      if(off>SR){const st=Math.abs(aL[i]-prev);if(st>maxStep)maxStep=st;}
      prev=aL[i];
    }
  }
  // reference: what does the SOURCE's own max step look like?
  let srcStep=0;for(let i=1;i<N;i++)srcStep=Math.max(srcStep,Math.abs(s.L[i]-s.L[i-1]));
  check(nm+': all params swept, finite and bounded',!bad&&peak<12,
    'peak '+peak.toFixed(2)+', max step '+(maxStep/srcStep).toFixed(1)+'x source');
}

console.log('\nTRANSPORT STOP/START (resetStreams mid-session must not click or leak)');
for(const [nm,E] of Object.entries(CORES)){
  const N=SR*2;const s=src(N,13);
  const c=new E(SR);if(c.refresh)c.refresh();c.resetStreams();
  const half=N>>1;
  const a1=new Float64Array(half),b1=new Float64Array(half);
  c.processBlock(s.L,s.R,a1,b1,half);
  c.resetStreams();
  const a2=new Float64Array(half),b2=new Float64Array(half);
  c.processBlock(s.L,s.R,a2,b2,half);
  const f=new E(SR);if(f.refresh)f.refresh();f.resetStreams();
  const c1=new Float64Array(half),d1=new Float64Array(half);
  f.processBlock(s.L,s.R,c1,d1,half);
  let e=0;for(let i=0;i<half;i++)e=Math.max(e,Math.abs(a2[i]-c1[i]));
  check(nm+': post-reset == fresh instance',e===0,'max diff '+e.toExponential(2));
}

console.log('\nMULTIPLE INSTANCES (no shared/static state between plugin instances)');
for(const [nm,E] of Object.entries(CORES)){
  const N=SR;const s1=src(N,3),s2=src(N,29);
  const A=new E(SR),B=new E(SR);
  if(A.refresh){A.refresh();B.refresh();}A.resetStreams();B.resetStreams();
  const a1=new Float64Array(N),a2=new Float64Array(N),b1=new Float64Array(N),b2=new Float64Array(N);
  // interleave the two instances block by block
  const Q=128;
  for(let off=0;off+Q<=N;off+=Q){
    A.processBlock(s1.L.subarray(off,off+Q),s1.R.subarray(off,off+Q),
                   a1.subarray(off,off+Q),a2.subarray(off,off+Q),Q);
    B.processBlock(s2.L.subarray(off,off+Q),s2.R.subarray(off,off+Q),
                   b1.subarray(off,off+Q),b2.subarray(off,off+Q),Q);
  }
  const solo=new E(SR);if(solo.refresh)solo.refresh();solo.resetStreams();
  const r1=new Float64Array(N),r2=new Float64Array(N);
  for(let off=0;off+Q<=N;off+=Q)
    solo.processBlock(s1.L.subarray(off,off+Q),s1.R.subarray(off,off+Q),
                      r1.subarray(off,off+Q),r2.subarray(off,off+Q),Q);
  let e=0;for(let i=0;i<N-Q;i++)e=Math.max(e,Math.abs(a1[i]-r1[i]));
  check(nm+': interleaved instances do not interfere',e===0,'max diff '+e.toExponential(2));
}

console.log('\nSILENCE ENDURANCE (denormal stress: 60 s of digital silence after audio)');
for(const [nm,E] of Object.entries(CORES)){
  const c=new E(SR);if(c.refresh)c.refresh();c.resetStreams();
  const Q=512,s=src(Q,5);
  const oL=new Float64Array(Q),oR=new Float64Array(Q);
  for(let k=0;k<20;k++)c.processBlock(s.L,s.R,oL,oR,Q);
  const z=new Float64Array(Q);
  const t0=process.hrtime.bigint();
  const blocks=Math.round(60*SR/Q);
  for(let k=0;k<blocks;k++)c.processBlock(z,z,oL,oR,Q);
  const ms=Number(process.hrtime.bigint()-t0)/1e6;
  let resid=0;for(let i=0;i<Q;i++)resid=Math.max(resid,Math.abs(oL[i]));
  check(nm+': 60 s silence stays finite and cheap',finite(oL)&&resid<1e-20,
    (ms/60000*100).toFixed(2)+'% realtime, residual '+resid.toExponential(1));
}
console.log('\n'+(fails?fails+' FAILURE(S)':'ALL HOST SIMULATIONS PASS'));
process.exit(fails?1:0);
