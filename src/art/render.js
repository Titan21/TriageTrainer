// Composition: turn (casualty, view, content) into one SVG string.
//
// The picture equals: pose + look + appearance + visible findings + findings
// revealed so far + probes run so far + interventions done so far, at the current
// deterioration stage. Layer order is fixed:
//   ground -> body -> clothing -> injuries -> entrapment -> appearance
//          -> interventions -> probes/callouts -> tag

import { f, esc, hash, makeRng, rectPath, circlePath, lerp } from './util.js';
import { mergeState, sampleStates } from '../engine/rules.js';
import { getSkeleton, cloneGeometry, deriveAnchors, bodyCircles, VIEWBOX } from './skeleton.js';
import { drawFigure } from './figure.js';
import { resolveStyle, OUTLINE } from './palette.js';
import { placeLabels, FONT } from './labels.js';
import { OVERLAYS, layerOf } from './overlays/index.js';
import { footprintPath, bodyShape } from './overlays/helpers.js';

export const LAYERS = ['ground', 'body', 'clothing', 'injuries', 'entrapment', 'appearance', 'interventions', 'probes', 'tag'];
const LABEL_PRIORITY = { appearance: 0, tag: 1, interventions: 2, probes: 3 };
const SINGLE = new Set(['eyes', 'expression', 'speech', 'motion', 'mobility_aid']);
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '');

// ---- data resolution ----

const appKey = (a) => (SINGLE.has(a.overlay) ? a.overlay : `${a.overlay}|${a.region ?? ''}|${JSON.stringify(a.params ?? {})}`);

function addAppearance(list, items) {
  for (const a of items ?? []) {
    const k = appKey(a);
    const i = list.findIndex((x) => appKey(x) === k);
    if (i >= 0) list[i] = a; else list.push(a);
  }
}

/** Indexes of the deterioration stages applied for `stage` (id, index or null = none). */
export function stageChain(casualty, stage) {
  const det = casualty.deterioration ?? [];
  if (stage == null || stage === -1 || stage === 'start') return [];
  const idx = typeof stage === 'number' ? stage : det.findIndex((d) => d.id === stage);
  if (idx < 0 || idx >= det.length) return [];
  const isAction = (d) => d.afterAction != null;
  const chain = det.map((d, i) => i).filter((i) => i <= idx && !isAction(det[i]));
  if (isAction(det[idx])) chain.push(idx);
  return chain;
}

/** Pose, state, appearance and findings after the chosen stage (cumulative for time stages). */
export function resolveStage(casualty, stage) {
  let pose = casualty.pose;
  let state = casualty.state ?? {};
  const appearance = [];
  addAppearance(appearance, casualty.appearance);
  let findings = [...(casualty.findings ?? [])];
  const applied = [];
  for (const i of stageChain(casualty, stage)) {
    const d = casualty.deterioration[i];
    applied.push(d.id ?? `stage_${i}`);
    if (d.pose) pose = d.pose;
    if (d.state) state = mergeState(state, d.state);
    for (const id of d.removeAppearance ?? []) for (let k = appearance.length - 1; k >= 0; k--) if (appearance[k].overlay === id) appearance.splice(k, 1);
    addAppearance(appearance, d.appearance);
    const gone = new Set(d.removeFindings ?? []);
    findings = findings.filter((x) => !gone.has(x.id));
    for (const nf of d.addFindings ?? []) { const k = findings.findIndex((x) => x.id === nf.id); if (k >= 0) findings[k] = nf; else findings.push(nf); }
  }
  return { pose, state, appearance, findings, applied };
}

const midpoint = (state) => (JSON.stringify(state).includes('"range"') ? sampleStates(state).at(-1) : state);

function targetFindings(findings, target) {
  if (!target) return [];
  const m = /^(minor|major|catastrophic)_bleed$/.exec(target);
  return findings.filter((x) => x.lifeThreat === target || x.id === target || x.overlay === target
    || (m && x.overlay === 'bleed' && x.params?.severity === m[1]));
}

function shortLabel(x) {
  const p = x.params ?? {};
  switch (x.overlay) {
    case 'bleed': return `${cap(p.severity ?? 'minor')} bleed`;
    case 'wound': return cap(p.type ?? 'wound');
    case 'deformity': return p.open === true ? 'Open deformity' : 'Deformity';
    case 'burn': return `${cap(p.depth ?? 'burn')} burn`;
    case 'impaled_object': return `Impaled: ${String(p.object ?? 'object').replace(/_/g, ' ')}`;
    case 'entrapment': return `Trapped: ${p.material ?? 'debris'}`;
    default: return cap(x.overlay);
  }
}

const OFFSIDE_FALLBACK = {
  back: ['chest', 'abdomen', 'pelvis'], face: ['head'], chest: ['back', 'pelvis'], abdomen: ['back', 'pelvis'],
  left_groin: ['left_thigh', 'pelvis'], right_groin: ['right_thigh', 'pelvis'],
};

function probeValue(overlay, action, state, done) {
  const airway = done.has('open_airway');
  const rescue = done.has('rescue_breaths');
  if (overlay === 'breathing_animation') {
    const breathes = state.breathing === true || (airway && state.breathesAfterAirwayOpen === true) || (rescue && state.breathesAfterRescueBreaths === true);
    const rr = breathes && typeof state.rr === 'number' ? state.rr : null;
    return { breathing: breathes, rr, depth: breathes ? (state.breathingDepth && state.breathingDepth !== 'none' ? state.breathingDepth : 'normal') : 'none' };
  }
  if (overlay === 'pulse_marker') return { present: state.radialPulse?.present !== false, rate: typeof state.radialPulse?.rate === 'number' ? state.radialPulse.rate : null };
  if (overlay === 'crt_marker') return { seconds: typeof state.crtSeconds === 'number' ? state.crtSeconds : null };
  if (overlay === 'response_bubble') {
    if (action.id === 'give_command') return { text: state.obeysCommands ? 'Squeezes hand' : 'No response' };
    const t = { alert: 'Alert: answers', voice: 'Responds to voice', pain: 'Responds to pain', unresponsive: 'No response' };
    return { text: t[state.responsive] ?? 'No response' };
  }
  return {};
}

// ---- main ----

/**
 * Render one casualty.
 *
 * view: {
 *   stage       deterioration stage id/index applied (cumulative for time stages); null = approach
 *   done        action ids the player has done (probes, interventions, reveals, walking...)
 *   revealed    finding ids revealed so far, or 'all'
 *   tag         triage category id to show on the tag (null = no tag)
 *   state       concrete vitals (default: midpoint sample of the state at this stage)
 *   times       { actionId: 'HH:MM' } for time labels
 *   callouts    'revealed' (default) | 'all' | 'none' | [findingIds]
 *   animate     SMIL pulses and breathing (default true)
 *   pose        force a pose
 * }
 * content: { vocab, actions, rules }; options: { viewBox, debugAnchors, uid, background }
 * Returns { svg, warnings, anchors, pose }.
 */
export function renderCasualty(casualty, view = {}, content = {}) {
  const { vocab } = content;
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  // Accepts the actions.json document, its actions array, or a Map of id -> action.
  const actionList = content.actions instanceof Map ? [...content.actions.values()]
    : Array.isArray(content.actions) ? content.actions : content.actions?.actions ?? [];
  const actions = new Map(actionList.map((a) => [a.id, a]));
  const rules = content.rules;

  // 1. stage
  const st = resolveStage(casualty, view.stage);
  let { pose, appearance, findings } = st;
  let state = view.state ?? midpoint(st.state);
  const done = new Set(view.done ?? []);
  const hasAid = (types) => appearance.some((a) => a.overlay === 'mobility_aid' && types.includes(a.params?.type));

  // 2. actions the player has done
  let released = state.entrapped === false && findings.some((x) => x.overlay === 'entrapment');
  const revealed = new Set(view.revealed === 'all' ? findings.map((x) => x.id) : view.revealed ?? []);
  const probes = [], interventions = [];
  let tagRegion = 'right_hand';
  for (const id of done) {
    const a = actions.get(id);
    if (!a) { warn(`unknown action "${id}" in view.done`); continue; }
    const e = a.effect ?? {};
    if (e.type === 'reveal_findings') {
      for (const x of findings) if (e.all || x.revealedBy === a.id) revealed.add(x.id);
    } else if (e.type === 'reveal_state') {
      if (e.probe) probes.push({ action: a, overlay: e.probe, region: e.region, fallback: e.fallbackRegion });
      else if (e.onTrue && e.fields?.every((k) => state[k] === true)) {
        const keep = (e.onTrue.keepPoseWithAid ?? []).length && hasAid(e.onTrue.keepPoseWithAid);
        if (e.onTrue.pose && !keep) pose = e.onTrue.pose;
        addAppearance(appearance, e.onTrue.appearance);
      }
    } else if (e.type === 'intervene') {
      if (e.sets?.entrapped === false) released = true;
      if (e.overlay) interventions.push({ action: a, overlay: e.overlay, region: e.region, params: e.params ?? {}, target: e.target });
    } else if (e.type === 'set_pose') {
      pose = e.pose;
    } else if (e.type === 'tag') {
      tagRegion = e.region ?? tagRegion;
    }
  }
  if (view.pose) pose = view.pose;
  if (released) for (const x of findings) if (x.overlay !== 'entrapment' && x.visible === false && x.revealedBy === 'release_from_entrapment') revealed.add(x.id);
  const wantTag = view.tag ?? null;
  if (done.has('tag_casualty') && !wantTag) warn('tag_casualty is in view.done but view.tag is not set; no tag drawn');

  // 3. style flags
  const has = (o) => appearance.some((a) => a.overlay === o);
  const style = resolveStyle(casualty.id ?? 'x', casualty.look, { pallor: has('pallor'), wet: has('wet') });
  const ageGroup = vocab?.ageGroups?.[casualty.ageGroup] || ['adult', 'child'].includes(casualty.ageGroup) ? casualty.ageGroup : 'adult';
  if (casualty.ageGroup != null && casualty.ageGroup !== ageGroup) warn(`unknown ageGroup "${casualty.ageGroup}", drawn as adult`);
  const base = getSkeleton(pose, ageGroup);
  if (!base) {
    warn(`no skeleton for pose "${pose}"`);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><text x="120" y="120" text-anchor="middle" font-size="10">no skeleton: ${esc(pose)}</text></svg>`, warnings, anchors: {}, pose };
  }
  const hidden = new Set(vocab?.poses?.[pose]?.hiddenRegions ?? []);

  // 4. which findings are shown
  const trapFindings = findings.filter((x) => x.overlay === 'entrapment');
  const covered = new Set();
  if (!released) for (const t of trapFindings) for (const r of t.regions ?? [t.region]) covered.add(r);
  const items = []; // { kind:'finding', f, overlay, region, params, cutaway }
  const trapDraw = [];
  const calloutIds = view.callouts === 'all' ? 'all' : view.callouts === 'none' ? [] : Array.isArray(view.callouts) ? view.callouts : null;
  for (const x of findings) {
    const isShown = x.visible === true || revealed.has(x.id);
    if (!isShown) continue;
    const def = OVERLAYS[x.overlay];
    if (!def) { warn(`${x.id}: overlay "${x.overlay}" has no draw function`); continue; }
    if (x.overlay === 'entrapment') { if (!released) trapDraw.push(x); continue; }
    if (covered.has(x.region)) { warn(`${x.id}: ${x.overlay} on ${x.region} is hidden under the entrapment debris`); continue; }
    items.push({ f: x, overlay: x.overlay, region: x.region, params: x.params ?? {}, cutaway: x.visible !== true, key: x.id });
  }

  // 5. geometry modifiers (deformity, amputation, guarding, self pressure), then anchors
  const geom = cloneGeometry(base);
  const posedAnchors = () => deriveAnchors(geom);
  const geomItems = [];
  for (const it of items) if (OVERLAYS[it.overlay].geometry && !hidden.has(it.region)) geomItems.push(it);
  const busy = new Set([...covered, ...items.filter((i) => i.overlay === 'deformity' || i.overlay === 'amputation').map((i) => i.region)]);
  const env = { get anchors() { return posedAnchors(); }, busy };
  for (const it of geomItems.filter((i) => i.overlay === 'deformity' || i.overlay === 'amputation')) OVERLAYS[it.overlay].geometry(geom, { region: it.region, params: it.params, env });

  // appearance entries with a region
  const appItems = appearance.map((a, i) => ({ overlay: a.overlay, region: a.region ?? defaultRegion(a.overlay, vocab), params: a.params ?? {}, key: `app${i}` }));
  const interventionItems = [];
  for (const iv of interventions) {
    const regions = [];
    if (iv.region) regions.push(iv.region);
    else if (iv.target) { const hits = targetFindings(findings.filter((x) => x.visible === true || revealed.has(x.id)), iv.target); hits.slice(0, iv.target === 'deformity' ? 4 : 1).forEach((h) => regions.push(h.region)); if (!hits.length) warn(`${iv.action.id}: no finding matches target "${iv.target}"`); }
    else { const allowed = vocab?.overlays?.[iv.overlay]?.regions; if (Array.isArray(allowed) && allowed.length === 1) regions.push(allowed[0]); else warn(`${iv.action.id}: no region for overlay ${iv.overlay}`); }
    for (const r of regions) interventionItems.push({ overlay: iv.overlay, region: r, params: iv.params, key: `${iv.action.id}:${r}`, actionId: iv.action.id, time: view.times?.[iv.action.id] });
  }
  if (wantTag) interventionItems.push({ overlay: 'triage_tag', region: tagRegion, params: { category: wantTag }, key: 'tag', actionId: 'tag_casualty' });

  for (const it of [...appItems.filter((a) => OVERLAYS[a.overlay]?.geometry), ...interventionItems.filter((a) => OVERLAYS[a.overlay]?.geometry)]) {
    if (hidden.has(it.region) || covered.has(it.region)) continue;
    OVERLAYS[it.overlay].geometry(geom, { region: it.region, params: it.params, env });
  }
  const allAnchors = posedAnchors();
  const anchors = Object.fromEntries(Object.entries(allAnchors).filter(([r]) => !hidden.has(r)));

  // 6. figure and context
  // seated figures get a low block to sit on, unless an intact wheelchair is their seat
  const wheelchairSeat = appearance.some((a) => a.overlay === 'mobility_aid' && (a.params?.type ?? 'wheelchair') === 'wheelchair' && a.params?.condition !== 'broken');
  const figure = drawFigure(geom, style, { seat: wheelchairSeat ? null : casualty.id ?? 'x' });
  figure.centre = lerp(geom.torso.neck, geom.torso.pelvis, 0.5);
  const uid = content.uid ?? view.uid ?? `a${hash(JSON.stringify([casualty, view])).toString(36)}`;
  const layers = Object.fromEntries(LAYERS.map((l) => [l, []]));
  const defs = new Map();
  const labelReqs = [];
  const cyan = has('cyanosis');
  const ctx = {
    geom, anchors, allAnchors, hidden, covered, style, figure, vocab, rules, state, uid, warn,
    animate: view.animate !== false,
    sharedShape: typeof content.shareBase === 'function' ? `sh${hash(figure.bodyUnion).toString(36)}` : null,
    lip: cyan ? '#6c82a8' : style.lip,
    add: (layer, svg) => { if (svg) layers[layer].push(svg); },
    def: (key, build) => { const id = `${uid}-${key}`; if (!defs.has(key)) defs.set(key, build(id)); return id; },
    rng: (key) => makeRng(`${casualty.id}|${key}`),
    requestLabel: (req) => labelReqs.push({ ...req, order: labelReqs.length }),
  };
  ctx.add('ground', figure.ground ?? `<use href="#${bodyShape(ctx)}" transform="translate(3 4)" fill="#000" fill-opacity="0.12"/>`);
  ctx.add('body', figure.body);
  ctx.add('clothing', figure.clothing);

  const call = (it, kindHint) => {
    const def = OVERLAYS[it.overlay];
    const vocabDef = vocab?.overlays?.[it.overlay];
    const layer = layerOf(it.overlay, vocabDef?.kind ?? kindHint);
    let svg = '';
    try { svg = def.draw(ctx, { ...it, geometry: undefined }) ?? ''; } catch (e) { warn(`${it.key ?? it.overlay}: ${it.overlay} failed to draw (${e.message})`); return; }
    return { layer, svg };
  };
  const needAnchor = (it, label) => {
    if (anchors[it.region]) return true;
    if (hidden.has(it.region)) warn(`${label}: ${it.overlay} on ${it.region} skipped: region hidden in pose ${pose}`);
    else warn(`${label}: ${it.overlay} on ${it.region} skipped: no anchor (not drawn in this pose)`);
    return false;
  };

  // injuries
  for (const it of items) {
    if (!anchors[it.region]) { offside(it); continue; }
    const out = call(it, 'injury');
    if (!out) continue;
    ctx.add(out.layer, it.cutaway && !['deformity', 'amputation'].includes(it.overlay) ? cutawayPatch(ctx, it, out.svg) : out.svg);
  }
  // entrapment
  for (const x of trapDraw) {
    const regs = (x.regions ?? [x.region]).filter((r) => anchors[r]);
    if (regs.length < (x.regions ?? [x.region]).length) warn(`${x.id}: some entrapment regions are hidden in pose ${pose}`);
    const out = call({ overlay: 'entrapment', regions: regs, params: x.params ?? {}, key: x.id }, 'entrapment');
    if (out) ctx.add(out.layer, out.svg);
  }
  // appearance: default eyes and expression first
  const faceOk = !!anchors.face;
  const hasEyes = appItems.some((a) => a.overlay === 'eyes'), hasExpr = appItems.some((a) => a.overlay === 'expression');
  if (faceOk) {
    if (!hasEyes) ctx.add('appearance', OVERLAYS.eyes.draw(ctx, { params: {} }));
    if (!hasExpr) ctx.add('appearance', OVERLAYS.expression.draw(ctx, { params: {} }));
  }
  for (const it of appItems) {
    if (!OVERLAYS[it.overlay]) { warn(`appearance overlay "${it.overlay}" has no draw function`); continue; }
    if (it.overlay === 'speech' && !anchors[it.region] && anchors.head) warn(`speech: face hidden in pose ${pose}, bubble pinned to the head`);
    else if (!needAnchor(it, 'appearance')) continue;
    const out = call(it, 'appearance');
    if (out) ctx.add(out.layer, out.svg);
  }
  // interventions (tag is drawn in the tag layer by its own overlay)
  for (const it of interventionItems) {
    if (!needAnchor(it, it.actionId)) continue;
    if (covered.has(it.region)) { warn(`${it.actionId}: ${it.overlay} on ${it.region} skipped: hidden under entrapment debris`); continue; }
    const out = call(it, 'intervention');
    if (out) ctx.add(out.layer, out.svg);
  }
  // probes
  for (const pr of probes) {
    let region = pr.region;
    let anchor;
    if (!anchors[region] && pr.fallback && anchors[pr.fallback]) region = pr.fallback;
    if (!anchors[region] && pr.overlay === 'response_bubble' && anchors.head) { region = 'head'; anchor = [anchors.head.x, anchors.head.y]; warn(`${pr.action.id}: face hidden in pose ${pose}, response bubble pinned to the head`); }
    if (!anchors[region]) { warn(`${pr.action.id}: ${pr.overlay} skipped: ${pr.region} not drawn in pose ${pose}${pr.fallback ? ` (fallback ${pr.fallback} also unavailable)` : ''}`); continue; }
    if (covered.has(region)) { warn(`${pr.action.id}: ${pr.overlay} on ${region} skipped: hidden under entrapment debris`); continue; }
    const out = call({ overlay: pr.overlay, region, key: pr.action.id, value: probeValue(pr.overlay, pr.action, state, done), anchor }, 'probe');
    if (out) ctx.add(out.layer, out.svg);
  }
  // callouts for revealed findings
  const showCallout = (x) => {
    if (calloutIds === 'all') return true;
    if (Array.isArray(calloutIds)) return calloutIds.includes(x.id);
    return calloutIds === null && x.visible !== true && revealed.has(x.id);
  };
  for (const x of findings) {
    if (!(x.visible === true || revealed.has(x.id)) || !showCallout(x)) continue;
    const regs = x.regions ?? [x.region];
    if (x.overlay === 'entrapment' && released) continue;
    let region = regs.find((r) => anchors[r]);
    let dashed = false;
    if (!region) { region = (OFFSIDE_FALLBACK[regs[0]] ?? []).find((r) => anchors[r]); dashed = true; }
    if (!region) continue;
    if (covered.has(region) && x.overlay !== 'entrapment') continue;
    OVERLAYS.callout.draw(ctx, { region, value: { text: shortLabel(x) + (dashed ? ' (other side)' : '') }, dashed });
  }

  // place labels
  labelReqs.sort((p, q) => (LABEL_PRIORITY[p.layer] ?? 3) - (LABEL_PRIORITY[q.layer] ?? 3) || p.order - q.order);
  for (const l of placeLabels(labelReqs, bodyCircles(geom))) ctx.add(l.layer, l.svg);

  // 7. assemble. Optional content.shareBase(svg) -> id lets a page that shows many figures
  // keep each identical body + clothing once and reference it with <use> (opt-in; used by the preview).
  const vb = content.viewBox ?? VIEWBOX;
  if (typeof content.shareBase === 'function') {
    const shape = `<defs><path id="${ctx.sharedShape}" d="${figure.bodyUnion}"/></defs>`;
    const ref = content.shareBase(shape + layers.body.join('') + layers.clothing.join(''));
    layers.body = [`<use href="#${ref}"/>`];
    layers.clothing = [];
  }
  const body = LAYERS.map((l) => (layers[l].length ? `<g id="${uid}-${l}" class="layer-${l}">${layers[l].join('')}</g>` : '')).join('');
  const debug = content.debugAnchors ? debugLayer(anchors) : '';
  const bg = content.background ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${content.background}"/>` : '';
  const label = describe(casualty, pose);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" role="img" aria-label="${esc(label)}" font-family="${FONT}">`
    + `<title>${esc(label)}</title>${defs.size ? `<defs>${[...defs.values()].join('')}</defs>` : ''}${bg}${body}${debug}</svg>`;
  return { svg, warnings, anchors, pose, state };

  // ---- local helpers ----
  function offside(it) {
    const label = it.f?.id ?? it.key;
    if (hidden.has(it.region)) warn(`${label}: ${it.overlay} on ${it.region} not drawn: region hidden in pose ${pose}${it.cutaway || view.callouts ? ' (shown as an other-side callout)' : ''}`);
    else warn(`${label}: ${it.overlay} on ${it.region} not drawn: no anchor in pose ${pose} (amputated or missing)`);
  }
}

function defaultRegion(overlay, vocab) {
  const r = vocab?.overlays?.[overlay]?.regions;
  if (Array.isArray(r) && r.length === 1) return r[0];
  if (r === 'whole_body') return 'whole_body';
  if (['eyes', 'expression', 'speech', 'cyanosis', 'sweating'].includes(overlay)) return 'face';
  return 'whole_body';
}

/** Skin patch that appears where clothing has been cut away to show a hidden finding. */
function cutawayPatch(ctx, it, inner) {
  const a = ctx.anchors[it.region];
  let d;
  if (a.kind === 'circle') d = circlePath([a.x, a.y], a.r * 0.9);
  else if (a.kind === 'segment') d = rectPath([a.x, a.y], a.angle, Math.min(a.length * 0.86, 34), a.width + 4, 4);
  else d = rectPath([a.x, a.y], a.angle, Math.min(a.length * 0.8, 34), Math.min(a.width * 0.85, 30), 5);
  const clipId = ctx.def(`cut-${it.key}`, (id) => `<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  const patch = `<path d="${d}" fill="${ctx.style.skin}" stroke="${OUTLINE}" stroke-width="1.6" stroke-dasharray="3.4 2.2" stroke-linejoin="round"/>`;
  const free = ['swelling', 'impaled_object'].includes(it.overlay);
  return `<g class="cutaway">${patch}${free ? inner : `<g clip-path="url(#${clipId})">${inner}</g>`}</g>`;
}

function describe(casualty, pose) {
  const parts = [`${casualty.ageGroup ?? 'adult'} casualty ${pose}`];
  if (casualty.title) parts.push(casualty.title);
  return parts.join(': ');
}

function debugLayer(anchors) {
  const names = Object.keys(anchors).filter((r) => r !== 'whole_body');
  let s = '';
  names.forEach((r, i) => {
    const a = anchors[r];
    const hue = (i * 47) % 360;
    const col = `hsl(${hue} 80% 38%)`;
    s += `<path d="${footprintPath(a, 0)}" fill="hsl(${hue} 80% 50% / 0.12)" stroke="${col}" stroke-width="0.8"/>`;
    s += `<path d="M${f(a.x)} ${f(a.y)}l${f(Math.cos((a.angle * Math.PI) / 180) * Math.min(a.length / 2, 14))} ${f(Math.sin((a.angle * Math.PI) / 180) * Math.min(a.length / 2, 14))}" stroke="${col}" stroke-width="1.4"/>`;
    s += `<circle cx="${f(a.x)}" cy="${f(a.y)}" r="5.2" fill="#fff" stroke="${col}" stroke-width="1"/><text x="${f(a.x)}" y="${f(a.y + 2.6)}" font-size="7" font-weight="700" fill="${col}" text-anchor="middle">${i + 1}</text>`;
  });
  return `<g class="debug-anchors">${s}</g>`;
}
export const debugRegionOrder = (anchors) => Object.keys(anchors).filter((r) => r !== 'whole_body');
