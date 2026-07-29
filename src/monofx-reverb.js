/* MonoFX ReverbCore — 100% mono-compatible by construction.
   8-line FDN with a Householder feedback matrix. The M tail is the all-plus
   tap combination; the S tail is the orthogonal alternating-sign combination
   (decorrelated from M, cancels exactly on mono sum). Width scales S only,
   so mono listeners always hear the complete designed M tail. */
class ReverbCore{
  static NAME='REVERB';
  static PROC='monofx-reverb';
  static PARAMS=[
    {id:'size',  label:'SIZE',  min:0.4, max:2,   def:1,   log:false,unit:'',   dp:2},
    {id:'decay', label:'DECAY', min:0.3, max:12,  def:2.2, log:true, unit:'s',  dp:1},
    {id:'damp',  label:'DAMP',  min:1000,max:16000,def:6000,log:true,unit:'Hz', dp:0},
    {id:'pre',   label:'PREDLY',min:0,   max:120, def:20,  log:false,unit:'ms', dp:0},
    {id:'width', label:'WIDTH', min:0,   max:1,   def:1,   log:false,unit:'',   dp:2},
    {id:'mix',   label:'MIX',   min:0,   max:1,   def:0.3, log:false,unit:'',   dp:2}
  ];
  constructor(sr){
    this.sr=sr;
    for(const p of ReverbCore.PARAMS)this[p.id]=p.def;
    this.baseMs=[29.7,37.1,41.1,43.7,53.3,59.5,61.3,68.9];
    this.bufs=[];this.ptrs=new Int32Array(8);this.lens=new Int32Array(8);
    this.lp=new Float64Array(8);this.g=new Float64Array(8);
    this.l=new Float64Array(8);   // per-sample scratch, hoisted out of processBlock
    this.pms=0;this.pmm=0;        // image-balance estimator
    this._size=-1;this._decay=-1;this._sr=-1;
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
    this.alloc();
    this.refresh();
  }
  // Sized from sr, so it must re-run if the host changes rate. Called from
  // refresh(), which means a rate change allocates — that is a prepare-time
  // event, not an audio-thread one. A C++ port does this in prepareToPlay.
  alloc(){
    const need=Math.ceil(0.080*2.2*this.sr);
    if(!this.bufs.length||this.bufs[0].length<need){
      this.bufs=[];for(let i=0;i<8;i++)this.bufs.push(new Float64Array(need));
      this.lens.fill(0);this.ptrs.fill(0);this.lp.fill(0);
    }
    let pl=1;while(pl<0.15*this.sr)pl<<=1;
    if(!this.preBuf||this.preBuf.length<pl){
      this.preBuf=new Float64Array(pl);this.preMask=pl-1;this.preW=0;
    }
  }
  refresh(){
    if(this._size===this.size&&this._decay===this.decay&&this._sr===this.sr)return;
    if(this._sr!==this.sr)this.alloc();
    this._size=this.size;this._decay=this.decay;this._sr=this.sr;
    for(let i=0;i<8;i++){
      // Clamp to the allocated line. Without it, size>2.55 walks the pointer past
      // the end, and out-of-range typed-array reads yield undefined -> NaN forever.
      const len=Math.min(this.bufs[i].length,
        Math.max(64,Math.round(this.baseMs[i]*0.001*this.size*this.sr)));
      // Do NOT zero the line on a length change. SIZE is a normally-automated
      // parameter, and wiping the buffer dropped the entire tail to digital
      // silence for the whole drag. Re-pointing is a far smaller artefact.
      if(len!==this.lens[i]){this.lens[i]=len;if(this.ptrs[i]>=len)this.ptrs[i]=0;}
      this.g[i]=Math.pow(10,-3*len/(Math.max(1e-3,this.decay)*this.sr));
    }
  }
  resetStreams(){
    for(let i=0;i<8;i++){this.bufs[i].fill(0);this.ptrs[i]=0;}
    this.lp.fill(0);this.preBuf.fill(0);this.preW=0;this.pms=0;this.pmm=0;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  processBlock(inL,inR,outL,outR,N){
    this.refresh();
    const sr=this.sr,stp=1/(0.010*sr);
    // Clamp: parameters arrive unvalidated via Object.assign from a postMessage.
    // A negative damp makes lpc negative and the one-pole diverges — a damp of
    // -14000 ran the output away to -2.8e8.
    const damp=Math.min(0.49*sr,Math.max(20,this.damp));
    const mix=Math.min(1,Math.max(0,this.mix)),width=Math.min(1,Math.max(0,this.width));
    const lpc=1-Math.exp(-2*Math.PI*damp/sr);
    const preD=Math.min(this.preMask,Math.max(1,Math.round(Math.max(0,this.pre)*0.001*sr)));
    const wS=width*mix*1.5;
    const bal=1-Math.exp(-1/(0.500*sr)); // image-balance estimator, 500 ms
    // NOT 50 ms. `al` is a ratio of two smoothed products, so it ripples at
    // twice the signal frequency; multiplying mOut by a rippling gain is
    // intermodulation. At 50 ms that cost 30-35 dB of THD in the phaser and
    // chorus (measured: chorus -62.6 dB vs -93.4 dB with the corrector off).
    // 500 ms is strictly better on BOTH axes - about 20 dB less distortion
    // AND slightly better image balance, because a steadier estimate tracks
    // the true projection instead of chasing the ripple.
    const l=this.l;
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      // Quarantine NaN/Inf on the way INTO the state, not just denormals. The
      // guard below used to be Math.abs(v)<1e-24, and Math.abs(NaN)<1e-24 is
      // false, so one bad sample latched the whole FDN permanently: 97.5% of all
      // subsequent output non-finite, recovering never. The phaser and delay were
      // fixed on 2026-07-25; the reverb was missed because its regression test
      // checks the FIRST block after injection, and the shortest line is 29.7 ms
      // (~5.6 blocks at 256), so the NaN had not circulated back yet.
      this.preBuf[this.preW]=Number.isFinite(M)?M:0;
      const xr=this.preBuf[(this.preW-preD)&this.preMask];
      const x=Number.isFinite(xr)?xr:0;
      this.preW=(this.preW+1)&this.preMask;
      let sum=0;
      for(let j=0;j<8;j++){l[j]=this.bufs[j][this.ptrs[j]];sum+=l[j];}
      const h=0.25*sum; // Householder: A = I - (2/8)·J
      let mT=0,sT=0;
      for(let j=0;j<8;j++){
        const f=l[(j+3)&7]-h;
        const nl=this.lp[j]+lpc*(this.g[j]*f-this.lp[j]);
        // Same flush-and-quarantine as the phaser and delay: finite AND above
        // the denormal threshold, or zero.
        this.lp[j]=Number.isFinite(nl)&&(nl>1e-24||nl<-1e-24)?nl:0;
        this.bufs[j][this.ptrs[j]]=x*0.35+this.lp[j];
        this.ptrs[j]=(this.ptrs[j]+1)%this.lens[j];
        mT+=l[j];sT+=(j&1)?-l[j]:l[j];
      }
      mT*=0.185;sT*=0.185;
      const mOut=M*(1-mix)+mix*mT*1.5;  // mono path: width-independent
      // Same dry law as the mid path. The old (1-mix*0.5) left half the dry SIDE
      // in the output at mix=1, so a "100% wet" reverb still passed the dry
      // signal at -6.02 dB — audible as the source reprinting through an aux send.
      const sW=wS*sT;
      // Image-balance corrector — see monofx-phaser.js. The all-plus and
      // alternating-sign taps are orthogonal by construction, so this stays small
      // here; it is applied for consistency and to hold the image as the line
      // lengths change. Cannot affect the mono sum (2m); zero at mix=0.
      const al=this.pmm>1e-20?Math.min(4,Math.max(-4,this.pms/this.pmm)):0;
      const sOut=S*(1-mix)+sW-al*mOut;
      // Guard the accumulators too. Without this, one NaN latches pms/pmm
      // forever; the OUTPUT survives (NaN>1e-20 is false, so al falls back to 0)
      // but the image-balance corrector is then silently dead for the rest of
      // the session - the worst kind of failure, because nothing looks wrong.
      const npms=this.pms+bal*(mOut*sW-this.pms),npmm=this.pmm+bal*(mOut*mOut-this.pmm);
      this.pms=Number.isFinite(npms)?npms:0;
      this.pmm=Number.isFinite(npmm)?npmm:0;
      const bT=this.bypass?1:0,mTn=this.mono?1:0;
      this.bypassMix+=Math.max(-stp,Math.min(stp,bT-this.bypassMix));
      this.monoMix+=Math.max(-stp,Math.min(stp,mTn-this.monoMix));
      const m=mOut*(1-this.bypassMix)+M*this.bypassMix;
      const s=(sOut*(1-this.bypassMix)+S*this.bypassMix)*(1-this.monoMix);
      outL[i]=m+s;outR[i]=m-s;
    }
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports=ReverbCore;
