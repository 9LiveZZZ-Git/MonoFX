/* MonoFX PhaserCore — 100% mono-compatible by construction.
   The 6-stage allpass sweep lives entirely in M (both ears share the same
   notches); stereo movement comes only from S content built as a stage
   difference, which cancels exactly on mono sum. mono(out) = M path, always. */
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
    this.ph=0;this.fbS=0;
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
  }
  resetStreams(){
    this.x1.fill(0);this.y1.fill(0);this.ph=0;this.fbS=0;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  processBlock(inL,inR,outL,outR,N){
    const sr=this.sr,stp=1/(0.010*sr),phInc=2*Math.PI*this.rate/sr;
    const mix=this.mix,wS=this.width*mix*0.5,fb=this.fb;
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      // swept coefficient (shared by both channels: identical notches)
      const fc=Math.min(0.45*sr,150*Math.pow(2,this.depth*4*(0.5+0.5*Math.sin(this.ph))));
      this.ph+=phInc;if(this.ph>2*Math.PI)this.ph-=2*Math.PI;
      const t=Math.tan(Math.PI*fc/sr),g=(t-1)/(t+1);
      let x=M+this.fbS*fb,y3=0;
      for(let st=0;st<6;st++){
        const y=g*x+this.x1[st]-g*this.y1[st];
        this.x1[st]=x;this.y1[st]=y;
        if(st===2)y3=y;
        x=y;
      }
      this.fbS=Math.abs(x)<1e-24?0:x;
      const wet=0.5*(M+x);              // dry+allpassed = the notched signal
      const mOut=M*(1-mix)+wet*mix;     // mono path: width-independent
      const sOut=S+wS*(y3-x);           // side sparkle: stage-3 minus stage-6
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
