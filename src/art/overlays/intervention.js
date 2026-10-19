// Intervention overlays: things the player does to the casualty.

import { f, pt, dir, perp, add, sub, mul, unit, lerp, rectPath, capsulePath, esc, mix } from '../util.js';
import { OUTLINE, INK, FIXED_COLOURS, SKIN } from '../palette.js';
import { reachArm, polyAt, polyLength } from '../skeleton.js';
import { textWidth, nearestOnRect } from '../labels.js';
import { headPoint, darkLine } from './helpers.js';
import { spot } from './injury.js';
import { chooseFreeArm, heldHand, holdPoint } from './appearance.js';
import { outward } from './probe.js';

const TEAL = '#2f6f8f';

// ---- hands ----

/** A hand pressing at p with fingers pointing along `angle`, plus a short forearm stub going back. */
function handShape(p, angle, colour, stubColour) {
  const u = dir(angle), v = perp(u);
  const q = (a, b) => add(p, add(mul(u, a), mul(v, b)));
  let s = '';
  s += `<path d="${capsulePath(q(-5, 0), q(-20, 0), 4.6)}" fill="${stubColour}" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
  s += darkLine(`M${pt(q(-8, -4.4))}L${pt(q(-8, 4.4))}`, 2, mix(stubColour, '#000000', 0.25));
  s += `<path d="${capsulePath(q(3, 7), q(8.5, 10), 2)}" fill="${colour}" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>`;
  s += `<path d="${rectPath(q(0, 0), angle, 11, 12.5, 3)}" fill="${colour}" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
  for (const b of [-4.5, -1.5, 1.5, 4.5]) s += `<path d="${capsulePath(q(4, b), q(9.5, b), 1.55)}" fill="${colour}" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`;
  return s;
}

/** Direction (deg) a helping hand should point: from outside the body toward the target. */
function handAngle(ctx, p) {
  const c = ctx.figure.centre;
  const v = sub(p, c);
  const d = Math.hypot(v[0], v[1]) < 4 ? [0, 1] : v;
  return (Math.atan2(-d[1], -d[0]) * 180) / Math.PI; // pointing inward
}

function pad(p, k = 1) {
  const c = FIXED_COLOURS.gauze;
  return `<path d="${rectPath(p, 0, 15 * k, 13 * k, 3)}" fill="${c}" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>` + darkLine(`M${f(p[0] - 5 * k)} ${f(p[1] - 4 * k)}L${f(p[0] + 5 * k)} ${f(p[1] + 4 * k)}M${f(p[0] + 5 * k)} ${f(p[1] - 4 * k)}L${f(p[0] - 5 * k)} ${f(p[1] + 4 * k)}`, 0.9, '#c9c9bd');
}

/** Centre point for a pressure/packing/tourniquet interaction on a region. */
function target(ctx, region) {
  const a = ctx.anchors[region];
  if (region === 'head' || region === 'face') return spot(ctx, region, 0).p;
  return [a.x, a.y];
}

const BYSTANDER_SKIN = { light: SKIN.medium, medium: SKIN.light, dark: SKIN.light };

export const hand_pressure = {
  kind: 'intervention',
  params: { by: ['rescuer', 'bystander', 'self'] },
  geometry(geom, { region, params, env }) {
    if (params.by !== 'self') return;
    const a = env.anchors[region];
    if (!a) return;
    const side = chooseFreeArm(geom, region, env.busy);
    if (reachArm(geom, side, holdPoint(geom, region, a, side))) (geom.holding ??= []).push({ side, region, kind: 'pressure' });
  },
  draw(ctx, { region, params }) {
    const p = target(ctx, region);
    const by = params.by ?? 'rescuer';
    if (by === 'self') {
      const hold = (ctx.geom.holding ?? []).find((h) => h.region === region && h.kind === 'pressure');
      return pad(p) + (hold ? heldHand(ctx, hold.side, ctx.style.skin) : '');
    }
    const ang = handAngle(ctx, p);
    if (by === 'rescuer') return handShape(p, ang, FIXED_COLOURS.glove, '#6b7480');
    return handShape(p, ang, BYSTANDER_SKIN[ctx.style.skinTone] ?? SKIN.light, BYSTANDER_SKIN[ctx.style.skinTone] ?? SKIN.light);
  },
};

export const wound_packing = {
  kind: 'intervention',
  params: {},
  draw(ctx, { region }) {
    const p = target(ctx, region);
    return pad(p, 1.1) + handShape(p, handAngle(ctx, p), FIXED_COLOURS.glove, '#6b7480');
  },
};

export const tourniquet = {
  kind: 'intervention',
  params: {},
  draw(ctx, { region, time }) {
    const a = ctx.anchors[region];
    const L = a.pts ? polyLength(a.pts) : a.length;
    const p = a.pts ? polyAt(a.pts, L * 0.2) : [a.x, a.y];
    const u = dir(a.angle), v = perp(u);
    const w = a.width + 8;
    let s = `<path d="${rectPath(p, a.angle + 90, w, 6.5, 2)}" fill="${FIXED_COLOURS.band}" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>`;
    s += darkLine(`M${pt(add(p, mul(v, -w / 2 + 2)))}L${pt(add(p, mul(v, w / 2 - 2)))}`, 1, '#6a6f78');
    // windlass bar lying along the limb, with a retaining clip
    const bar0 = add(add(p, mul(u, -10)), mul(v, w * 0.1)), bar1 = add(add(p, mul(u, 10)), mul(v, w * 0.1));
    s += `<path d="${capsulePath(bar0, bar1, 2.2)}" fill="#d7dce1" stroke="${OUTLINE}" stroke-width="1.5"/>`;
    s += `<path d="${rectPath(add(p, mul(v, w / 2 - 2)), a.angle + 90, 6, 8, 1.5)}" fill="#8d96a0" stroke="${OUTLINE}" stroke-width="1.3"/>`;
    const label = time ?? '10:42';
    const fs = 8, tw = textWidth(label, fs, true) + 9, th = 14;
    ctx.requestLabel({
      layer: 'interventions', anchor: p, w: tw, h: th, prefer: outward(ctx, p),
      draw(rect, an) {
        const np = nearestOnRect(rect, an);
        return `<path d="M${pt(an)}L${pt(np)}" stroke="${OUTLINE}" stroke-width="1.2"/><rect x="${f(rect[0])}" y="${f(rect[1])}" width="${f(tw)}" height="${th}" rx="3" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1.5"/>`
          + `<circle cx="${f(rect[0] + 6)}" cy="${f(rect[1] + th / 2)}" r="3" fill="none" stroke="${OUTLINE}" stroke-width="1"/><path d="M${f(rect[0] + 6)} ${f(rect[1] + th / 2 - 1.8)}V${f(rect[1] + th / 2)}h1.6" stroke="${OUTLINE}" stroke-width="0.9" fill="none"/>`
          + `<text x="${f(rect[0] + 11 + (tw - 11) / 2 - 1)}" y="${f(rect[1] + th / 2 + 2.9)}" font-size="${fs}" font-weight="700" fill="${INK}" text-anchor="middle">${esc(label)}</text>`;
      },
    });
    return s;
  },
};

export const airway_open = {
  kind: 'intervention',
  params: {},
  geometry(geom) { geom.head.back = true; },
  draw(ctx) {
    const g = ctx.geom, r = g.head.r;
    const P = (x, y) => headPoint(g, x, y);
    // curved arrow beside the head (tilt back) and a chevron under the chin (lift)
    const a0 = P(1.38, 0.75), a1 = P(1.38, -0.35);
    const arc = `M${pt(a0)}Q${pt(P(1.75, 0.2))} ${pt(a1)}`;
    const dirEnd = unit(sub(a1, P(1.62, 0.1)));
    const n = perp(dirEnd);
    const tip = add(a1, mul(dirEnd, 2.5));
    let s = darkLine(arc, 2.2, TEAL) + `<path d="M${pt(add(tip, add(mul(dirEnd, -5.5), mul(n, 3.8))))}L${pt(tip)}L${pt(add(tip, add(mul(dirEnd, -5.5), mul(n, -3.8))))}" fill="none" stroke="${TEAL}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const c0 = P(-0.35, 1.5), c1 = P(0, 1.18), c2 = P(0.35, 1.5);
    s += darkLine(`M${pt(c0)}L${pt(c1)}L${pt(c2)}`, 2.2, TEAL);
    return s;
  },
};

const CAT_FALLBACK = { red: '#c62828', orange: '#ef6c00', green: '#2e7d32', black: '#111111' };
const labelOf = { red: 'Immediate', orange: 'Urgent', green: 'Delayed / walking', black: 'Dead' };

export const triage_tag = {
  kind: 'intervention',
  layer: 'tag',
  params: { category: ['red', 'orange', 'green', 'black'] },
  draw(ctx, { region, params }) {
    const cat = params.category ?? 'green';
    const rc = ctx.rules?.categories?.find((c) => c.id === cat);
    const colour = rc?.colour ?? CAT_FALLBACK[cat] ?? '#777';
    const text = rc?.label ?? labelOf[cat] ?? cat;
    const lines = text.includes(' / ') ? text.split(' / ').map((s, i) => (i === 0 ? s + ' /' : s)) : [text];
    const fs = 8;
    const textColour = cat === 'orange' ? '#111111' : '#ffffff';
    const w = Math.max(...lines.map((l) => textWidth(l, fs, true))) + 12, h = lines.length * (fs + 2) + 9;
    const a = ctx.anchors[region];
    const wrist = a.p0;
    ctx.requestLabel({
      layer: 'tag', anchor: wrist, w, h, prefer: outward(ctx, wrist),
      draw(rect, an) {
        const [x, y] = rect;
        const np = nearestOnRect(rect, an);
        let s = `<path d="M${pt(an)}L${pt(np)}" stroke="#e9e3d0" stroke-width="2.4" stroke-linecap="round"/><path d="M${pt(an)}L${pt(np)}" stroke="${OUTLINE}" stroke-width="0.8" stroke-linecap="round"/>`;
        s += `<circle cx="${f(an[0])}" cy="${f(an[1])}" r="${f(a.width / 2 + 1.6)}" fill="none" stroke="#e9e3d0" stroke-width="2.4"/><circle cx="${f(an[0])}" cy="${f(an[1])}" r="${f(a.width / 2 + 1.6)}" fill="none" stroke="${OUTLINE}" stroke-width="0.8"/>`;
        s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="3" fill="${colour}" stroke="${OUTLINE}" stroke-width="2"/>`;
        s += `<circle cx="${f(x + w / 2)}" cy="${f(y + 3.6)}" r="1.5" fill="#f4f4ee" stroke="${OUTLINE}" stroke-width="0.8"/>`;
        lines.forEach((ln, i) => { s += `<text x="${f(x + w / 2)}" y="${f(y + 9 + fs * (i + 0.85) + i * 2)}" font-size="${fs}" font-weight="700" fill="${textColour}" text-anchor="middle">${esc(ln)}</text>`; });
        return s;
      },
    });
    return '';
  },
};

export const splint = {
  kind: 'intervention',
  params: {},
  draw(ctx, { region }) {
    const a = ctx.anchors[region];
    const u = dir(a.angle), v = perp(u);
    const p0 = add(a.p0, mul(u, 3)), p1 = sub(a.p1, mul(u, 3));
    let s = '';
    for (const sg of [-1, 1]) {
      const o = mul(v, sg * (a.width / 2 + 2.6));
      s += `<path d="${capsulePath(add(p0, o), add(p1, o), 2.3)}" fill="${FIXED_COLOURS.board}" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
    for (const t of [0.18, 0.5, 0.82]) {
      const c = lerp(p0, p1, t);
      const e0 = add(c, mul(v, -(a.width / 2 + 5))), e1 = add(c, mul(v, a.width / 2 + 5));
      s += darkLine(`M${pt(e0)}L${pt(e1)}`, 4.4, OUTLINE) + darkLine(`M${pt(e0)}L${pt(e1)}`, 2.6, '#ffffff');
    }
    return s;
  },
};

export const cervical_collar = {
  kind: 'intervention',
  params: {},
  draw(ctx) {
    const a = ctx.anchors.neck;
    const c = [a.x, a.y], u = dir(a.angle), v = perp(u);
    const L = a.length + 3, W = a.width + 8;
    let s = `<path d="${rectPath(c, a.angle, L, W, 3.5)}" fill="#ece5d2" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
    // two stitched edges along the band and a velcro tab
    s += darkLine(`M${pt(add(c, add(mul(u, -L / 2 + 2), mul(v, -W / 2 + 2))))}L${pt(add(c, add(mul(u, L / 2 - 2), mul(v, -W / 2 + 2))))}`, 1, '#8aa0b8', ' stroke-dasharray="2 1.6"');
    s += darkLine(`M${pt(add(c, add(mul(u, -L / 2 + 2), mul(v, W / 2 - 2))))}L${pt(add(c, add(mul(u, L / 2 - 2), mul(v, W / 2 - 2))))}`, 1, '#8aa0b8', ' stroke-dasharray="2 1.6"');
    return s;
  },
};

export const INTERVENTION_OVERLAYS = { tourniquet, wound_packing, hand_pressure, airway_open, triage_tag, splint, cervical_collar };
