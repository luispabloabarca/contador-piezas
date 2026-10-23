import { analyze, classify } from './analyzer.js';
import { makeSample } from './sample.js';

const MAX_SIDE = 1400; // se reduce la foto para analizar rápido en el celular
const COLORS = { entera: [46, 157, 91], partida: [232, 144, 42], grupo: [210, 60, 60], miga: [138, 138, 138] };

const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const state = { img: null, seg: null, pieces: [], summary: null, refLengthPx: null, selected: null, showMask: false };

// ---------- Carga de imagen ----------

$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Analizando…');
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const off = new OffscreenCanvas(w, h).getContext('2d');
    off.drawImage(bmp, 0, 0, w, h);
    load(off.getImageData(0, 0, w, h));
  } catch (err) {
    setStatus('No se pudo leer la imagen: ' + err.message);
  }
  e.target.value = '';
});

$('sample').addEventListener('click', () => {
  setStatus('Generando ejemplo…');
  const { img } = makeSample({ seed: Math.floor(Math.random() * 1000) });
  load(new ImageData(img.data, img.width, img.height));
});

function load(imageData) {
  state.img = imageData;
  state.refLengthPx = null;
  state.selected = null;
  $('mm').value = '';
  runFull();
}

// ---------- Análisis ----------

function options() {
  return {
    sensitivity: Number($('sens').value),
    wholeThreshold: Number($('thr').value) / 100,
    refLengthPx: state.refLengthPx,
    refRealMm: Number($('mm').value) || null,
  };
}

function runFull() {
  if (!state.img) return;
  setTimeout(() => { // deja pintar el mensaje "Analizando…"
    const t0 = performance.now();
    const r = analyze(state.img, options());
    state.seg = { mask: r.mask, labels: r.labels, comps: r.comps };
    state.pieces = r.pieces;
    state.summary = r.summary;
    render();
    setStatus(`Análisis en ${Math.round(performance.now() - t0)} ms · imagen ${state.img.width}×${state.img.height}px`);
  }, 20);
}

function reclassify() {
  if (!state.seg) return;
  const r = classify(state.seg.comps, options());
  state.pieces = r.pieces;
  state.summary = r.summary;
  render();
}

$('sens').addEventListener('change', runFull);
$('thr').addEventListener('input', () => { $('thrVal').textContent = $('thr').value; reclassify(); });
$('mm').addEventListener('input', reclassify);
$('refAuto').addEventListener('click', () => { state.refLengthPx = null; state.selected = null; reclassify(); });
$('mask').addEventListener('click', () => {
  state.showMask = !state.showMask;
  $('mask').classList.toggle('on', state.showMask);
  drawCanvas();
});
$('csv').addEventListener('click', exportCsv);

canvas.addEventListener('click', e => {
  if (!state.seg) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((e.clientY - rect.top) * canvas.height / rect.height);
  const lbl = state.seg.labels[y * canvas.width + x];
  const p = state.pieces.find(q => q.label === lbl);
  if (!p) return;
  state.selected = p.label;
  if (p.status === 'entera' || p.status === 'partida') state.refLengthPx = p.length;
  reclassify();
});

// ---------- Render ----------

function render() {
  $('result').hidden = false;
  drawCanvas();
  renderCards();
  renderHist();
  renderTable();
}

function drawCanvas() {
  const { img, seg, pieces } = state;
  canvas.width = img.width;
  canvas.height = img.height;
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const statusByLabel = new Map(pieces.map(p => [p.label, p.status]));
  const d = out.data;
  for (let i = 0; i < seg.labels.length; i++) {
    const q = i * 4;
    if (state.showMask) {
      const v = seg.mask[i] ? 255 : 0;
      d[q] = d[q + 1] = d[q + 2] = v;
      continue;
    }
    const st = statusByLabel.get(seg.labels[i]);
    if (!st) continue;
    const c = COLORS[st];
    d[q] = d[q] * 0.5 + c[0] * 0.5; d[q + 1] = d[q + 1] * 0.5 + c[1] * 0.5; d[q + 2] = d[q + 2] * 0.5 + c[2] * 0.5;
  }
  ctx.putImageData(out, 0, 0);
  if (state.showMask) return;

  const fs = Math.max(12, Math.round(img.width / 70));
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of pieces) {
    if (p.status === 'miga') continue;
    const { cx, cy, len, wid, angle } = p.box;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.lineWidth = p.label === state.selected ? 4 : 2;
    ctx.strokeStyle = p.label === state.selected ? '#1e6fd9' : `rgb(${COLORS[p.status]})`;
    ctx.strokeRect(-len / 2, -wid / 2, len, wid);
    ctx.restore();
    const txt = p.status === 'grupo' ? `${p.n} (~${p.estUnits})` : String(p.n);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeText(txt, cx, cy);
    ctx.fillStyle = '#111';
    ctx.fillText(txt, cx, cy);
  }
}

function renderCards() {
  const s = state.summary;
  const pct = v => (v * 100).toFixed(0) + '%';
  const len = s.mmPerPx ? `${(s.refLengthPx * s.mmPerPx).toFixed(1)} mm` : `${s.refLengthPx.toFixed(0)} px`;
  const cards = [
    ['', s.totalPiezas, 'Unidades totales' + (s.grupos ? ' (incluye estimadas)' : '')],
    ['entera', s.enteras, 'Enteras'],
    ['partida', s.partidas, `Partidas (${pct(s.pctPartidas)})`],
    ['grupo', s.grupos ? `${s.grupos} (~${s.unidadesEnGrupos})` : 0, 'Grupos tocándose (unid. est.)'],
    ['', s.equivalenteEnteras.toFixed(1), 'Equivalente en enteras (Σ largos)'],
    ['', s.migas, 'Migas / trozos mínimos'],
    ['', s.formaPredominante, `Forma · largo/ancho ≈ ${s.relacionLargoAncho.toFixed(1)}`],
    ['', len, `Largo de referencia (${s.refAuto ? 'automático' : 'manual'})`],
  ];
  $('cards').innerHTML = cards.map(([cls, v, k]) =>
    `<div class="card ${cls}"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}

function renderHist() {
  const h = state.summary.histograma;
  const max = Math.max(1, ...h.map(b => b.n));
  $('hist').innerHTML = h.map(b => `
    <div class="bar"><span>${Math.round(b.desde * 100)}–${Math.round(b.hasta * 100)}%</span>
      <div class="track"><div class="fill" style="width:${(b.n / max) * 100}%"></div></div>
      <span class="n">${b.n}</span></div>`).join('');
}

function fmtLen(p, px) {
  return p.lengthMm != null ? (px * state.summary.mmPerPx).toFixed(1) + ' mm' : px.toFixed(0) + ' px';
}

function renderTable() {
  const rows = [...state.pieces].sort((a, b) => a.n - b.n);
  $('table').querySelector('thead tr').innerHTML =
    '<th>#</th><th>Estado</th><th>Forma</th><th class="num">Largo</th><th class="num">% ref.</th><th class="num">Ancho</th><th class="num">L/A</th>';
  $('table').querySelector('tbody').innerHTML = rows.map(p => `
    <tr class="${p.label === state.selected ? 'sel' : ''}">
      <td>${p.n}</td>
      <td><span class="tag ${p.status}">${p.status}${p.status === 'grupo' ? ` ~${p.estUnits}` : ''}</span>${p.touchesBorder ? ' ⚠ borde' : ''}</td>
      <td>${p.shape}</td>
      <td class="num">${fmtLen(p, p.length)}</td>
      <td class="num">${p.rel != null ? Math.round(p.rel * 100) + '%' : '–'}</td>
      <td class="num">${fmtLen(p, p.meanWidth)}</td>
      <td class="num">${p.elongation.toFixed(1)}</td>
    </tr>`).join('');
}

function exportCsv() {
  const s = state.summary;
  const unit = s.mmPerPx ? 'mm' : 'px';
  const k = s.mmPerPx || 1;
  const lines = [
    `# enteras;${s.enteras};partidas;${s.partidas};grupos;${s.grupos};unidades_en_grupos;${s.unidadesEnGrupos};total;${s.totalPiezas};equivalente_enteras;${s.equivalenteEnteras.toFixed(2)}`,
    `n;estado;forma;largo_${unit};ancho_${unit};pct_referencia;largo_ancho;unidades_estimadas;toca_borde`,
    ...[...state.pieces].sort((a, b) => a.n - b.n).map(p => [
      p.n, p.status, p.shape, (p.length * k).toFixed(1).replace('.', ','), (p.meanWidth * k).toFixed(1).replace('.', ','),
      p.rel != null ? Math.round(p.rel * 100) : '', p.elongation.toFixed(2).replace('.', ','),
      p.status === 'grupo' ? p.estUnits : p.status === 'miga' ? 0 : 1, p.touchesBorder ? 'si' : 'no',
    ].join(';')),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `conteo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setStatus(msg) { $('status').textContent = msg; }
