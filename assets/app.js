/* Visor Control Proyecto CyD — Libro de Obra Digital (Construcción) */
(() => {
  'use strict';
  /* Calendario: la sincronización con Drive corre de lunes a viernes a las 07:43 (America/Santiago);
     el visor se recarga solo a las 08:00 de esos días y queda en pausa sábado y domingo. */
  const TZ = 'America/Santiago', SYNC_HM = [7, 43], ACT_HM = [8, 0];
  const partesTZ = (t) => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }).formatToParts(new Date(t)).forEach((x) => { o[x.type] = x.value; }); return o; };
  const desfaseTZ = (t) => { const p = partesTZ(t); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000; };
  const instanteTZ = (y, mo, d, h, mi) => { const g = Date.UTC(y, mo - 1, d, h, mi); return g - desfaseTZ(g - desfaseTZ(g)); };
  const habilSem = (t) => !['Sat', 'Sun'].includes(partesTZ(t).weekday);
  const hito = (desde, hm, dir) => { // próxima (dir=1) o última (dir=-1) hora hm de un día lunes a viernes
    const p = partesTZ(desde);
    for (let k = 0; k <= 8; k++) {
      const base = Date.UTC(+p.year, +p.month - 1, +p.day + dir * k), d = new Date(base);
      const t = instanteTZ(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hm[0], hm[1]);
      if (habilSem(t + 6 * 36e5) && (dir > 0 ? t > desde : t <= desde)) return t;
    }
    return desde + dir * 864e5;
  };
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
  const state = { folios: [], materias: [], meta: {}, plazos: {}, prevIds: null, nuevos: new Set(), sortKey: 'folio', sortDir: -1, view: 'todo', next: 0, loading: false };

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
  const SYNC_TOL_MS = 2 * 36e5; // tolerancia tras la hora programada antes de advertir desfase
  const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const estadoClase = (e) => ({ 'Aprobado': 'st-ok', 'Cerrado': 'st-ok', 'Aprobado con condiciones': 'st-ok', 'Observado': 'st-bad', 'En revisión': 'st-warn', 'Sin pronunciamiento': 'st-warn', 'Por revisar': 'st-new' })[e] || 'st-mut';
  const parte = (r) => ({ IF: 'Inspección Fiscal', SC: 'Sociedad Concesionaria' })[r] || r;
  const cell = (tr, txt, cls) => { const c = tr.insertCell(); c.textContent = txt; if (cls) c.className = cls; return c; };
  const badge = (td, txt, cls) => { const s = document.createElement('span'); s.className = 'badge ' + (cls || estadoClase(txt)); s.textContent = txt; td.appendChild(s); };
  /* Cómputo de plazos BALI (art. 1.2.2 vi): días corridos con prórroga al día hábil siguiente, o días hábiles. */
  const sumaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const esHabil = (iso, fest) => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !fest.has(iso); };
  const vencimiento = (iso, n, habiles, fest) => {
    let d = iso;
    if (habiles) { let k = 0; while (k < n) { d = sumaDias(d, 1); if (esHabil(d, fest)) k++; } return d; }
    d = sumaDias(d, n); while (!esHabil(d, fest)) d = sumaDias(d, 1); return d;
  };
  function plazoDe(m, fs, corte) {
    const P = state.plazos || {}, cfg = (P.materias || {})[m.materia_id], regla = cfg && (P.reglas || {})[cfg.regla];
    if (!regla || (m.responde !== 'IF' && m.responde !== 'SC')) return null;
    const last = fs.reduce((a, b) => (+b.folio > +a.folio ? b : a));
    const reingreso = m.responde === 'IF' && regla.IF_reingreso && fs.some((f) => f.emisor === 'IF' && +f.folio < +last.folio);
    const r = (reingreso ? regla.IF_reingreso : regla[m.responde]) || {};
    const base = { regla: cfg.regla, articulo: regla.articulo, nombre: regla.nombre, texto: r.texto || '', nota: cfg.nota || '', referencial: !!cfg.referencial, reingreso, desde: last.fecha, folio: +last.folio };
    if (!r.dias) return { ...base, dias: null };
    const vence = vencimiento(last.fecha, r.dias, !!r.habiles, new Set(P.festivos || []));
    return { ...base, dias: r.dias, habiles: !!r.habiles, vence, restan: diasEntre(corte, vence) };
  }
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
      return { ...m, n_folios: fs.length, ultimo_folio: +last.folio, fecha_ultimo: last.fecha, dias_desde: diasEntre(last.fecha, corte), plazo: fs.length ? plazoDe(m, fs, corte) : null };
    }).filter((m) => m.n_folios > 0);
    const dias = (p) => respuestas.filter((r) => r.responde === p).map((r) => r.dias).sort((a, b) => a - b);
    const fechas = folios.map((f) => f.fecha).sort();
    const kpi = {
      total: folios.length, primera: fechas[0], ultima: fechas[fechas.length - 1], corte,
      sc: folios.filter((f) => f.emisor === 'SC').length, if_: folios.filter((f) => f.emisor === 'IF').length,
      pend_if: mat.filter((m) => m.responde === 'IF').length, pend_sc: mat.filter((m) => m.responde === 'SC').length,
      med_resp_if: median(dias('IF')), med_resp_sc: median(dias('SC')),
      venc: mat.filter((m) => m.plazo && m.plazo.vence && m.plazo.restan < 0).length,
      prox: mat.filter((m) => m.plazo && m.plazo.vence && m.plazo.restan >= 0 && m.plazo.restan <= 7).length,
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
    const rest = (m) => (m.plazo && m.plazo.vence ? m.plazo.restan : Infinity);
    mat.filter((m) => m.responde === 'IF' || m.responde === 'SC').sort((a, b) => rest(a) - rest(b) || b.dias_desde - a.dias_desde).forEach((m, i) => {
      const tr = tb.insertRow(); if (motion) tr.style.animation = `rise .45s ${i * 0.04}s both`;
      cell(tr, m.materia); cell(tr, m.articulo, 'dim');
      badge(cell(tr, ''), parte(m.responde), m.responde === 'IF' ? 'st-if' : 'st-sc');
      badge(cell(tr, ''), m.estado);
      cell(tr, 'F' + m.ultimo_folio, 'num');
      const ct = cell(tr, d3.format(',')(m.dias_desde), 'num'); ct.title = `Contados desde F${m.ultimo_folio}, de ${fmtFecha(m.fecha_ultimo)}`;
      const fi = document.createElement('div'); fi.className = 'dim'; fi.textContent = `desde ${fmtFecha(m.fecha_ultimo)}`; ct.appendChild(fi);
      drawPlazo(tr, m.plazo);
      cell(tr, m.situacion, 'wrap');
    });
  }

  function drawPlazo(tr, p) {
    const cp = cell(tr, '', 'plazo'), cv = cell(tr, '', 'num');
    if (!p) { cp.textContent = 'Sin regla asignada'; cp.className = 'dim'; cv.textContent = '—'; return; }
    cp.title = [p.texto, p.nota].filter(Boolean).join(' ');
    const art = document.createElement('div'); art.className = 'dim'; art.textContent = p.articulo + (p.referencial ? ' (referencial)' : '');
    if (!p.dias) { cp.append('Sin plazo en BALI', art); cv.textContent = '—'; return; }
    cp.append(`${p.dias} días${p.habiles ? ' hábiles' : ''}${p.reingreso ? ' (reingreso)' : ''}`, art);
    cv.title = `Desde F${p.folio} (${fmtFecha(p.desde)}). ${p.texto}`;
    const s = document.createElement('span'); s.className = 'dias ' + (p.restan < 0 ? 'd3' : p.restan <= 7 ? 'd2' : 'd1');
    s.textContent = p.restan < 0 ? `Vencido ${-p.restan} d` : p.restan === 0 ? 'Vence hoy' : `${p.restan} d`;
    const f = document.createElement('div'); f.className = 'dim'; f.textContent = fmtFecha(p.vence);
    cv.append(s, f);
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
      const [folios, materias, meta, plazos] = await Promise.all([getJSON('data/folios.json'), getJSON('data/materias.json'), getJSON('data/meta.json').catch(() => ({})), getJSON('data/plazos.json').catch(() => ({}))]);
      const ids = new Set(folios.map((f) => +f.folio));
      state.nuevos = state.prevIds ? new Set([...ids].filter((i) => !state.prevIds.has(i))) : new Set();
      state.prevIds = ids; state.folios = folios; state.materias = materias; state.meta = meta; state.plazos = plazos;
      render();
      $$('.card, .tile, .takeaway').forEach((c) => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); });
      const ahora = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const est = $('#estado-sync'), esperada = hito(Date.now() - SYNC_TOL_MS, SYNC_HM, -1);
      const desfasado = !meta.sincronizado || Date.parse(meta.sincronizado) < esperada - 30 * 6e4;
      const sync = meta.sincronizado ? ` · Drive sincronizado ${new Date(meta.sincronizado).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}` : ' · Sincronización con Drive no ejecutada';
      est.textContent = `Última actualización: ${ahora}${sync}${desfasado ? ' · ATENCIÓN: registro posiblemente desfasado respecto del Libro de Obra' : ''}`;
      est.classList.toggle('desfase', desfasado);
      if (state.nuevos.size) { toast(`${state.nuevos.size} folio(s) nuevo(s): ${[...state.nuevos].map((n) => 'F' + n).join(', ')}`); play('nuevo'); }
      else if (origen !== 'inicio') { toast('Contenido actualizado · sin folios nuevos'); play('ok'); }
    } catch (e) {
      $('#estado-sync').textContent = `No se pudo actualizar (${e.message}). Se mantiene la última información.`; play('error');
    } finally {
      btn.classList.remove('spin'); state.loading = false; state.prev = hito(Date.now(), ACT_HM, -1); state.next = hito(Date.now(), ACT_HM, 1);
    }
  }

  // Barra de actualización: ciclo diario de lunes a viernes; en pausa sábado y domingo.
  setInterval(() => {
    if (!state.next) return;
    const ahora = Date.now(), rest = Math.max(0, state.next - ahora), total = Math.max(1, state.next - (state.prev || ahora));
    $('#bar-fill').style.width = `${100 * (1 - rest / total)}%`;
    const d = Math.floor(rest / 864e5), h = Math.floor((rest % 864e5) / 36e5), m = Math.floor((rest % 36e5) / 6e4);
    const pausa = !habilSem(ahora);
    $('#cuenta').textContent = pausa
      ? `Actualización automática en pausa (sábado y domingo) · se reanuda el lunes a las 08:00, en ${d} d ${h} h ${m} min`
      : `Próxima actualización automática en ${d ? d + ' d ' : ''}${h} h ${m} min (lunes a viernes, 08:00)`;
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
