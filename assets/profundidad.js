/* Efecto de profundidad: los indicadores y los botones se inclinan en 3D siguiendo el cursor.
   Se desactiva si el sistema pide reducir el movimiento o si el dispositivo no tiene puntero fino. */
(() => {
  'use strict';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return;
  const SEL = '.tile, .toolbar .btn, .filtro-esp .btn';
  const AMP = (el) => (el.classList.contains('tile') ? { rx: 12, ry: 14, z: 14, p: 700 } : { rx: 16, ry: 10, z: 10, p: 360 });
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest(SEL); if (!el) return;
    const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5, a = AMP(el);
    el.style.transform = `perspective(${a.p}px) rotateX(${(-py * a.rx).toFixed(2)}deg) rotateY(${(px * a.ry).toFixed(2)}deg) translateZ(${a.z}px)`;
    el.style.setProperty('--gx', `${(px + 0.5) * 100}%`); el.style.setProperty('--gy', `${(py + 0.5) * 100}%`);
  });
  document.addEventListener('pointerout', (e) => { const el = e.target.closest && e.target.closest(SEL); if (el && !el.contains(e.relatedTarget)) el.style.transform = ''; });
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('.toolbar .btn, .filtro-esp .btn'); if (el) el.style.transform += ' translateZ(-6px) scale(.97)'; });
})();
