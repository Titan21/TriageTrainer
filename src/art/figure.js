// Base figure: ground shadow, skin, clothing, hair and head, drawn from a
// (possibly modified) geometry and a resolved style. Returns SVG fragments for
// the ground / body / clothing layers plus the union path of the body (for clipping).

import { f, pt, add, sub, mul, unit, perp, lerp, dist, circlePath, capsulePath, chainPath, polyPath, roundedPoly, lighten, darken } from './util.js';
import { torsoOutline, torsoPoint, torsoHalfWidth, subPolyline, polyLength, polyAt, findLimb } from './skeleton.js';
import { FIXED_COLOURS, OUTLINE } from './palette.js';

const LW = 2; // outline width

/**
 * Outlined silhouette in one element: the stroke is painted first and the fill over it,
 * so only the outer half of the stroke shows and overlapping parts merge without seams.
 */
export function silhouette(d, fill, outline = OUTLINE, w = LW) {
  return `<path d="${d}" fill="${fill}" stroke="${outline}" stroke-width="${f(w * 2)}" stroke-linejoin="round" paint-order="stroke"/>`;
}
const stroke = (d, colour, w = 1.6, extra = '') => `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

/** Points actually drawn for a segment: hands and feet stop at the fingertip/toe. */
export function segDrawPts(seg) {
  if (seg.part !== 'end' || seg.pts.length < 2) return seg.pts;
  const [a, b] = seg.pts;
  const l = dist(a, b), r = seg.w / 2;
  return [a, l > r ? lerp(a, b, (l - r) / l) : a];
}
const segCapsules = (segs, extra = 0) => segs.map((s) => chainPath(segDrawPts(s), s.w / 2 + extra)).join('');

// ---- skin ----

export function bodyPaths(geom) {
  const torso = roundedPoly(torsoOutline(geom, 0, 1.12, 0), 7);
  const neck = chainPath(geom.neck.pts, geom.neck.w / 2);
  const head = circlePath(geom.head.c, geom.head.r);
  const limbs = geom.limbs.map((l) => ({ limb: l, d: segCapsules(l.segs) }));
  return { torso, neck, head, limbs, union: torso + neck + head + limbs.map((l) => l.d).join('') };
}

function sleeveParts(geom, limb, style) {
  const kind = style.topKind;
  const [up, fore] = limb.segs;
  const long = !(kind === 'tshirt' || kind === 'school_uniform');
  const frac = kind === 'tshirt' ? 0.62 : 0.55;
  const parts = [];
  const rr = (s) => s.w / 2 + 1.8;
  if (long) {
    parts.push({ pts: up.pts, r: rr(up), cuff: null });
    if (fore) parts.push({ pts: subPolyline(fore.pts, 0, fore.stump ? 1 : 0.9), r: rr(fore), cuff: fore.stump ? 'stump' : 'end' });
  } else {
    parts.push({ pts: subPolyline(up.pts, 0, up.stump ? 1 : frac), r: rr(up), cuff: up.stump ? 'stump' : 'end' });
  }
  return parts;
}

function cuffLine(pts, r, colour, atEnd = true) {
  const a = pts.at(-2), b = pts.at(-1);
  const d = unit(sub(b, a)), n = perp(d);
  const p = atEnd ? sub(b, mul(d, 2)) : a;
  return stroke(`M${pt(add(p, mul(n, r - 0.5)))}L${pt(sub(p, mul(n, r - 0.5)))}`, colour, 2.2);
}

/** Arm = skin chain + sleeve. */
function armSvg(geom, limb, style) {
  let s = silhouette(segCapsules(limb.segs), style.skin, style.outline);
  for (const p of sleeveParts(geom, limb, style)) {
    s += silhouette(chainPath(p.pts, p.r), style.topColour, style.outline);
    if (p.cuff) s += cuffLine(p.pts, p.r, style.accent);
    if (p.cuff === 'stump') s += stumpCap(p.pts, p.r, style.topColour, style.outline);
  }
  if (limb.cut) {
    // clothing-edged stump for skin-only stumps (short sleeves, hand amputation)
    const last = limb.segs.at(-1), dp = segDrawPts(last);
    s += stumpCap(dp.length > 1 ? dp : [limb.segs.at(-2)?.pts.at(-1) ?? dp[0], dp[0]], last.w / 2 + 1.8, style.topColour, style.outline);
  }
  if (style.topKind === 'hi_vis') {
    // silver band on the upper arm
    const up = limb.segs[0];
    const band = subPolyline(up.pts, 0.36, 0.5);
    if (band.length > 1) s += stroke(chainPath(band, 0), FIXED_COLOURS.silver, up.w + 3.4, ' stroke-opacity="0.95"').replace('M', 'M');
  }
  return s;
}

function stumpCap(pts, r, colour, outline) {
  const b = pts.at(-1), a = pts.at(-2), d = unit(sub(b, a));
  const end = sub(b, mul(d, 1));
  return `<path d="${capsulePath(sub(end, mul(d, 4)), end, r)}" fill="${colour}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`;
}

// ---- legs and bottoms ----

function legSkin(limb, style) { return silhouette(segCapsules(limb.segs), style.skin, style.outline); }

function legClothes(geom, limb, style) {
  const [thigh, shin, foot] = limb.segs;
  const col = style.bottomColour, kind = style.bottomKind, o = style.outline;
  let out = '';
  const rr = (s) => s.w / 2 + 1.8;
  if (kind === 'trousers' || kind === 'overalls') {
    const parts = [{ pts: thigh.pts, r: rr(thigh) }];
    if (shin) parts.push({ pts: subPolyline(shin.pts, 0, shin.stump ? 1 : 0.97), r: rr(shin) });
    for (const p of parts) out += silhouette(chainPath(p.pts, p.r), col, o);
    if (shin) out += cuffLine(parts.at(-1).pts, rr(shin), darken(col, 0.25));
    if (shin?.stump) out += stumpCap(parts.at(-1).pts, rr(shin), col, o);
  } else if (kind === 'shorts') {
    const pts = subPolyline(thigh.pts, 0, thigh.stump ? 1 : 0.6);
    out += silhouette(chainPath(pts, rr(thigh)), col, o);
    out += cuffLine(pts, rr(thigh), darken(col, 0.25));
    if (thigh.stump) out += stumpCap(pts, rr(thigh), col, o);
  } else if (kind === 'skirt' && thigh.stump) {
    out += stumpCap(thigh.pts, rr(thigh), col, o);
  }
  if (foot) {
    const fp = segDrawPts(foot);
    out += silhouette(chainPath(fp, foot.w / 2 + 1.4), style.shoe, o);
    // sole line along the outer edge of the shoe
    const a = fp[0], b = fp.at(-1), d = unit(sub(b, a)), n = perp(d);
    out += stroke(`M${pt(add(add(a, mul(n, foot.w / 2 + 0.4)), mul(d, 2)))}L${pt(add(add(b, mul(n, foot.w / 2 + 0.4)), mul(d, -1)))}`, lighten(style.shoe, 0.45), 1.4);
  } else if (limb.cut && !(shin?.stump || thigh.stump) && kind !== 'trousers' && kind !== 'overalls') {
    const last = limb.segs.at(-1);
    out += stumpCap(last.pts, last.w / 2 + 1.8, col, o);
  }
  return out;
}

function skirtSvg(geom, style) {
  const lt = findLimb(geom, 'L', 'leg').segs[0], rt = findLimb(geom, 'R', 'leg').segs[0];
  const h = torsoHalfWidth(geom, 0.6);
  const hem = (seg, sgn) => {
    const c = polyAt(seg.pts, polyLength(seg.pts) * 0.62);
    const d = unit(sub(seg.pts.at(-1), seg.pts[0])), n = perp(d);
    return [add(c, mul(n, sgn * (seg.w / 2 + 5))), add(c, mul(n, -sgn * (seg.w / 2 + 5)))];
  };
  const [l1, l2] = hem(lt, 1), [r1, r2] = hem(rt, 1);
  // choose outer/inner by distance from the axis
  const axis = torsoPoint(geom, 1);
  const lo = dist(l1, axis) > dist(l2, axis) ? l1 : l2, ro = dist(r1, axis) > dist(r2, axis) ? r1 : r2;
  const pts = [torsoPoint(geom, 0.58, h + 1), lo, ro, torsoPoint(geom, 0.58, -(h + 1))];
  return silhouette(roundedPoly(pts, 5), style.bottomColour, style.outline) + stroke(`M${pt(lo)}L${pt(ro)}`, darken(style.bottomColour, 0.25), 1.6);
}

// ---- top ----

function topDetails(geom, style, back) {
  const s = geom.P.shoulderHalf, T = (t, x) => torsoPoint(geom, t, x * s);
  const acc = style.accent;
  let out = '';
  switch (style.topKind) {
    case 'tshirt':
      out += stroke(`M${pt(T(0.0, -0.4))}Q${pt(T(back ? 0.04 : 0.12, 0))} ${pt(T(0.0, 0.4))}`, acc, 1.8);
      break;
    case 'jacket':
      if (!back) out += stroke(`M${pt(T(0.05, 0))}L${pt(T(0.86, 0))}`, acc, 1.8) + stroke(`M${pt(T(0.56, -0.5))}L${pt(T(0.7, -0.42))}M${pt(T(0.56, 0.5))}L${pt(T(0.7, 0.42))}`, acc, 1.5);
      out += silhouette(roundedPoly([T(0.0, -0.5), T(0.1, -0.2), T(0.02, 0)], 2), darken(style.topColour, 0.12), style.outline, 1);
      out += silhouette(roundedPoly([T(0.0, 0.5), T(0.1, 0.2), T(0.02, 0)], 2), darken(style.topColour, 0.12), style.outline, 1);
      break;
    case 'shirt':
    case 'school_uniform': {
      const collar = style.topKind === 'shirt' ? lighten(style.topColour, 0.55) : '#ffffff';
      out += silhouette(roundedPoly([T(0.0, -0.5), T(0.1, -0.12), T(0.0, 0.0)], 2), collar, style.outline, 1);
      out += silhouette(roundedPoly([T(0.0, 0.5), T(0.1, 0.12), T(0.0, 0.0)], 2), collar, style.outline, 1);
      if (style.topKind === 'school_uniform' && !back) out += silhouette(roundedPoly([T(0.03, -0.12), T(0.03, 0.12), T(0.46, 0.08), T(0.5, 0), T(0.46, -0.08)], 2), style.accent, style.outline, 1);
      else if (!back) for (const t of [0.2, 0.4, 0.6]) out += `<circle cx="${f(T(t, 0)[0])}" cy="${f(T(t, 0)[1])}" r="1.3" fill="${acc}"/>`;
      break;
    }
    case 'hi_vis': {
      const strip = (t0, t1) => `<path d="${polyPath(torsoOutline(geom, t0, t1, -0.2))}" fill="${FIXED_COLOURS.silver}" stroke="${style.outline}" stroke-width="1"/>`;
      out += strip(0.34, 0.42) + strip(0.56, 0.64);
      out += stroke(`M${pt(T(0.0, -0.55))}L${pt(T(0.34, -0.5))}M${pt(T(0.0, 0.55))}L${pt(T(0.34, 0.5))}`, FIXED_COLOURS.silver, 3.6);
      break;
    }
    case 'hoodie':
      if (!back) {
        out += silhouette(roundedPoly([T(0.5, -0.5), T(0.5, 0.5), T(0.74, 0.58), T(0.74, -0.58)], 3), darken(style.topColour, 0.1), style.outline, 1);
        out += stroke(`M${pt(T(0.04, -0.12))}L${pt(T(0.26, -0.12))}M${pt(T(0.04, 0.12))}L${pt(T(0.26, 0.12))}`, acc, 1.3);
      }
      out += stroke(`M${pt(T(0.8, -0.78))}L${pt(T(0.8, 0.78))}`, acc, 1.5);
      break;
    default: break;
  }
  return out;
}

function hoodBehindHead(geom, style) {
  if (style.topKind !== 'hoodie') return '';
  const c = lerp(geom.torso.neck, geom.head.c, 0.18);
  return silhouette(circlePath(c, geom.head.r * 1.12), darken(style.topColour, 0.12), style.outline);
}

function overallsBib(geom, style) {
  const s = geom.P.shoulderHalf, T = (t, x) => torsoPoint(geom, t, x * s);
  const col = style.bottomColour;
  const bib = roundedPoly([T(0.14, -0.5), T(0.14, 0.5), T(0.62, torsoHalfWidth(geom, 0.62) / s - 0.1), T(0.62, -(torsoHalfWidth(geom, 0.62) / s - 0.1))], 3);
  let out = silhouette(chainPath([T(0.14, -0.42), T(0.0, -0.55)], 1.9) + chainPath([T(0.14, 0.42), T(0.0, 0.55)], 1.9), col, style.outline, 1.4);
  out += silhouette(bib, col, style.outline);
  out += stroke(`M${pt(T(0.3, -0.18))}L${pt(T(0.3, 0.18))}L${pt(T(0.44, 0.18))}L${pt(T(0.44, -0.18))}Z`, darken(col, 0.3), 1.2);
  return out;
}

function clothingTorso(geom, style, back) {
  let out = '';
  const k = style.bottomKind;
  // waist piece (trousers / shorts / overalls) under the top
  if (k === 'skirt') out += skirtSvg(geom, style);
  else out += silhouette(roundedPoly(torsoOutline(geom, 0.58, 1.12, 0.8), 5), style.bottomColour, style.outline);
  out += silhouette(roundedPoly(torsoOutline(geom, 0, 0.86, 1.2), 6), style.topColour, style.outline);
  if (style.topKind === 'hoodie') out += stroke(`M${pt(torsoPoint(geom, 0.84, -torsoHalfWidth(geom, 0.84) - 0.5))}L${pt(torsoPoint(geom, 0.84, torsoHalfWidth(geom, 0.84) + 0.5))}`, darken(style.topColour, 0.25), 3);
  out += topDetails(geom, style, back);
  if (k === 'overalls') out += overallsBib(geom, style);
  return out;
}

// ---- head ----

/** Transform that puts the head's local frame (up = -y, face toward +y/+x) in the picture. */
export function headTransform(geom) {
  const { c, up, tilt } = geom.head;
  return `translate(${f(c[0])} ${f(c[1])}) rotate(${f(up + 90 + tilt)})`;
}

function headSvg(geom, style) {
  const { r, mode } = geom.head;
  const k = (x, y) => `${f(x * r)} ${f(y * r)}`;
  const O = style.outline, skin = style.skin, hc = style.hair, hs = style.hairStyle;
  const darkHair = darken(hc, 0.3);
  const lying = !geom.upright;
  let behind = '', front = '';
  const flat = style.hairFlat;

  // ----- hair pieces behind the head -----
  const fan = () => silhouette(roundedPoly([[-1.1, -0.1], [-1.5, -1.35], [0, -1.8], [1.5, -1.35], [1.1, -0.1]].map(([x, y]) => [x * r, y * r]), 0.7 * r), hc, O, 1.6);
  if (hs === 'long') {
    if (lying) behind += fan();
    else behind += silhouette(roundedPoly([[-1.08, -0.5], [-1.3, 1.65], [1.3, 1.65], [1.08, -0.5]].map(([x, y]) => [x * r, y * r]), 0.5 * r), hc, O, 1.6);
  }
  if (hs === 'tied') behind += silhouette(circlePath([0, -1.1 * r], 0.42 * r), hc, O, 1.6) + `<path d="M${k(-0.3, -0.82)}L${k(0.3, -0.82)}" stroke="${darkHair}" stroke-width="2.2" stroke-linecap="round"/>`;

  // ----- ears + head disc -----
  const ear = (x, y) => `<circle cx="${f(x * r)}" cy="${f(y * r)}" r="${f(0.22 * r)}" fill="${skin}" stroke="${O}" stroke-width="1.6"/>`;
  let discBehind = '';
  if (mode === 'front' || mode === 'back') discBehind += ear(-0.98, 0.08) + ear(0.98, 0.08);
  if (mode === 'profile') discBehind += `<path d="${roundedPoly([[0.9, -0.05], [1.28, 0.2], [0.94, 0.34]].map(([x, y]) => [x * r, y * r]), 0.12 * r)}" fill="${skin}" stroke="${O}" stroke-width="1.8" stroke-linejoin="round"/>`;
  const disc = silhouette(circlePath([0, 0], r), skin, O);

  // ----- hair over the head -----
  if (mode === 'front') {
    const cap = `M${k(-0.9928, -0.12)}A${f(r)} ${f(r)} 0 0 1 ${k(0.9928, -0.12)}Q${k(0.66, -0.6)} ${k(0.15, -0.48)}Q${k(-0.42, -0.6)} ${k(-0.9928, -0.12)}Z`;
    const flatCap = `M${k(-0.9928, 0.0)}A${f(r)} ${f(r)} 0 0 1 ${k(0.9928, 0.0)}Q${k(0.7, -0.38)} ${k(0, -0.34)}Q${k(-0.7, -0.38)} ${k(-0.9928, 0.0)}Z`;
    if (hs === 'bald') front += stroke(`M${k(-0.45, -0.7)}Q${k(-0.1, -0.88)} ${k(0.3, -0.84)}`, lighten(skin, 0.45), 1.8);
    else if (hs === 'curly') {
      let d = '';
      for (let i = 0; i < 9; i++) { const a = ((196 + i * 18) * Math.PI) / 180; d += circlePath([Math.cos(a) * 0.9 * r, Math.sin(a) * 0.9 * r], 0.36 * r); }
      front += silhouette(d + cap, hc, O, 1.6);
    } else front += silhouette(flat ? flatCap : cap, hc, O, 1.6);
  } else if (mode === 'back') {
    const nape = `M${k(-0.88, 0.47)}A${f(r)} ${f(r)} 0 1 1 ${k(0.88, 0.47)}Q${k(0, 0.86)} ${k(-0.88, 0.47)}Z`;
    if (hs === 'bald') front += stroke(`M${k(-0.5, -0.5)}Q${k(-0.1, -0.78)} ${k(0.35, -0.68)}`, lighten(skin, 0.45), 1.8);
    else if (hs === 'curly') {
      let d = '';
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; d += circlePath([Math.cos(a) * 0.86 * r, Math.sin(a) * 0.86 * r], 0.34 * r); }
      front += silhouette(d + circlePath([0, 0], 0.9 * r), hc, O, 1.6);
    } else front += silhouette(nape, hc, O, 1.6);
  } else {
    // profile, facing +x
    const hairline = `M${k(0.82, -0.57)}A${f(r * 1.02)} ${f(r * 1.02)} 0 0 0 ${k(-0.87, 0.5)}Q${k(-0.45, 0.42)} ${k(-0.1, -0.05)}Q${k(0.3, -0.5)} ${k(0.82, -0.57)}Z`;
    if (hs === 'bald') front += stroke(`M${k(-0.3, -0.8)}Q${k(0.1, -0.92)} ${k(0.5, -0.7)}`, lighten(skin, 0.45), 1.8);
    else if (hs === 'curly') {
      let d = '';
      for (let i = 0; i < 9; i++) { const a = ((-60 - i * 21) * Math.PI) / 180; d += circlePath([Math.cos(a) * 0.88 * r, Math.sin(a) * 0.88 * r], 0.36 * r); }
      front += silhouette(d + hairline, hc, O, 1.6);
    } else front += silhouette(hairline, hc, O, 1.6);
    front += `<circle cx="${f(-0.12 * r)}" cy="${f(0.14 * r)}" r="${f(0.2 * r)}" fill="${skin}" stroke="${O}" stroke-width="1.5"/>`;
  }
  return `<g transform="${headTransform(geom)}">${behind}${discBehind}${disc}${mode === 'front' ? noseSvg(r, skin) : ''}${front}</g>`;
}

function noseSvg(r, skin) {
  return `<path d="M0 ${f(0.02 * r)}Q${f(0.14 * r)} ${f(0.2 * r)} 0 ${f(0.24 * r)}" fill="none" stroke="${darken(skin, 0.28)}" stroke-width="1.3" stroke-linecap="round"/>`;
}

// ---- assembly ----

/**
 * Draw the base figure. Returns { ground, body, clothing, bodyUnion } SVG fragments.
 * `clothing` includes the "front" parts (arms, head) that sit above the torso.
 */
export function drawFigure(geom, style) {
  const back = geom.head.mode === 'back';
  const arm = (side) => findLimb(geom, side, 'arm');
  const leg = (side) => findLimb(geom, side, 'leg');
  const legOrder = (geom.spec.legsOrder ?? ['L', 'R']);
  const paths = bodyPaths(geom);

  // ground: contact shadow
  const [x0, y0, x1, y1] = geom.bbox;
  // upright: an ellipse; lying: render.js draws the body shape again, offset (see ground)
  let ground = null;
  if (geom.upright) {
    ground = `<ellipse cx="${f((x0 + x1) / 2)}" cy="${f(geom.groundY)}" rx="${f((x1 - x0) * 0.4)}" ry="5" fill="#000" fill-opacity="0.13"/>`;
    // seated figures also cast a shadow under the hips
    if (geom.legsFront) ground += `<ellipse cx="${f(geom.torso.pelvis[0])}" cy="${f(geom.torso.pelvis[1] + 7)}" rx="${f(geom.P.hipHalf * 2.4)}" ry="${f(geom.P.hipHalf * 0.7)}" fill="#000" fill-opacity="0.12"/>`;
  }

  // body (skin): arms behind the torso, legs, torso + neck
  const torsoSkin = silhouette(chainPath(geom.neck.pts, geom.neck.w / 2) + roundedPoly(torsoOutline(geom, 0, 1.12, 0), 7), style.skin, style.outline);
  const legsSkin = legOrder.map((s) => legSkin(leg(s), style)).join('');
  const behindArms = geom.armsBehind.map((s) => silhouette(segCapsules(arm(s).segs), style.skin, style.outline)).join('');
  const body = behindArms + (geom.legsFront ? torsoSkin + legsSkin : legsSkin + torsoSkin);

  // clothing: behind-arm sleeves, bottoms, top, then front parts
  const behindSleeves = geom.armsBehind.map((s) => sleeveParts(geom, arm(s), style).map((p) => silhouette(chainPath(p.pts, p.r), style.topColour, style.outline)).join('')).join('');
  const legsCloth = legOrder.map((s) => legClothes(geom, leg(s), style)).join('');
  const frontArms = ['L', 'R'].filter((s) => !geom.armsBehind.includes(s)).map((s) => armSvg(geom, arm(s), style)).join('');
  const clothing = behindSleeves + (geom.legsFront ? '' : legsCloth) + clothingTorso(geom, style, back) + (geom.legsFront ? legsCloth : '')
    + hoodBehindHead(geom, style) + frontArms + headSvg(geom, style);
  return { ground, body, clothing, bodyUnion: paths.union, paths };
}
