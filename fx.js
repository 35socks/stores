/* ambient dot field (static under reduced-motion) */
(function(){
  const c=document.getElementById("dotfield"), g=c.getContext("2d"), GAP=28;
  const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W,H,mx=-999,my=-999,raf=0;
  function draw(){
    raf=0; g.clearRect(0,0,W,H);
    for(let y=GAP/2;y<H;y+=GAP) for(let x=GAP/2;x<W;x+=GAP){
      const t=Math.max(0,1-Math.hypot(x-mx,y-my)/170);
      g.fillStyle="rgba(255,255,255,"+(.11+t*.75).toFixed(3)+")";
      g.beginPath(); g.arc(x,y,1+t*1.5,0,6.2832); g.fill();
    }
  }
  function size(){
    const d=Math.min(devicePixelRatio||1,2); W=innerWidth; H=innerHeight;
    c.width=W*d; c.height=H*d; c.style.width=W+"px"; c.style.height=H+"px"; g.setTransform(d,0,0,d,0,0); draw();
  }
  addEventListener("resize",size); size();
  if(!still){
    addEventListener("pointermove",e=>{ mx=e.clientX; my=e.clientY; if(!raf) raf=requestAnimationFrame(draw); });
    document.addEventListener("pointerleave",()=>{ mx=my=-999; if(!raf) raf=requestAnimationFrame(draw); });
  }
})();
