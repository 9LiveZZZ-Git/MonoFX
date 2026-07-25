#!/usr/bin/env node
/* MonoLock engine regression suite.

   Runs against src/monolock-engine.generated.js — regenerate it from the
   prototype first (`npm run extract`, done automatically by `npm test`).

   Targets below are MEASURED values with tolerance, not aspirations. When you
   change the engine, expect these to move; only accept a move you can explain.
   The two that must NEVER move are the null tests: an identical-channel input
   is already perfectly mono-compatible, so any processing at all is a bug. */
let E;
try{ E=require('../src/monolock-engine.generated.js'); }
catch(e){
  console.error('Missing generated engine. Run:  npm run extract\n'+e.message);
  process.exit(1);
}
const {processAll,LiveCore,makeTest,pink,drums,varDelay}=E;

const SR=48000, N=SR*4;
let failures=0;
const corr=(a,b)=>{let s=0,sa=0,sb=0;
  for(let i=0;i<a.length;i++){s+=a[i]*b[i];sa+=a[i]*a[i];sb+=b[i]*b[i];}
  return sa>1e-20&&sb>1e-20?s/Math.sqrt(sa*sb):0;};
const db=x=>20*Math.log10(Math.abs(x)+1e-30);
const check=(name,ok,detail)=>{
  if(!ok)failures++;
  console.log((ok?'  ok   ':'  FAIL ')+name+(detail?'  ['+detail+']':''));
};

/* Stream a signal through a causal LiveCore: one warm pass to converge the
   leaky estimators, reset the delay lines, then the measured capture pass.
   Q is the host quantum — 128 mirrors a real AudioWorklet. */
function streamLive(W,L,R,Q){
  const c=new LiveCore(SR,W);
  const push=cap=>{
    const oL=cap?new Float32Array(L.length):null,oR=cap?new Float32Array(L.length):null;
    const tL=new Float32Array(Q),tR=new Float32Array(Q),aL=new Float32Array(Q),aR=new Float32Array(Q);
    for(let off=0;off<L.length;off+=Q){
      for(let i=0;i<Q;i++){const s=off+i;tL[i]=s<L.length?L[s]:0;tR[i]=s<L.length?R[s]:0;}
      c.processBlock(tL,tR,aL,aR,Q);
      if(cap)for(let i=0;i<Q;i++){const d=off+i;if(d<L.length){oL[d]=aL[i];oR[d]=aR[i];}}
    }
    return cap?{oL,oR}:null;
  };
  push(false); c.resetStreams();
  return push(true);
}
// Empirically locate the pipeline latency rather than assuming it.
function findLatency(out,inp,maxLag){
  let best=0,bc=-2;
  for(let g=0;g<=maxLag;g++){
    let s=0,sa=0,sb=0;
    for(let i=g+1000;i<inp.length-1000;i+=7){s+=out[i]*inp[i-g];sa+=out[i]*out[i];sb+=inp[i-g]*inp[i-g];}
    const c=s/Math.sqrt(sa*sb+1e-30);
    if(c>bc){bc=c;best=g;}
  }
  return best;
}

(async()=>{
console.log('\nMonoLock engine suite  ·  sr='+SR+'\n');

console.log('OFFLINE MAXIMIZER (strength 1.0)');
const cases=[
  ['delay  (5 ms inter-channel)','delay', 0.995],
  ['anti   (polarity inverted)', 'anti',  0.98 ],
  ['rotate (broadband phase)',   'rotate',0.98 ],
];
for(const [label,kind,target] of cases){
  const t=makeTest(kind,SR);
  const p=await processAll(t.L,t.R,SR,1.0,()=>{});
  check(label,p.corrPost>=target&&p.residual===0,
    p.corrPre.toFixed(3)+' -> '+p.corrPost.toFixed(3)+', destructive bands '+p.residual);
}
{ // genuinely wide material must be left alone, not collapsed
  const t=makeTest('wide',SR);
  const p=await processAll(t.L,t.R,SR,1.0,()=>{});
  check('wide   (decorrelated: stays transparent)',p.corrPost<0.5,
    p.corrPre.toFixed(3)+' -> '+p.corrPost.toFixed(3));
}
{ // time-varying misalignment: tests the tracked fractional delay
  const L=drums(N,SR,7),d=new Float32Array(N);
  for(let i=0;i<N;i++)d[i]=0.008*SR*(i/N);
  const p=await processAll(L,varDelay(L,d),SR,1.0,()=>{});
  check('drift  (0 -> 8 ms over 4 s)',p.corrPost>=0.90&&p.segments>=2,
    p.corrPre.toFixed(3)+' -> '+p.corrPost.toFixed(3)+', '+p.segments+' segments');
}
{ // mid-file polarity flip: invisible to whole-file statistics; tests segmentation
  const base=pink(N,5),L=new Float32Array(base),R=new Float32Array(N);
  for(let i=0;i<N;i++)R[i]=i<N/2?base[i]:-base[i];
  const p=await processAll(L,R,SR,1.0,()=>{});
  check('flip   (mid-file polarity change)',p.corrPost>=0.70&&p.segments===2,
    p.corrPre.toFixed(3)+' -> '+p.corrPost.toFixed(3)+', '+p.segments+' segments');
}

console.log('\nTRANSPARENCY (already-mono-compatible input must be untouched)');
for(const st of [0,0.5,1]){
  const Ln=pink(N,5);
  const z=await processAll(Ln,Ln,SR,st,()=>{});
  let e=0;for(let i=8192;i<N-8192;i++)e=Math.max(e,Math.abs(z.oL[i]-Ln[i]));
  check('null @ strength '+st,e<1e-5&&!z.dualRes,
    db(e).toFixed(1)+' dBFS, enhancement stages '+(z.dualRes||z.glApplied?'FIRED':'idle'));
}

console.log('\nLIVE CORE (causal, host quantum = 128)');
for(const [W,latMs,tgt] of [[512,8.0,0.98],[1024,18.7,0.98]]){
  const L=pink(SR*3,9),R=new Float32Array(SR*3);
  for(let i=0;i<R.length;i++)R[i]=-L[i];
  const o=streamLive(W,L,R,128);
  check(W+'-pt: anti-phase recovery',corr(o.oL,o.oR)>=tgt,
    corr(L,R).toFixed(3)+' -> '+corr(o.oL,o.oR).toFixed(3));
  const z=streamLive(W,L,L,128);
  const lag=findLatency(z.oL,L,3*W);
  let e=0;for(let i=lag+4096;i<L.length-4096;i++)e=Math.max(e,Math.abs(z.oL[i]-L[i-lag]));
  check(W+'-pt: identical-channel null',e<1e-5,db(e).toFixed(1)+' dBFS');
  check(W+'-pt: latency == '+latMs+' ms',Math.abs(lag/SR*1000-latMs)<0.6,
    lag+' smp = '+(lag/SR*1000).toFixed(1)+' ms');
}
{
  const L=pink(SR*2,3),R=pink(SR*2,4);
  const a=streamLive(1024,L,R,128),b=streamLive(1024,L,R,128);
  let e=0;for(let i=0;i<L.length;i++)e=Math.max(e,Math.abs(a.oL[i]-b.oL[i]));
  check('1024-pt: deterministic',e===0);
}

console.log('');
console.log(failures===0?'ALL MONOLOCK TESTS PASS\n':failures+' FAILURE(S)\n');
process.exit(failures===0?0:1);
})().catch(e=>{console.error('SUITE CRASHED\n',e);process.exit(1);});
