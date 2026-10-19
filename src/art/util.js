// Small pure helpers shared by the art modules: vectors, SVG path builders,
// colour maths, hashing and a seeded RNG. No DOM, no Node APIs.

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const dir = (d) => [Math.cos(rad(d)), Math.sin(rad(d))];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const perp = (a) => [-a[1], a[0]];
export const angleOf = (a, b) => deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
export const rotAround = (p, c, d) => {
  const v = sub(p, c), cs = Math.cos(rad(d)), sn = Math.sin(rad(d));
  return [c[0] + v[0] * cs - v[1] * sn, c[1] + v[0] * sn + v[1] * cs];
};
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Format a number for SVG output: one decimal, no "-0". */
export const f = (n) => { const v = Math.round(n * 10) / 10; return String(Object.is(v, -0) ? 0 : v); };
export const pt = (p) => `${f(p[0])} ${f(p[1])}`;

/** XML-escape text and attribute values. */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** FNV-1a string hash (unsigned 32-bit). */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32 seeded RNG: returns () => [0,1). */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- SVG path builders (all return path data strings) ----

export function circlePath(c, r) {
  return `M${f(c[0] - r)} ${f(c[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

/** Stadium (capsule) between a and b with radius r. */
export function capsulePath(a, b, r) {
  const d = sub(b, a);
  if (len(d) < 0.01) return circlePath(a, r);
  const n = mul(perp(unit(d)), r);
  const p = (q, s) => pt([q[0] + n[0] * s, q[1] + n[1] * s]);
  return `M${p(a, 1)}L${p(b, 1)}A${f(r)} ${f(r)} 0 0 0 ${p(b, -1)}L${p(a, -1)}A${f(r)} ${f(r)} 0 0 0 ${p(a, 1)}Z`;
}

/** Polyline as a chain of capsules (union via a compound path). */
export function chainPath(pts, r) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) d += capsulePath(pts[i], pts[i + 1], r);
  return d;
}

export function polyPath(pts, close = true) {
  return `M${pts.map(pt).join('L')}${close ? 'Z' : ''}`;
}

/** Closed polygon with rounded corners (quadratic corner cuts). */
export function roundedPoly(pts, r) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const dp = sub(prev, p), dn = sub(next, p);
    const cut = Math.min(r, len(dp) / 2, len(dn) / 2);
    const s = add(p, mul(unit(dp), cut)), e = add(p, mul(unit(dn), cut));
    d += `${i === 0 ? 'M' : 'L'}${pt(s)}Q${pt(p)} ${pt(e)}`;
  }
  return d + 'Z';
}

/** Rotated rounded rectangle centred on c; length along angle (deg), width across. */
export function rectPath(c, angle, length, width, r = 3) {
  const u = dir(angle), v = perp(u), hl = length / 2, hw = width / 2;
  const q = (a, b) => add(c, add(mul(u, a), mul(v, b)));
  return roundedPoly([q(-hl, -hw), q(hl, -hw), q(hl, hw), q(-hl, hw)], Math.min(r, hl, hw));
}

/** Smooth closed blob around c: radii jitter from a seeded rng, ellipse rx/ry rotated by angle. */
export function blobPath(c, rx, ry, rot, rng, jitter = 0.18, n = 9) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rng() * 2 - 1) * jitter;
    const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
    const cs = Math.cos(rad(rot)), sn = Math.sin(rad(rot));
    pts.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
  }
  // Catmull-Rom to cubic Bezier for a smooth closed curve.
  let d = `M${pt(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + 'Z';
}

// ---- colour maths ----

export function hexToRgb(h) {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export const rgbToHex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
export const darken = (hex, t) => mix(hex, '#000000', t);
export const lighten = (hex, t) => mix(hex, '#ffffff', t);

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
