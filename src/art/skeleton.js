// Skeletons, poses and region anchors.
//
// Every pose x ageGroup is a set of joint coordinates in ONE shared viewBox
// (0 0 240 240), so every casualty renders at the same scale. Poses are authored
// as segment angles (screen degrees, 0 = right, 90 = down) and expanded with
// forward kinematics using the age group's proportions, then placed in the box.
// Region anchors (centre, angle, length, width) are derived from the joints.
//
// "left"/"right" always mean the casualty's own sides.

import { dir, add, sub, mul, lerp, unit, perp, angleOf, dist, rotAround } from './util.js';

export const VIEWBOX = [0, 0, 240, 240];
const CX = 120, GROUND_Y = 226, LYING_CY = 126;

export const PROPORTIONS = {
  adult: {
    headR: 17, headToNeck: 26, torso: 62, shoulderHalf: 18, hipHalf: 10,
    upperArm: 33, forearm: 29, hand: 12, thigh: 48, shin: 44, foot: 16,
    w: { neck: 9, upperArm: 12, forearm: 10, hand: 9, thigh: 16, shin: 12, foot: 10 },
  },
  child: {
    headR: 16, headToNeck: 22, torso: 42, shoulderHalf: 12.5, hipHalf: 8,
    upperArm: 22, forearm: 19, hand: 9, thigh: 30, shin: 28, foot: 12,
    w: { neck: 8, upperArm: 10, forearm: 8.5, hand: 8, thigh: 13, shin: 10, foot: 9 },
  },
};

const mirror = (a) => a.map((x) => 180 - x);

// Segment angles: arms [upper, fore, hand], legs [thigh, shin, foot] per side.
export const POSES = {
  standing: {
    axis: -90, lat: [1, 0], headDir: -90, face: 'front', upright: true,
    arms: { L: [80, 84, 86], R: mirror([80, 84, 86]) },
    legs: { L: [84, 88, 35], R: mirror([84, 88, 35]) },
  },
  sitting: {
    axis: -90, lat: [1, 0], headDir: -90, face: 'front', upright: true, legsFront: true,
    legScale: [0.72, 0.64, 0.8],
    arms: { L: [62, 76, 84], R: mirror([62, 76, 84]) },
    legs: { L: [48, 62, 36], R: mirror([48, 62, 36]) },
  },
  slumped: {
    axis: -64, lat: [0.9, -0.44], headDir: -38, headScale: 0.78, face: 'front', upright: true, legsFront: true,
    legScale: [0.72, 0.64, 0.8],
    arms: { L: [40, 62, 78], R: [102, 96, 92] },
    legs: { L: [48, 62, 36], R: [128, 116, 144] },
  },
  supine: {
    axis: 180, lat: [0, -1], headDir: 180, face: 'front', upright: false,
    arms: { L: [-13, -8, -4], R: [13, 8, 4] },
    legs: { L: [-5, -3, -48], R: [5, 3, 48] },
  },
  prone: {
    axis: 180, lat: [0, 1], headDir: 180, face: 'back', upright: false,
    arms: { L: [16, 9, 4], R: [-16, -9, -4] },
    legs: { L: [5, 3, 22], R: [-5, -3, -22] },
  },
  recovery: {
    // Lying on the left side, head to the left, face turned to the top of the picture.
    axis: 180, lat: [0, -1], latK: 0.34, depthK: 0.62, headDir: 180, face: 'profile', upright: false,
    armsBehind: ['L'],
    arms: { L: [-78, -112, -120], R: [-100, 150, 145] },
    legs: { L: [4, 8, 18], R: [-52, 38, 12] },
    legsOrder: ['L', 'R'],
    backOffset: [0, 1],
  },
};

// Torso half-width profile as [t along neck->pelvis, half-width]; widths scaled per age group.
function torsoProfile(P, depthK = 1) {
  const s = P.shoulderHalf, h = P.hipHalf;
  return [[0, 0.42 * s], [0.045, s + 0.5], [0.28, s * 0.97], [0.6, h + 4.5], [0.88, h + 4], [1.0, h + 3.5], [1.12, h + 2]]
    .map(([t, w]) => [t, w * depthK]);
}
function hwAt(profile, t) {
  if (t <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i][0]) {
      const [t0, w0] = profile[i - 1], [t1, w1] = profile[i];
      return w0 + ((w1 - w0) * (t - t0)) / (t1 - t0);
    }
  }
  return profile.at(-1)[1];
}

/** Point on the torso axis at t (0 = neck, 1 = pelvis) plus lateral offset s toward the casualty's left. */
export function torsoPoint(geom, t, s = 0) {
  const T = geom.torso;
  return add(add(T.neck, mul(sub(T.pelvis, T.neck), t)), mul(T.lat, s));
}
/** Outline polygon of the torso between t0 and t1 (outset in units). */
export function torsoOutline(geom, t0 = 0, t1 = 1.12, outset = 0) {
  const prof = geom.torso.profile;
  const ts = [t0, ...prof.map((p) => p[0]).filter((t) => t > t0 + 0.01 && t < t1 - 0.01), t1];
  const left = ts.map((t) => torsoPoint(geom, t, hwAt(prof, t) + outset));
  const right = ts.map((t) => torsoPoint(geom, t, -(hwAt(prof, t) + outset))).reverse();
  return [...left, ...right];
}
export const torsoHalfWidth = (geom, t) => hwAt(geom.torso.profile, t);

const SIDE = { L: { name: 'left', sign: 1 }, R: { name: 'right', sign: -1 } };

function buildJoints(P, S) {
  const up = dir(S.axis), lat = unit(S.lat), latK = S.latK ?? 1;
  const pelvis = [0, 0];
  const neck = mul(up, P.torso);
  const head = add(neck, mul(dir(S.headDir), P.headToNeck * (S.headScale ?? 1)));
  const J = { head, neck, pelvis };
  const ls = S.legScale ?? [1, 1, 1];
  for (const [k, { sign }] of Object.entries(SIDE)) {
    const sh = add(add(neck, mul(lat, sign * P.shoulderHalf * latK)), mul(up, -4));
    const hip = add(pelvis, mul(lat, sign * P.hipHalf * latK));
    const a = S.arms[k], b = S.legs[k];
    const el = add(sh, mul(dir(a[0]), P.upperArm));
    const wr = add(el, mul(dir(a[1]), P.forearm));
    const fg = add(wr, mul(dir(a[2]), P.hand));
    const kn = add(hip, mul(dir(b[0]), P.thigh * ls[0]));
    const an = add(kn, mul(dir(b[1]), P.shin * ls[1]));
    const to = add(an, mul(dir(b[2]), P.foot * ls[2]));
    Object.assign(J, { ['sh' + k]: sh, ['el' + k]: el, ['wr' + k]: wr, ['fg' + k]: fg, ['hip' + k]: hip, ['kn' + k]: kn, ['an' + k]: an, ['to' + k]: to });
  }
  return { J, up, lat };
}

function limbSegs(P, J, k) {
  const n = SIDE[k].name;
  const w = P.w;
  return [
    { arm: { region: `${n}_upper_arm`, pts: [J['sh' + k], J['el' + k]], w: w.upperArm, part: 'upper' },
      leg: { region: `${n}_thigh`, pts: [J['hip' + k], J['kn' + k]], w: w.thigh, part: 'upper' } },
    { arm: { region: `${n}_forearm`, pts: [J['el' + k], J['wr' + k]], w: w.forearm, part: 'fore' },
      leg: { region: `${n}_lower_leg`, pts: [J['kn' + k], J['an' + k]], w: w.shin, part: 'fore' } },
    { arm: { region: `${n}_hand`, pts: [J['wr' + k], J['fg' + k]], w: w.hand, part: 'end' },
      leg: { region: `${n}_foot`, pts: [J['an' + k], J['to' + k]], w: w.foot, part: 'end' } },
  ];
}

const cache = new Map();

/** Base geometry for a pose and age group (cached; clone before modifying). */
export function getSkeleton(pose, ageGroup) {
  const key = `${pose}|${ageGroup}`;
  if (cache.has(key)) return cache.get(key);
  const P = PROPORTIONS[ageGroup], S = POSES[pose];
  if (!P || !S) { cache.set(key, null); return null; }
  const { J, up, lat } = buildJoints(P, S);
  const latUnit = lat;
  const geom = {
    pose, ageGroup, P, spec: S, joints: J, up, lat: latUnit,
    face: S.face, upright: S.upright, legsFront: !!S.legsFront, armsBehind: S.armsBehind ?? [],
    head: { c: J.head, r: P.headR, mode: S.face, tilt: 0, up: angleOf(J.neck, J.head) },
    neck: { pts: [J.neck, add(J.head, mul(unit(sub(J.neck, J.head)), P.headR * 0.8))], w: P.w.neck },
    torso: { neck: J.neck, pelvis: J.pelvis, lat: latUnit, profile: torsoProfile(P, S.depthK ?? 1) },
    limbs: ['L', 'R'].flatMap((k) => {
      const segs = limbSegs(P, J, k);
      return [
        { side: k, kind: 'arm', segs: segs.map((s) => ({ ...s.arm, pts: [...s.arm.pts] })) },
        { side: k, kind: 'leg', segs: segs.map((s) => ({ ...s.leg, pts: [...s.leg.pts] })) },
      ];
    }),
  };
  placeGeometry(geom);
  cache.set(key, geom);
  return geom;
}

function allPoints(geom) {
  const pts = [];
  const r = geom.head.r;
  pts.push([geom.head.c[0] - r, geom.head.c[1] - r], [geom.head.c[0] + r, geom.head.c[1] + r]);
  for (const p of torsoOutline(geom, 0, 1.12, 0)) pts.push(p);
  for (const limb of geom.limbs) for (const s of limb.segs) for (const p of s.pts) {
    pts.push([p[0] - s.w / 2, p[1] - s.w / 2], [p[0] + s.w / 2, p[1] + s.w / 2]);
  }
  return pts;
}

/** Translate the figure into the shared viewBox: centred, standing figures on the ground line. */
function placeGeometry(geom) {
  const pts = allPoints(geom);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const dx = CX - (x0 + x1) / 2;
  const dy = geom.upright ? GROUND_Y - y1 : LYING_CY - (y0 + y1) / 2;
  const mv = (p) => { p[0] += dx; p[1] += dy; };
  const seen = new Set();
  const move = (p) => { if (!seen.has(p)) { seen.add(p); mv(p); } };
  Object.values(geom.joints).forEach(move);
  // limb/neck points alias joints in places; move any not already moved
  [geom.head.c, geom.neck.pts[0], geom.neck.pts[1], geom.torso.neck, geom.torso.pelvis].forEach(move);
  for (const limb of geom.limbs) for (const s of limb.segs) s.pts.forEach(move);
  geom.bbox = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
  geom.groundY = geom.upright ? GROUND_Y : null;
}

export function cloneGeometry(g) {
  // structuredClone keeps shared point identity inside one clone, which is fine; we only read.
  return structuredClone(g);
}

// ---- helpers over limb chains ----

export const findLimb = (geom, side, kind) => geom.limbs.find((l) => l.side === side && l.kind === kind);
export function regionSeg(geom, region) {
  for (const limb of geom.limbs) {
    const i = limb.segs.findIndex((s) => s.region === region);
    if (i >= 0) return { limb, seg: limb.segs[i], index: i };
  }
  return null;
}
export const polyLength = (pts) => pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);

/** Point at distance d along a polyline. */
export function polyAt(pts, d) {
  let rem = d;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (rem <= l || i === pts.length - 2) return lerp(pts[i], pts[i + 1], l ? Math.min(1, rem / l) : 0);
    rem -= l;
  }
  return pts[0];
}
/** Sub-polyline between fractions t0 and t1 of its length. */
export function subPolyline(pts, t0, t1) {
  const L = polyLength(pts);
  const a = t0 * L, b = t1 * L;
  const out = [polyAt(pts, a)];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    acc += dist(pts[i], pts[i + 1]);
    if (acc > a + 0.01 && acc < b - 0.01) out.push(pts[i + 1]);
  }
  out.push(polyAt(pts, b));
  return out;
}

// ---- geometry modifiers used by overlays ----

/** Deformity: kink a limb segment 25 degrees at its midpoint; everything beyond it pivots. */
export function kinkSegment(geom, region, angle = 25) {
  const hit = regionSeg(geom, region);
  if (!hit) return false;
  const { limb, seg, index } = hit;
  if (seg.pts.length !== 2) return false;
  const [a, b] = seg.pts;
  const m = lerp(a, b, 0.5);
  // bend away from the body axis line
  const axisMid = lerp(geom.torso.neck, geom.torso.pelvis, 0.5);
  const out = (s) => { const nb = rotAround(b, m, s * angle); return dist(nb, axisMid); };
  const sign = out(1) >= out(-1) ? 1 : -1;
  const pivot = (p) => rotAround(p, m, sign * angle);
  seg.pts = [a, m, pivot(b)];
  seg.kink = m;
  // later segments in the chain: replace their points (by value) with rotated copies
  const moved = new Map();
  const mv = (p) => { if (!moved.has(p)) moved.set(p, pivot(p)); return moved.get(p); };
  const end = seg.pts.at(-1);
  limb.segs.slice(index + 1).forEach((s) => { s.pts = s.pts.map((p) => (p === b || (p[0] === b[0] && p[1] === b[1]) ? end : mv(p))); });
  return true;
}

/** Amputation: stop the segment partway (stump) and drop everything beyond it. */
export function amputate(geom, region) {
  const hit = regionSeg(geom, region);
  if (!hit) return false;
  const { limb, seg, index } = hit;
  const cutAt = seg.part === 'end' ? 0.12 : 0.62;
  seg.pts = subPolyline(seg.pts, 0, cutAt);
  seg.stump = true;
  limb.segs = limb.segs.slice(0, index + 1);
  limb.cut = true;
  return true;
}

/** Move a free arm so its hand reaches `target` (two-bone IK; elbow bends away from the body). */
export function reachArm(geom, side, target) {
  const limb = findLimb(geom, side, 'arm');
  if (!limb || limb.segs.length < 3) return false;
  const [up, fore, hand] = limb.segs;
  const P = geom.P;
  const s = up.pts[0];
  const L1 = P.upperArm, L2 = P.forearm;
  const toT = sub(target, s);
  const want = sub(target, mul(unit(toT), P.hand * 0.45));
  let D = dist(s, want);
  const Dc = Math.max(Math.abs(L1 - L2) + 1, Math.min(L1 + L2 - 1, D));
  const u = unit(sub(want, s));
  const a = (L1 * L1 - L2 * L2 + Dc * Dc) / (2 * Dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const base = add(s, mul(u, a));
  const n = perp(u);
  const c1 = add(base, mul(n, h)), c2 = add(base, mul(n, -h));
  const axisMid = lerp(geom.torso.neck, geom.torso.pelvis, 0.5);
  const el = dist(c1, axisMid) >= dist(c2, axisMid) ? c1 : c2;
  const wr = add(s, mul(u, Dc));
  const fg = add(wr, mul(unit(sub(wr, el)), P.hand));
  up.pts = [s, el];
  fore.pts = [el, wr];
  hand.pts = [wr, fg];
  limb.reaching = true;
  return true;
}

// ---- anchors ----

const TORSO_REGIONS = { chest: [0.05, 0.4], abdomen: [0.4, 0.72], pelvis: [0.72, 1.08], back: [0.05, 0.72] };

function segAnchor(region, pts, w) {
  const L = polyLength(pts);
  const c = polyAt(pts, L / 2);
  const p0 = pts[0], p1 = pts.at(-1);
  const angle = angleOf(p0, p1);
  return { region, x: c[0], y: c[1], angle, length: L, width: w, p0, p1, pts, kind: 'segment', kink: pts.length === 3 ? pts[1] : null };
}

/**
 * Anchors for every region the skeleton can place (hidden-region filtering is
 * the caller's job, see getAnchors). Each anchor: { region, x, y, angle, length,
 * width, p0, p1, kind } with angle in screen degrees along proximal -> distal.
 */
export function deriveAnchors(geom) {
  const A = {};
  const { head, P } = geom;
  const r = head.r;
  const headUp = head.up;
  A.head = { region: 'head', x: head.c[0], y: head.c[1], angle: headUp, length: 2 * r, width: 2 * r, p0: sub(head.c, mul(dir(headUp), r)), p1: add(head.c, mul(dir(headUp), r)), kind: 'circle', r };
  // face: front = centre of the disc; profile faces the top of the picture (screen -y)
  const faceN = head.mode === 'profile' ? [0, -1] : [0, 0];
  const fc = add(head.c, mul(faceN, r * 0.42));
  A.face = { region: 'face', x: fc[0], y: fc[1], angle: headUp, length: 1.5 * r, width: head.mode === 'profile' ? 0.9 * r : 1.5 * r, p0: fc, p1: fc, kind: 'circle', r: 0.75 * r };
  A.neck = segAnchor('neck', geom.neck.pts, geom.neck.w);
  A.neck.length = dist(geom.neck.pts[0], geom.neck.pts[1]);
  for (const [name, [t0, t1]] of Object.entries(TORSO_REGIONS)) {
    const p0 = torsoPoint(geom, t0), p1 = torsoPoint(geom, t1), tm = (t0 + t1) / 2;
    let c = torsoPoint(geom, tm);
    let width = 2 * hwAt(geom.torso.profile, tm);
    if (name === 'back' && geom.spec.backOffset) {
      const off = mul(geom.spec.backOffset, width * 0.28);
      c = add(c, off); width *= 0.45;
    }
    const a = angleOf(geom.torso.neck, geom.torso.pelvis);
    A[name] = { region: name, x: c[0], y: c[1], angle: a, length: dist(p0, p1), width, p0, p1, kind: 'torso' };
  }
  for (const limb of geom.limbs) for (const seg of limb.segs) A[seg.region] = segAnchor(seg.region, seg.pts, seg.w);
  for (const [k, { name }] of Object.entries(SIDE)) {
    const thigh = findLimb(geom, k, 'leg').segs[0];
    const hip = thigh.pts[0], knee = thigh.pts.at(-1);
    const medial = unit(sub(geom.torso.pelvis, hip));
    const c = add(add(hip, mul(medial, 3)), mul(unit(sub(knee, hip)), 6));
    A[`${name}_groin`] = { region: `${name}_groin`, x: c[0], y: c[1], angle: angleOf(hip, knee), length: 14, width: 12, p0: hip, p1: lerp(hip, knee, 0.3), kind: 'segment' };
  }
  const [x0, y0, x1, y1] = geom.bbox;
  A.whole_body = { region: 'whole_body', x: (x0 + x1) / 2, y: (y0 + y1) / 2, angle: 0, length: x1 - x0, width: y1 - y0, p0: [x0, y0], p1: [x1, y1], kind: 'box' };
  return A;
}

/** Anchors visible in a pose: every anchor except hidden regions (vocab.poses[pose].hiddenRegions). */
export function getAnchors(pose, ageGroup, vocab, geom = null) {
  const g = geom ?? getSkeleton(pose, ageGroup);
  if (!g) return null;
  const hidden = new Set(vocab?.poses?.[pose]?.hiddenRegions ?? []);
  const all = deriveAnchors(g);
  return Object.fromEntries(Object.entries(all).filter(([r]) => !hidden.has(r)));
}

/** Circles approximating the body, used to keep labels off the figure. */
export function bodyCircles(geom) {
  const out = [{ c: geom.head.c, r: geom.head.r + 1, w: 140 }];
  for (let t = 0; t <= 1.1; t += 0.12) out.push({ c: torsoPoint(geom, t), r: hwAt(geom.torso.profile, t) + 1 });
  out.push({ c: lerp(geom.neck.pts[0], geom.neck.pts[1], 0.5), r: geom.neck.w / 2 + 1 });
  for (const limb of geom.limbs) for (const s of limb.segs) {
    const L = polyLength(s.pts);
    for (let d = 0; d <= L; d += 7) out.push({ c: polyAt(s.pts, d), r: s.w / 2 + 1 });
  }
  return out;
}
