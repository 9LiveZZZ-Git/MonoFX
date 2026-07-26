#!/usr/bin/env node
/* Differential test vector generator.
 *
 * Renders the JS reference cores over a matrix of (core x params x signal x
 * sample rate x host block size) and writes the inputs AND outputs as raw
 * float64. The C++ port loads the same files and compares per sample.
 *
 * Why dump the INPUTS too, rather than have C++ regenerate them: if the port
 * reimplements drums() with one different constant, every case fails and it
 * looks like a DSP bug. Reading the same bytes removes signal generation as a
 * variable, so a failure can only mean the DSP diverged.
 *
 * Why float64 rather than float32: the headline invariant is a float64
 * identity. Rounding the vectors to float32 would cap the harness at the 1-ULP
 * float32 floor and lose the ability to tell "algebraically correct" from
 * "close" — the exact distinction the VERIFY button exists to make.
 *
 * Output is NOT committed (see .gitignore); it is a pure function of this
 * repo, so CI regenerates it before running the C++ suite.
 *
 *   node tools/gen-vectors.js [outDir]     # default: vectors/
 */
'use strict';
const fs=require('fs'),path=require('path');
const {drums,pinkStereo,sweep,impulse}=require('../tests/lib/signals.js');

const CORES={
  PHASER:require('../src/monofx-phaser.js'),
  DELAY :require('../src/monofx-delay.js'),
  REVERB:require('../src/monofx-reverb.js'),
  CHORUS:require('../src/monofx-chorus.js'),
};

const OUT=path.resolve(process.argv[2]||path.join(__dirname,'..','vectors'));
fs.mkdirSync(OUT,{recursive:true});

/* ---------- signals ---------------------------------------------------- */
// Deterministic and seeded. Keyed by name+rate so a case can request any of
// them at any rate without regenerating.
const SIGNALS={
  drums : (n,sr)=>drums(n,sr,7),
  pink  : (n)   =>pinkStereo(n,5),
  sweep : (n,sr)=>sweep(n,sr),
  // A mono input: S is identically zero, so any L/R energy difference in the
  // output is the core biasing the image on its own.
  mono  : (n,sr)=>{const d=drums(n,sr,7);return {L:d.L,R:d.L};},
  // Impulse: exposes the whole impulse response, including the tail that
  // steady-state material averages away.
  imp   : (n)   =>impulse(n,64),     // already returns {L,R}
};

/* ---------- case matrix ------------------------------------------------ */
// Each entry lists the parameters EXPLICITLY rather than relying on defaults,
// so a change to a default cannot silently retune the vectors.
function paramSets(E){
  const def={},min={},max={};
  for(const p of E.PARAMS){def[p.id]=p.def;min[p.id]=p.min;max[p.id]=p.max;}
  return [
    ['def',    def],
    ['min',    min],
    ['max',    max],
    ['w0',     {...def,width:0}],     // width extremes: the invariant's two ends
    ['w1',     {...def,width:1}],
    ['mix0',   {...def,mix:0}],       // must be bit-transparent
    ['mix1',   {...def,mix:1}],
    ['w1mix1', {...def,width:1,mix:1}],
  ];
}

const cases=[];
const inputs=new Map();   // key -> {file, n, sr}

function inputKey(sig,sr,n){return `${sig}_${sr}_${n}`;}

function addCase(core,psName,params,sig,sr,n,block){
  const ik=inputKey(sig,sr,n);
  if(!inputs.has(ik)){
    const s=SIGNALS[sig](n,sr);
    // Fail loudly on a malformed signal. A generator that silently writes
    // undefined produces NaN vectors, and a NaN reference makes every
    // comparison against it succeed (`d > max` is false for NaN) — so the
    // affected cases pass while testing nothing. That happened here: `imp`
    // returned {L:{L,R},R:{L,R}} and four cases were green on pure NaN.
    if(!s||!s.L||!s.R||s.L.length<n||s.R.length<n)
      throw new Error(`signal '${sig}' did not return {L,R} of length >= ${n}`);
    const buf=Buffer.allocUnsafe(n*2*8);
    for(let i=0;i<n;i++){
      if(!Number.isFinite(s.L[i])||!Number.isFinite(s.R[i]))
        throw new Error(`signal '${sig}' produced a non-finite sample at ${i}`);
      buf.writeDoubleLE(s.L[i],i*16);buf.writeDoubleLE(s.R[i],i*16+8);
    }
    const file=`in_${ik}.f64`;
    fs.writeFileSync(path.join(OUT,file),buf);
    inputs.set(ik,{file,n,sr,signal:sig,L:s.L,R:s.R});
  }
  const inp=inputs.get(ik);
  const E=CORES[core];
  const c=new E(sr);
  Object.assign(c,params);
  if(c.refresh)c.refresh();

  // Render float64 in and float64 out. The JS cores accept any indexable
  // buffer; using Float64Array both sides keeps the reference at full precision.
  const iL=Float64Array.from(inp.L),iR=Float64Array.from(inp.R);
  const oL=new Float64Array(n),oR=new Float64Array(n);
  if(!block){
    c.processBlock(iL,iR,oL,oR,n);
  }else{
    const tL=new Float64Array(block),tR=new Float64Array(block),
          aL=new Float64Array(block),aR=new Float64Array(block);
    for(let off=0;off<n;off+=block){
      const k=Math.min(block,n-off);
      for(let i=0;i<k;i++){tL[i]=iL[off+i];tR[i]=iR[off+i];}
      c.processBlock(tL,tR,aL,aR,k);
      for(let i=0;i<k;i++){oL[off+i]=aL[i];oR[off+i]=aR[i];}
    }
  }
  const id=`${core}_${psName}_${sig}_${sr}_${block||'whole'}`;
  const buf=Buffer.allocUnsafe(n*2*8);
  for(let i=0;i<n;i++){buf.writeDoubleLE(oL[i],i*16);buf.writeDoubleLE(oR[i],i*16+8);}
  const file=`out_${id}.f64`;
  fs.writeFileSync(path.join(OUT,file),buf);

  let peak=0;
  for(let i=0;i<n;i++){
    if(!Number.isFinite(oL[i])||!Number.isFinite(oR[i]))
      throw new Error(`${id}: reference render produced a non-finite sample at ${i}`);
    peak=Math.max(peak,Math.abs(oL[i]),Math.abs(oR[i]));
  }
  cases.push({id,core,params,signal:sig,sr,n,block:block||0,
              input:inp.file,expected:file,peak});
}

const SR_MAIN=48000, N_MAIN=48000;          // 1 second
for(const core of Object.keys(CORES)){
  const E=CORES[core];
  for(const [nm,p] of paramSets(E)){
    addCase(core,nm,p,'drums',SR_MAIN,N_MAIN,0);
  }
  const def={};for(const q of E.PARAMS)def[q.id]=q.def;
  // Other material: decorrelated, sustained, mono, and a bare impulse response.
  for(const sig of ['pink','sweep','mono','imp'])
    addCase(core,'def',def,sig,SR_MAIN,N_MAIN,0);
  // Streaming: a block size commensurate with nothing, to catch state that is
  // carried across calls incorrectly.
  addCase(core,'def',def,'drums',SR_MAIN,N_MAIN,128);
  addCase(core,'def',def,'drums',SR_MAIN,N_MAIN,441);
  // Rate dependence: every coefficient in these cores is derived from sr.
  for(const sr of [44100,96000])
    addCase(core,'def',def,'drums',sr,sr,0);
}

/* ---------- transcendental parity probe --------------------------------- */
// The cores' actual argument ranges. ECMAScript defines sin/cos/tan/exp/pow/
// log/atan2 as implementation-approximated: V8 uses fdlibm, C++ uses the
// platform libm. This records what V8 returned so the port can measure the gap
// for the arguments that matter, rather than in the abstract.
function mathProbe(){
  const rows=[];
  const push=(fn,a,b)=>rows.push({fn,a,b:b===undefined?0:b,y:b===undefined?Math[fn](a):Math[fn](a,b)});
  const NP=2000;
  for(let i=0;i<NP;i++){
    const u=i/(NP-1);
    push('sin',u*2*Math.PI);                       // LFO phase
    push('cos',u*2*Math.PI);
    push('tan',Math.PI*(150+u*(0.45*48000-150))/48000); // allpass coefficient
    push('exp',-u*20);                             // one-pole coefficients
    push('pow',2,u*4);                             // phaser depth curve
    push('pow',10,-3*u);                           // FDN decay law
    push('log',1e-6+u*10);
    push('atan2',u*2-1,1-u);
    push('hypot',u*2-1,1-u);
  }
  const buf=Buffer.allocUnsafe(rows.length*24);
  rows.forEach((r,i)=>{buf.writeDoubleLE(r.a,i*24);buf.writeDoubleLE(r.b,i*24+8);
                       buf.writeDoubleLE(r.y,i*24+16);});
  fs.writeFileSync(path.join(OUT,'math.f64'),buf);
  return {file:'math.f64',count:rows.length,
          order:[...new Set(rows.map(r=>r.fn))],
          layout:'a,b,y as float64 LE; fn cycles through `sequence` per group',
          sequence:rows.slice(0,9).map(r=>r.fn)};
}
const math=mathProbe();

fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify({
  formatVersion:1,
  note:'Raw little-endian float64, interleaved L,R. Regenerate with `npm run vectors`.',
  math,cases
},null,2));

const bytes=fs.readdirSync(OUT).reduce((a,f)=>a+fs.statSync(path.join(OUT,f)).size,0);
console.log(`wrote ${cases.length} cases + ${inputs.size} inputs + math probe (${math.count} rows) `+
            `to ${path.relative(process.cwd(),OUT)}/ (${(bytes/1048576).toFixed(1)} MB)`);
