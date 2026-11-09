/* Visor Control Proyecto CyD — Libro de Obra Digital (Construcción) */
(() => {
  'use strict';
  const PERIODO_MS = 5 * 60 * 1000;           // ciclo de actualización: 5 minutos
  const ROTACION_MS = 12 * 1000;              // modo presentación: cambio de vista
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const grad = (svg, id, c1, c2, vertical) => {
    let defs = svg.select('defs'); if (defs.empty()) defs = svg.append('defs');
    const g = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('y1', 0).attr('x2', vertical ? 0 : 1).attr('y2', vertical ? 1 : 0);
    g.append('stop').attr('offset', '0%').attr('stop-color', c1); g.append('stop').attr('offset', '100%').attr('stop-color', c2);
    return `url(#${id})`;
  };
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { folios: [], materias: [], meta: {}, prevIds: null, nuevos: new Set(), sortKey: 'folio', sortDir: -1, view: 'todo', next: 0, loading: false };

  /* ---------- Sonido (Web Audio, sin archivos externos) ---------- */
  const audio = { ctx: null, on: true };
  const unlock = () => { if (!audio.ctx) { try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio.ctx = null; } } if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); };
  const tone = (freq, t0, dur, type = 'sine', vol = 0.08) => {
    const c = audio.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  };
  const SONIDOS = {
    click: () => tone(1200, 0, 0.05, 'triangle', 0.05),
    vista: () => { tone(660, 0, 0.12, 'sine', 0.06); tone(990, 0.07, 0.14, 'sine', 0.05); },
    inicio: () => { tone(440, 0, 0.12, 'triangle', 0.05); tone(554, 0.09, 0.12, 'triangle', 0.05); },
    ok: () => { tone(523, 0, 0.16, 'sine', 0.07); tone(784, 0.12, 0.26, 'sine', 0.06); },
    nuevo: () => { tone(659, 0, 0.18, 'sine', 0.08); tone(880, 0.14, 0.18, 'sine', 0.08); tone(1319, 0.28, 0.4, 'sine', 0.07); },
    error: () => { tone(220, 0, 0.25, 'sawtooth', 0.05); tone(196, 0.2, 0.3, 'sawtooth', 0.05); },
  };
  const play = (k) => { if (!audio.on || !audio.ctx || audio.ctx.state !== 'running') return; try { SONIDOS[k](); } catch (e) { /* sin audio */ } };
  document.addEventListener('pointerdown', unlock, { once: false, passive: true });

  /* ---------- Utilidades ---------- */
  const fmtFecha = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fmtMes = (ym) => `${MES[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
  const SYNC_MAX_H = 6; // horas sin sincronización antes de advertir desfase
  const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const estadoClase = (e) => ({ 'Aprobado': 'st-ok', 'Cerrado': 'st-ok', 'Aprobado con condiciones': 'st-ok', 'Observado': 'st-bad', 'En revisión': 'st-warn', 'Sin pronunciamiento': 'st-warn', 'Por revisar': 'st-new' })[e] || 'st-mut';
  const parte = (r) => ({ IF: 'Inspección Fiscal', SC: 'Sociedad Concesionaria' })[r] || r;
  const cell = (tr, txt, cls) => { const c = tr.insertCell(); c.textContent = txt; if (cls) c.className = cls; return c; };
  const badge = (td, txt, cls) => { const s = document.createElement('span'); s.className = 'badge ' + (cls || estadoClase(txt)); s.textContent = txt; td.appendChild(s); };
  const median = (xs) => (xs.length ? (xs[(xs.length - 1) >> 1] + xs[xs.length >> 1]) / 2 : null);

  const tip = $('#tip');
  const showTip = (ev, head, lines) => {
    tip.replaceChildren();
    const h = document.createElement('div'); h.className = 'h'; h.textContent = head; tip.appendChild(h);
    lines.forEach((l) => { const d = document.createElement('div'); d.textContent = l; tip.appendChild(d); });
    tip.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const hideTip = () => { tip.hidden = true; };
  const toast = (msg) => { const t = $('#toast'); t.hidden = true; void t.offsetWidth; t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3700); };

  /* ---------- Cálculos ---------- */
  function calcular() {
    const { folios, materias } = state;
    const byId = new Map(folios.map((f) => [+f.folio, f]));
    const respuestas = [];
    for (const f of folios) {
      const refs = String(f.refs || '').split(';').filter(Boolean).map(Number).filter((r) => byId.has(r) && byId.get(r).emisor !== f.emisor);
      if (!refs.length) continue;
      const r = Math.max(...refs);
      respuestas.push({ folio: +f.folio, ref: r, responde: f.emisor, materia: f.materia, fecha: f.fecha, dias: diasEntre(byId.get(r).fecha, f.fecha) });
    }
    const corte = hoyISO();
    const mat = materias.map((m) => {
      const fs = folios.filter((f) => f.materia_id === m.materia_id);
      const last = fs.reduce((a, b) => (+b.folio > +a.folio ? b : a), fs[0] || { folio: 0, fecha: corte });
      return { ...m, n_folios: fs.length, ultimo_folio: +last.folio, fecha_ultimo: last.fecha, dias_desde: diasEntre(last.fecha, corte) };
    }).filter((m) => m.n_folios > 0);
    const dias = (p) => respuestas.filter((r) => r.responde === p).map((r) => r.dias).sort((a, b) => a - b);
    const fechas = folios.map((f) => f.fecha).sort();
    const kpi = {
      total: folios.length, primera: fechas[0], ultima: fechas[fechas.length - 1], corte,
      sc: folios.filter((f) => f.emisor === 'SC').length, if_: folios.filter((f) => f.emisor === 'IF').length,
      pend_if: mat.filter((m) => m.responde === 'IF').length, pend_sc: mat.filter((m) => m.responde === 'SC').length,
      med_resp_if: median(dias('IF')), med_resp_sc: median(dias('SC')),
    };
    return { respuestas, mat, kpi };
  }

  /* ---------- Dibujo ---------- */
  function drawKpis(kpi) {
    $$('[data-k]').forEach((el) => {
      const v = kpi[el.dataset.k];
      if (v == null) { el.textContent = '—'; return; }
      if (typeof v === 'string') { el.textContent = fmtFecha(v); return; }
      const prev = +el.dataset.v || 0; el.dataset.v = v;
      const fmt = Number.isInteger(v) ? d3.format(',') : d3.format(',.1f');
      if (!motion) { el.textContent = fmt(v); return; }
      d3.select(el).transition().duration(900).ease(d3.easeCubicOut)
        .tween('text', () => { const i = d3.interpolateNumber(prev, v); return (t) => { el.textContent = fmt(t < 1 ? Math.round(i(t) * 10) / 10 : v); }; });
    });
  }

  function drawPendientes(mat) {
    const tb = $('#t-pend'); tb.replaceChildren();
    mat.filter((m) => m.responde === 'IF' || m.responde === 'SC').sort((a, b) => b.dias_desde - a.dias_desde).forEach((m, i) => {
      const tr = tb.insertRow(); if (motion) tr.style.animation = `rise .45s ${i * 0.04}s both`;
      cell(tr, m.materia); cell(tr, m.articulo, 'dim');
      badge(cell(tr, ''), parte(m.responde), m.responde === 'IF' ? 'st-if' : 'st-sc');
      badge(cell(tr, ''), m.estado);
      cell(tr, 'F' + m.ultimo_folio, 'num');
      const cd = cell(tr, '', 'num'); const p = document.createElement('span'); p.className = 'dias ' + (m.dias_desde > 30 ? 'd3' : m.dias_desde > 14 ? 'd2' : 'd1'); p.textContent = d3.format(',')(m.dias_desde); cd.appendChild(p);
      cell(tr, m.situacion, 'wrap');
    });
  }

  function drawMaterias(mat) {
    const tb = $('#t-mat'); tb.replaceChildren();
    const max = d3.max(mat, (m) => m.n_folios) || 1;
    mat.forEach((m) => {
      const tr = tb.insertRow();
      cell(tr, m.materia); cell(tr, m.articulo, 'dim'); badge(cell(tr, ''), m.estado);
      const c = cell(tr, ''); const b = document.createElement('span'); b.className = 'minibar ' + estadoClase(m.estado); b.style.width = '0'; c.append(b, String(m.n_folios));
      requestAnimationFrame(() => { b.style.transition = motion ? 'width .8s cubic-bezier(.2,.8,.2,1)' : ''; b.style.width = (48 * m.n_folios / max) + 'px'; });
      cell(tr, `${fmtFecha(m.fecha_ultimo)} · F${m.ultimo_folio}`, 'dim'); cell(tr, m.situacion, 'wrap');
    });
  }

  const dur = () => (motion ? 800 : 0);
  function drawRegistro() {
    const tb = $('#t-reg'); tb.replaceChildren();
    const q = $('#q').value.toLowerCase().trim(), em = $('#f-em').value, pr = $('#f-pr').value;
    const num = (k) => k === 'folio' || k === 'adjuntos', { sortKey: k, sortDir: s } = state;
    state.folios.filter((f) => (!em || f.emisor === em) && (!pr || f.prioridad === pr) && (!q || [f.folio, f.asunto, f.materia, f.por, f.para, f.tipo, f.refs].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => s * (num(k) ? +a[k] - +b[k] : String(a[k]).localeCompare(String(b[k]), 'es')))
      .forEach((f) => {
        const tr = tb.insertRow(); if (state.nuevos.has(+f.folio)) tr.className = 'row-new';
        cell(tr, String(f.folio), 'num'); cell(tr, `${fmtFecha(f.fecha)} ${f.hora || ''}`, 'dim'); badge(cell(tr, ''), f.emisor, f.emisor === 'IF' ? 'st-if' : 'st-sc'); cell(tr, f.por); cell(tr, f.tipo); badge(cell(tr, ''), f.prioridad, ({ Alta: 'st-bad', Media: 'st-warn', Baja: 'st-ok' })[f.prioridad]);
        const cm = cell(tr, f.materia); if (f.revisar) { cm.append(' '); badge(cm, 'Por revisar'); }
        cell(tr, f.asunto, 'wrap'); cell(tr, f.refs ? f.refs.split(';').map((r) => 'F' + r).join(', ') : '', 'dim'); cell(tr, String(f.adjuntos ?? ''), 'num');
        const c = tr.insertCell(); const a = document.createElement('a'); a.href = f.enlace; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir'; c.appendChild(a);
      });
    $$('#t-reg-tab th[data-sort]').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === k ? (s > 0 ? 'ascending' : 'descending') : 'none'));
  }

  function render() {
    const { respuestas, mat, kpi } = calcular();
    drawKpis(kpi); drawPendientes(mat); drawMaterias(mat); drawRegistro();
  }

  /* ---------- Carga y actualización ---------- */
  async function getJSON(path) { const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); }
  async function actualizar(origen) {
    if (state.loading) return; state.loading = true;
    const btn = $('#btn-act'); btn.classList.add('spin'); $('#estado-sync').textContent = 'Actualizando contenido…';
    if (origen !== 'inicio') play('inicio');
    try {
      const [folios, materias, meta] = await Promise.all([getJSON('data/folios.json'), getJSON('data/materias.json'), getJSON('data/meta.json').catch(() => ({}))]);
      const ids = new Set(folios.map((f) => +f.folio));
      state.nuevos = state.prevIds ? new Set([...ids].filter((i) => !state.prevIds.has(i))) : new Set();
      state.prevIds = ids; state.folios = folios; state.materias = materias; state.meta = meta;
      render();
      $$('.card, .tile, .takeaway').forEach((c) => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); });
      const ahora = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const est = $('#estado-sync'), horasSync = meta.sincronizado ? (Date.now() - Date.parse(meta.sincronizado)) / 36e5 : Infinity;
      const sync = meta.sincronizado ? ` · Drive sincronizado ${new Date(meta.sincronizado).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}` : ' · Sincronización con Drive no ejecutada';
      est.textContent = `Última actualización: ${ahora}${sync}${horasSync > SYNC_MAX_H ? ' · ATENCIÓN: registro posiblemente desfasado respecto del Libro de Obra' : ''}`;
      est.classList.toggle('desfase', horasSync > SYNC_MAX_H);
      if (state.nuevos.size) { toast(`${state.nuevos.size} folio(s) nuevo(s): ${[...state.nuevos].map((n) => 'F' + n).join(', ')}`); play('nuevo'); }
      else if (origen !== 'inicio') { toast('Contenido actualizado · sin folios nuevos'); play('ok'); }
    } catch (e) {
      $('#estado-sync').textContent = `No se pudo actualizar (${e.message}). Se mantiene la última información.`; play('error');
    } finally {
      btn.classList.remove('spin'); state.loading = false; state.next = Date.now() + PERIODO_MS;
    }
  }

  // Barra de actualización: ciclo de 5 minutos.
  setInterval(() => {
    const rest = Math.max(0, state.next - Date.now());
    $('#bar-fill').style.width = `${100 * (1 - rest / PERIODO_MS)}%`;
    const m = Math.floor(rest / 60000), s = Math.floor((rest % 60000) / 1000);
    $('#cuenta').textContent = `Próxima actualización en ${m}:${String(s).padStart(2, '0')}`;
    if (rest === 0 && !state.loading) actualizar('auto');
  }, 1000);

  /* ---------- Controles ---------- */
  $('#btn-act').addEventListener('click', () => { unlock(); actualizar('manual'); });
  $('#btn-son').addEventListener('click', (e) => {
    unlock(); audio.on = !audio.on; e.currentTarget.setAttribute('aria-pressed', String(audio.on));
    e.currentTarget.title = audio.on ? 'Sonido activado' : 'Sonido desactivado'; if (audio.on) play('click');
  });
  const menu = $('#menu-ver'), btnVer = $('#btn-ver');
  btnVer.addEventListener('click', () => { unlock(); play('click'); menu.hidden = !menu.hidden; btnVer.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) { menu.hidden = true; btnVer.setAttribute('aria-expanded', 'false'); } });
  const VISTAS = ['todo', 'pendientes', 'materias', 'registro'];
  let rot = null;
  function setVista(v, silencio) {
    state.view = v; const mostrar = v === 'presentacion' ? VISTAS[1] : v;
    $$('[data-views]').forEach((s) => { s.hidden = !s.dataset.views.split(' ').includes(mostrar); });
    $$('#menu-ver [data-view]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === v)));
    $('#ver-actual').textContent = $(`#menu-ver [data-view="${v}"]`).textContent.replace(/ \(.*\)/, '');
    clearInterval(rot);
    if (v === 'presentacion') {
      let i = 1;
      rot = setInterval(() => { i = (i % (VISTAS.length - 1)) + 1; $$('[data-views]').forEach((s) => { s.hidden = !s.dataset.views.split(' ').includes(VISTAS[i]); }); render(); play('vista'); }, ROTACION_MS);
    }
    render(); if (!silencio) play('vista'); scrollTo({ top: 0, behavior: motion ? 'smooth' : 'auto' });
  }
  $$('#menu-ver [data-view]').forEach((b) => b.addEventListener('click', () => { menu.hidden = true; setVista(b.dataset.view); }));
  ['#q', '#f-em', '#f-pr'].forEach((s) => $(s).addEventListener('input', drawRegistro));
  $$('#t-reg-tab th[data-sort] button').forEach((b) => b.addEventListener('click', () => {
    const k = b.closest('th').dataset.sort; play('click');
    if (k === state.sortKey) state.sortDir = -state.sortDir; else { state.sortKey = k; state.sortDir = 1; }
    drawRegistro();
  }));

  actualizar('inicio');
})();
