// Appearance overlays: whole-body looks (pallor, dust, wet, motion, mobility aid),
// face features (eyes, expression, cyanosis, sweating, soot is an injury) and
// speech. Guarding re-poses the free arm.

import { f, pt, perp, add, sub, mul, unit, dist, lerp, clamp, chainPath, roundedPoly, blobPath, rad } from '../util.js';
import { OUTLINE, INK } from '../palette.js';
import { reachArm, findLimb, torsoPoint, torsoHalfWidth } from '../skeleton.js';
import { silhouette, segDrawPts } from '../figure.js';
import { textWidth, wrapText, nearestOnRect } from '../labels.js';
import { frame, headPoint, headGroup, faceLayout, blurFilter, dustFill, bodyClip, darkLine } from './helpers.js';

const MOTION = '#55606b';

// ---- whole-body looks ----

export const pallor = {
  kind: 'appearance',
  params: {},
  // Skin, lips and eyelids are recoloured in the palette (palette.resolveStyle flags.pallor).
  draw() { return ''; },
};

export const dust = {
  kind: 'appearance',
  params: {},
  draw(ctx) {
    return `<g clip-path="url(#${bodyClip(ctx)})"><rect x="0" y="0" width="240" height="240" fill="url(#${dustFill(ctx)})" fill-opacity="0.65"/></g>`;
  },
};

function drop(x, y, s = 1) {
  return `<path d="M${f(x)} ${f(y - 4 * s)}Q${f(x + 3.2 * s)} ${f(y + 0.5 * s)} ${f(x)} ${f(y + 2.6 * s)}Q${f(x - 3.2 * s)} ${f(y + 0.5 * s)} ${f(x)} ${f(y - 4 * s)}Z" fill="#9dc0dc" stroke="#486b88" stroke-width="1"/>`;
}

export const wet = {
  kind: 'appearance',
  params: {},
  // Clothing and hair darkening happens in the palette; this adds the drip shapes.
  draw(ctx) {
    const g = ctx.geom;
    const hw = torsoHalfWidth(g, 0.84) + 1;
    const pts = [torsoPoint(g, 0.86, hw), torsoPoint(g, 0.86, -hw)];
    for (const k of ['L', 'R']) {
      const arm = findLimb(g, k, 'arm');
      const last = arm.segs.at(-1).pts.at(-1);
      pts.push(last);
    }
    const leg = findLimb(g, 'L', 'leg');
    pts.push(leg.segs[0].pts.at(-1));
    return pts.map((p, i) => drop(p[0] + (i % 2 ? 1 : -1), p[1] + 6, 0.9)).join('') + drop(g.head.c[0] + g.head.r * 0.9, g.head.c[1] + g.head.r * 0.5, 0.8);
  },
};

// ---- motion ----

function zigzag(a, b, off, amp, period = 7) {
  const d = unit(sub(b, a)), n = perp(d), L = dist(a, b);
  const pts = [];
  const steps = Math.max(2, Math.round(L / (period / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = lerp(a, b, t);
    pts.push(add(p, mul(n, off + (i % 2 ? amp : -amp))));
  }
  return `M${pts.map(pt).join('L')}`;
}
function arcMarks(p, angle, r0 = 5, r1 = 8.5) {
  const mk = (r) => {
    const a0 = rad(angle - 38), a1 = rad(angle + 38);
    return `M${f(p[0] + Math.cos(a0) * r)} ${f(p[1] + Math.sin(a0) * r)}A${f(r)} ${f(r)} 0 0 1 ${f(p[0] + Math.cos(a1) * r)} ${f(p[1] + Math.sin(a1) * r)}`;
  };
  return darkLine(mk(r0), 1.7, MOTION) + darkLine(mk(r1), 1.7, MOTION);
}
function wave(a, b, off, amp, period = 16) {
  const d = unit(sub(b, a)), n = perp(d), L = dist(a, b);
  const pts = [];
  const steps = Math.max(6, Math.round(L / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(add(add(a, mul(d, L * t)), mul(n, off + Math.sin((t * L / period) * Math.PI * 2) * amp)));
  }
  return `M${pts.map(pt).join('L')}`;
}

export const motion = {
  kind: 'appearance',
  params: { type: ['walking', 'agitated', 'shaking', 'writhing', 'seizing'] },
  draw(ctx, { params }) {
    const g = ctx.geom, type = params.type ?? 'agitated';
    const [x0, y0, x1, y1] = g.bbox;
    const axisA = g.torso.neck, axisB = g.torso.pelvis;
    const hw = torsoHalfWidth(g, 0.5);
    const sideOf = (s) => [torsoPoint(g, 0.05, s * (hw + 8)), torsoPoint(g, 0.95, s * (hw + 8))];
    let svg = '';
    if (type === 'walking') {
      const roomL = x0, roomR = 240 - x1;
      const sgn = roomL >= roomR ? -1 : 1, bx = sgn < 0 ? x0 - 6 : x1 + 6;
      const H = y1 - y0;
      [[0.3, 16], [0.48, 24], [0.66, 14]].forEach(([t, l]) => { const y = g.upright ? y0 + H * t : (y0 + y1) / 2 + (t - 0.5) * 40; svg += darkLine(`M${f(bx)} ${f(y)}L${f(bx + sgn * l)} ${f(y)}`, 1.8, MOTION); });
      if (g.upright) for (const k of ['L', 'R']) { const to = findLimb(g, k, 'leg').segs.at(-1).pts.at(-1); svg += arcMarks([to[0], to[1] + 3], k === 'L' ? 0 : 180, 4, 7); }
    } else if (type === 'agitated') {
      const hc = g.head.c, r = g.head.r;
      svg += arcMarks([hc[0] - r - 2, hc[1]], 180, 5, 9) + arcMarks([hc[0] + r + 2, hc[1]], 0, 5, 9);
      for (const k of ['L', 'R']) { const arm = findLimb(g, k, 'arm'); const tip = arm.segs.at(-1).pts.at(-1); const away = unit(sub(tip, arm.segs[0].pts[0])); svg += arcMarks(add(tip, mul(away, 3)), (Math.atan2(away[1], away[0]) * 180) / Math.PI, 4, 7.5); }
    } else if (type === 'shaking') {
      for (const s of [1, -1]) { const [a, b] = sideOf(s); svg += darkLine(zigzag(a, b, s * 3, 1.8, 6), 1.6, MOTION); }
      const hc = g.head.c, r = g.head.r;
      svg += darkLine(zigzag([hc[0] - r - 5, hc[1] - 8], [hc[0] - r - 5, hc[1] + 8], 0, 1.8, 5), 1.6, MOTION) + darkLine(zigzag([hc[0] + r + 5, hc[1] - 8], [hc[0] + r + 5, hc[1] + 8], 0, 1.8, 5), 1.6, MOTION);
    } else if (type === 'writhing') {
      for (const s of [1, -1]) { const [a, b] = sideOf(s); svg += darkLine(wave(a, b, s * 4, 3.2, 20), 1.7, MOTION); }
      for (const k of ['L', 'R']) { const leg = findLimb(g, k, 'leg'); const a = leg.segs[0].pts[0], b = leg.segs[1]?.pts.at(-1) ?? a; svg += darkLine(wave(a, b, (k === 'L' ? 1 : -1) * (g.P.w.thigh / 2 + 5), 2.4, 18), 1.5, MOTION); }
    } else {
      // seizing: jagged outline around every chain plus a few bursts
      const jag = (pts, off) => { let d = ''; for (let i = 0; i < pts.length - 1; i++) d += zigzag(pts[i], pts[i + 1], off, 2.4, 6.5); return d; };
      for (const limb of g.limbs) for (const s of limb.segs) {
        const dp = segDrawPts(s);
        svg += darkLine(jag(dp, s.w / 2 + 5), 1.5, MOTION) + darkLine(jag(dp, -(s.w / 2 + 5)), 1.5, MOTION);
      }
      for (const s of [1, -1]) { const [a, b] = sideOf(s); svg += darkLine(zigzag(a, b, s * 4, 2.4, 6.5), 1.5, MOTION); }
      const hc = g.head.c, r = g.head.r;
      let ring = '';
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = r + 4 + (i % 2) * 4; ring += `${i ? 'L' : 'M'}${f(hc[0] + Math.cos(a) * rr)} ${f(hc[1] + Math.sin(a) * rr)}`; }
      svg += darkLine(ring + 'Z', 1.5, MOTION);
    }
    return svg;
  },
};

// ---- face features ----

const BROW = '#3b2f2a';

function eyeSvg(p, state, r, style) {
  const [x, y] = [p[0] * r, p[1] * r];
  const rx = 0.2 * r, ry = 0.17 * r;
  if (state === 'closed') {
    return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 1.05)}" ry="${f(ry * 0.65)}" fill="${style.lid}"/>`
      + darkLine(`M${f(x - rx * 1.05)} ${f(y - 0.02 * r)}Q${f(x)} ${f(y + 0.2 * r)} ${f(x + rx * 1.05)} ${f(y - 0.02 * r)}`, 1.5, OUTLINE);
  }
  let s = `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="#fff" stroke="${OUTLINE}" stroke-width="1"/>`;
  s += `<circle cx="${f(x)}" cy="${f(y + (state === 'half_closed' ? 0.04 * r : 0))}" r="${f(0.095 * r)}" fill="#23262c"/>`;
  if (state === 'half_closed') {
    s += `<path d="M${f(x - rx)} ${f(y)}A${f(rx)} ${f(ry)} 0 0 1 ${f(x + rx)} ${f(y)}Z" fill="${style.lid}" stroke="${OUTLINE}" stroke-width="1" stroke-linejoin="round"/>`;
  }
  return s;
}

export const eyes = {
  kind: 'appearance',
  params: { state: ['open', 'closed', 'half_closed'] },
  draw(ctx, { params }) {
    const g = ctx.geom, r = g.head.r, L = faceLayout(g);
    const state = params.state ?? (ctx.state?.responsive === 'alert' || ctx.state?.responsive == null ? 'open' : 'closed');
    return headGroup(g, L.eyes.map((e) => eyeSvg(e.p, state, r, ctx.style)).join(''));
  },
};

function browPath(L, p, r, kind, idx, profile) {
  // inner end faces the face centre line
  const inner = profile ? -1 : p[0] < 0 ? 1 : -1;
  const w = 0.17 * r;
  const x0 = p[0] * r - inner * w, x1 = p[0] * r + inner * w; // x0 outer, x1 inner
  const y = p[1] * r;
  const adj = { calm: [0, -0.03, 0], blank: [0, 0, 0], pain: [-0.03, 0.08, 0], distress: [0.05, -0.1, 0], panic: [-0.12, -0.16, 0], confused: idx === 0 ? [0, -0.14, 0] : [0.02, 0.05, 0] }[kind] ?? [0, 0, 0];
  const o = adj[0] * r, i = adj[1] * r;
  return `M${f(x0)} ${f(y + o)}Q${f((x0 + x1) / 2)} ${f(y + (o + i) / 2 + (kind === 'calm' || kind === 'panic' ? -0.06 * r : 0))} ${f(x1)} ${f(y + i)}`;
}

function mouthSvg(L, mood, r, lip) {
  const [mx, my] = L.mouth;
  const prof = L.mode === 'profile';
  const w = (prof ? 0.2 : 0.24) * r;
  const cx = mx * r, cy = my * r;
  const lineWith = (d) => darkLine(d, 4, OUTLINE) + darkLine(d, 1.9, lip);
  const X = (dx) => f(cx + dx);
  const Y = (dy) => f(cy + dy);
  switch (mood) {
    case 'pain': {
      const hh = 0.1 * r;
      return `<rect x="${X(-w)}" y="${Y(-hh)}" width="${f(2 * w)}" height="${f(2 * hh * 1.1)}" rx="${f(hh)}" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1.3"/>` + darkLine(`M${X(-w)} ${Y(0)}L${X(w)} ${Y(0)}`, 0.8, '#8a8f96')
        + darkLine(`M${X(-w)} ${Y(-hh)}L${X(w)} ${Y(-hh)}`, 1.6, lip);
    }
    case 'distress': return lineWith(`M${X(-w)} ${Y(0.08 * r)}Q${X(0)} ${Y(-0.12 * r)} ${X(w)} ${Y(0.08 * r)}`);
    case 'panic':
      return `<ellipse cx="${X(0)}" cy="${Y(0.04 * r)}" rx="${f(w * 0.75)}" ry="${f(0.2 * r)}" fill="#4b3238" stroke="${OUTLINE}" stroke-width="3.4"/><ellipse cx="${X(0)}" cy="${Y(0.04 * r)}" rx="${f(w * 0.75)}" ry="${f(0.2 * r)}" fill="none" stroke="${lip}" stroke-width="1.6"/>`;
    case 'blank': return lineWith(`M${X(-w * 0.7)} ${Y(0.04 * r)}L${X(w * 0.7)} ${Y(0.04 * r)}`);
    case 'confused': return lineWith(`M${X(-w)} ${Y(0.04 * r)}q${f(w * 0.5)} ${f(-0.14 * r)} ${f(w)} 0t${f(w)} 0`);
    default: return lineWith(`M${X(-w)} ${Y(0)}Q${X(0)} ${Y(0.14 * r)} ${X(w)} ${Y(0)}`);
  }
}

export const expression = {
  kind: 'appearance',
  params: { mood: ['calm', 'pain', 'distress', 'panic', 'blank', 'confused'] },
  draw(ctx, { params }) {
    const g = ctx.geom, r = g.head.r, L = faceLayout(g);
    const resp = ctx.state?.responsive;
    const mood = params.mood ?? (resp === 'alert' || resp == null ? 'calm' : 'blank');
    const brows = L.brows.map((p, i) => darkLine(browPath(L, p, r, mood, i, L.mode === 'profile'), 1.7, BROW)).join('');
    return headGroup(g, brows + mouthSvg(L, mood, r, ctx.lip));
  },
};

export const cyanosis = {
  kind: 'appearance',
  params: {},
  draw(ctx) {
    const g = ctx.geom, r = g.head.r, L = faceLayout(g), bl = blurFilter(ctx, 1.4);
    const [mx, my] = L.mouth;
    return headGroup(g, `<ellipse cx="${f(mx * r)}" cy="${f(my * r)}" rx="${f(0.42 * r)}" ry="${f(0.26 * r)}" fill="#6c82a8" fill-opacity="0.62" filter="url(#${bl})"/>`);
  },
};

export const sweating = {
  kind: 'appearance',
  params: {},
  draw(ctx) {
    const g = ctx.geom, r = g.head.r, L = faceLayout(g);
    const pts = [...L.forehead, ...L.cheek.slice(0, 2)].slice(0, 4);
    const s = (p) => { const x = p[0] * r, y = p[1] * r, k = r / 15; return `<path d="M${f(x)} ${f(y - 3.4 * k)}Q${f(x + 2.6 * k)} ${f(y + 0.4 * k)} ${f(x)} ${f(y + 2.2 * k)}Q${f(x - 2.6 * k)} ${f(y + 0.4 * k)} ${f(x)} ${f(y - 3.4 * k)}Z" fill="#a8d0ea" stroke="#486b88" stroke-width="0.9"/>`; };
    return headGroup(g, pts.map(s).join(''));
  },
};

// ---- speech ----

function bubble(rect, anchor, { dashed = false, fill = '#ffffff', lines, fs = 8, italic = false, stroke = OUTLINE }) {
  const [x, y, w, h] = rect;
  const np = nearestOnRect(rect, anchor);
  const d = unit(sub(anchor, np)), n = perp(d);
  const t1 = add(np, mul(n, 4.5)), t2 = sub(np, mul(n, 4.5));
  // pull the base points inside the rect edge so the tail merges into the bubble
  const inside = (p) => [clamp(p[0], x + 3, x + w - 3), clamp(p[1], y + 3, y + h - 3)];
  const b1 = inside(t1), b2 = inside(t2);
  const dash = dashed ? ' stroke-dasharray="3.2 2.2"' : '';
  let s = `<path d="M${pt(b1)}L${pt(anchor)}L${pt(b2)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"${dash}/>`;
  s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`;
  s += `<path d="M${pt(b1)}L${pt(b2)}" stroke="${fill}" stroke-width="2.4"/>`;
  lines.forEach((ln, i) => { s += `<text x="${f(x + w / 2)}" y="${f(y + 5 + fs * (i + 0.8) + i * 2)}" font-size="${fs}" fill="${INK}" text-anchor="middle"${italic ? ' font-style="italic"' : ''}>${ln.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`; });
  return s;
}

/** Shared bubble request used by speech and response bubbles. */
export function requestBubble(ctx, { layer, anchor, text, dashed, fill, italic, max = 15, prefer }) {
  const lines = wrapText(text, max);
  const fs = 8;
  const w = Math.max(...lines.map((l) => textWidth(l, fs))) + 11;
  const h = lines.length * (fs + 2) + 6;
  ctx.requestLabel({ layer, anchor, w, h, prefer, draw: (rect, a) => bubble(rect, a, { dashed, fill, lines, fs, italic }) });
}

export const speech = {
  kind: 'appearance',
  params: { text: 'string' },
  draw(ctx, { params }) {
    const g = ctx.geom, L = faceLayout(g);
    // face hidden (prone): the bubble is pinned to the head instead
    const mouth = ctx.anchors.face ? headPoint(g, L.mouth[0] * (L.mode === 'profile' ? 1.05 : 1), L.mouth[1]) : [ctx.anchors.head.x, ctx.anchors.head.y];
    const text = String(params.text ?? '').slice(0, 40);
    requestBubble(ctx, { layer: 'appearance', anchor: mouth, text, prefer: g.upright ? [315, 225, 0, 180, 270] : [270, 315, 225, 0, 180] });
    return '';
  },
};

// ---- guarding (free arm moves to the region) ----

/** Where a free hand rests on a region: the side of the head (not the face), else the region centre. */
export function holdPoint(geom, region, anchor, side) {
  if (region !== 'head' && region !== 'face') return [anchor.x, anchor.y];
  const sh = findLimb(geom, side, 'arm').segs[0].pts[0];
  const cands = [-1.12, 1.12].map((x) => headPoint(geom, x, 0.05));
  return cands.sort((p, q) => dist(p, sh) - dist(q, sh))[0];
}

export function chooseFreeArm(geom, region, busyRegions) {
  const sideOfRegion = region.startsWith('left_') ? 'L' : region.startsWith('right_') ? 'R' : null;
  if (sideOfRegion) return sideOfRegion === 'L' ? 'R' : 'L';
  const busy = (k) => [`${k === 'L' ? 'left' : 'right'}_upper_arm`, `${k === 'L' ? 'left' : 'right'}_forearm`, `${k === 'L' ? 'left' : 'right'}_hand`].some((r) => busyRegions.has(r));
  return ['R', 'L'].find((k) => !busy(k)) ?? 'R';
}

export const guarding = {
  kind: 'appearance',
  params: {},
  geometry(geom, { region, env }) {
    const a = env.anchors[region];
    if (!a) return;
    const side = chooseFreeArm(geom, region, env.busy);
    if (reachArm(geom, side, holdPoint(geom, region, a, side))) (geom.holding ??= []).push({ side, region, kind: 'guard' });
  },
  draw(ctx, { region }) {
    const hold = (ctx.geom.holding ?? []).find((h) => h.region === region && h.kind === 'guard');
    if (!hold) return '';
    return heldHand(ctx, hold.side, ctx.style.skin);
  },
};

/** The hand drawn again above the injuries, so it covers the region it holds. */
export function heldHand(ctx, side, colour, glove = false) {
  const arm = findLimb(ctx.geom, side, 'arm');
  const hand = arm.segs[2];
  if (!hand) return '';
  const pts = segDrawPts(hand);
  return silhouette(chainPath(pts, hand.w / 2 + (glove ? 0.8 : 0)), colour, OUTLINE);
}

// ---- mobility aid ----

const AID = { grey: '#8d96a0', light: '#c9d0d7', blue: '#5f7ea6', dark: '#4a5360' };
const line = (a, b, w, c) => `<path d="M${pt(a)}L${pt(b)}" stroke="${OUTLINE}" stroke-width="${w + 3}" stroke-linecap="round" fill="none"/><path d="M${pt(a)}L${pt(b)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;

function wheelSide(c, r, buckled, rng) {
  let s = buckled
    ? `<path d="${blobPath(c, r * 1.05, r * 0.82, 20, rng, 0.05, 12)}" fill="#e2e6ea" stroke="${OUTLINE}" stroke-width="2.4"/>`
    : `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r)}" fill="#e2e6ea" stroke="${OUTLINE}" stroke-width="2.4"/>`;
  s += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r * 0.78)}" fill="none" stroke="${AID.grey}" stroke-width="1.6"/>`;
  const n = buckled ? 3 : 6;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.3; s += darkLine(`M${f(c[0])} ${f(c[1])}L${f(c[0] + Math.cos(a) * r * 0.78)} ${f(c[1] + Math.sin(a) * r * 0.78)}`, 1, AID.grey); }
  if (buckled) s += `<path d="M${f(c[0] + r * 0.2)} ${f(c[1] - r * 0.95)}l${f(r * 0.28)} ${f(r * 0.45)}l${f(-r * 0.1)} ${f(r * 0.1)}l${f(r * 0.2)} ${f(r * 0.35)}" fill="none" stroke="${OUTLINE}" stroke-width="2"/>`;
  return s + `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="2.4" fill="${AID.dark}"/>`;
}

function wheelchairSide(broken, rng) {
  const hub = [0, 8];
  let s = '';
  s += line([-16, -36], [-28, -37], 3, AID.dark); // push handle
  s += line([-16, -36], [-14, -4], 4.5, AID.blue); // back rest
  s += line([-16, -4], [24, -4], 5.5, AID.blue); // seat
  s += line([24, -4], [31, 21], 3.2, AID.grey); // front frame
  s += line([27, 8], [40, 14], 3, AID.grey); // footrest
  s += `<circle cx="31" cy="23" r="5.5" fill="${AID.light}" stroke="${OUTLINE}" stroke-width="2"/>`;
  s += wheelSide(hub, 19, broken, rng);
  if (!broken) return { svg: s, w: 78, h: 64, rest: 27 };
  // tipped over: rotate about the wheel so the chair lies on its back
  // Rotated extents are x -51..32, y -44..41: shift right by 10 to centre, and rest on the bottom edge.
  return { svg: `<g transform="translate(10 0) rotate(-72 0 8)">${s}</g>`, w: 84, h: 86, rest: 39, tipped: true };
}

function wheelchairFront(ctx, broken) {
  const g = ctx.geom, pp = g.torso.pelvis, hw = g.P.hipHalf + 12;
  const top = torsoPoint(g, -0.15);
  let s = '';
  s += line([pp[0] - hw - 6, top[1] - 6], [pp[0] - hw - 12, top[1] - 16], 3.4, AID.dark);
  s += line([pp[0] + hw + 6, top[1] - 6], [pp[0] + hw + 12, top[1] - 16], 3.4, AID.dark);
  s += `<path d="${roundedPoly([[pp[0] - hw - 8, top[1] - 4], [pp[0] + hw + 8, top[1] - 4], [pp[0] + hw + 8, pp[1] + 8], [pp[0] - hw - 8, pp[1] + 8]], 6)}" fill="${AID.blue}" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round"/>`;
  for (const sg of [-1, 1]) {
    const cx = pp[0] + sg * (hw + 17), cy = pp[1] + 6;
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="5" ry="22" fill="#e2e6ea" stroke="${OUTLINE}" stroke-width="2.2"/><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="2" ry="19" fill="none" stroke="${AID.grey}" stroke-width="1.4"/>`;
  }
  return s;
}

function walkingFrame(broken) {
  const legs = [-22, -10, 10, 22];
  let s = '';
  legs.forEach((x, i) => {
    if (broken && i === 3) {
      s += line([x, -26], [x + 9, -6], 3.2, AID.grey);
      s += line([x + 13, 10], [x + 22, 25], 3.2, AID.grey);
      s += `<path d="M${x + 10} -3l3 4l-3 4l3 4" fill="none" stroke="${OUTLINE}" stroke-width="1.6"/>`;
    } else s += line([x, -26], [x + (x < 0 ? -2 : 2), 24], 3.2, AID.grey);
  });
  s += line([-22, -26], [broken ? 6 : 22, broken ? -22 : -26], 4.2, AID.light);
  if (broken) s += line([6, -22], [22, -26], 4.2, AID.light);
  s += line([-22, -6], [-10, -6], 2.6, AID.grey) + line([10, -6], [broken ? 17 : 22, -6], 2.6, AID.grey);
  for (const x of [-22, 22]) s += line([x - 3, -26], [x + 3, -26], 5, AID.blue);
  return { svg: s, w: 62, h: 58, rest: 26 };
}

function crutches(broken) {
  let s = '';
  const one = (x, lean, snap) => {
    const top = [x, -34], bot = [x + lean, 26];
    if (snap) {
      const mid = [x + lean * 0.5 + 1, -4];
      s += line(top, mid, 3.4, AID.grey);
      s += line([mid[0] + 9, mid[1] + 6], [bot[0] + 8, bot[1] - 1], 3.4, AID.grey);
      s += `<path d="M${f(mid[0] + 2)} ${f(mid[1] + 1)}l3 3l-2 3l4 3" fill="none" stroke="${OUTLINE}" stroke-width="1.6"/>`;
    } else {
      s += line(top, bot, 3.4, AID.grey);
      const g = lerp(top, bot, 0.38);
      s += line([g[0] - 6, g[1]], [g[0] + 6, g[1]], 3.4, AID.blue);
    }
    s += `<path d="${roundedPoly([[top[0] - 8, top[1] - 3], [top[0] + 8, top[1] - 3], [top[0] + 6, top[1] + 4], [top[0] - 6, top[1] + 4]], 2)}" fill="${AID.blue}" stroke="${OUTLINE}" stroke-width="2"/>`;
  };
  one(-11, -3, false);
  one(11, 3, broken);
  return { svg: s, w: 46, h: 66, rest: 26 };
}

function stick(broken) {
  let s = '';
  const hook = (x) => `<path d="M${x} -26Q${x} -36 ${x - 9} -34" fill="none" stroke="${OUTLINE}" stroke-width="6" stroke-linecap="round"/><path d="M${x} -26Q${x} -36 ${x - 9} -34" fill="none" stroke="${AID.blue}" stroke-width="3" stroke-linecap="round"/>`;
  if (broken) {
    s += hook(0) + line([0, -26], [1, -4], 3.2, AID.grey);
    s += line([8, 2], [14, 26], 3.2, AID.grey);
    s += `<path d="M2 -3l3 3l-2 3l4 3" fill="none" stroke="${OUTLINE}" stroke-width="1.6"/>`;
  } else s += hook(0) + line([0, -26], [2, 26], 3.2, AID.grey);
  return { svg: s, w: 28, h: 66, rest: 26 };
}

export const mobility_aid = {
  kind: 'appearance',
  params: { type: ['wheelchair', 'walking_frame', 'crutches', 'walking_stick'], condition: ['intact', 'broken'] },
  draw(ctx, { params }) {
    const g = ctx.geom;
    const type = params.type ?? 'wheelchair', broken = params.condition === 'broken';
    const rng = ctx.rng(`aid:${type}`);
    if (type === 'wheelchair' && !broken && (g.pose === 'sitting' || g.pose === 'slumped')) {
      ctx.add('ground', wheelchairFront(ctx, false));
      return '';
    }
    const a = type === 'wheelchair' ? wheelchairSide(broken, rng) : type === 'walking_frame' ? walkingFrame(broken) : type === 'crutches' ? crutches(broken) : stick(broken);
    const [x0, y0, x1, y1] = g.bbox;
    let tx, ty;
    if (g.upright) {
      const left = x0 >= 240 - x1;
      tx = left ? Math.max(a.w / 2 + 4, x0 - a.w / 2 - 4) : Math.min(236 - a.w / 2, x1 + a.w / 2 + 4);
      ty = g.groundY - a.rest;
    } else {
      const top = y0 >= 240 - y1;
      tx = 120;
      ty = top ? Math.max(a.h / 2 + 4, y0 - a.h / 2 - 5) : Math.min(236 - a.h / 2, y1 + a.h / 2 + 5);
    }
    ctx.add('ground', `<g transform="translate(${f(tx)} ${f(ty)})">${a.svg}</g>`);
    return '';
  },
};

export const APPEARANCE_OVERLAYS = { pallor, cyanosis, sweating, dust, wet, eyes, expression, motion, speech, mobility_aid, guarding };
