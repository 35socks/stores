/* ambient dot field
 * Cheap by design: the full grid is painted once (on load/resize); on mouse move only the few cells around the
 * old and new cursor positions are cleared and repainted. Static on touch screens / reduced-motion.
 * Effects can be switched off from the sidebar ("FX"); that choice is remembered.
 */
(function(){
  try { if (localStorage.getItem("sb_fx") === "0") document.body.classList.add("nofx"); } catch(e) {}
  const c = document.getElementById("dotfield"); if (!c) return;
  const g = c.getContext("2d"), GAP = 28, R = 140;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches;
  let W = 0, H = 0, NI = 0, NJ = 0, mx = -999, my = -999, px = -999, py = -999, raf = 0;

  function dot(x, y, t){
    if (t < 0.02){ g.fillStyle = "rgba(255,255,255,.11)"; g.fillRect(x - 1, y - 1, 2, 2); }
    else {
      g.fillStyle = "rgba(255,255,255," + (0.11 + t * 0.75).toFixed(2) + ")";
      g.beginPath(); g.arc(x, y, 1 + t * 1.5, 0, 6.2832); g.fill();
    }
  }
  // repaint whole grid cells [i0..i1] x [j0..j1] (cell-aligned, so clearing is exact)
  function cells(i0, i1, j0, j1){
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(NI - 1, i1); j1 = Math.min(NJ - 1, j1);
    if (i1 < i0 || j1 < j0) return;
    g.clearRect(i0 * GAP, j0 * GAP, (i1 - i0 + 1) * GAP, (j1 - j0 + 1) * GAP);
    for (let j = j0; j <= j1; j++) {
      const y = j * GAP + GAP / 2;
      for (let i = i0; i <= i1; i++) {
        const x = i * GAP + GAP / 2;
        const d = Math.hypot(x - mx, y - my);
        dot(x, y, d < R ? 1 - d / R : 0);
      }
    }
  }
  const around = (x, y) => cells(Math.floor((x - R) / GAP), Math.floor((x + R) / GAP), Math.floor((y - R) / GAP), Math.floor((y + R) / GAP));
  function frame(){ raf = 0; around(px, py); around(mx, my); px = mx; py = my; }
  function size(){
    W = innerWidth; H = innerHeight; NI = Math.ceil(W / GAP); NJ = Math.ceil(H / GAP);
    c.width = W; c.height = H;                         // 1x on purpose: tiny dots don't need retina resolution
    cells(0, NI - 1, 0, NJ - 1);
  }
  addEventListener("resize", size); size();
  if (!still) {
    addEventListener("pointermove", e => {
      if (document.body.classList.contains("nofx")) return;
      mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(frame);
    }, { passive: true });
    document.addEventListener("pointerleave", () => { mx = my = -999; if (!raf) raf = requestAnimationFrame(frame); });
  }
})();
