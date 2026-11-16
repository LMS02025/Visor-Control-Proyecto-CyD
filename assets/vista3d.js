/* Vista 3D de materias por especialidad y efecto de profundidad en tarjetas.
   Canvas 2D con proyección en perspectiva propia (sin dependencias).
   Filas = especialidades; columnas = materias; altura = folios; color = estado;
   marcador flotante = parte que debe responder (IF / SC). */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const hex = (c) => {
    c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16); return isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (rgb, f, a = 1) => `rgba(${rgb.map((x) => Math.round(Math.min(255, Math.max(0, f >= 1 ? x + (255 - x) * (f - 1) : x * f)))).join(',')},${a})`;
  const COLOR_ESTADO = { 'Aprobado': '--emerald', 'Cerrado': '--emerald', 'Aprobado con condiciones': '--emerald', 'Observado': '--ruby', 'En revisión': '--amber', 'Sin pronunciamiento': '--amber', 'Por revisar': '--teal', 'Informativo': '--violet' };

  const S = { canvas: null, ctx: null, wrap: null, rows: [], bars: [], yaw: -0.38, base: -0.38, pitch: 0.62, dist: 30, k: 0, ox: 0, oy: 0, box: null, drag: null, hover: null, t0: performance.now(), grow: 0, visible: true, esp: '', onPick: null, raf: 0, w: 0, h: 0 };

  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const dentro = (pt, poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]); if (c !== 0) { if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false; } } return true; };

  function proyectar(x, y, z) {
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
    const d = S.dist + z2;
    return [S.ox + (S.k * x1) / d, S.oy - (S.k * y2) / d, d, x1 / d, -y2 / d];
  }

  // Encuadre automático: ajusta escala y centro para que la escena completa quepa en el lienzo.
  function encuadrar(suave) {
    if (!S.box) return;
    const k0 = S.k, ox0 = S.ox, oy0 = S.oy;
    S.k = 1; S.ox = 0; S.oy = 0;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const v of S.box) { const q = proyectar(v[0], v[1], v[2]); a = Math.min(a, q[3]); b = Math.max(b, q[3]); c = Math.min(c, q[4]); d = Math.max(d, q[4]); }
    const mx = 24, myT = 30, myB = 58, k = Math.min((S.w - 2 * mx) / (b - a), (S.h - myT - myB) / (d - c)) * (S.zoom || 1);
    const ox = S.w / 2 - (k * (a + b)) / 2, oy = myT + (S.h - myT - myB) / 2 - (k * (c + d)) / 2;
    const f = suave && k0 ? 0.08 : 1;
    S.k = k0 + (k - k0) * f; S.ox = ox0 + (ox - ox0) * f; S.oy = oy0 + (oy - oy0) * f;
  }

  function construir(materias, especialidades) {
    const porMat = new Map(materias.map((m) => [m.materia_id, m]));
    const usadas = new Set();
    const rows = [];
    especialidades.forEach((e) => { const ms = e.materias.map((id) => porMat.get(id)).filter(Boolean); ms.forEach((m) => usadas.add(m.materia_id)); if (ms.length) rows.push({ id: e.id, nombre: e.nombre, ms }); });
    const otras = materias.filter((m) => !usadas.has(m.materia_id)); if (otras.length) rows.push({ id: 'otras', nombre: 'Otras', ms: otras });
    // Filas con muchas materias se disponen en 2 o 3 carriles para acotar la profundidad.
    rows.forEach((r) => { r.lanes = r.ms.length > 8 ? 3 : r.ms.length > 3 ? 2 : 1; r.hw = 0.45 + r.lanes * 0.42; });
    const maxCols = Math.max(...rows.map((r) => Math.ceil(r.ms.length / r.lanes)), 1), maxF = Math.max(...materias.map((m) => m.n_folios), 1);
    // Especialidades a lo largo del eje X (ancho del lienzo) y materias en profundidad (eje Z).
    const DZ = 1.35, H = 4.6;
    const zf = ((maxCols - 1) / 2) * DZ + 0.75;
    // Posición X acumulada según el ancho de cada franja (separación constante entre franjas).
    const GAP = 1.0; let acc = 0; const xs = rows.map((r) => { const x = acc + r.hw; acc += 2 * r.hw + GAP; return x; });
    const off = (acc - GAP) / 2;
    S.rows = rows.map((r, i) => ({ ...r, x: xs[i] - off, z0: -zf, z1: zf }));
    S.bars = [];
    S.rows.forEach((r) => r.ms.forEach((m, j) => S.bars.push({ m, row: r, x: r.x + ((j % r.lanes) - (r.lanes - 1) / 2) * 0.88, z: (Math.floor(j / r.lanes) - (maxCols - 1) / 2) * DZ, h: 0.35 + (H * m.n_folios) / maxF, fase: Math.random() * 6.28 })));
    // Puntos de encuadre: esquinas de cada franja, cima de cada barra (con su marcador) y rótulos.
    S.box = [];
    S.rows.forEach((r) => { for (const x of [r.x - r.hw, r.x + r.hw]) for (const z of [r.z0 - 0.9, r.z1]) S.box.push([x, 0, z]); });
    S.bars.forEach((b) => { for (const dx of [-0.45, 0.45]) S.box.push([b.x + dx, b.h + 1.0, b.z]); });
    S.k = 0; encuadrar(false);
  }

  function caja(b, hEf, ancho, col, alpha, ctx) {
    const a = ancho / 2, x = b.x, z = b.z;
    const V = [[x - a, 0, z - a], [x + a, 0, z - a], [x + a, 0, z + a], [x - a, 0, z + a], [x - a, hEf, z - a], [x + a, hEf, z - a], [x + a, hEf, z + a], [x - a, hEf, z + a]].map((v) => proyectar(...v));
    const caras = [
      { i: [4, 5, 6, 7], n: [0, 1, 0], l: 1.18 }, { i: [0, 1, 5, 4], n: [0, 0, -1], l: 0.78 }, { i: [1, 2, 6, 5], n: [1, 0, 0], l: 0.92 },
      { i: [2, 3, 7, 6], n: [0, 0, 1], l: 0.7 }, { i: [3, 0, 4, 7], n: [-1, 0, 0], l: 0.86 },
    ];
    // Cámara en coordenadas de mundo para decidir caras visibles.
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const cam = [-S.dist * cp * sy, S.dist * sp, -S.dist * cp * cy]; // posición del ojo en coordenadas de mundo
    caras.map((c) => ({ ...c, d: c.i.reduce((s, k) => s + V[k][2], 0) / 4 })).sort((p, q) => q.d - p.d).forEach((c) => {
      const centro = [x + c.n[0] * a, c.n[1] ? hEf : hEf / 2, z + c.n[2] * a];
      const vis = (cam[0] - centro[0]) * c.n[0] + (cam[1] - centro[1]) * c.n[1] + (cam[2] - centro[2]) * c.n[2] > 0;
      if (!vis) return;
      ctx.beginPath(); c.i.forEach((k, n) => (n ? ctx.lineTo(V[k][0], V[k][1]) : ctx.moveTo(V[k][0], V[k][1]))); ctx.closePath();
      ctx.fillStyle = rgba(col, c.l, alpha); ctx.fill();
      ctx.strokeStyle = rgba(col, c.l * 0.7, alpha * 0.9); ctx.lineWidth = 0.8; ctx.stroke();
    });
    return { hull: hull(V.map((v) => [v[0], v[1]])), top: proyectar(x, hEf, z), d: V.reduce((s, v) => s + v[2], 0) / 8 };
  }

  function dibujar(now) {
    const ctx = S.ctx; if (!ctx || !S.w) return;
    const t = (now - S.t0) / 1000;
    if (!reduce && !S.drag) { S.yaw = S.base + Math.sin(t * 0.16) * 0.42; S.pitch += ((0.62 + Math.sin(t * 0.11) * 0.08) - S.pitch) * 0.01; }
    if (!reduce) S.dist = 30 + Math.sin(t * 0.33) * 2.4; // respiración de profundidad
    encuadrar(true);
    S.grow = reduce ? 1 : Math.min(1, S.grow + 0.018);
    const ease = 1 - Math.pow(1 - S.grow, 3);
    ctx.clearRect(0, 0, S.w, S.h);
    const fg = hex(cssv('--fg') || '#222'), muted = cssv('--muted') || '#888', line = hex(cssv('--gold') || '#999');

    // Planos de cada especialidad (de atrás hacia adelante).
    const filas = S.rows.map((r) => ({ r, d: proyectar(0, 0, r.z)[2] })).sort((a, b) => b.d - a.d);
    filas.forEach(({ r }) => {
      const act = !S.esp || S.esp === r.id;
      const P = [[r.x - r.hw, 0, r.z0], [r.x + r.hw, 0, r.z0], [r.x + r.hw, 0, r.z1], [r.x - r.hw, 0, r.z1]].map((v) => proyectar(...v));
      ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
      ctx.fillStyle = rgba(line, 1, act ? 0.14 : 0.04); ctx.fill(); ctx.strokeStyle = rgba(line, 1, act ? 0.5 : 0.12); ctx.lineWidth = 1; ctx.stroke();
    });

    // Barras ordenadas por profundidad.
    const orden = S.bars.map((b) => ({ b, d: proyectar(b.x, b.h / 2, b.z)[2] })).sort((p, q) => q.d - p.d);
    orden.forEach(({ b }) => {
      const act = !S.esp || S.esp === b.row.id, hov = S.hover === b;
      const col = hex(cssv(COLOR_ESTADO[b.m.estado] || '--muted') || '#888');
      const hEf = b.h * ease * (hov ? 1.06 : 1);
      const r = caja(b, hEf, hov ? 0.92 : 0.82, col, act ? 1 : 0.18, ctx);
      b.hull = r.hull; b.depth = r.d;
      if (act && (b.m.responde === 'IF' || b.m.responde === 'SC')) {
        const bob = reduce ? 0 : Math.sin(t * 2.2 + b.fase) * 0.12;
        const p = proyectar(b.x, hEf + 0.55 + bob, b.z), rad = Math.max(7, Math.min(16, (S.k * 0.3) / p[2]));
        const c2 = hex(cssv(b.m.responde === 'IF' ? '--amber' : '--sapphire'));
        ctx.beginPath(); ctx.moveTo(p[0], p[1] - rad); ctx.lineTo(p[0] + rad * 0.75, p[1]); ctx.lineTo(p[0], p[1] + rad); ctx.lineTo(p[0] - rad * 0.75, p[1]); ctx.closePath();
        ctx.fillStyle = rgba(c2, 1.05); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.font = `700 ${Math.max(8, rad * 0.9)}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(b.m.responde, p[0], p[1] + rad * 0.32);
      }
      if (act) { ctx.font = `600 ${Math.max(9, Math.min(13, (S.k * 0.2) / r.top[2]))}px Inter, system-ui, sans-serif`; ctx.fillStyle = rgba(fg, 1, 0.85); ctx.textAlign = 'center'; ctx.fillText(b.m.materia_id, r.top[0], r.top[1] - 4); }
    });
    // Rótulos de especialidad al frente de cada franja, siempre sobre las barras.
    const fs = Math.max(10, Math.min(12, S.w / 110));
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
    S.rows.forEach((r) => {
      const act = !S.esp || S.esp === r.id, L = proyectar(r.x, 0, r.z0 - 0.35);
      const pal = r.nombre.split(' '), mitad = Math.ceil(pal.length / 2), lin = pal.length > 2 ? [pal.slice(0, mitad).join(' '), pal.slice(mitad).join(' ')] : [r.nombre];
      const ancho = Math.max(...lin.map((l) => ctx.measureText(l).width)) + 14, alto = lin.length * (fs + 3) + 8;
      ctx.fillStyle = rgba(hex(cssv('--panel-solid') || '#fff'), 1, act ? 0.88 : 0.5);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(L[0] - ancho / 2, L[1] - 4, ancho, alto, 7) : ctx.rect(L[0] - ancho / 2, L[1] - 4, ancho, alto); ctx.fill();
      ctx.fillStyle = act ? rgba(fg, 1, 0.95) : muted;
      lin.forEach((l, i) => ctx.fillText(l, L[0], L[1] + fs + i * (fs + 3)));
    });
    if (S.visible) S.raf = requestAnimationFrame(dibujar);
  }

  function medir() {
    if (!S.canvas) return;
    const r = S.wrap.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    S.w = r.width; S.h = Math.max(340, Math.min(560, r.width * 0.46));
    S.canvas.width = S.w * dpr; S.canvas.height = S.h * dpr; S.canvas.style.height = S.h + 'px';
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.k = 0; encuadrar(false);
  }

  function iniciar() {
    S.wrap = document.getElementById('v3d'); if (!S.wrap) return false;
    S.canvas = document.createElement('canvas'); S.canvas.setAttribute('role', 'img'); S.canvas.setAttribute('aria-label', 'Vista tridimensional de materias por especialidad');
    S.wrap.appendChild(S.canvas); S.ctx = S.canvas.getContext('2d');
    new ResizeObserver(medir).observe(S.wrap); medir();
    new IntersectionObserver((es) => { const v = es[0].isIntersecting; if (v && !S.visible) { S.visible = true; S.raf = requestAnimationFrame(dibujar); } else if (!v) { S.visible = false; cancelAnimationFrame(S.raf); } }).observe(S.wrap);
    const tip = document.getElementById('tip');
    const pos = (e) => { const r = S.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pick = (pt) => S.bars.filter((b) => b.hull && (!S.esp || S.esp === b.row.id) && dentro(pt, b.hull)).sort((a, b) => a.depth - b.depth)[0] || null;
    S.canvas.addEventListener('pointerdown', (e) => { S.drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch, mov: 0 }; S.canvas.setPointerCapture(e.pointerId); });
    S.canvas.addEventListener('pointermove', (e) => {
      if (S.drag) { const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y; S.drag.mov = Math.abs(dx) + Math.abs(dy); S.yaw = S.drag.yaw - dx * 0.008; S.base = S.yaw; S.t0 = performance.now(); S.pitch = Math.max(0.15, Math.min(1.25, S.drag.pitch + dy * 0.006)); tip.hidden = true; return; }
      const b = pick(pos(e)); S.hover = b; S.canvas.style.cursor = b ? 'pointer' : 'grab';
      if (!b) { tip.hidden = true; return; }
      tip.replaceChildren(); const h = document.createElement('div'); h.className = 'h'; h.textContent = `${b.m.materia_id} · ${b.m.materia}`; tip.appendChild(h);
      [`Especialidad: ${b.row.nombre}`, `Estado: ${b.m.estado}`, `Folios: ${b.m.n_folios} · último F${b.m.ultimo_folio}`, `Debe responder: ${b.m.responde === 'IF' ? 'Inspección Fiscal' : b.m.responde === 'SC' ? 'Sociedad Concesionaria' : '—'}`, 'Clic: filtrar por esta especialidad'].forEach((l) => { const d = document.createElement('div'); d.textContent = l; tip.appendChild(d); });
      tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
    });
    const fin = (e) => { if (S.drag && S.drag.mov < 4) { const b = pick(pos(e)); if (b && S.onPick) S.onPick(S.esp === b.row.id ? '' : b.row.id); } S.drag = null; };
    S.canvas.addEventListener('pointerup', fin);
    S.canvas.addEventListener('pointerleave', () => { S.hover = null; tip.hidden = true; });
    S.canvas.addEventListener('wheel', (e) => { e.preventDefault(); S.zoom = Math.max(0.6, Math.min(1.8, (S.zoom || 1) * (e.deltaY > 0 ? 0.94 : 1.06))); }, { passive: false });
    return true;
  }

  window.Vista3D = {
    actualizar(materias, especialidades, esp, onPick) {
      if (!S.canvas && !iniciar()) return;
      S.esp = esp || ''; S.onPick = onPick;
      const clave = materias.map((m) => m.materia_id + m.n_folios + m.estado + m.responde).join('|');
      if (clave !== S.clave) { S.clave = clave; construir(materias, especialidades); if (!S.bars.length) return; }
      cancelAnimationFrame(S.raf); if (S.visible) S.raf = requestAnimationFrame(dibujar);
    },
    reiniciar() { S.grow = 0; },
  };

  /* Profundidad en tarjetas: inclinación 3D según la posición del cursor. */
  if (!reduce && matchMedia('(hover: hover)').matches) {
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('.tile'); if (!el) return;
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(700px) rotateX(${(-py * 12).toFixed(2)}deg) rotateY(${(px * 14).toFixed(2)}deg) translateZ(14px)`;
      el.style.setProperty('--gx', `${(px + 0.5) * 100}%`); el.style.setProperty('--gy', `${(py + 0.5) * 100}%`);
    });
    document.addEventListener('pointerout', (e) => { const el = e.target.closest && e.target.closest('.tile'); if (el && !el.contains(e.relatedTarget)) el.style.transform = ''; });
  }
})();
