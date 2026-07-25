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
  // The WHOLE buffer, including both edges. Restricting this to 8192..n-8192 hid
  // an overlap-add head ramp that attenuated the first 37 ms of every render by
  // up to 44 dB and left sample 0 silent.
  let e=0;for(let i=0;i<N;i++)e=Math.max(e,Math.abs(z.oL[i]-Ln[i]));
  // Assert BOTH enhancement stages are idle. The old assertion checked only
  // dualRes while the printed detail also reported glApplied, so a consistency
  // pass firing on already-compatible input would have gone unnoticed.
  check('null @ strength '+st,e<1e-5&&!z.dualRes&&!z.glApplied,
    db(e).toFixed(1)+' dBFS whole-buffer, enhancement stages '+(z.dualRes||z.glApplied?'FIRED':'idle'));
}
{ // the head and tail specifically, since that is where the OLA bug lived
  const Ln=pink(N,5);
  const z=await processAll(Ln,Ln,SR,1,()=>{});
  let head=0,tail=0;
  for(let i=0;i<4096;i++)head=Math.max(head,Math.abs(z.oL[i]-Ln[i]));
  for(let i=N-4096;i<N;i++)tail=Math.max(tail,Math.abs(z.oL[i]-Ln[i]));
  check('render edges are gain-correct (no OLA head/tail ramp)',head<1e-5&&tail<1e-5,
    'head '+db(head).toFixed(1)+' dBFS, tail '+db(tail).toFixed(1)+' dBFS');
}

console.log('\nLIVE CORE (causal, host quantum = 128)');
// Latency is now exactly W samples: (W-hop) of STFT lookahead plus the hop
// samples primed into the output FIFO. It used to be W-hop plus a variable
// priming term, so the figure moved with the host block size (384..480 at
// W=512) — the previously documented 18.7 ms for W=1024 was an artifact of this
// suite happening to use a 128-sample quantum.
for(const [W,latMs,tgt] of [[512,512/SR*1000,0.98],[1024,1024/SR*1000,0.98]]){
  const L=pink(SR*3,9),R=new Float32Array(SR*3);
  for(let i=0;i<R.length;i++)R[i]=-L[i];
  const o=streamLive(W,L,R,128);
  check(W+'-pt: anti-phase recovery',corr(o.oL,o.oR)>=tgt,
    corr(L,R).toFixed(3)+' -> '+corr(o.oL,o.oR).toFixed(3));
  const z=streamLive(W,L,L,128);
  const lag=findLatency(z.oL,L,3*W);
  let e=0;for(let i=lag+4096;i<L.length-4096;i++)e=Math.max(e,Math.abs(z.oL[i]-L[i-lag]));
  check(W+'-pt: identical-channel null',e<1e-5,db(e).toFixed(1)+' dBFS');
  check(W+'-pt: latency == '+latMs.toFixed(1)+' ms',Math.abs(lag/SR*1000-latMs)<0.6,
    lag+' smp = '+(lag/SR*1000).toFixed(1)+' ms, reported '+new LiveCore(SR,W).latencySamples());
}

/* Block-size independence and a CONSTANT latency, for LiveCore this time. This
   is invariant 4, and it was only ever checked for the MonoFX cores. The FIFO
   used to inject zeros mid-stream at block sizes incommensurate with hop
   (441/735/882 — every 44.1 kHz buffer) and to overwrite unread audio outright
   above W*4, which turned 76% of an 8192-sample render into silence. */
for(const W of [512,1024]){
  const n=SR,L=pink(n,9);
  const run=Q=>{
    const c=new LiveCore(SR,W);
    const oL=new Float32Array(n);
    const tL=new Float32Array(Q),tR=new Float32Array(Q),aL=new Float32Array(Q),aR=new Float32Array(Q);
    for(let off=0;off<n;off+=Q){
      for(let i=0;i<Q;i++){const s=off+i;tL[i]=tR[i]=s<n?L[s]:0;}
      c.processBlock(tL,tR,aL,aR,Q);
      for(let i=0;i<Q;i++){const d=off+i;if(d<n)oL[d]=aL[i];}
    }
    return oL;
  };
  const ref=run(128);
  let worst=0,at=0;
  for(const Q of [32,64,100,128,256,333,441,480,512,735,882,1000,1024,1470,2048,4096,8192]){
    const o=run(Q);
    let e=0;for(let i=6000;i<n-6000;i++)e=Math.max(e,Math.abs(ref[i]-o[i]));
    if(e>worst){worst=e;at=Q;}
  }
  check(W+'-pt: block-size independent (17 quanta, 32..8192)',worst===0,
    worst===0?'bit-identical at every block size':'differs by '+worst.toExponential(2)+' at Q='+at);
}

/* The live path must leave genuinely decorrelated material alone, the same way
   the offline engine does. It did not: forced bass-mono is unconditional, so it
   collapsed wide bass along with damaged bass and pulled the suite's own "wide"
   case from 0.288 to 0.606. The rotation path itself was never the problem —
   with bassMono off it lands at 0.291. The feature is now switchable. */
{
  const t=makeTest('wide',SR),n2=t.L.length;
  const run=(W,bm)=>{
    const c=new LiveCore(SR,W); c.strength=1; c.bassMono=bm;
    const Q=128,oL=new Float32Array(n2),oR=new Float32Array(n2);
    const tL=new Float32Array(Q),tR=new Float32Array(Q),aL=new Float32Array(Q),aR=new Float32Array(Q);
    const push=cap=>{for(let off=0;off<n2;off+=Q){
      for(let i=0;i<Q;i++){const s=off+i;tL[i]=s<n2?t.L[s]:0;tR[i]=s<n2?t.R[s]:0;}
      c.processBlock(tL,tR,aL,aR,Q);
      if(cap)for(let i=0;i<Q;i++){const d=off+i;if(d<n2){oL[d]=aL[i];oR[d]=aR[i];}}}};
    push(false);c.resetStreams();push(true);
    return corr(oL.subarray(8000,n2-8000),oR.subarray(8000,n2-8000));
  };
  const pre=corr(t.L.subarray(8000,n2-8000),t.R.subarray(8000,n2-8000));
  const c512=run(512,0),c1024=run(1024,0);
  check('wide material stays wide (bassMono off)',c512<0.5&&c1024<0.5,
    pre.toFixed(3)+' -> '+c512.toFixed(3)+' (512) / '+c1024.toFixed(3)+' (1024)');
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
