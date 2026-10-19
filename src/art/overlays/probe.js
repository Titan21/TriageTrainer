// Probe overlays: results of checks the player has done. Draw functions get the
// concrete value in spec.value; readouts are placed by the shared label placer.

import { f, pt, dir, perp, add, sub, mul, unit, dist, clamp, rectPath, capsulePath, roundedPoly } from '../util.js';
import { OUTLINE, INK, FIXED_COLOURS } from '../palette.js';
import { FONT, textWidth, nearestOnRect } from '../labels.js';
import { frame, darkLine, textEl } from './helpers.js';
import { requestBubble } from './appearance.js';

const TEAL = '#2f6f8f';
const PURPLE = '#7b5ea7';

// ---- glyphs (drawn around origin, about 10 units wide) ----

const heart = (x, y, fill = PURPLE) => `<path transform="translate(${f(x)} ${f(y)})" d="M0 3.6C-6 -0.6 -3.6 -5.6 0 -2.2C3.6 -5.6 6 -0.6 0 3.6Z" fill="${fill}" stroke="${OUTLINE}" stroke-width="0.8" stroke-linejoin="round"/>`;
const heartCrossed = (x, y) => heart(x, y, '#b8bcc2') + darkLine(`M${f(x - 4.4)} ${f(y - 4.2)}L${f(x + 4.4)} ${f(y + 4.4)}M${f(x + 4.4)} ${f(y - 4.2)}L${f(x - 4.4)} ${f(y + 4.4)}`, 1.6, '#3b3f46');
const stopwatch = (x, y) => `<circle cx="${f(x)}" cy="${f(y + 0.6)}" r="3.8" fill="#fff" stroke="${OUTLINE}" stroke-width="1.1"/><path d="M${f(x - 1.2)} ${f(y - 4.4)}h2.4M${f(x)} ${f(y - 3.4)}v-1M${f(x)} ${f(y + 0.6)}v-2.2M${f(x)} ${f(y + 0.6)}l1.7 1.2" stroke="${OUTLINE}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
const lungsGlyph = (x, y) => darkLine(`M${f(x - 5)} ${f(y)}q1.7 -4 3.3 0t3.3 0t3.3 0`, 1.5, TEAL);
const crossGlyph = (x, y) => darkLine(`M${f(x - 3.5)} ${f(y - 3.5)}L${f(x + 3.5)} ${f(y + 3.5)}M${f(x + 3.5)} ${f(y - 3.5)}L${f(x - 3.5)} ${f(y + 3.5)}`, 1.8, '#3b3f46');

/** Pinned readout: pin on the region, leader line, small box with a glyph and text. */
export function requestReadout(ctx, { layer = 'probes', anchor, text, glyph, prefer, style = 'probe', dashed = false }) {
  const fs = 8;
  const gw = glyph ? 12 : 0;
  const w = textWidth(text, fs, true) + 9 + gw, h = 15;
  const border = style === 'probe' ? TEAL : OUTLINE;
  const fill = style === 'probe' ? '#f4fafc' : '#ffffff';
  ctx.requestLabel({
    layer, anchor, w, h, prefer,
    draw(rect, a) {
      const [x, y] = rect;
      const np = nearestOnRect(rect, a);
      let s = `<path d="M${pt(a)}L${pt(np)}" stroke="${border}" stroke-width="1.3" stroke-linecap="round"${dashed ? ' stroke-dasharray="2.5 2"' : ''}/>`;
      s += `<circle cx="${f(a[0])}" cy="${f(a[1])}" r="2.6" fill="#fff" stroke="${border}" stroke-width="1.5"/>`;
      s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="4" fill="${fill}" stroke="${border}" stroke-width="1.5"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
      if (glyph) s += glyph(x + 8, y + h / 2);
      s += `<text x="${f(x + gw + (w - gw) / 2)}" y="${f(y + h / 2 + 2.9)}" font-size="${fs}" font-weight="700" fill="${INK}" text-anchor="middle">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
      return s;
    },
  });
}

// ---- breathing ----

const AMP = { normal: 3, shallow: 1.4, deep: 5.5, gasping: 5, noisy: 3 };

export const breathing_animation = {
  kind: 'probe',
  params: {},
  draw(ctx, { region, value = {} }) {
    const a = ctx.anchors[region];
    const fr = frame(a);
    const { breathing = true, rr = null, depth = 'normal' } = value;
    const L = a.length * 0.9, W = a.width * 0.95;
    const c = fr.c;
    let svg = '';
    if (!breathing || depth === 'none') {
      const p0 = fr.P(0, -W / 2 - 1), p1 = fr.P(0, W / 2 + 1);
      svg += darkLine(`M${pt(p0)}L${pt(p1)}`, 2.2, TEAL, ' stroke-dasharray="4 3"') + crossGlyph(...fr.P(0, 0)).replace('stroke-width="1.8"', 'stroke-width="2.4"');
      requestReadout(ctx, { anchor: fr.c, text: 'No breathing', glyph: crossGlyph, prefer: [180, 0, 270] });
      return svg;
    }
    const amp = AMP[depth] ?? 3;
    const shape = (k, kk) => (depth === 'noisy' ? wavyRect(L + 2 * k, W + 2 * kk) : rectPath([0, 0], 0, L + 2 * k, W + 2 * kk, 7));
    const g0 = `translate(${f(c[0])} ${f(c[1])}) rotate(${f(a.angle)})`;
    // static ghost of the "inhaled" outline so amplitude is readable without animation
    svg += `<g transform="${g0}"><path d="${shape(amp, amp)}" fill="none" stroke="${TEAL}" stroke-width="1.4" stroke-dasharray="3 2.5" stroke-opacity="0.85"/>`;
    let rest = `<path d="${shape(0, 0)}" fill="none" stroke="${TEAL}" stroke-width="2"/>`;
    if (ctx.animate && rr) {
      const dur = clamp(60 / rr, 0.8, 8).toFixed(2);
      const sx = 1 + (2 * amp) / L, sy = 1 + (2 * amp) / W;
      const kt = depth === 'gasping' ? ' keyTimes="0;0.15;0.5;1" values="1 1;1 1;' + `${sx.toFixed(3)} ${sy.toFixed(3)};1 1"` : ` values="1 1;${sx.toFixed(3)} ${sy.toFixed(3)};1 1"`;
      rest = `<g>${rest}<animateTransform attributeName="transform" type="scale"${kt} dur="${dur}s" repeatCount="indefinite"/></g>`;
    }
    svg += rest + '</g>';
    const label = rr != null ? `RR ${rr}${depth !== 'normal' ? ' ' + depth : ''}` : `Breathing ${depth}`;
    requestReadout(ctx, { anchor: fr.c, text: label, glyph: lungsGlyph, prefer: [180, 0, 270, 90] });
    return svg;
  },
};

function wavyRect(L, W) {
  const pts = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rx = L / 2, ry = W / 2;
    const w = 1 + 0.06 * Math.sin(t * 7);
    pts.push([Math.cos(t) * rx * w, Math.sin(t) * ry * w]);
  }
  return `M${pts.map(pt).join('L')}Z`;
}

// ---- pulse / capillary refill ----

function fingerPair(a, ctx) {
  const u = dir(a.angle), v = perp(u), w = a.p0;
  let s = '';
  for (const sg of [-1, 1]) {
    const o = add(w, mul(v, sg * 2.7));
    s += `<path d="${capsulePath(add(o, mul(u, -8)), add(o, mul(u, -0.5)), 2.5)}" fill="${PURPLE}" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  return s;
}

export const pulse_marker = {
  kind: 'probe',
  params: {},
  draw(ctx, { region, value = {} }) {
    const a = ctx.anchors[region];
    const { present = true, rate = null } = value;
    const svg = fingerPair(a, ctx);
    const text = present ? (rate != null ? `Pulse ${rate}` : 'Pulse present') : 'No pulse';
    const out = outward(ctx, a.p0);
    requestReadout(ctx, { anchor: a.p0, text, glyph: present ? (x, y) => heart(x, y) : (x, y) => heartCrossed(x, y), prefer: out });
    return svg;
  },
};

export const crt_marker = {
  kind: 'probe',
  params: {},
  draw(ctx, { region, value = {} }) {
    const a = ctx.anchors[region];
    const tip = a.p1;
    const u = dir(a.angle);
    const s = `<circle cx="${f(tip[0] - u[0] * 3)}" cy="${f(tip[1] - u[1] * 3)}" r="3.4" fill="#fffaf0" stroke="${TEAL}" stroke-width="1.6"/><circle cx="${f(tip[0] - u[0] * 3)}" cy="${f(tip[1] - u[1] * 3)}" r="6" fill="none" stroke="${TEAL}" stroke-width="1" stroke-dasharray="1.6 2"/>`;
    const text = value.seconds != null ? `CRT ${value.seconds} s` : 'CRT';
    requestReadout(ctx, { anchor: tip, text, glyph: stopwatch, prefer: outward(ctx, tip) });
    return s;
  },
};

/** Preferred label directions for an anchor: away from the body centre. */
export function outward(ctx, p) {
  const c = ctx.figure.centre;
  const ang = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
  const snap = (Math.round(ang / 45) * 45 + 360) % 360;
  return [snap, (snap + 45) % 360, (snap + 315) % 360];
}

// ---- response bubble ----

export const response_bubble = {
  kind: 'probe',
  params: {},
  draw(ctx, { region, value = {}, anchor }) {
    const g = ctx.geom;
    let p = anchor;
    if (!p) { const a = ctx.anchors[region]; p = [a.x, a.y + (region === 'face' ? 3 : 0)]; }
    requestBubble(ctx, { layer: 'probes', anchor: p, text: String(value.text ?? 'No response'), dashed: true, fill: '#f1f6fa', italic: true, max: 17, prefer: g.upright ? [225, 315, 180, 0] : [90, 135, 45, 270] });
    return '';
  },
};

// ---- callout ----

export const callout = {
  kind: 'probe',
  params: {},
  draw(ctx, { region, value = {}, anchor, dashed = false }) {
    const a = ctx.anchors[region];
    const p = anchor ?? (a ? [a.x, a.y] : ctx.figure.centre);
    requestReadout(ctx, { anchor: p, text: String(value.text ?? ''), glyph: null, style: 'callout', prefer: outward(ctx, p), dashed });
    return '';
  },
};

export const PROBE_OVERLAYS = { breathing_animation, pulse_marker, crt_marker, response_bubble, callout };
