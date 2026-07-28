/* MonoFX ChorusCore — 100% mono-compatible by construction.
   Three modulated-delay voices sum identically into M (mono hears the full
   ensemble); stereo shimmer comes only from the voice-1 minus voice-3
   difference placed in S, which cancels exactly on mono sum. */
class ChorusCore{
  static NAME='CHORUS';
  static PROC='monofx-chorus';
  static PARAMS=[
    {id:'rate',  label:'RATE',  min:0.05,max:3,  def:0.5, log:true, unit:'Hz', dp:2},
    {id:'depth', label:'DEPTH', min:0,   max:1,  def:0.5, log:false,unit:'',   dp:2},
    {id:'voxmix',label:'VOICES',min:0,   max:1,  def:0.8, log:false,unit:'',   dp:2},
    {id:'width', label:'WIDTH', min:0,   max:1,  def:0.8, log:false,unit:'',   dp:2},
    {id:'mix',   label:'MIX',   min:0,   max:1,  def:0.5, log:false,unit:'',   dp:2}
  ];
  constructor(sr){
    this.sr=sr;
    for(const p of ChorusCore.PARAMS)this[p.id]=p.def;
    let len=1;while(len<0.06*sr)len<<=1;
    this.len=len;this.mask=len-1;
    this.buf=new Float64Array(len);this.wp=0;
    this.ph=[0,2.094,4.189];this.rMul=[1,0.87,1.13];this.base=[0.008,0.014,0.022];
    this.v=[0,0,0];   // per-sample scratch, hoisted out of processBlock
    this.pms=0;this.pmm=0;   // image-balance estimator
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
  }
  resetStreams(){
    // Write into the existing array rather than replacing it: resetStreams may be
    // wired to a host transport callback, and that must not allocate.
    this.buf.fill(0);this.wp=0;this.pms=0;this.pmm=0;
    this.ph[0]=0;this.ph[1]=2.094;this.ph[2]=4.189;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  read(d){
    const p=this.wp-d,i0=Math.floor(p),fr=p-i0,m=this.mask,b=this.buf;
    const a=b[(i0-1)&m],c0=b[i0&m],c=b[(i0+1)&m],e=b[(i0+2)&m];
    const k1=0.5*(c-a),k2=a-2.5*c0+2*c-0.5*e,k3=0.5*(e-a)+1.5*(c0-c);
    return ((k3*fr+k2)*fr+k1)*fr+c0;
  }
  processBlock(inL,inR,outL,outR,N){
    const sr=this.sr,stp=1/(0.010*sr);
    // Clamp: parameters arrive unvalidated via Object.assign from a postMessage.
    const rate=Math.min(20,Math.max(0,this.rate)),depth=Math.min(1,Math.max(0,this.depth)),
          mix=Math.min(1,Math.max(0,this.mix)),width=Math.min(1,Math.max(0,this.width)),
          vx=Math.min(1,Math.max(0,this.voxmix));
    const modS=(0.0005+depth*0.004)*sr;        // 0.5–4.5 ms sweep
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
      this.buf[this.wp]=M;
      const v=this.v;
      for(let j=0;j<3;j++){
        const d=Math.min(this.len-4,Math.max(4,this.base[j]*sr+modS*Math.sin(this.ph[j])));
        this.ph[j]+=2*Math.PI*rate*this.rMul[j]/sr;
        if(this.ph[j]>2*Math.PI)this.ph[j]-=2*Math.PI;
        v[j]=this.read(d);
      }
      this.wp=(this.wp+1)&this.mask;
      const ens=(v[0]+v[1]*vx+v[2])/(2+vx);
      const mOut=M*(1-mix)+mix*0.5*(M+ens)*1.4142; // mono path: width-independent
      const sW=wS*(v[0]-v[2]);                     // shimmer: voice 1 minus voice 3
      // Image-balance corrector — see monofx-phaser.js. Voices 1 and 3 are also in
      // the mid ensemble, and their base delays differ (8 vs 22 ms), so E[m*sW]
      // is non-zero and WIDTH panned the image by up to 1.7 dB. Removing the
      // projection onto the mid cannot alter the mono sum (2m) and is identically
      // zero at mix=0, where sW is zero.
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
if(typeof module!=='undefined'&&module.exports)module.exports=ChorusCore;
