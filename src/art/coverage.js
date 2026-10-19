// checkCoverage(vocab): prove the art matches the data model. Returns a list of
// gap strings (empty = every pose x age group has a skeleton, every non-hidden
// region has an anchor, every overlay has a draw function, every param value and
// region of every overlay actually draws).

import { getSkeleton, getAnchors, VIEWBOX, POSES } from './skeleton.js';
import { OVERLAYS, KIND_LAYER } from './overlays/index.js';
import { LOOK_SUPPORT, TOP_PALETTE, BOTTOM_PALETTE, SHOE_PALETTE, FIXED_COLOURS, looksLikeTagColour, colourDistance } from './palette.js';
import { renderCasualty } from './render.js';

const POSE_PREFERENCE = ['supine', 'sitting', 'standing', 'prone', 'recovery', 'slumped'];
const MAX_COMBOS = 40;

/** Region ids an overlay may use, resolving regionGroups. */
export function overlayRegions(vocab, name) {
  const r = vocab.overlays[name]?.regions;
  if (Array.isArray(r)) return r;
  return vocab.regionGroups?.[r] ?? null;
}

/** Every combination of an overlay's enumerated params (capped by cycling). */
export function paramCombos(params = {}) {
  const keys = Object.keys(params);
  const lists = keys.map((k) => (Array.isArray(params[k]) ? params[k] : params[k] === 'string' ? ['Help me'] : [null]));
  let combos = [{}];
  for (let i = 0; i < keys.length; i++) combos = combos.flatMap((c) => lists[i].map((v) => ({ ...c, [keys[i]]: v })));
  if (combos.length > MAX_COMBOS) combos = combos.filter((_, i) => i % Math.ceil(combos.length / MAX_COMBOS) === 0);
  return combos;
}

/** First pose in which `region` is visible. */
export function poseShowing(vocab, region) {
  const poses = Object.keys(vocab.poses);
  const order = [...POSE_PREFERENCE.filter((p) => poses.includes(p)), ...poses.filter((p) => !POSE_PREFERENCE.includes(p))];
  if (region === 'whole_body') return order[0];
  return order.find((p) => !(vocab.poses[p].hiddenRegions ?? []).includes(region)) ?? null;
}

/**
 * Build a one-overlay test casualty and the view/content needed to draw it.
 * Used by checkCoverage and by the preview's overlay sheet.
 */
export function overlayProbe(vocab, name, region, params, { ageGroup = 'adult', pose } = {}) {
  const def = vocab.overlays[name];
  const kind = def.kind;
  const p = pose ?? poseShowing(vocab, region);
  const cas = { id: `probe_${name}`, ageGroup, pose: p, look: { skinTone: 'medium', hair: 'short', top: 'tshirt', bottom: 'trousers' }, appearance: [], findings: [], state: { responsive: 'alert', breathing: true, rr: 20, breathingDepth: 'normal', radialPulse: { present: true, rate: 100 }, crtSeconds: 2, obeysCommands: true } };
  const view = { done: [], callouts: 'none', animate: false };
  const actions = [];
  if (kind === 'injury') cas.findings.push({ id: 'f1', overlay: name, region, params, visible: true });
  else if (kind === 'entrapment') cas.findings.push({ id: 'f1', overlay: name, regions: [region], params, visible: true });
  else if (kind === 'appearance') cas.appearance.push({ overlay: name, params, ...(region !== 'whole_body' && name === 'guarding' ? { region } : {}) });
  else if (kind === 'probe' && name === 'callout') { cas.findings.push({ id: 'f1', overlay: 'wound', region, params: { type: 'laceration' }, visible: true }); view.callouts = 'all'; }
  else if (kind === 'probe') { actions.push({ id: 'a1', effect: { type: 'reveal_state', fields: [], probe: name, region } }); view.done.push('a1'); }
  else { actions.push({ id: 'a1', effect: { type: 'intervene', overlay: name, region, params } }); view.done.push('a1'); }
  return { casualty: cas, view, actions };
}

export function checkCoverage(vocab, opts = {}) {
  const gaps = [];
  const gap = (m) => gaps.push(m);
  const regions = new Set([...vocab.regions, 'whole_body']);

  // ---- skeletons and anchors ----
  for (const pose of Object.keys(vocab.poses)) {
    const hiddenList = vocab.poses[pose].hiddenRegions ?? [];
    for (const h of hiddenList) if (!regions.has(h)) gap(`pose "${pose}": hiddenRegions lists unknown region "${h}"`);
    for (const age of Object.keys(vocab.ageGroups)) {
      const g = getSkeleton(pose, age);
      if (!g) { gap(`no skeleton for pose "${pose}" x ageGroup "${age}"`); continue; }
      const anchors = getAnchors(pose, age, vocab);
      for (const r of vocab.regions) {
        if (hiddenList.includes(r)) { if (anchors[r]) gap(`pose "${pose}" x ${age}: hidden region "${r}" still has an anchor`); continue; }
        const a = anchors[r];
        if (!a) { gap(`pose "${pose}" x ${age}: region "${r}" has no anchor`); continue; }
        const ok = [a.x, a.y, a.angle, a.length, a.width].every(Number.isFinite) && a.length > 0 && a.width > 0;
        if (!ok) gap(`pose "${pose}" x ${age}: region "${r}" has a bad anchor`);
        else if (a.x < VIEWBOX[0] || a.y < VIEWBOX[1] || a.x > VIEWBOX[2] || a.y > VIEWBOX[3]) gap(`pose "${pose}" x ${age}: region "${r}" anchor lies outside the viewBox`);
      }
      const [x0, y0, x1, y1] = g.bbox;
      if (x0 < 0 || y0 < 0 || x1 > 240 || y1 > 240) gap(`pose "${pose}" x ${age}: figure leaves the viewBox (${[x0, y0, x1, y1].map(Math.round)})`);
    }
  }
  for (const age of Object.keys(vocab.ageGroups)) if (!['adult', 'child'].includes(age)) gap(`ageGroup "${age}" has no proportions`);

  // ---- look options ----
  for (const [key, supported] of Object.entries(LOOK_SUPPORT)) {
    for (const v of vocab.look?.[key] ?? []) if (!supported.includes(v)) gap(`look.${key} value "${v}" is not drawn`);
  }

  // ---- palette ----
  const tagCols = (opts.rules?.categories ?? []).map((c) => c.colour);
  for (const c of [...TOP_PALETTE, ...BOTTOM_PALETTE, ...SHOE_PALETTE, FIXED_COLOURS.hiVis, FIXED_COLOURS.school]) {
    const fam = looksLikeTagColour(c);
    if (fam) gap(`clothing colour ${c} looks like the ${fam} tag colour`);
    for (const t of tagCols) if (colourDistance(c, t) < 70) gap(`clothing colour ${c} is too close to tag colour ${t}`);
  }

  // ---- overlays ----
  for (const [name, o] of Object.entries(vocab.overlays)) {
    const def = OVERLAYS[name];
    if (!def || typeof def.draw !== 'function') { gap(`overlay "${name}" has no draw function`); continue; }
    if (!KIND_LAYER[o.kind]) gap(`overlay "${name}" has unknown kind "${o.kind}"`);
    const handled = def.params ?? {};
    for (const [pk, pv] of Object.entries(o.params ?? {})) {
      if (!(pk in handled)) { gap(`overlay "${name}": param "${pk}" is not handled`); continue; }
      if (Array.isArray(pv)) for (const v of pv) if (!Array.isArray(handled[pk]) || !handled[pk].map(String).includes(String(v))) gap(`overlay "${name}": param ${pk}="${v}" is not handled`);
    }
    for (const pk of Object.keys(handled)) if (!(pk in (o.params ?? {}))) gap(`overlay "${name}": renderer handles param "${pk}" that vocab does not list`);
    const regs = overlayRegions(vocab, name);
    if (!regs) { gap(`overlay "${name}": regions "${o.regions}" does not resolve`); continue; }
    if (o.multiRegion && !def.multiRegion) gap(`overlay "${name}": multiRegion not supported by renderer`);

    // dry run: every allowed region x param combination, adult and child
    const combos = paramCombos(o.params);
    for (const region of regs) {
      const pose = poseShowing(vocab, region);
      if (!pose) { gap(`overlay "${name}": region "${region}" is hidden in every pose`); continue; }
      for (const age of Object.keys(vocab.ageGroups)) {
        let empty = null;
        const seen = new Map();
        let differsFromBase = false;
        for (const params of combos) {
          const base = overlayProbe(vocab, name, region, params, { ageGroup: age, pose });
          const tag = `overlay "${name}" on ${region} (${age}, ${JSON.stringify(params)})`;
          let out;
          try {
            out = renderCasualty(base.casualty, base.view, { vocab, actions: base.actions, rules: opts.rules });
          } catch (e) { gap(`${tag} threw: ${e.message}`); continue; }
          const bad = out.warnings.filter((w) => /failed to draw|no draw function|skipped|not drawn/.test(w));
          if (bad.length) { gap(`${tag}: ${bad[0]}`); continue; }
          empty ??= renderCasualty({ ...base.casualty, findings: [], appearance: [] }, { ...base.view, done: [] }, { vocab, actions: [], rules: opts.rules }).svg;
          if (out.svg !== empty) differsFromBase = true;
          const dup = seen.get(out.svg);
          if (dup !== undefined) gap(`${tag} renders identically to ${JSON.stringify(dup)}: param value not handled`);
          else seen.set(out.svg, params);
        }
        if (!differsFromBase && combos.length) gap(`overlay "${name}" on ${region} (${age}) draws nothing`);
      }
    }
  }
  // poses implemented but missing from vocab are fine; poses in vocab without code are reported above
  for (const p of Object.keys(POSES)) if (!vocab.poses[p]) gap(`info: renderer has pose "${p}" that vocab does not list`);
  return gaps;
}
