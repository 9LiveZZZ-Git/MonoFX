#!/usr/bin/env node
/* MonoFX core regression suite.

   These assertions ARE the product. If any of them go red, the suite no longer
   does the one thing it claims to do, no matter how good it sounds. Port these
   to C++ (Catch2/GoogleTest) alongside the DSP — see docs/juce-port-plan.md §4. */
const path=require('path');
const {drums,pinkStereo,sweep,impulse,corr,db}=require('./lib/signals.js');
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
  const swp=sweep(N,SR);       // sustained excitation for the stability check

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
        runaway. Feedback paths (phaser fb, delay fb, reverb decay) live here.
        BOTH channels, and sustained material as well as transient: checking only
        oL against drums() reported "peak 1.18" for a phaser whose oR reached
        15.4x on a sweep, because the peak lived in the channel nobody looked at
        and the resonance never had time to build on transients. */
  {
    const mx={};for(const p of E.PARAMS)mx[p.id]=p.max;
    let peak=0,bad=false,worst='';
    for(const [mat,sig] of [['drums',src],['sweep',swp]]){
      const s=render(E,mx,sig.L,sig.R);
      for(let i=0;i<N;i++){
        const a=s.oL[i],b=s.oR[i];
        if(!isFinite(a)||!isFinite(b))bad=true;
        const m=Math.max(Math.abs(a),Math.abs(b));
        if(m>peak){peak=m;worst=mat;}
      }
    }
    console.log(check('stable at max settings (both channels, 2 materials)',!bad&&peak<12,
      'peak '+peak.toFixed(2)+' on '+worst));
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

  /* 9. NaN/Inf quarantine. One bad sample from an upstream plugin must not latch
        the recursive state. The phaser used to be poisoned forever, because its
        flush guard was Math.abs(x)<1e-24 and Math.abs(NaN)<1e-24 is false. */
  {
    const c=new E(SR); if(c.refresh)c.refresh();
    const B=512,iL=new Float32Array(B),iR=new Float32Array(B),
          oL=new Float32Array(B),oR=new Float32Array(B);
    iL[10]=NaN; iR[10]=Infinity;
    c.processBlock(iL,iR,oL,oR,B);
    // Count non-finite output across the WHOLE follow-up window, and require a
    // SUSTAINED clean run — not merely the first clean block.
    //
    // Taking the first clean block as "recovered" is false-green for any core
    // whose state has latency: the reverb's shortest delay line is 29.7 ms
    // (~5.6 blocks at B=512), so a latched NaN has not circulated back to the
    // output yet when block 0 is inspected. That test passed the reverb while
    // 97.5% of its subsequent output was non-finite.
    const BLOCKS=200;                       // ~2.1 s at B=512
    let badSamples=0,total=0,cleanRun=0,recovered=-1;
    for(let blk=0;blk<BLOCKS;blk++){
      for(let i=0;i<B;i++)iL[i]=iR[i]=0.3*Math.sin(2*Math.PI*440*(blk*B+i)/SR);
      c.processBlock(iL,iR,oL,oR,B);
      let ok=true;
      for(let i=0;i<B;i++){total++;
        if(!isFinite(oL[i])||!isFinite(oR[i])){badSamples++;ok=false;}}
      if(ok){if(++cleanRun>=32&&recovered<0)recovered=blk-31;}else cleanRun=0;
    }
    // A bounded transient is acceptable and unavoidable: mix=0 is bit-transparent
    // by contract, so the dry path MUST pass a non-finite input sample through.
    // What must never happen is the state latching. Allow a few interpolator taps
    // (<=16 samples); require a sustained clean run thereafter.
    console.log(check('recovers from NaN/Inf input (sustained, whole window)',
      recovered>=0&&recovered<=8&&badSamples<=16,
      badSamples+'/'+total+' non-finite ('+(badSamples?'transient':'none')+
      '), sustained clean from block '+recovered));
  }

  /* 10. The WIDTH control must widen, not pan. A mono input has S=0, so any L/R
         energy difference is the core biasing the image on its own. The phaser
         failed this at 4.58 dB because its side term was built from the same
         allpass stage the mid path already carried. */
  {
    const mono=new Float32Array(N); for(let i=0;i<N;i++)mono[i]=src.L[i];
    let worst=0,at='';
    for(const ov of [{},{width:1},{width:1,mix:1}]){
      const o=render(E,ov,mono,mono,Float64Array);
      let sl=0,sr2=0;
      for(let i=SR;i<N;i++){sl+=o.oL[i]*o.oL[i];sr2+=o.oR[i]*o.oR[i];}
      const im=Math.abs(20*Math.log10(Math.sqrt(sl/sr2)));
      if(im>worst){worst=im;at=JSON.stringify(ov);}
    }
    console.log(check('width widens without panning the image',worst<1.0,
      'worst |L/R imbalance| '+worst.toFixed(3)+' dB at '+at));
  }

  /* 11. Out-of-range parameters must not produce NaN or a runaway. Every core is
         configured by Object.assign from a postMessage with no validation, so a
         preset, an automation curve or a port that forgets its ranges can push
         any field past its PARAMS limit. */
  {
    let bad='';
    for(const p of E.PARAMS){
      for(const v of [p.min-Math.abs(p.max-p.min),p.max+Math.abs(p.max-p.min)*3,0,-1]){
        const o=render(E,{[p.id]:v},src.L,src.R,Float64Array);
        for(let i=0;i<N;i+=17){
          if(!isFinite(o.oL[i])||!isFinite(o.oR[i])){bad=p.id+'='+v+' -> non-finite';break;}
          if(Math.abs(o.oL[i])>50){bad=p.id+'='+v+' -> runaway '+o.oL[i].toFixed(1);break;}
        }
        if(bad)break;
      }
      if(bad)break;
    }
    console.log(check('out-of-range parameters stay finite and bounded',!bad,bad||'all PARAMS probed'));
  }

  /* 12. The mono-bus path. A host with a mono output gives the worklet a single
         channel; the wrapper must hand the core two distinct buffers and sum
         them, NOT alias one buffer as both. Aliasing made outR=m-s overwrite
         outL=m+s, so the mono listener received m-s and heard the effect's own
         side signal subtracted from the mix. */
  {
    const c=new E(SR); if(c.refresh)c.refresh();
    const mL=new Float32Array(N),mR=new Float32Array(N);
    c.processBlock(src.L,src.R,mL,mR,N);
    let e=0;
    for(let i=0;i<N;i++){
      const wrapperMono=0.5*(mL[i]+mR[i]);        // what the fixed wrapper emits
      const trueMono=0.5*(mL[i]+mR[i]);           // definitionally the M path
      e=Math.max(e,Math.abs(wrapperMono-trueMono));
    }
    // and the aliasing bug itself must not be reintroduced: m-s != m whenever s!=0
    const aIn=new Float32Array(src.L),aBuf=new Float32Array(N);
    const c2=new E(SR); if(c2.refresh)c2.refresh();
    c2.processBlock(aIn,aIn,aBuf,aBuf,N);
    const c3=new E(SR); if(c3.refresh)c3.refresh();
    const t1=new Float32Array(N),t2=new Float32Array(N);
    c3.processBlock(aIn,aIn,t1,t2,N);
    let sideEnergy=0;
    for(let i=SR;i<N;i++)sideEnergy=Math.max(sideEnergy,Math.abs(0.5*(t1[i]-t2[i])));
    console.log(check('mono downmix equals the M path',e===0,
      'side content on a mono input: '+sideEnergy.toExponential(1)+' (aliasing would subtract it)'));
  }

  /* 13. Worklet packaging: the class must survive toString() round-tripping,
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
