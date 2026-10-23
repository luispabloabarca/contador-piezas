// analyzer.js — Detecta, cuenta y mide piezas en una foto (sin dependencias).
// Funciona igual en el navegador y en Node: recibe {width, height, data: RGBA}.

export const DEFAULTS = {
  sensitivity: 0,        // -1..1  (negativo = detecta más, positivo = más estricto)
  wholeThreshold: 0.9,   // fracción del largo de referencia para considerar "entera"
  crumbFrac: 0.05,       // área < 5 % de una pieza típica → miga
  groupWidthFactor: 1.6, // ancho medio > 1.6 × ancho típico → piezas tocándose
  refLengthPx: null,     // largo de referencia manual (px); null = automático
  refRealMm: null,       // largo real de una unidad entera (mm), para convertir a mm
};

// ---------- API ----------

export function analyze(img, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const seg = segment(img, o);
  const { labels, count } = label(seg.mask, img.width, img.height);
  const comps = measure(labels, count, img.width, img.height);
  return { ...seg, labels, comps, ...classify(comps, o) };
}

// Re-clasifica sin volver a segmentar (cambios de umbral o referencia).
export function classify(comps, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const pieces = comps.map(c => ({ ...c }));
  if (!pieces.length) return { pieces, summary: emptySummary() };

  // Migas: mucho más chicas que una pieza típica.
  const typicalArea = percentile(pieces.map(p => p.area), 0.75);
  for (const p of pieces) if (p.area < o.crumbFrac * typicalArea) p.status = 'miga';
  let real = pieces.filter(p => p.status !== 'miga');

  // Ancho típico: piezas "limpias" (rectángulo bien lleno).
  const clean = real.filter(p => p.rectFill > 0.7);
  const typicalWidth = median((clean.length ? clean : real).map(p => p.meanWidth));

  // Grupos: piezas que se tocan o cruzan.
  for (const p of real) {
    const tooWide = p.meanWidth > o.groupWidthFactor * typicalWidth;
    const crossed = p.profileCV > 0.3 && p.rectFill < 0.65 && p.length > 2 * typicalWidth;
    if (tooWide || crossed) p.status = 'grupo';
  }

  const singles = real.filter(p => p.status !== 'grupo');
  const refLength = o.refLengthPx || percentile(singles.map(p => p.length), 0.9) || 1;
  const mmPerPx = o.refRealMm ? o.refRealMm / refLength : null;

  for (const p of singles) {
    p.rel = p.length / refLength;
    p.status = p.rel >= o.wholeThreshold ? 'entera' : 'partida';
  }
  const wholes = singles.filter(p => p.status === 'entera');
  const wholeArea = wholes.length ? median(wholes.map(p => p.area)) : typicalWidth * refLength;

  for (const p of pieces) {
    p.shape = shapeOf(p);
    p.equiv = p.status === 'miga' ? 0 : p.status === 'grupo' ? p.area / wholeArea : p.rel;
    if (p.status === 'grupo') p.estUnits = Math.max(2, Math.round(p.area / wholeArea));
    if (mmPerPx) { p.lengthMm = p.length * mmPerPx; p.widthMm = p.meanWidth * mmPerPx; }
  }

  // Resumen
  const groups = pieces.filter(p => p.status === 'grupo');
  const partidas = singles.filter(p => p.status === 'partida');
  const bins = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, o.wholeThreshold]];
  const shapeCount = {};
  for (const p of (wholes.length ? wholes : singles)) shapeCount[p.shape] = (shapeCount[p.shape] || 0) + 1;

  const summary = {
    enteras: wholes.length,
    partidas: partidas.length,
    grupos: groups.length,
    unidadesEnGrupos: groups.reduce((s, p) => s + p.estUnits, 0),
    migas: pieces.filter(p => p.status === 'miga').length,
    totalPiezas: singles.length + groups.reduce((s, p) => s + p.estUnits, 0),
    equivalenteEnteras: real.reduce((s, p) => s + p.equiv, 0),
    pctPartidas: singles.length ? partidas.length / singles.length : 0,
    refLengthPx: refLength,
    refAuto: !o.refLengthPx,
    typicalWidthPx: typicalWidth,
    mmPerPx,
    formaPredominante: Object.entries(shapeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '-',
    relacionLargoAncho: refLength / typicalWidth,
    histograma: bins.map(([a, b]) => ({
      desde: a, hasta: b,
      n: partidas.filter(p => p.rel >= a && p.rel < b).length,
    })),
  };

  // Numeración en orden de lectura (arriba→abajo, izq→der) por franjas.
  const band = Math.max(1, typicalWidth * 3);
  pieces.sort((a, b) => Math.floor(a.cy / band) - Math.floor(b.cy / band) || a.cx - b.cx);
  pieces.forEach((p, i) => { p.n = i + 1; });
  return { pieces, summary };
}

function emptySummary() {
  return {
    enteras: 0, partidas: 0, grupos: 0, unidadesEnGrupos: 0, migas: 0, totalPiezas: 0,
    equivalenteEnteras: 0, pctPartidas: 0, refLengthPx: 0, refAuto: true, typicalWidthPx: 0,
    mmPerPx: null, formaPredominante: '-', relacionLargoAncho: 0, histograma: [],
  };
}

function shapeOf(p) {
  if (p.elongation >= 3) return 'palito';
  if (p.elongation >= 1.6) return p.rectFill > 0.85 ? 'rectangular' : 'ovalado';
  return p.rectFill > 0.85 ? 'cuadrado' : 'redondo';
}

// ---------- Segmentación ----------

function segment(img, o) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const bg = borderMedian(img);
  const dist = new Uint8Array(n);
  const hist = new Float64Array(256);
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    const dr = data[q] - bg[0], dg = data[q + 1] - bg[1], db = data[q + 2] - bg[2];
    const d = Math.min(255, Math.round(Math.sqrt(dr * dr + dg * dg + db * db) * 0.6));
    dist[i] = d;
    hist[d]++;
  }
  const threshold = Math.max(6, otsu(hist, n) * Math.pow(2, o.sensitivity * 0.8));
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = dist[i] > threshold ? 1 : 0;

  const r = Math.max(1, Math.round(Math.min(w, h) / 500));
  mask = dilate(erode(mask, w, h, 1), w, h, 1); // apertura: quita ruido
  mask = erode(dilate(mask, w, h, r), w, h, r); // cierre: tapa grietas
  fillHoles(mask, w, h);
  return { mask, background: bg, threshold };
}

// Color de fondo = mediana de una franja del borde de la imagen.
function borderMedian({ width: w, height: h, data }) {
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= m && x < w - m && y >= m && y < h - m) { x = w - m - 1; continue; }
      const q = (y * w + x) * 4;
      hists[0][data[q]]++; hists[1][data[q + 1]]++; hists[2][data[q + 2]]++;
      total++;
    }
  }
  return hists.map(hh => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hh[v]; if (acc >= total / 2) return v; }
    return 255;
  });
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function morph(src, w, h, r, isMax) {
  const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
  const pick = isMax ? (a, b) => a | b : (a, b) => a & b;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[row + k]);
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}
const erode = (m, w, h, r) => morph(m, w, h, r, false);
const dilate = (m, w, h, r) => morph(m, w, h, r, true);

// Rellena huecos internos (brillos, sal) inundando el fondo desde el borde.
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = i => { if (!mask[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
}

// ---------- Componentes y medición ----------

function label(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    labels[i] = ++count;
    let sp = 0;
    stack[sp++] = i;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const k = ny * w + nx;
          if (mask[k] && !labels[k]) { labels[k] = count; stack[sp++] = k; }
        }
      }
    }
  }
  return { labels, count };
}

function measure(labels, count, w, h) {
  const minArea = Math.max(4, Math.round((w * h) / 2e5));
  const area = new Int32Array(count + 1);
  for (let i = 0; i < labels.length; i++) area[labels[i]]++;
  // Índices de píxeles agrupados por etiqueta (CSR).
  const start = new Int32Array(count + 2);
  for (let l = 1; l <= count; l++) start[l + 1] = start[l] + area[l];
  const fill = start.slice(), idx = new Int32Array(start[count + 1]);
  for (let i = 0; i < labels.length; i++) if (labels[i]) idx[fill[labels[i]]++] = i;

  const comps = [];
  for (let l = 1; l <= count; l++) {
    const a = area[l];
    if (a < minArea) continue;
    let sx = 0, sy = 0, touches = false;
    for (let k = start[l]; k < start[l + 1]; k++) {
      const i = idx[k], x = i % w, y = (i - x) / w;
      sx += x; sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
    }
    const cx = sx / a, cy = sy / a;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let k = start[l]; k < start[l + 1]; k++) {
      const i = idx[k], x = (i % w) - cx, y = ((i - (i % w)) / w) - cy;
      cxx += x * x; cyy += y * y; cxy += x * y;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let k = start[l]; k < start[l + 1]; k++) {
      const i = idx[k], x = (i % w) - cx, y = ((i - (i % w)) / w) - cy;
      const u = x * cos + y * sin, v = -x * sin + y * cos;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const length = maxU - minU + 1, widthMax = maxV - minV + 1;

    // Perfil de ancho a lo largo del eje mayor (detecta cruces).
    const nb = Math.max(1, Math.ceil(length));
    const cnt = new Float64Array(nb);
    for (let k = start[l]; k < start[l + 1]; k++) {
      const i = idx[k], x = (i % w) - cx, y = ((i - (i % w)) / w) - cy;
      cnt[Math.min(nb - 1, Math.floor(x * cos + y * sin - minU))]++;
    }
    const core = Array.from(cnt.slice(Math.floor(nb * 0.2), Math.ceil(nb * 0.8)));
    const mean = core.reduce((s, v) => s + v, 0) / (core.length || 1);
    const sd = Math.sqrt(core.reduce((s, v) => s + (v - mean) ** 2, 0) / (core.length || 1));

    const uc = (minU + maxU) / 2, vc = (minV + maxV) / 2;
    comps.push({
      label: l, area: a, cx, cy, angle, length, widthMax,
      meanWidth: a / length,
      elongation: length / (a / length),
      rectFill: a / (length * widthMax),
      profileCV: mean ? sd / mean : 0,
      touchesBorder: touches,
      box: { cx: cx + uc * cos - vc * sin, cy: cy + uc * sin + vc * cos, len: length, wid: widthMax, angle },
    });
  }
  return comps;
}

// ---------- utilidades ----------

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}
const median = arr => percentile(arr, 0.5);
