#!/usr/bin/env node
/* MonoFX core regression suite.

   These assertions ARE the product. If any of them go red, the suite no longer
   does the one thing it claims to do, no matter how good it sounds. Port these
   to C++ (Catch2/GoogleTest) alongside the DSP — see docs/juce-port-plan.md §4. */
const path=require('path');
const {drums,pinkStereo,impulse,corr,db}=require('./lib/signals.js');
const CORES=[
  require('../src/monofx-phaser.js'),
  require('../src/monofx-delay.js'),
  require('../src/monofx-reverb.js'),
  require('../src/monofx-chorus.js')
];

const SR=48000, N=SR*4;
let failures=0;
const check=(name,ok,detail)=>{
  if(!ok)failures++;
  return (ok?'  ok   ':'  FAIL ')+name+(detail?'  ['+detail+']':'');
};

function render(E,overrides,L,R,Arr){
  const c=new E(SR);
  Object.assign(c,overrides||{});
  if(c.refresh)c.refresh();
  const A=Arr||Float32Array;
  const oL=new A(L.length),oR=new A(L.length);
  c.processBlock(L,R,oL,oR,L.length);
  return {oL,oR};
}
// Streamed render: proves block-size independence (hosts hand us any quantum).
function renderChunked(E,overrides,L,R,Q){
  const c=new E(SR);
  Object.assign(c,overrides||{});
  if(c.refresh)c.refresh();
  const oL=new Float32Array(L.length),oR=new Float32Array(L.length);
  const tL=new Float32Array(Q),tR=new Float32Array(Q),aL=new Float32Array(Q),aR=new Float32Array(Q);
  for(let off=0;off<L.length;off+=Q){
    for(let i=0;i<Q;i++){const s=off+i;tL[i]=s<L.length?L[s]:0;tR[i]=s<L.length?R[s]:0;}
    c.processBlock(tL,tR,aL,aR,Q);
    for(let i=0;i<Q;i++){const d=off+i;if(d<L.length){oL[d]=aL[i];oR[d]=aR[i];}}
  }
  return {oL,oR};
}

console.log('\nMonoFX core suite  ·  sr='+SR+'  ·  4 s deterministic material\n');

for(const E of CORES){
  console.log(E.NAME);
  const src=drums(N,SR,7);
  const dec=pinkStereo(N,5);   // fully decorrelated worst case

  /* 1. THE INVARIANT. Mono sum must not depend on the width control.
        float64 render isolates the arithmetic from output quantization:
        the M path must be bit-identical. float32 is allowed exactly the
        1-ULP rounding floor (~-138 dBFS at these levels). */
  {
    const a=render(E,{width:0},src.L,src.R,Float64Array);
    const b=render(E,{width:1},src.L,src.R,Float64Array);
    let e64=0;
    for(let i=0;i<N;i++)e64=Math.max(e64,Math.abs((a.oL[i]+a.oR[i])-(b.oL[i]+b.oR[i])));
    const a3=render(E,{width:0},src.L,src.R);
    const b3=render(E,{width:1},src.L,src.R);
    let e32=0;
    for(let i=0;i<N;i++)e32=Math.max(e32,Math.abs((a3.oL[i]+a3.oR[i])-(b3.oL[i]+b3.oR[i])));
    console.log(check('mono sum is width-invariant (f64 exact)',e64<1e-15,'f64 '+db(e64).toFixed(0)+' dB'));
    console.log(check('mono sum is width-invariant (f32 <= 1 ULP)',e32<3e-7,'f32 '+db(e32).toFixed(1)+' dBFS'));
  }

  /* 2. Same invariant on fully decorrelated input, where S is large and any
        width leakage into M would be loudest. */
  {
    const a=render(E,{width:0},dec.L,dec.R,Float64Array);
    const b=render(E,{width:1},dec.L,dec.R,Float64Array);
    let e=0;
    for(let i=0;i<N;i++)e=Math.max(e,Math.abs((a.oL[i]+a.oR[i])-(b.oL[i]+b.oR[i])));
    console.log(check('width-invariant on decorrelated input',e<1e-15,db(e).toFixed(0)+' dB'));
  }

  /* 3. mix=0 must be a true bypass: no gain change, no coloration, no offset. */
  {
    const z=render(E,{mix:0},src.L,src.R);
    let e=0;
    for(let i=0;i<N;i++)e=Math.max(e,Math.abs(z.oL[i]-src.L[i]),Math.abs(z.oR[i]-src.R[i]));
    console.log(check('mix=0 is bit-transparent',e<1e-6,db(e).toFixed(1)+' dBFS'));
  }

  /* 4. Stability: every parameter pinned to its maximum, 4 s, no NaN/Inf and no
        runaway. Feedback paths (phaser fb, delay fb, reverb decay) live here. */
  {
    const mx={};for(const p of E.PARAMS)mx[p.id]=p.max;
    const s=render(E,mx,src.L,src.R);
    let peak=0,bad=false;
    for(let i=0;i<N;i++){const v=s.oL[i];if(!isFinite(v))bad=true;peak=Math.max(peak,Math.abs(v));}
    console.log(check('stable at max settings',!bad&&peak<12,'peak '+peak.toFixed(2)));
  }

  /* 5. Silence in, silence out — catches denormal noise and stuck feedback. */
  {
    const zL=new Float32Array(SR),zR=new Float32Array(SR);
    const s=render(E,{},zL,zR);
    let peak=0;for(let i=0;i<SR;i++)peak=Math.max(peak,Math.abs(s.oL[i]));
    console.log(check('silence in -> silence out',peak<1e-12,db(peak).toFixed(0)+' dBFS'));
  }

  /* 6. Block-size independence: 4096-sample render must equal a 128-sample
        streamed render. Hosts vary the quantum; a mismatch means hidden state
        tied to buffer boundaries. */
  {
    const whole=render(E,{},src.L,src.R);
    const chunk=renderChunked(E,{},src.L,src.R,128);
    let e=0;for(let i=0;i<N;i++)e=Math.max(e,Math.abs(whole.oL[i]-chunk.oL[i]));
    console.log(check('block-size independent (whole vs 128)',e<1e-6,db(e).toFixed(1)+' dBFS'));
  }

  /* 7. Determinism: identical construction + input => bit-identical output. */
  {
    const a=render(E,{},src.L,src.R),b=render(E,{},src.L,src.R);
    let e=0;for(let i=0;i<N;i++)e=Math.max(e,Math.abs(a.oL[i]-b.oL[i]));
    console.log(check('deterministic',e===0));
  }

  /* 8. The effect actually does something at defaults, and width actually
        widens — guards against passing every test above by doing nothing. */
  {
    const d=render(E,{},src.L,src.R);
    let wet=0;for(let i=SR;i<N;i++)wet=Math.max(wet,Math.abs(d.oL[i]-src.L[i]));
    const narrow=render(E,{width:0},src.L,src.R);
    const wide=render(E,{width:1},src.L,src.R);
    const cN=corr(narrow.oL,narrow.oR),cW=corr(wide.oL,wide.oR);
    console.log(check('audible wet path at defaults',wet>0.01,'delta '+wet.toFixed(3)));
    console.log(check('width control widens (corr drops)',cW<cN-0.002,
      'corr '+cN.toFixed(3)+' -> '+cW.toFixed(3)));
  }

  /* 9. Worklet packaging: the class must survive toString() round-tripping,
        which is how every core is shipped into the AudioWorklet scope. A
        closure over any outer variable would break here, not in production. */
  {
    let ok=true,why='';
    try{
      const wsrc=E.toString()+
        '\nclass P extends AudioWorkletProcessor{constructor(){super();'+
        'this.core=new '+E.name+'(sampleRate);'+
        'this.port.onmessage=e=>Object.assign(this.core,e.data);}'+
        'process(){return true;}}\nregisterProcessor("'+E.PROC+'",P);';
      new Function('AudioWorkletProcessor','registerProcessor','sampleRate',wsrc)
        (class{constructor(){this.port={};}},()=>{},SR);
    }catch(e){ok=false;why=e.message;}
    console.log(check('self-contained (toString worklet packaging)',ok,why));
  }

  console.log('');
}

console.log(failures===0
  ? 'ALL MONOFX CORE TESTS PASS\n'
  : failures+' FAILURE(S)\n');
process.exit(failures===0?0:1);
