// Geometry and defs helpers shared by the overlay draw functions.

import { f, pt, dir, perp, add, mul, circlePath, chainPath, rectPath, rad, esc } from '../util.js';
import { headTransform } from '../figure.js';
import { OUTLINE, BLOOD } from '../palette.js';

/** Local frame of an anchor: P(along, across) in picture coordinates. */
export function frame(a) {
  const u = dir(a.angle), v = perp(u);
  return { u, v, c: [a.x, a.y], L: a.length, W: a.width, P: (s, t) => [a.x + u[0] * s + v[0] * t, a.y + u[1] * s + v[1] * t] };
}

/** Footprint path of a region anchor, optionally padded. */
export function footprintPath(a, pad = 0) {
  if (a.kind === 'circle') return circlePath([a.x, a.y], a.r + pad);
  if (a.kind === 'segment' && a.pts) return chainPath(a.pts, a.width / 2 + pad);
  if (a.kind === 'box') return rectPath([a.x, a.y], 0, a.length, a.width, 4);
  return rectPath([a.x, a.y], a.angle, a.length + pad * 2, a.width + pad * 2, 5);
}

/** Map a point in the head's local frame (units of head radius) to picture coordinates. */
export function headPoint(geom, x, y) {
  const { c, up, tilt, r } = geom.head;
  const a = rad(up + 90 + tilt), cs = Math.cos(a), sn = Math.sin(a);
  const px = x * r, py = y * r;
  return [c[0] + px * cs - py * sn, c[1] + px * sn + py * cs];
}
export const headGroup = (geom, inner) => `<g transform="${headTransform(geom)}">${inner}</g>`;

/** Face feature layout in head-local units (r = 1). `side` of eyes: +1 = casualty's left. */
export function faceLayout(geom) {
  const dy = geom.head.back ? -0.13 : 0; // head tilted back (airway open): features ride up the face
  const up = (p) => [p[0], p[1] + dy];
  if (geom.head.mode === 'profile') {
    return { mode: 'profile', eyes: [{ p: up([0.52, -0.04]), side: -1 }], brows: [up([0.52, -0.3])], mouth: up([0.68, 0.52]), nose: up([1.0, 0.2]), cheek: [up([0.4, 0.34])], forehead: [[0.55, -0.55], [0.3, -0.6]] };
  }
  return { mode: 'front', eyes: [{ p: up([-0.38, -0.02]), side: -1 }, { p: up([0.38, -0.02]), side: 1 }], brows: [up([-0.38, -0.3]), up([0.38, -0.3])], mouth: up([0, 0.5]), nose: up([0, 0.15]), cheek: [up([-0.58, 0.3]), up([0.58, 0.3])], forehead: [[-0.3, -0.58], [0.1, -0.64], [0.4, -0.54]] };
}

// ---- defs ----

export function hatchFill(ctx) {
  return ctx.def('hatch', (id) => `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="${BLOOD.fill}"/><line x1="0" y1="0" x2="0" y2="4" stroke="${BLOOD.hatch}" stroke-width="1.3"/></pattern>`);
}
export function crossHatchFill(ctx) {
  return ctx.def('xhatch', (id) => `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#5b5c61"/><path d="M0 0L4 4M4 0L0 4" stroke="#3b3c40" stroke-width="1"/></pattern>`);
}
export function blurFilter(ctx, sd = 1.6) {
  return ctx.def(`blur${String(sd).replace('.', '_')}`, (id) => `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
}
export function dustFill(ctx) {
  return ctx.def('dust', (id) => `<pattern id="${id}" width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="1.8" cy="2.4" r="0.7" fill="#cfcfca"/><circle cx="7" cy="1.4" r="0.55" fill="#b9b9b3"/><circle cx="4.6" cy="6.4" r="0.8" fill="#d6d6d1"/><circle cx="9.2" cy="8.2" r="0.55" fill="#c2c2bc"/><circle cx="1" cy="9" r="0.5" fill="#c8c8c2"/></pattern>`);
}

/** clipPath for a region footprint. */
export function regionClip(ctx, region, pad = 1) {
  const a = ctx.anchors[region];
  return ctx.def(`clip-${region}`, (id) => `<clipPath id="${id}"><path d="${footprintPath(a, pad)}"/></clipPath>`);
}
export function bodyShape(ctx) {
  // with a shared base (preview), the outline lives once in the shared definitions
  if (ctx.sharedShape) return ctx.sharedShape;
  return ctx.def('bodyshape', (id) => `<path id="${id}" d="${ctx.figure.bodyUnion}"/>`);
}
export function bodyClip(ctx) {
  const shape = bodyShape(ctx);
  return ctx.def('clip-body', (id) => `<clipPath id="${id}"><use href="#${shape}"/></clipPath>`);
}
/** Wrap content so it is clipped to the region and the body silhouette. */
export function clipped(ctx, region, inner, { body = true, pad = 1 } = {}) {
  const rc = regionClip(ctx, region, pad);
  const g = `<g clip-path="url(#${rc})">${inner}</g>`;
  return body ? `<g clip-path="url(#${bodyClip(ctx)})">${g}</g>` : g;
}

export const darkLine = (d, w = 1.6, c = OUTLINE, extra = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
export const textEl = (x, y, s, fs, fill = '#1f2228', anchor = 'middle', bold = false) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${fs}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ''}>${esc(s)}</text>`;

/** Sample a few positions inside the footprint so several findings on one region do not stack. */
export function slot(a, index = 0) {
  const fr = frame(a);
  const offs = [[0.0, 0.0], [0.22, -0.2], [-0.22, 0.2], [0.3, 0.25]];
  const o = offs[index % offs.length];
  return fr.P(o[0] * a.length, o[1] * a.width);
}
export { add, mul, pt };
