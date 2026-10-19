// Text measuring and greedy label placement. Speech bubbles, response bubbles,
// probe readouts, callouts and the triage tag all ask for a rectangle near an
// anchor point; the placer picks a spot that stays in the picture and off the
// figure and off earlier labels.

import { dir, len, sub, add, mul, clamp } from './util.js';

export const FONT = 'Arial, Helvetica, sans-serif';
export const textWidth = (s, fs, bold = false) => String(s).length * fs * (bold ? 0.6 : 0.54);

/** Greedy word wrap to at most `max` characters per line. */
export function wrapText(text, max = 16) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const BOX = [4, 4, 236, 236];

function overlapArea(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
function circleHits(rect, c) {
  const x = clamp(c.c[0], rect[0], rect[0] + rect[2]), y = clamp(c.c[1], rect[1], rect[1] + rect[3]);
  return Math.hypot(c.c[0] - x, c.c[1] - y) < c.r;
}

// does segment p->q cross the rectangle?
function segHitsRect(p, q, r) {
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  const checks = [[-d[0], p[0] - r[0]], [d[0], r[0] + r[2] - p[0]], [-d[1], p[1] - r[1]], [d[1], r[1] + r[3] - p[1]]];
  for (const [pp, qq] of checks) {
    if (pp === 0) { if (qq < 0) return false; } else {
      const t = qq / pp;
      if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

/**
 * requests: [{ anchor:[x,y], w, h, prefer?:[angleDeg...], draw(rect, anchor) => svg, layer }]
 * obstacles: [{c, r}] circles approximating the body. Returns [{layer, svg, rect}].
 * Labels avoid the figure, each other, every pin, and leader lines avoid other labels.
 */
export function placeLabels(requests, obstacles, box = BOX) {
  const placed = []; // { rect, anchor }
  const out = [];
  const pins = requests.map((r) => r.anchor);
  for (let ri = 0; ri < requests.length; ri++) {
    const req = requests[ri];
    const { anchor, w, h } = req;
    const prefer = req.prefer ?? [];
    let best = null;
    const angles = [...prefer, ...[270, 315, 225, 0, 180, 45, 135, 90, 300, 240, 330, 210, 30, 150, 60, 120, 285, 255, 345, 195, 15, 165, 75, 105].filter((a) => !prefer.includes(a))];
    angles.forEach((ang, ai) => {
      for (const d of [8, 18, 30, 44, 60, 78, 98]) {
        const u = dir(ang);
        const ext = Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2;
        const cx = anchor[0] + u[0] * (d + ext), cy = anchor[1] + u[1] * (d + ext);
        const rect = [cx - w / 2, cy - h / 2, w, h];
        let score = d + ai * (prefer.includes(ang) ? 1 : 2.5);
        const outX = Math.max(0, box[0] - rect[0]) + Math.max(0, rect[0] + w - box[2]);
        const outY = Math.max(0, box[1] - rect[1]) + Math.max(0, rect[1] + h - box[3]);
        score += (outX + outY) * 40;
        for (const p of placed) {
          const ov = overlapArea(rect, p.rect);
          if (ov > 0) score += 900 + ov;
          else if (overlapArea([rect[0] - 2, rect[1] - 2, w + 4, h + 4], p.rect) > 0) score += 30; // keep a small gap
          if (segHitsRect(anchor, nearestOnRect(rect, anchor), p.rect)) score += 45;
          if (segHitsRect(p.anchor, nearestOnRect(p.rect, p.anchor), rect)) score += 45;
        }
        for (const o of obstacles) if (circleHits(rect, o)) score += o.w ?? 7;
        for (let k = 0; k < pins.length; k++) if (k !== ri && circleHits(rect, { c: pins[k], r: 4 })) score += 60;
        if (circleHits(rect, { c: anchor, r: 5 })) score += 500; // never sit on top of its own pin
        if (!best || score < best.score) best = { score, rect };
      }
    });
    placed.push({ rect: best.rect, anchor });
    out.push({ layer: req.layer, svg: req.draw(best.rect, anchor), rect: best.rect });
  }
  return out;
}

/** Nearest point on a rectangle to p. */
export function nearestOnRect(rect, p) {
  return [clamp(p[0], rect[0], rect[0] + rect[2]), clamp(p[1], rect[1], rect[1] + rect[3])];
}

export const distPt = (a, b) => len(sub(a, b));
export { add, mul };
