// sample.js — Genera una foto sintética de "ramitas" con resultado conocido,
// para probar el analizador sin cámara (navegador y Node).

export function makeSample({
  width = 1200, height = 900, seed = 7,
  whole = 14, broken = 12, crossed = true, crumbs = 6,
  stickLen = 220, stickW = 16,
} = {}) {
  const rnd = mulberry32(seed);
  const sticks = [];
  const fits = (s, gap) => sticks.every(t => segDist(s, t) > (s.w + t.w) / 2 + gap);

  const place = (len, w, tries = 400) => {
    for (let k = 0; k < tries; k++) {
      const a = rnd() * Math.PI, cx = 40 + rnd() * (width - 80), cy = 40 + rnd() * (height - 80);
      const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
      const s = { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, w, tint: 0.85 + rnd() * 0.25 };
      if (inside(s, width, height, w) && fits(s, 14)) return s;
    }
    return null;
  };

  const truth = { enteras: 0, partidas: 0, grupoUnidades: 0, migas: 0 };
  if (crossed) {
    // Dos ramitas cruzadas en X: deben detectarse como grupo.
    const a = place(stickLen, stickW);
    if (a) {
      const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1) + Math.PI / 3;
      const dx = Math.cos(ang) * stickLen / 2, dy = Math.sin(ang) * stickLen / 2;
      const b = { x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy, w: stickW, tint: a.tint };
      if (inside(b, width, height, stickW) && fits(b, 14)) {
        sticks.push(a, b);
        truth.grupoUnidades = 2;
      }
    }
  }
  for (let i = 0; i < whole; i++) {
    const s = place(stickLen, stickW);
    if (s) { sticks.push(s); truth.enteras++; }
  }
  for (let i = 0; i < broken; i++) {
    const s = place(stickLen * (0.15 + rnd() * 0.6), stickW);
    if (s) { sticks.push(s); truth.partidas++; }
  }
  const dots = [];
  for (let i = 0; i < crumbs; i++) {
    const s = place(1, 6 + rnd() * 3);
    if (s) { sticks.push(s); dots.push(s); truth.migas++; }
  }

  // Raster: fondo claro con degradé de luz + ruido, ramitas color tostado con sombreado.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const q = (y * width + x) * 4;
      const light = 1 - 0.06 * (x / width) - 0.04 * (y / height);
      const nz = (rnd() - 0.5) * 10;
      data[q] = 240 * light + nz; data[q + 1] = 236 * light + nz; data[q + 2] = 228 * light + nz; data[q + 3] = 255;
    }
  }
  for (const s of sticks) {
    const hw = s.w / 2;
    const x0 = Math.max(0, Math.floor(Math.min(s.x1, s.x2) - hw)), x1 = Math.min(width - 1, Math.ceil(Math.max(s.x1, s.x2) + hw));
    const y0 = Math.max(0, Math.floor(Math.min(s.y1, s.y2) - hw)), y1 = Math.min(height - 1, Math.ceil(Math.max(s.y1, s.y2) + hw));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = ptSeg(x, y, s);
        if (d > hw) continue;
        const shade = (1 - 0.35 * (d / hw) ** 2) * s.tint;
        const q = (y * width + x) * 4;
        const salt = rnd() < 0.015 ? 70 : 0;
        const nz = (rnd() - 0.5) * 14;
        data[q] = 196 * shade + nz + salt; data[q + 1] = 132 * shade + nz + salt; data[q + 2] = 62 * shade + nz + salt;
      }
    }
  }
  return { img: { width, height, data }, truth };
}

function inside(s, W, H, w) {
  const m = w + 6;
  return Math.min(s.x1, s.x2) > m && Math.max(s.x1, s.x2) < W - m && Math.min(s.y1, s.y2) > m && Math.max(s.y1, s.y2) < H - m;
}

function ptSeg(px, py, s) {
  const vx = s.x2 - s.x1, vy = s.y2 - s.y1, L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / L2)) : 0;
  return Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy));
}

function segDist(a, b) {
  let d = Infinity;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    d = Math.min(d,
      ptSeg(a.x1 + t * (a.x2 - a.x1), a.y1 + t * (a.y2 - a.y1), b),
      ptSeg(b.x1 + t * (b.x2 - b.x1), b.y1 + t * (b.y2 - b.y1), a));
  }
  return d;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
