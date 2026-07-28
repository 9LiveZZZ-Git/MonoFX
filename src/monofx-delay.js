/* MonoFX DelayCore — 100% mono-compatible by construction.
   One shared delay time; the echo train lives in M. Ping-pong movement comes
   from a side ring fed with alternating sign, so successive repeats tilt
   left/right as pure ILD — the S content cancels exactly on mono sum. */
class DelayCore{
  static NAME='DELAY';
  static PROC='monofx-delay';
  static PARAMS=[
    {id:'time',  label:'TIME',  min:30,  max:1500,def:380, log:true, unit:'ms', dp:0},
    {id:'fb',    label:'FEEDBK',min:0,   max:0.95,def:0.45,log:false,unit:'',   dp:2},
    {id:'tone',  label:'TONE',  min:500, max:12000,def:4500,log:true,unit:'Hz', dp:0},
    {id:'width', label:'WIDTH', min:0,   max:1,   def:0.8, log:false,unit:'',   dp:2},
    {id:'mix',   label:'MIX',   min:0,   max:1,   def:0.35,log:false,unit:'',   dp:2}
  ];
  constructor(sr){
    this.sr=sr;
    for(const p of DelayCore.PARAMS)this[p.id]=p.def;
    let len=1;while(len<2.2*sr)len<<=1;
    this.len=len;this.mask=len-1;
    this.mBuf=new Float64Array(len);this.sBuf=new Float64Array(len);
    this.wp=0;this.dCur=this.time*0.001*sr;
    this.lpM=0;this.lpS=0;this.pms=0;this.pmm=0;
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
  }
  resetStreams(){
    this.mBuf.fill(0);this.sBuf.fill(0);this.wp=0;
    this.dCur=this.time*0.001*this.sr;this.lpM=0;this.lpS=0;
    this.pms=0;this.pmm=0;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  read(buf,d){
    const p=this.wp-d,i0=Math.floor(p),fr=p-i0,m=this.mask;
    const a=buf[(i0-1)&m],b=buf[i0&m],c=buf[(i0+1)&m],e=buf[(i0+2)&m];
    const c0=b,c1=0.5*(c-a),c2=a-2.5*b+2*c-0.5*e,c3=0.5*(e-a)+1.5*(b-c);
    return ((c3*fr+c2)*fr+c1)*fr+c0;
  }
  processBlock(inL,inR,outL,outR,N){
    const sr=this.sr,stp=1/(0.010*sr);
    // Clamp to the ring as well as to the 4-sample interpolator minimum: read()
    // masks its index, so an out-of-range time would silently alias to
    // (d mod len) — time=2731 ms at 48 kHz became a 0.3 ms feedback loop.
    const dT=Math.min(this.len-4,Math.max(4,this.time*0.001*sr)),gl=1-Math.exp(-1/(0.05*sr));
    // Clamp: parameters arrive unvalidated via Object.assign from a postMessage.
    // tone above Nyquist makes lpc exceed 1 and the one-pole diverges; fb above
    // 0.95 makes the recirculation grow without bound.
    const tone=Math.min(0.49*sr,Math.max(20,this.tone));
    const fb=Math.min(0.95,Math.max(0,this.fb));
    const mix=Math.min(1,Math.max(0,this.mix)),width=Math.min(1,Math.max(0,this.width));
    const lpc=1-Math.exp(-2*Math.PI*tone/sr);
    const wS=width*mix*0.5;
    const bal=1-Math.exp(-1/(0.500*sr)); // image-balance estimator, 500 ms
    // NOT 50 ms. `al` is a ratio of two smoothed products, so it ripples at
    // twice the signal frequency; multiplying mOut by a rippling gain is
    // intermodulation. At 50 ms that cost 30-35 dB of THD in the phaser and
    // chorus (measured: chorus -62.6 dB vs -93.4 dB with the corrector off).
    // 500 ms is strictly better on BOTH axes - about 20 dB less distortion
    // AND slightly better image balance, because a steadier estimate tracks
    // the true projection instead of chasing the ripple.
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      this.dCur+=(dT-this.dCur)*gl;                 // analog-style glide
      const mWet=this.read(this.mBuf,this.dCur);
      const sWet=this.read(this.sBuf,this.dCur);
      // These one-poles sit inside the recirculation: flush denormals and
      // quarantine NaN/Inf so one bad sample cannot latch the echo train.
      const nlM=this.lpM+lpc*(mWet-this.lpM),nlS=this.lpS+lpc*(sWet-this.lpS);
      this.lpM=Number.isFinite(nlM)&&(nlM>1e-24||nlM<-1e-24)?nlM:0;
      this.lpS=Number.isFinite(nlS)&&(nlS>1e-24||nlS<-1e-24)?nlS:0;
      this.mBuf[this.wp]=M+fb*this.lpM;             // echo train (M)
      this.sBuf[this.wp]=M-fb*this.lpS;             // alternating-sign: ping-pong ILD
      this.wp=(this.wp+1)&this.mask;
      const mOut=M*(1-mix)+mix*mWet;                // mono path: width-independent
      const sW=wS*sWet;                             // ping-pong ILD
      // Image-balance corrector — see monofx-phaser.js. The side ring is fed from
      // the same M as the echo train, so E[m*sW] = 1/(1+fb^2) > 0: the loudest
      // (first) repeat always landed on the same side and the whole train sat
      // 5.2 dB left. This removes the net bias while leaving the alternation —
      // the repeats still bounce, they just no longer pull the image. Cannot
      // affect the mono sum (2m), and is identically zero at mix=0.
      const al=this.pmm>1e-20?Math.min(4,Math.max(-4,this.pms/this.pmm)):0;
      const sOut=S*(1-mix)+sW-al*mOut;
      this.pms+=bal*(mOut*sW-this.pms);
      this.pmm+=bal*(mOut*mOut-this.pmm);
      const bT=this.bypass?1:0,mT=this.mono?1:0;
      this.bypassMix+=Math.max(-stp,Math.min(stp,bT-this.bypassMix));
      this.monoMix+=Math.max(-stp,Math.min(stp,mT-this.monoMix));
      const m=mOut*(1-this.bypassMix)+M*this.bypassMix;
      const s=(sOut*(1-this.bypassMix)+S*this.bypassMix)*(1-this.monoMix);
      outL[i]=m+s;outR[i]=m-s;
    }
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports=DelayCore;
