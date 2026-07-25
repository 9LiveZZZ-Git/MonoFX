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
    this.bypass=false;this.mono=false;this.bypassMix=0;this.monoMix=0;
  }
  resetStreams(){
    this.buf.fill(0);this.wp=0;this.ph=[0,2.094,4.189];
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
    const modS=(0.0005+this.depth*0.004)*sr;   // 0.5–4.5 ms sweep
    const mix=this.mix,wS=this.width*mix*0.5,vx=this.voxmix;
    for(let i=0;i<N;i++){
      const L=inL[i],R=inR[i],M=0.5*(L+R),S=0.5*(L-R);
      this.buf[this.wp]=M;
      const v=[0,0,0];
      for(let j=0;j<3;j++){
        const d=Math.max(4,this.base[j]*sr+modS*Math.sin(this.ph[j]));
        this.ph[j]+=2*Math.PI*this.rate*this.rMul[j]/sr;
        if(this.ph[j]>2*Math.PI)this.ph[j]-=2*Math.PI;
        v[j]=this.read(d);
      }
      this.wp=(this.wp+1)&this.mask;
      const ens=(v[0]+v[1]*vx+v[2])/(2+vx);
      const mOut=M*(1-mix)+mix*0.5*(M+ens)*1.4142; // mono path: width-independent
      const sOut=S+wS*(v[0]-v[2]);
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
