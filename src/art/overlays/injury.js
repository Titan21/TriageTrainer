// Injury and entrapment overlays. Each draw function returns SVG for its layer
// (injuries or entrapment); ground effects (blood pools, debris shadows) are
// added to the ground layer through ctx.add('ground', ...).

import { f, pt, dir, perp, add, sub, mul, dist, clamp, circlePath, chainPath, rectPath, blobPath, roundedPoly, polyPath } from '../util.js';
import { OUTLINE, BLOOD, WOUND } from '../palette.js';
import { kinkSegment, amputate, subPolyline } from '../skeleton.js';
import { frame, headPoint, hatchFill, crossHatchFill, blurFilter, clipped, darkLine, slot } from './helpers.js';

const SWELL = '#c8b2de';

/** Point (and size scale) where a mark for `region` should sit; avoids eyes and mouth on the head. */
export function spot(ctx, region, index = 0) {
  const a = ctx.anchors[region];
  const k = ctx.geom.ageGroup === 'child' ? 0.82 : 1;
  const mode = ctx.geom.head.mode;
  if (region === 'head') return { p: headPoint(ctx.geom, index % 2 ? -0.5 : 0.5, -0.58), rot: 0, k: 0.8 * k };
  if (region === 'face') return { p: headPoint(ctx.geom, mode === 'profile' ? 0.42 : index % 2 ? -0.55 : 0.55, 0.32), rot: 0, k: 0.7 * k };
  const s = Math.min(a.width, a.kind === 'torso' ? a.width : a.length);
  return { p: slot(a, index), rot: a.angle, k: clamp(s / 15, 0.7, 1.3) * (a.kind === 'segment' && a.width < 11 ? 0.9 : 1) };
}

function bloodShape(ctx, d, key, extra = '') {
  return `<path d="${d}" fill="url(#${hatchFill(ctx)})" stroke="${BLOOD.edge}" stroke-width="1.3" stroke-linejoin="round"${extra}/>`;
}

function pool(ctx, a, rng) {
  const g = ctx.geom;
  const R = clamp(11 + Math.max(a.length, a.width) * 0.26, 14, 26) * (g.ageGroup === 'child' ? 0.85 : 1);
  let c, rx, ry;
  if (g.upright) {
    const [x0, , x1] = g.bbox;
    c = [clamp(a.x, x0 + 6, x1 - 6), g.groundY - 2]; rx = R * 1.35; ry = R * 0.38;
  } else {
    const fr = frame(a);
    const mid = ctx.figure.centre;
    const cand = [1, -1].map((s) => ({ s, p: fr.P(0, s * (a.width / 2 + R * 0.5)) }));
    const box = (p) => Math.min(p[0], 240 - p[0], p[1], 240 - p[1]);
    const away = (o) => dist(o.p, mid) + box(o.p) * 0.6;
    const best = cand.sort((p, q) => away(q) - away(p))[0];
    c = best.p; rx = R; ry = R * 0.82;
  }
  const d = blobPath(c, rx, ry, 0, rng, 0.2, 10);
  ctx.add('ground', `<path d="${d}" fill="url(#${hatchFill(ctx)})" stroke="${BLOOD.edge}" stroke-width="1.3" stroke-linejoin="round"/>`);
}

export const bleed = {
  kind: 'injury',
  params: { severity: ['minor', 'major', 'catastrophic'] },
  draw(ctx, { region, params, key, index = 0 }) {
    const a = ctx.anchors[region];
    const rng = ctx.rng(`bleed:${region}:${key}`);
    const sev = params.severity ?? 'minor';
    const fr = frame(a);
    const rot = a.kind === 'circle' ? 0 : a.angle;
    let d;
    if (region === 'head' && sev !== 'minor') {
      // scalp bleed: keep it above the face
      const k = sev === 'major' ? 0.8 : 0.97, r = ctx.geom.head.r;
      d = blobPath(headPoint(ctx.geom, 0, -0.42), r * k, r * (sev === 'major' ? 0.5 : 0.62), (ctx.geom.head.up + 90) % 360, rng, 0.1, 10);
      if (sev === 'catastrophic') pool(ctx, a, ctx.rng(`pool:${region}:${key}`));
    } else if (sev === 'minor') {
      const { p, k } = spot(ctx, region, index);
      d = blobPath(p, Math.max(3.5, Math.min(a.length * 0.15, 7)) * k, Math.max(3, Math.min(a.width * 0.2, 6)) * k, rot, rng, 0.25, 8);
    } else if (sev === 'major') {
      d = blobPath(fr.c, a.length * 0.42, a.width * 0.43, rot, rng, 0.14, 10);
    } else {
      d = blobPath(fr.c, a.length * 0.58, a.width * 0.58, rot, rng, 0.1, 10);
      pool(ctx, a, ctx.rng(`pool:${region}:${key}`));
    }
    let svg = bloodShape(ctx, d, key);
    if (sev === 'catastrophic' && ctx.animate) svg = `<g>${svg}<animate attributeName="opacity" values="1;0.72;1" dur="1.2s" repeatCount="indefinite"/></g>`;
    else if (sev === 'major' && ctx.animate) svg = `<g>${svg}<animate attributeName="opacity" values="1;0.88;1" dur="2.4s" repeatCount="indefinite"/></g>`;
    return clipped(ctx, region, svg);
  },
};

export const wound = {
  kind: 'injury',
  params: { type: ['laceration', 'puncture', 'abrasion'] },
  draw(ctx, { region, params, key, index = 0 }) {
    const { p, rot, k } = spot(ctx, region, index);
    const rng = ctx.rng(`wound:${region}:${key}`);
    const type = params.type ?? 'laceration';
    if (type === 'puncture') {
      return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(5 * k)}" fill="${WOUND.margin}" stroke="${OUTLINE}" stroke-width="1"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(2.6 * k)}" fill="${WOUND.dark}"/>`;
    }
    if (type === 'abrasion') {
      const d = blobPath(p, 8.5 * k, 6 * k, rot + 20, rng, 0.38, 12);
      let dots = '';
      for (let i = 0; i < 6; i++) dots += `<circle cx="${f(p[0] + (rng() - 0.5) * 11 * k)}" cy="${f(p[1] + (rng() - 0.5) * 8 * k)}" r="${f(0.9 * k)}" fill="#b45a6a"/>`;
      return `<path d="${d}" fill="#efaab4" stroke="#c9707e" stroke-width="1" stroke-linejoin="round"/>${dots}`;
    }
    const u = dir(rot + 40), h = 7.5 * k;
    const a0 = sub(p, mul(u, h)), a1 = add(p, mul(u, h)), mid = add(p, mul(perp(u), 1.6 * k));
    const dd = `M${pt(a0)}Q${pt(mid)} ${pt(a1)}`;
    return darkLine(dd, 5 * k + 1, WOUND.margin) + darkLine(dd, 2 * k + 0.4, WOUND.dark);
  },
};

export const deformity = {
  kind: 'injury',
  params: { open: [true, false] },
  geometry(geom, { region }) { kinkSegment(geom, region, 25); },
  draw(ctx, { region, params, key }) {
    const a = ctx.anchors[region];
    if (!(params.open === true || params.open === 'true')) return '';
    const p = a.kink ?? [a.x, a.y];
    const k = ctx.geom.ageGroup === 'child' ? 0.82 : 1;
    return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(4.8 * k)}" fill="${WOUND.margin}" stroke="${OUTLINE}" stroke-width="1"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(2.4 * k)}" fill="${WOUND.dark}"/>`;
  },
};

export const amputation = {
  kind: 'injury',
  params: {},
  geometry(geom, { region }) { amputate(geom, region); },
  draw() { return ''; }, // the stump is part of the base figure (clothing-edged cap)
};

export const swelling = {
  kind: 'injury',
  params: {},
  draw(ctx, { region }) {
    const a = ctx.anchors[region];
    const g = ctx.geom;
    const shape = (d) => `<path d="${d}" fill="${SWELL}" fill-opacity="0.82" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
    const hi = (d) => darkLine(d, 1.2, '#f1e8fa', ' stroke-opacity="0.9"');
    if (region === 'head') {
      const c = headPoint(g, 0.62, -0.5);
      return shape(circlePath(c, g.head.r * 0.46)) + hi(`M${pt(headPoint(g, 0.45, -0.7))}Q${pt(headPoint(g, 0.6, -0.78))} ${pt(headPoint(g, 0.78, -0.62))}`);
    }
    if (region === 'face') {
      const c = headPoint(g, g.head.mode === 'profile' ? 0.45 : 0.56, 0.3);
      return shape(circlePath(c, g.head.r * 0.4));
    }
    if (region === 'abdomen') return shape(rectPath([a.x, a.y], a.angle, a.length * 0.95, a.width + 6, 10));
    if (region === 'neck') return shape(chainPath(a.pts, a.width / 2 + 3.5));
    const pts = a.kind === 'segment' ? (a.pts.length > 1 ? subPolyline(a.pts, a.length > 20 ? 0.12 : 0, a.length > 20 ? 0.92 : 1) : a.pts) : null;
    if (pts) return shape(chainPath(pts, a.width / 2 + 3.5)) + hi(`M${pt(pts[0])}L${pt(pts.at(-1))}`).replace('stroke-width="1.2"', 'stroke-width="0"');
    return shape(rectPath([a.x, a.y], a.angle, a.length, a.width + 6, 8));
  },
};

export const bruising = {
  kind: 'injury',
  params: {},
  draw(ctx, { region, key, index = 0 }) {
    const { p, rot, k } = spot(ctx, region, index);
    const rng = ctx.rng(`bruise:${region}:${key}`);
    const bl = blurFilter(ctx, 1.5);
    const a = ctx.anchors[region];
    const big = Math.min(a.length, 30) * 0.3 + 3;
    const outer = blobPath(p, (big + 3) * k, (big * 0.7 + 3) * k, rot + 15, rng, 0.25, 9);
    const inner = blobPath(add(p, [0.8, 0.5]), big * 0.7 * k, big * 0.5 * k, rot + 15, rng, 0.25, 9);
    return clipped(ctx, region, `<g filter="url(#${bl})"><path d="${outer}" fill="#d5cc78" fill-opacity="0.8"/><path d="${inner}" fill="#8a66b2" fill-opacity="0.82"/></g>`);
  },
};

export const burn = {
  kind: 'injury',
  params: { depth: ['superficial', 'partial', 'full'] },
  draw(ctx, { region, params, key, index = 0 }) {
    const a = ctx.anchors[region];
    const fr = frame(a);
    const rng = ctx.rng(`burn:${region}:${key}`);
    const depth = params.depth ?? 'superficial';
    const rot = a.kind === 'circle' ? 0 : a.angle;
    const c = a.kind === 'circle' ? spot(ctx, region, index).p : fr.c;
    const rx = (a.kind === 'circle' ? a.r * 0.6 : a.length * 0.42), ry = (a.kind === 'circle' ? a.r * 0.5 : a.width * 0.44);
    const d = blobPath(c, rx, ry, rot, rng, 0.2, 10);
    let svg;
    if (depth === 'superficial') svg = `<path d="${d}" fill="#f2b3bb" fill-opacity="0.85" stroke="#d98893" stroke-width="1"/>`;
    else if (depth === 'partial') {
      svg = `<path d="${d}" fill="#c58f86" stroke="#8d625b" stroke-width="1"/>`;
      for (let i = 0; i < 5; i++) {
        const q = fr.P((rng() - 0.5) * rx * 1.2, (rng() - 0.5) * ry * 1.1);
        const q2 = a.kind === 'circle' ? add(c, [(rng() - 0.5) * rx * 1.3, (rng() - 0.5) * ry * 1.3]) : q;
        svg += `<circle cx="${f(q2[0])}" cy="${f(q2[1])}" r="${f(1.5 + rng() * 1.2)}" fill="#ffffff" stroke="#8d625b" stroke-width="0.8"/>`;
      }
    } else svg = `<path d="${d}" fill="url(#${crossHatchFill(ctx)})" stroke="#303136" stroke-width="1.4" stroke-linejoin="round"/>`;
    return clipped(ctx, region, svg);
  },
};

const IMPALE_REGIONS_ROT = { chest: -50, abdomen: -55, pelvis: -50, back: -50 };
export const impaled_object = {
  kind: 'injury',
  params: { object: ['rebar', 'glass', 'wood', 'metal_sheet'] },
  draw(ctx, { region, params, index = 0 }) {
    const a = ctx.anchors[region];
    const base = a.kind === 'torso' ? -62 : a.angle - 62;
    const u = dir(base), v = perp(u);
    const { p } = spot(ctx, region, index);
    const L = a.kind === 'torso' ? 36 : 28;
    const tip = add(p, mul(u, L));
    const obj = params.object ?? 'rebar';
    let svg = '';
    if (obj === 'rebar') {
      svg += darkLine(`M${pt(p)}L${pt(tip)}`, 5.4, OUTLINE) + darkLine(`M${pt(p)}L${pt(tip)}`, 3, '#8f969d');
      for (let t = 5; t < L; t += 5) { const q = add(p, mul(u, t)); svg += darkLine(`M${pt(add(q, mul(v, 1.8)))}L${pt(sub(q, mul(v, 1.8)))}`, 1.1, '#5a6068'); }
    } else if (obj === 'metal_sheet') {
      const pts = [add(p, mul(v, -3)), add(add(p, mul(u, L * 0.9)), mul(v, -8)), add(add(p, mul(u, L)), mul(v, 3)), add(p, mul(v, 4))];
      svg += `<path d="${roundedPoly(pts, 1.5)}" fill="#b4bac1" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>` + darkLine(`M${pt(add(p, mul(v, -1)))}L${pt(add(add(p, mul(u, L * 0.85)), mul(v, -3)))}`, 1, '#eef1f4');
    } else if (obj === 'glass') {
      const pts = [add(p, mul(v, -3.5)), add(add(p, mul(u, L * 0.55)), mul(v, -7)), add(p, mul(u, L)), add(add(p, mul(u, L * 0.5)), mul(v, 5))];
      svg += `<path d="${polyPath(pts)}" fill="#b8def2" fill-opacity="0.92" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>` + darkLine(`M${pt(add(p, mul(u, 5)))}L${pt(add(p, mul(u, L * 0.75)))}`, 1, '#ffffff');
    } else {
      const pts = [add(p, mul(v, -3.2)), add(add(p, mul(u, L * 0.8)), mul(v, -3.6)), add(add(p, mul(u, L * 0.9)), mul(v, -1)), add(p, mul(u, L)), add(add(p, mul(u, L * 0.82)), mul(v, 3.6)), add(p, mul(v, 3.2))];
      svg += `<path d="${polyPath(pts)}" fill="#946443" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>` + darkLine(`M${pt(add(p, mul(u, 3)))}L${pt(add(p, mul(u, L * 0.8)))}`, 1, '#6a4529');
    }
    svg += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="4" fill="${WOUND.dark}" fill-opacity="0.9" stroke="${WOUND.margin}" stroke-width="1.6"/>`;
    return svg;
  },
};

export const soot = {
  kind: 'injury',
  params: {},
  draw(ctx, { region }) {
    const g = ctx.geom;
    const bl = blurFilter(ctx, 1.1);
    const spots = g.head.mode === 'profile'
      ? [[0.7, 0.45, 0.28, 0.2], [0.55, 0.3, 0.22, 0.16], [0.85, 0.3, 0.16, 0.14]]
      : [[-0.3, 0.38, 0.26, 0.2], [0.3, 0.38, 0.26, 0.2], [0, 0.55, 0.3, 0.18], [0, 0.25, 0.18, 0.12]];
    let s = '';
    for (const [x, y, rx, ry] of spots) {
      const c = headPoint(g, x, y);
      s += `<ellipse cx="${f(c[0])}" cy="${f(c[1])}" rx="${f(rx * g.head.r)}" ry="${f(ry * g.head.r)}" transform="rotate(${f(g.head.up + 90)} ${f(c[0])} ${f(c[1])})" fill="#4d4f55" fill-opacity="0.62"/>`;
    }
    return `<g filter="url(#${bl})">${s}</g>`;
  },
};

// ---- entrapment ----

function obbOf(ctx, regions) {
  const pts = [];
  for (const r of regions) {
    const a = ctx.anchors[r];
    if (!a) continue;
    const fr = frame(a);
    for (const [s, t] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pts.push(fr.P(s * a.length, t * a.width));
  }
  if (!pts.length) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = [Math.cos(ang), Math.sin(ang)], v = perp(u);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of pts) {
    const s = (p[0] - mx) * u[0] + (p[1] - my) * u[1], t = (p[0] - mx) * v[0] + (p[1] - my) * v[1];
    a0 = Math.min(a0, s); a1 = Math.max(a1, s); b0 = Math.min(b0, t); b1 = Math.max(b1, t);
  }
  const c = [mx + u[0] * (a0 + a1) / 2 + v[0] * (b0 + b1) / 2, my + u[1] * (a0 + a1) / 2 + v[1] * (b0 + b1) / 2];
  return { c, u, v, L: a1 - a0, W: b1 - b0, angle: (ang * 180) / Math.PI };
}

const G = { light: '#b4b9bf', mid: '#9aa0a7', dark: '#767d85', hi: '#d4d8dc' };

function rubble(ctx, o, rng) {
  const P = (s, t) => [o.c[0] + o.u[0] * s + o.v[0] * t, o.c[1] + o.u[1] * s + o.v[1] * t];
  const L = o.L + 8, W = o.W + 8;
  let svg = `<path d="${blobPath(o.c, L / 2, W / 2, o.angle, rng, 0.08, 14)}" fill="${G.dark}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  const cols = Math.max(1, Math.round(L / 15)), rows = Math.max(1, Math.round(W / 15));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const s = -L / 2 + (i + 0.5) * (L / cols) + (rng() - 0.5) * 6, t = -W / 2 + (j + 0.5) * (W / rows) + (rng() - 0.5) * 6;
    const c = P(s, t), r = 6 + rng() * 5, n = 5 + Math.floor(rng() * 3);
    const pts = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + rng() * 0.5, rr = r * (0.7 + rng() * 0.5); pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]); }
    svg += `<path d="${polyPath(pts)}" fill="${[G.light, G.mid, G.hi][Math.floor(rng() * 3)]}" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
    svg += darkLine(`M${pt(pts[0])}L${pt(c)}L${pt(pts[2])}`, 1, G.dark);
  }
  return { svg, shadow: blobPath(add(o.c, [3, 4]), L / 2, W / 2, o.angle, rng, 0.08, 14) };
}

function bar(ctx, o, kind) {
  const tilt = 5;
  const thick = Math.max(kind === 'slab' ? 20 : 17, o.W + 8);
  const long = Math.max(o.L + 12, 56);
  const ang = o.angle + tilt;
  if (kind === 'beam') {
    const d = rectPath(o.c, ang, long, thick, 3);
    const fr = frame({ x: o.c[0], y: o.c[1], angle: ang, length: long, width: thick });
    let svg = `<path d="${d}" fill="${G.mid}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
    svg += darkLine(`M${pt(fr.P(-long / 2 + 3, -thick / 2 + 3.5))}L${pt(fr.P(long / 2 - 3, -thick / 2 + 3.5))}`, 1.4, G.hi);
    svg += darkLine(`M${pt(fr.P(-long / 2 + 3, thick / 2 - 3.5))}L${pt(fr.P(long / 2 - 3, thick / 2 - 3.5))}`, 1.4, G.dark);
    for (const s of [-0.38, 0.38]) svg += `<circle cx="${f(fr.P(long * s, 0)[0])}" cy="${f(fr.P(long * s, 0)[1])}" r="1.6" fill="${G.dark}"/>`;
    return { svg, shadow: rectPath(add(o.c, [3, 4]), ang, long, thick, 3) };
  }
  // slab: flat block with a lighter top and darker thickness edge
  const fr = frame({ x: o.c[0], y: o.c[1], angle: ang, length: long, width: thick });
  const top = rectPath(o.c, ang, long, thick, 4);
  let svg = `<path d="${rectPath(add(o.c, [0, 4]), ang, long, thick, 4)}" fill="${G.dark}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<path d="${top}" fill="${G.light}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  svg += darkLine(`M${pt(fr.P(-long * 0.2, -thick * 0.2))}L${pt(fr.P(-long * 0.05, thick * 0.05))}L${pt(fr.P(long * 0.05, -thick * 0.1))}`, 1.2, G.dark);
  svg += darkLine(`M${pt(fr.P(long * 0.3, thick * 0.25))}L${pt(fr.P(long * 0.38, 0))}`, 1.2, G.dark);
  return { svg, shadow: rectPath(add(o.c, [4, 7]), ang, long, thick, 4) };
}

function vehicle(ctx, o) {
  const long = Math.max(o.L + 12, 60), thick = Math.max(20, o.W + 8), ang = o.angle + 4;
  const fr = frame({ x: o.c[0], y: o.c[1], angle: ang, length: long, width: thick });
  const pts = [fr.P(-long / 2, -thick / 2), fr.P(long * 0.2, -thick / 2 - 3), fr.P(long / 2, -thick / 2 + 4), fr.P(long / 2, thick / 2), fr.P(-long / 2, thick / 2)];
  let svg = `<path d="${roundedPoly(pts, 5)}" fill="#454b53" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  svg += darkLine(`M${pt(fr.P(-long / 2 + 4, -thick / 2 + 5))}L${pt(fr.P(long / 2 - 4, -thick / 2 + 6))}`, 2, '#8a919a');
  svg += darkLine(`M${pt(fr.P(-long * 0.1, -thick / 2 + 3))}L${pt(fr.P(-long * 0.1, thick / 2 - 3))}`, 1.2, '#2c3036');
  return { svg, shadow: roundedPoly(pts.map((p) => add(p, [4, 6])), 5) };
}

function furniture(ctx, o) {
  const long = Math.max(o.L + 10, 54), thick = Math.max(22, o.W + 8), ang = o.angle + 3;
  const fr = frame({ x: o.c[0], y: o.c[1], angle: ang, length: long, width: thick });
  const wood = '#a07b54', dark = '#5f4630';
  let svg = `<path d="${rectPath(o.c, ang, long, thick, 3)}" fill="${wood}" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<path d="${rectPath(o.c, ang, long - 8, thick - 8, 2)}" fill="#c4a27a" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round"/>`;
  const n = Math.max(2, Math.round(long / 22));
  for (let i = 1; i < n; i++) svg += darkLine(`M${pt(fr.P(-long / 2 + 4 + ((long - 8) * i) / n, -thick / 2 + 4))}L${pt(fr.P(-long / 2 + 4 + ((long - 8) * i) / n, thick / 2 - 4))}`, 1.8, dark);
  svg += darkLine(`M${pt(fr.P(-long / 2 + 4, 0))}L${pt(fr.P(long / 2 - 4, 0))}`, 1.2, dark, ' stroke-opacity="0.7"');
  return { svg, shadow: rectPath(add(o.c, [3, 5]), ang, long, thick, 3) };
}

export const entrapment = {
  kind: 'entrapment',
  params: { material: ['rubble', 'beam', 'slab', 'vehicle', 'furniture'] },
  multiRegion: true,
  draw(ctx, { regions, params, key }) {
    const o = obbOf(ctx, regions);
    if (!o) return '';
    const rng = ctx.rng(`trap:${key}`);
    const m = params.material ?? 'rubble';
    const res = m === 'rubble' ? rubble(ctx, o, rng) : m === 'beam' || m === 'slab' ? bar(ctx, o, m) : m === 'vehicle' ? vehicle(ctx, o) : furniture(ctx, o);
    ctx.add('ground', `<path d="${res.shadow}" fill="#000" fill-opacity="0.16"/>`);
    return res.svg;
  },
};

export const INJURY_OVERLAYS = { bleed, wound, deformity, amputation, swelling, bruising, burn, impaled_object, soot, entrapment };
