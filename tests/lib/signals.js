/* Deterministic test signals — seeded LCG, no Math.random anywhere, so every
   figure in the test output is reproducible bit-for-bit across runs and machines. */
function lcg(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)*2-1;}

function drums(n,sr,seed){
  const rnd=lcg(seed||7),L=new Float32Array(n),R=new Float32Array(n);
  let lp=0;
  for(let i=0;i<n;i++){
    const b=i%(sr>>1);
    const kick=Math.sin(2*Math.PI*55*b/sr*Math.exp(-b/(sr*0.02))*4)*Math.exp(-b/(sr*0.05));
    const hat=((i%(sr>>2))<800?rnd()*Math.exp(-(i%(sr>>2))/300):0)*0.4;
    lp+=0.02*(rnd()-lp);
    const x=kick*0.8+hat+lp*0.25;
    L[i]=x;R[i]=x*0.9+lp*0.1;      // slightly decorrelated: a realistic stereo bus
  }
  return {L,R};
}

function pinkStereo(n,seed){
  const rnd=lcg(seed||5),L=new Float32Array(n),R=new Float32Array(n);
  let b0=0,b1=0,b2=0,c0=0,c1=0,c2=0;
  for(let i=0;i<n;i++){
    const w=rnd(),v=rnd();
    b0=0.997*b0+0.03*w;b1=0.985*b1+0.032*w;b2=0.95*b2+0.048*w;
    c0=0.997*c0+0.03*v;c1=0.985*c1+0.032*v;c2=0.95*c2+0.048*v;
    L[i]=(b0+b1+b2+w*0.05)*0.5;
    R[i]=(c0+c1+c2+v*0.05)*0.5;     // fully decorrelated: worst case for width claims
  }
  return {L,R};
}

function impulse(n,at){
  const L=new Float32Array(n),R=new Float32Array(n);
  L[at||64]=1;R[at||64]=1;
  return {L,R};
}

function corr(a,b){
  let s=0,sa=0,sb=0;
  for(let i=0;i<a.length;i++){s+=a[i]*b[i];sa+=a[i]*a[i];sb+=b[i]*b[i];}
  return sa>1e-20&&sb>1e-20?s/Math.sqrt(sa*sb):0;
}
const db=x=>20*Math.log10(Math.abs(x)+1e-30);

module.exports={lcg,drums,pinkStereo,impulse,corr,db};
