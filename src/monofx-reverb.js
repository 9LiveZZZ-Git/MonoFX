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
    for(let i=0;i<8;i++)this.bufs.push(new Float64Array(Math.ceil(0.080*2.2*sr)));
    this.lp=new Float64Array(8);this.g=new Float64Array(8);
    let pl=1;while(pl<0.15*sr)pl<<=1;
    this.preBuf=new Float64Array(pl);this.preMask=pl-1;this.preW=0;
    this._size=-1;this._decay=-1;
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
    this.refresh();
  }
  refresh(){
    if(this._size===this.size&&this._decay===this.decay)return;
    this._size=this.size;this._decay=this.decay;
    for(let i=0;i<8;i++){
      const len=Math.max(64,Math.round(this.baseMs[i]*0.001*this.size*this.sr));
      if(len!==this.lens[i]){this.lens[i]=len;this.bufs[i].fill(0);this.ptrs[i]=0;}
      this.g[i]=Math.pow(10,-3*len/(this.decay*this.sr));
    }
  }
  resetStreams(){
    for(let i=0;i<8;i++){this.bufs[i].fill(0);this.ptrs[i]=0;}
    this.lp.fill(0);this.preBuf.fill(0);this.preW=0;
    this.bypassMix=this.bypass?1:0;this.monoMix=this.mono?1:0;
  }
  processBlock(inL,inR,outL,outR,N){
    this.refresh();
    const sr=this.sr,stp=1/(0.010*sr);
    const lpc=1-Math.exp(-2*Math.PI*this.damp/sr);
    const preD=Math.max(1,Math.round(this.pre*0.001*sr));
    const mix=this.mix,wS=this.width*mix*1.5;
    const l=new Float64Array(8);
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      this.preBuf[this.preW]=M;
      const x=this.preBuf[(this.preW-preD)&this.preMask];
      this.preW=(this.preW+1)&this.preMask;
      let sum=0;
      for(let j=0;j<8;j++){l[j]=this.bufs[j][this.ptrs[j]];sum+=l[j];}
      const h=0.25*sum; // Householder: A = I - (2/8)·J
      let mT=0,sT=0;
      for(let j=0;j<8;j++){
        const f=l[(j+3)&7]-h;
        this.lp[j]+=lpc*(this.g[j]*f-this.lp[j]);
        const w=Math.abs(this.lp[j])<1e-24?0:this.lp[j];
        this.bufs[j][this.ptrs[j]]=x*0.35+w;
        this.ptrs[j]=(this.ptrs[j]+1)%this.lens[j];
        mT+=l[j];sT+=(j&1)?-l[j]:l[j];
      }
      mT*=0.185;sT*=0.185;
      const mOut=M*(1-mix)+mix*mT*1.5;  // mono path: width-independent
      const sOut=S*(1-mix*0.5)+wS*sT;
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
