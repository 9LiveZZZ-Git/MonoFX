/* Shared helpers for the quality suite: FFT, windows, WAV writing, loudness. */
'use strict';

function fft(re,im,inv){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;
    if(i<j){const tr=re[i];re[i]=re[j];re[j]=tr;const ti=im[i];im[i]=im[j];im[j]=ti;}}
  for(let len=2;len<=n;len<<=1){
    const ang=2*Math.PI/len*(inv?1:-1),wr=Math.cos(ang),wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){let cr=1,ci=0;
      for(let k=0;k<len/2;k++){
        const ur=re[i+k],ui=im[i+k];
        const vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci, vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
        re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;
        const nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;}}}
  if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
const nextPow2=x=>{let p=1;while(p<x)p*=2;return p;};
function hann(n){const w=new Float64Array(n);for(let i=0;i<n;i++)w[i]=0.5*(1-Math.cos(2*Math.PI*i/n));return w;}

// magnitude spectrum of one frame
function mag(x,off,W,win){
  const re=new Float64Array(W),im=new Float64Array(W);
  for(let i=0;i<W;i++){re[i]=(x[off+i]||0)*win[i];im[i]=0;}
  fft(re,im,false);
  const H=W>>1,m=new Float64Array(H+1);
  for(let k=0;k<=H;k++)m[k]=Math.hypot(re[k],im[k]);
  return m;
}

/* ITU-R BS.1770-4 gated loudness (LUFS). RMS is the wrong tool for judging
   whether two plugins are level-matched — the ear is not flat, and the suite's
   gain spread should be judged the way a mastering engineer would hear it. */
function lufs(L,R,sr){
  // stage 1: shelving high-pass ("K" pre-filter), stage 2: RLB high-pass.
  // Coefficients from the spec are given at 48 kHz; re-derive by bilinear
  // transform so other rates are honest rather than approximate.
  const biquad=(x,b0,b1,b2,a1,a2)=>{
    const y=new Float64Array(x.length);let x1=0,x2=0,y1=0,y2=0;
    for(let i=0;i<x.length;i++){
      const v=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;
      x2=x1;x1=x[i];y2=y1;y1=v;y[i]=v;}
    return y;};
  // shelf: +4 dB above ~1681 Hz
  const f0=1681.974450955533, G=3.999843853973347, Q=0.7071752369554196;
  const K=Math.tan(Math.PI*f0/sr), Vh=Math.pow(10,G/20), Vb=Math.pow(Vh,0.4996667741545416);
  const a0_=1+K/Q+K*K;
  const sb0=(Vh+Vb*K/Q+K*K)/a0_, sb1=2*(K*K-Vh)/a0_, sb2=(Vh-Vb*K/Q+K*K)/a0_;
  const sa1=2*(K*K-1)/a0_, sa2=(1-K/Q+K*K)/a0_;
  // RLB high-pass at ~38 Hz
  const f2=38.13547087602444, Q2=0.5003270373238773;
  const K2=Math.tan(Math.PI*f2/sr), d0=1+K2/Q2+K2*K2;
  // Normalise the numerator by d0 too. Deriving a1/a2 by bilinear (which divides
  // by d0) while leaving b=[1,-2,1] un-normalised leaves a constant +0.043 dB
  // gain error in this stage. Negligible for the relative comparisons it was
  // used for, but wrong.
  const hb0=1/d0, hb1=-2/d0, hb2=1/d0;
  const ha1=2*(K2*K2-1)/d0, ha2=(1-K2/Q2+K2*K2)/d0;
  const chan=x=>biquad(biquad(x,sb0,sb1,sb2,sa1,sa2),hb0,hb1,hb2,ha1,ha2);
  const kl=chan(L),kr=chan(R);
  // 400 ms blocks, 75% overlap, two-stage gating
  const B=Math.round(0.4*sr),S=Math.round(B/4);
  const blocks=[];
  for(let off=0;off+B<=kl.length;off+=S){
    let sl=0,sr2=0;
    for(let i=0;i<B;i++){sl+=kl[off+i]*kl[off+i];sr2+=kr[off+i]*kr[off+i];}
    blocks.push(-0.691+10*Math.log10((sl+sr2)/B+1e-30));
  }
  if(!blocks.length)return -Infinity;
  const abs=blocks.filter(b=>b>-70);
  if(!abs.length)return -Infinity;
  const meanPow=a=>10*Math.log10(a.reduce((s,b)=>s+Math.pow(10,b/10),0)/a.length);
  const rel=meanPow(abs)-10;
  const gated=abs.filter(b=>b>rel);
  return gated.length?meanPow(gated):meanPow(abs);
}

/* 24-bit stereo WAV, so the renders are actually listenable and not a toy. */
function writeWav(path,L,R,sr){
  const fs=require('fs');
  const n=L.length,BPS=3,BA=BPS*2,bytes=n*BA;
  const buf=Buffer.alloc(44+bytes);
  buf.write('RIFF',0);buf.writeUInt32LE(36+bytes,4);buf.write('WAVE',8);buf.write('fmt ',12);
  buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);
  buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*BA,28);buf.writeUInt16LE(BA,32);buf.writeUInt16LE(BPS*8,34);
  buf.write('data',36);buf.writeUInt32LE(bytes,40);
  const put=(o,x)=>{
    const q=Math.max(-8388608,Math.min(8388607,Math.round(x*8388607)));
    const u=q<0?q+16777216:q;
    buf[o]=u&255;buf[o+1]=(u>>8)&255;buf[o+2]=(u>>16)&255;};
  let o=44;
  for(let i=0;i<n;i++){put(o,L[i]);o+=BPS;put(o,R[i]);o+=BPS;}
  fs.writeFileSync(path,buf);
  return bytes+44;
}

module.exports={fft,nextPow2,hann,mag,lufs,writeWav};
