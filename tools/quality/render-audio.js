/* Renders listenable 24-bit WAV files. The audit could measure everything except
   how it SOUNDS; this closes that by producing files a human can A/B, including
   the mono fold that is the product's whole point. */
'use strict';
const path=require('path'),fs=require('fs');
const {writeWav}=require('./lib.js');
const CORES={
  phaser:require(path.join(__dirname,'../../src/monofx-phaser.js')),
  delay :require(path.join(__dirname,'../../src/monofx-delay.js')),
  reverb:require(path.join(__dirname,'../../src/monofx-reverb.js')),
  chorus:require(path.join(__dirname,'../../src/monofx-chorus.js')),
};
const SR=48000;
const OUT=process.argv[2]||path.join(__dirname,'../../quality-out/audio');
fs.mkdirSync(OUT,{recursive:true});

/* A musical-ish test bed: chord stabs + a hat pattern + a bass note. Noise and
   sines do not reveal smearing, flutter or thinness the way pitched material does. */
function source(secs){
  const N=Math.round(SR*secs);
  const L=new Float64Array(N),R=new Float64Array(N);
  let s=99;const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296)*2-1;
  const notes=[220,277.18,329.63,440];      // A minor-ish
  for(let i=0;i<N;i++){
    const t=i/SR;
    let v=0;
    // chord stabs every 1 s, 0.6 s decay
    const ph=t%1.0;
    if(ph<0.6){const env=Math.exp(-ph*5);
      for(const f of notes)v+=Math.sin(2*Math.PI*f*t)*env*0.10;}
    // bass every 0.5 s
    const pb=t%0.5;
    v+=Math.sin(2*Math.PI*55*t)*Math.exp(-pb*9)*0.25;
    // hats every 0.25 s
    const phh=t%0.25;
    if(phh<0.02)v+=rnd()*Math.exp(-phh*260)*0.18;
    L[i]=v;R[i]=v;                            // MONO source: all width is the effect's
  }
  return {L,R,N};
}
const {L,R,N}=source(8);
function render(name,ov){
  const E=CORES[name];
  const c=new E(SR);Object.assign(c,ov);if(c.refresh)c.refresh();c.resetStreams();
  const oL=new Float64Array(N),oR=new Float64Array(N);
  c.processBlock(L,R,oL,oR,N);
  return {oL,oR};
}
const files=[];
writeWav(path.join(OUT,'00-source-dry.wav'),L,R,SR);files.push('00-source-dry.wav');
for(const nm of Object.keys(CORES)){
  const w=render(nm,{mix:nm==='reverb'?0.45:0.6,width:1});
  writeWav(path.join(OUT,`${nm}-stereo.wav`),w.oL,w.oR,SR);
  // the mono fold: what a club PA / phone speaker / vinyl cutter hears
  const m=new Float64Array(N);for(let i=0;i<N;i++)m[i]=0.5*(w.oL[i]+w.oR[i]);
  writeWav(path.join(OUT,`${nm}-MONO-FOLD.wav`),m,m,SR);
  files.push(`${nm}-stereo.wav`,`${nm}-MONO-FOLD.wav`);
}
// the reverb's audible defects, isolated
{
  const w=render('reverb',{mix:1,width:0,size:1,decay:2.2,pre:0});
  const imp=new Float64Array(SR*3),impR=new Float64Array(SR*3);
  imp[0]=impR[0]=1;
  const c=new CORES.reverb(SR);Object.assign(c,{mix:1,width:0,size:1,decay:2.2,pre:0,damp:16000});
  c.refresh();c.resetStreams();
  const iL=new Float64Array(SR*3),iR=new Float64Array(SR*3);
  c.processBlock(imp,impR,iL,iR,SR*3);
  // normalise so the +17 dB tick at ~394 ms is easy to hear
  let pk=0;for(let i=2000;i<iL.length;i++)pk=Math.max(pk,Math.abs(iL[i]));
  const g=0.7/pk;const nL=new Float64Array(iL.length);
  for(let i=0;i<iL.length;i++)nL[i]=iL[i]*g;
  writeWav(path.join(OUT,'reverb-IR-normalised.wav'),nL,nL,SR);
  files.push('reverb-IR-normalised.wav  <- listen at ~0.39 s for the coincidence tick');
}
console.log('wrote '+files.length+' files to '+path.relative(process.cwd(),OUT)+':');
for(const f of files)console.log('  '+f);
