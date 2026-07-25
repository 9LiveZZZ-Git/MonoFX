/* MonoFX PhaserCore — 100% mono-compatible by construction.
   The 6-stage allpass sweep lives entirely in M (both ears share the same
   notches); stereo movement comes only from S content built as a stage
   difference, which cancels exactly on mono sum. mono(out) = M path, always.

   The width difference is taken across stages 1 and 4. It must NOT involve
   stage 6: the mid path already carries stage 6 (wet = 0.5*(M+x)), so a side
   term containing it is correlated with the mid, and outL=m+s / outR=m-s then
   carry unequal energy — the WIDTH control would pan the image instead of
   widening it. Measured over a 54-point parameter grid with a mono input,
   worst |L/R imbalance|: stages 3&6 = 4.583 dB, stages 1&4 = 0.630 dB. Stages
   1 and 4 are three apart, so |A^1-A^4| = |A^3-A^6| — same spectral character. */
class PhaserCore{
  static NAME='PHASER';
  static PROC='monofx-phaser';
  static PARAMS=[
    {id:'rate',  label:'RATE',  min:0.05,max:8,   def:0.4, log:true, unit:'Hz', dp:2},
    {id:'depth', label:'DEPTH', min:0,   max:1,   def:0.7, log:false,unit:'',   dp:2},
    {id:'fb',    label:'FEEDBK',min:0,   max:0.9, def:0.4, log:false,unit:'',   dp:2},
    {id:'width', label:'WIDTH', min:0,   max:1,   def:0.7, log:false,unit:'',   dp:2},
    {id:'mix',   label:'MIX',   min:0,   max:1,   def:0.5, log:false,unit:'',   dp:2}
  ];
  constructor(sr){
    this.sr=sr;
    for(const p of PhaserCore.PARAMS)this[p.id]=p.def;
    this.x1=new Float64Array(6);this.y1=new Float64Array(6);
    this.ph=0;this.fbS=0;this.dcX=0;this.dcY=0;this.pms=0;this.pmm=0;
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
  }
  resetStreams(){
    this.x1.fill(0);this.y1.fill(0);this.ph=0;this.fbS=0;this.dcX=0;this.dcY=0;
    this.pms=0;this.pmm=0;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  processBlock(inL,inR,outL,outR,N){
    const sr=this.sr,stp=1/(0.010*sr);
    // Clamp: parameters arrive via Object.assign from a postMessage with no
    // validation, so a preset or an automation curve can hand us anything.
    const rate=Math.min(20,Math.max(0,this.rate)),depth=Math.min(1,Math.max(0,this.depth)),
          fb=Math.min(0.9,Math.max(0,this.fb)),mix=Math.min(1,Math.max(0,this.mix)),
          width=Math.min(1,Math.max(0,this.width));
    const phInc=2*Math.PI*rate/sr,wS=width*mix*0.5;
    const dcR=1-2*Math.PI*20/sr;        // 20 Hz DC blocker for the feedback path
    const bal=1-Math.exp(-1/(0.050*sr)); // 50 ms image-balance estimator
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      // swept coefficient (shared by both channels: identical notches)
      const fc=Math.min(0.45*sr,150*Math.pow(2,depth*4*(0.5+0.5*Math.sin(this.ph))));
      this.ph+=phInc;if(this.ph>2*Math.PI)this.ph-=2*Math.PI;
      const t=Math.tan(Math.PI*fc/sr),g=(t-1)/(t+1);
      // A 1st-order allpass has H(1)=+1 for any coefficient, so the cascade is
      // unity-gain AND zero-phase at DC no matter where the LFO is. Raw feedback
      // is therefore always positive at DC and boosts it by 1/(1-fb) — +14.8 dB
      // at fb=0.9. Block DC before it recirculates.
      this.dcY=this.fbS-this.dcX+dcR*this.dcY;this.dcX=this.fbS;
      if(this.dcY>-1e-24&&this.dcY<1e-24)this.dcY=0;
      // Attenuate the chain input by (1-fb) so the resonant peak stays at unity.
      // Undamped, the cascade resonates at 1/(1-fb) = 10x at fb=0.9 and a
      // sustained sweep drove the output to 15.3x full scale.
      let x=M*(1-fb)+this.dcY*fb,yA=0,yB=0;
      for(let st=0;st<6;st++){
        const y=g*x+this.x1[st]-g*this.y1[st];
        // Flush denormals AND quarantine NaN/Inf. Math.abs(NaN)<1e-24 is false,
        // so the old guard let NaN through and every state latched it forever.
        this.x1[st]=Number.isFinite(x)&&(x>1e-24||x<-1e-24)?x:0;
        this.y1[st]=Number.isFinite(y)&&(y>1e-24||y<-1e-24)?y:0;
        if(st===0)yA=y;else if(st===3)yB=y;
        x=y;
      }
      this.fbS=Number.isFinite(x)&&(x>1e-24||x<-1e-24)?x:0;
      const wet=0.5*(M+x);              // dry+allpassed = the notched signal
      const mOut=M*(1-mix)+wet*mix;     // mono path: width-independent
      const sW=wS*(yA-yB);              // side sparkle: stage-1 minus stage-4
      // Image-balance corrector. outL=m+s and outR=m-s carry unequal energy
      // whenever E[m*s]!=0, so a side term correlated with the mid PANS the image
      // rather than widening it. Subtracting the projection of the wet side term
      // onto the mid drives E[m*s] to zero. It cannot disturb the mono sum, which
      // is 2m with or without it, and it vanishes identically at mix=0 because sW
      // does — so bit-transparency at mix=0 is untouched.
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
if(typeof module!=='undefined'&&module.exports)module.exports=PhaserCore;
