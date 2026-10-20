// The seat under a seated casualty: a low, neutral block from a disaster scene
// (concrete kerb, masonry block or a battered crate), drawn in the ground layer,
// behind the body. Muted warm greys and browns only; never the tag colours.
//
// An intact wheelchair is the seat instead (overlays/appearance.js), so the
// block is skipped when the casualty has one.

import { f, pt, hash, makeRng, roundedPoly } from './util.js';
import { OUTLINE } from './palette.js';

const VARIANTS = ['kerb', 'masonry', 'crate'];
const TONES = {
  kerb: { top: '#c3bcb0', front: '#a9a193', edge: '#8a8174', line: '#8a8174' },
  masonry: { top: '#bfb3a6', front: '#a4968a', edge: '#85796e', line: '#7d7166' },
  crate: { top: '#b7a68a', front: '#9c8a6d', edge: '#7a6a52', line: '#6f6049' },
};
/** Every colour the seat uses; checkCoverage proves none looks like a tag colour. */
export const SEAT_COLOURS = Object.values(TONES).flatMap((t) => Object.values(t));

/** Which seat to draw for a casualty id (stable per casualty). */
export const seatVariant = (id) => VARIANTS[hash(String(id ?? 'x')) % VARIANTS.length];

/** Size of the seat for this figure; scales with the age group's proportions. */
export function seatMetrics(geom) {
  const P = geom.P, u = P.thigh / 48;
  const p = geom.torso.pelvis;
  const kneeReach = Math.max(...['L', 'R'].map((k) => Math.abs(geom.joints['kn' + k][0] - p[0]) + P.w.thigh / 2));
  const half = Math.max(kneeReach + 9 * u, 30 * u);
  const topY = p[1] + P.hipHalf * 0.9;
  const depth = 12 * u;
  const baseY = geom.groundY - 6 * u;
  return { u, cx: p[0], half, topY, depth, baseY, groundY: geom.groundY };
}

const rect = (x0, y0, x1, y1, r = 3) => roundedPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], r);
const line = (d, w, c, extra = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const shape = (d, fill, w = 2) => `<path d="${d}" fill="${fill}" stroke="${OUTLINE}" stroke-width="${w}" stroke-linejoin="round"/>`;

/** SVG for the seat block (ground layer, behind the body). */
export function seatSvg(geom, id) {
  const m = seatMetrics(geom);
  const { u, cx, half, topY, depth, baseY, groundY } = m;
  const kind = seatVariant(id);
  const T = TONES[kind];
  const rng = makeRng(`seat|${id}`);
  const x0 = cx - half, x1 = cx + half;
  const inset = 5 * u;
  const lw = 2 * Math.max(0.8, Math.sqrt(u)) * 0.9;
  let s = `<ellipse cx="${f(cx)}" cy="${f(baseY + 1.5 * u)}" rx="${f(half + 6 * u)}" ry="${f(5 * u)}" fill="#000" fill-opacity="0.15"/>`;

  // front face, then the top face on it
  s += shape(rect(x0, topY, x1, baseY, 3 * u), T.front, lw);
  const top = [[x0, topY], [x1, topY], [x1 - inset, topY - depth], [x0 + inset, topY - depth]];
  s += shape(roundedPoly(top, 2.5 * u), T.top, lw);
  // lit top edge and a shaded foot
  s += line(`M${pt([x0 + 3 * u, topY + 2.2 * u])}L${pt([x1 - 3 * u, topY + 2.2 * u])}`, 1.4, '#ffffff', ' stroke-opacity="0.45"');
  s += `<path d="${rect(x0 + 1.5, baseY - 5.5 * u, x1 - 1.5, baseY - 1, 2)}" fill="${T.edge}" fill-opacity="0.45"/>`;

  const H = baseY - topY;
  if (kind === 'kerb') {
    // a crack and a chipped corner
    const cxk = x0 + (half * 2) * (0.62 + rng() * 0.1);
    s += line(`M${pt([cxk, topY + 1])}L${pt([cxk - 4 * u, topY + H * 0.3])}L${pt([cxk + 1.5 * u, topY + H * 0.5])}L${pt([cxk - 3 * u, topY + H * 0.78])}`, 1.3, T.line);
    s += shape(roundedPoly([[x0, topY + 1], [x0 + 9 * u, topY + 1], [x0, topY + 10 * u]], 1.5), T.edge, 1.4);
  } else if (kind === 'masonry') {
    // brick courses
    const rows = 3, rh = H / rows;
    for (let i = 1; i < rows; i++) s += line(`M${pt([x0 + 1.5, topY + rh * i])}L${pt([x1 - 1.5, topY + rh * i])}`, 1.3, T.line);
    for (let i = 0; i < rows; i++) {
      const bw = 24 * u, off = (i % 2) * bw * 0.5 + (rng() - 0.5) * 3;
      for (let x = x0 + off + bw; x < x1 - 4; x += bw) s += line(`M${pt([x, topY + rh * i + 1])}L${pt([x, topY + rh * (i + 1) - 1])}`, 1.3, T.line);
    }
  } else {
    // crate: two slats, corner posts and a nail on each
    for (const t of [0.34, 0.68]) s += line(`M${pt([x0 + 1.5, topY + H * t])}L${pt([x1 - 1.5, topY + H * t])}`, 1.4, T.line);
    for (const x of [x0 + 6 * u, x1 - 6 * u]) {
      s += `<path d="${rect(x - 3 * u, topY + 1, x + 3 * u, baseY - 1, 1)}" fill="${T.edge}" fill-opacity="0.55" stroke="${T.line}" stroke-width="1"/>`;
      for (const t of [0.22, 0.8]) s += `<circle cx="${f(x)}" cy="${f(topY + H * t)}" r="${f(1.1 * u + 0.3)}" fill="${T.line}"/>`;
    }
    for (const t of [0.3, 0.6]) s += line(`M${pt([x0 + inset + 2, topY - depth * t])}L${pt([x1 - inset - 2, topY - depth * t])}`, 1.1, T.line, ' stroke-opacity="0.7"');
  }
  return s;
}
