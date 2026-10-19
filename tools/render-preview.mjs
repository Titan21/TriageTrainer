#!/usr/bin/env node
// Writes preview/index.html: one self-contained page (inline SVG + CSS, no
// external requests) showing the pose sheet, the overlay sheet and every casualty
// in content/casualties/*.json, so a reviewer can compare text with pictures.
//
//   node tools/render-preview.mjs
//   node tools/render-preview.mjs --include tools/fixtures/test-casualties.json   extra casualty file (repeatable)
//   node tools/render-preview.mjs --only pose|overlays|casualties --out some.html  (for testing)
//   node tools/render-preview.mjs --filter bleed        only casualties whose id contains the text
//   node tools/render-preview.mjs --overlay bleed,wound only these overlays on the overlay sheet
//
// Exits non-zero (listing the gaps) if checkCoverage finds any.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderCasualty, checkCoverage, overlayProbe, overlayRegions, paramCombos, debugRegionOrder,
} from '../src/art/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flagAll = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const only = flag('--only');
const outPath = resolve(flag('--out') ?? join(root, 'preview', 'index.html'));
const idFilter = flag('--filter');
const overlayFilter = flag('--overlay')?.split(',') ?? null;
const includes = flagAll('--include').map((p) => resolve(p));

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const vocab = readJson(join(root, 'content', 'vocab.json'));
const actionsDoc = readJson(join(root, 'content', 'actions.json'));
const rules = readJson(join(root, 'content', 'triage-rules.json'));
const content = { vocab, actions: actionsDoc, rules };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- coverage ----
const t0 = Date.now();
const gaps = checkCoverage(vocab, { rules });
const coverageMs = Date.now() - t0;

// ---- casualty files ----
const notes = [];
const casualties = [];
function loadCasualtyFile(path) {
  const rel = relative(root, path).replace(/\\/g, '/');
  let doc;
  try { doc = readJson(path); } catch (e) { notes.push(`Skipped ${rel}: cannot read or parse (${e.message.split('\n')[0]})`); return; }
  if (!doc || !Array.isArray(doc.casualties)) { notes.push(`Skipped ${rel}: no "casualties" array`); return; }
  let n = 0;
  for (const c of doc.casualties) {
    if (!c || typeof c !== 'object' || !c.id || !c.pose) { notes.push(`Skipped an entry in ${rel}: missing id or pose`); continue; }
    casualties.push({ c, file: rel, theme: doc.theme ?? '' });
    n++;
  }
  notes.push(`Loaded ${n} casualties from ${rel}`);
}
const casDir = join(root, 'content', 'casualties');
if (existsSync(casDir)) for (const f of readdirSync(casDir).filter((x) => x.endsWith('.json')).sort()) loadCasualtyFile(join(casDir, f));
for (const p of includes) loadCasualtyFile(p);

// ---- helpers ----
// every inline SVG on the page needs its own id namespace (clipPaths, patterns)
let uidCounter = 0;
const svgOf = (cas, view, extra = {}) => {
  try { return renderCasualty(cas, { animate: true, ...view }, { ...content, uid: `p${++uidCounter}`, ...extra }); }
  catch (e) { return { svg: `<div class="err">Render error: ${esc(e.message)}</div>`, warnings: [`render error: ${e.message}`], anchors: {} }; }
};

const hueOf = (i) => `hsl(${(i * 47) % 360} 80% 38%)`;

// ================= A. pose sheet =================
function poseSheet() {
  let html = '<h2 id="poses">A. Pose sheet</h2><p class="lead">Every pose x age group on the shared 240 x 240 viewBox, with every region anchor drawn (footprint outline, direction tick, numbered). Hidden regions have no anchor.</p><div class="grid poses">';
  for (const age of Object.keys(vocab.ageGroups)) {
    for (const pose of Object.keys(vocab.poses)) {
      const cas = { id: 'pose_sheet', ageGroup: age, pose, look: { skinTone: 'medium', hair: 'short', top: 'shirt', bottom: 'trousers' }, appearance: [], findings: [], state: { responsive: 'alert' } };
      const r = svgOf(cas, { callouts: 'none', animate: false }, { debugAnchors: true });
      const order = debugRegionOrder(r.anchors);
      const hidden = vocab.poses[pose].hiddenRegions ?? [];
      html += `<figure class="card pose"><div class="fig big">${r.svg}</div><figcaption><b>${esc(pose)}</b> &middot; ${esc(age)}<div class="legend">`
        + order.map((reg, i) => `<span style="color:${hueOf(i)}"><b>${i + 1}</b> ${esc(reg)}</span>`).join('')
        + `</div>${hidden.length ? `<div class="hidden">hidden: ${hidden.map(esc).join(', ')}</div>` : ''}</figcaption></figure>`;
    }
  }
  return html + '</div>';
}

// ================= B. overlay sheet =================
const REPS = ['head', 'face', 'neck', 'chest', 'abdomen', 'back', 'left_upper_arm', 'right_forearm', 'left_hand', 'left_groin', 'left_thigh', 'right_lower_leg', 'left_foot'];
const TRAP_SETS = [['left_thigh', 'left_lower_leg', 'left_foot'], ['right_thigh', 'right_lower_leg'], ['chest', 'abdomen'], ['pelvis', 'left_thigh', 'right_thigh'], ['left_forearm', 'left_hand']];
const RESP = [['alert', 'check_response', {}], ['voice', 'check_response', {}], ['pain', 'check_response', {}], ['unresponsive', 'check_response', {}]];

function tilePose(region, name) {
  if (['head', 'face', 'neck'].includes(region) || name === 'speech' || region === 'whole_body') return 'standing';
  if (region === 'back') return 'prone';
  return 'supine';
}
function cropFor(name, region, kind, anchors) {
  const full = ['speech', 'response_bubble', 'triage_tag', 'entrapment'];
  if (full.includes(name) || region === 'whole_body') return null;
  const a = anchors?.[region];
  if (!a) return null;
  const size = ['face', 'head'].includes(region) ? (kind === 'probe' ? 150 : 64) : kind === 'probe' || kind === 'intervention' ? 170 : ['left_hand', 'right_hand', 'left_foot', 'right_foot'].includes(region) ? 80 : 96;
  const x = Math.max(0, Math.min(240 - size, a.x - size / 2)), y = Math.max(0, Math.min(240 - size, a.y - size / 2));
  return [x, y, size, size];
}

function tile(name, region, params, age, o = {}) {
  const def = vocab.overlays[name];
  const pose = o.pose ?? tilePose(region, name);
  const probe = overlayProbe(vocab, name, region, params, { ageGroup: age, pose });
  if (o.patch) o.patch(probe);
  if (name === 'entrapment') probe.casualty.findings[0].regions = o.regions ?? [region];
  const first = svgOf(probe.casualty, { ...probe.view, animate: false }, { actions: probe.actions });
  const crop = o.faceCrop ? [Math.max(0, first.anchors.face.x - 36), Math.max(0, first.anchors.face.y - 36), 72, 72] : o.noCrop ? null : cropFor(name, region, def.kind, first.anchors);
  const r = crop ? svgOf(probe.casualty, { ...probe.view, animate: false }, { actions: probe.actions, viewBox: crop }) : first;
  const ptxt = Object.entries(params).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 14 ? v.slice(0, 14) + '…' : v}`).join(' ');
  const warn = r.warnings.length ? `<div class="warn">${r.warnings.map(esc).join('<br>')}</div>` : '';
  return `<figure class="tile${o.wide ? ' wide' : ''}"><div class="fig">${r.svg}</div><figcaption>${esc(o.label ?? '')}${o.label ? ' ' : ''}${esc(ptxt)}<br><b>${esc(region)}</b> &middot; ${esc(age)} &middot; ${esc(pose)}</figcaption>${warn}</figure>`;
}

function overlaySheet() {
  let html = '<h2 id="overlays">B. Overlay sheet</h2><p class="lead">Every overlay in vocab.overlays on every allowed region (13 representative regions where the vocab says <code>any_body</code>) and every param value, on an adult and a child. Probe and intervention overlays are drawn through synthetic actions, as the game does.</p>';
  const kinds = ['injury', 'entrapment', 'appearance', 'probe', 'intervention'];
  for (const kind of kinds) {
    html += `<h3>${esc(kind)} overlays</h3>`;
    for (const [name, def] of Object.entries(vocab.overlays).filter(([n, d]) => d.kind === kind && (!overlayFilter || overlayFilter.includes(n)))) {
      const regs = overlayRegions(vocab, name) ?? [];
      const rep = def.regions === 'any_body' ? REPS.filter((r) => regs.includes(r)) : regs;
      html += `<details class="group" open><summary><b>${esc(name)}</b> <span class="muted">${esc(kind)} &middot; regions: ${esc(Array.isArray(def.regions) ? def.regions.length + ' listed' : def.regions)} &middot; params: ${esc(JSON.stringify(def.params))}</span></summary><p class="look">${esc(def.look)}</p><div class="tiles">`;
      for (const age of Object.keys(vocab.ageGroups)) {
        if (name === 'entrapment') {
          for (const mat of def.params.material) for (const set of TRAP_SETS) html += tile(name, set[0], { material: mat }, age, { regions: set, label: set.join('+').replace(/left_|right_/g, (m) => m[0] + '_') });
        } else if (name === 'breathing_animation') {
          const V = [['normal', { breathing: true, rr: 18, breathingDepth: 'normal' }], ['shallow', { breathing: true, rr: 28, breathingDepth: 'shallow' }], ['deep', { breathing: true, rr: 22, breathingDepth: 'deep' }], ['gasping', { breathing: true, rr: 8, breathingDepth: 'gasping' }], ['noisy', { breathing: true, rr: 30, breathingDepth: 'noisy' }], ['none', { breathing: false, rr: 0, breathingDepth: 'none' }]];
          for (const [lbl, st] of V) for (const region of ['chest', 'back']) html += tile(name, region, {}, age, { label: lbl, patch: (p) => Object.assign(p.casualty.state, st) });
        } else if (name === 'pulse_marker') {
          for (const region of regs) for (const [lbl, st] of [['present', { radialPulse: { present: true, rate: 104 } }], ['absent', { radialPulse: { present: false, rate: null } }]]) html += tile(name, region, {}, age, { label: lbl, patch: (p) => Object.assign(p.casualty.state, st) });
        } else if (name === 'crt_marker') {
          for (const region of regs) for (const s of [2, 4]) html += tile(name, region, {}, age, { label: `${s} s`, patch: (p) => { p.casualty.state.crtSeconds = s; } });
        } else if (name === 'response_bubble') {
          for (const [rsp] of RESP) html += tile(name, 'face', {}, age, { label: `check_response: ${rsp}`, patch: (p) => { p.casualty.state.responsive = rsp; p.actions[0].id = 'check_response'; } });
          for (const ob of [true, false]) html += tile(name, 'face', {}, age, { label: `give_command: obeys=${ob}`, patch: (p) => { p.casualty.state.obeysCommands = ob; p.actions[0].id = 'give_command'; } });
        } else if (name === 'pallor') {
          for (const tone of vocab.look.skinTone) {
            const fixTone = (p) => { p.casualty.look.skinTone = tone; p.casualty.appearance.push({ overlay: 'eyes', params: { state: 'closed' } }); };
            html += tile(name, 'whole_body', {}, age, { pose: 'standing', label: `skin ${tone}, no pallor`, patch: (p) => { fixTone(p); p.casualty.appearance = p.casualty.appearance.filter((a) => a.overlay !== 'pallor'); }, faceCrop: true });
            html += tile(name, 'whole_body', {}, age, { pose: 'standing', label: `skin ${tone}, pallor`, patch: fixTone, faceCrop: true });
            html += tile(name, 'whole_body', {}, age, { pose: 'supine', label: `skin ${tone}, pallor`, patch: fixTone });
          }
        } else if (name === 'mobility_aid') {
          for (const params of paramCombos(def.params)) for (const pose of age === 'adult' ? ['sitting', 'standing', 'supine'] : ['sitting']) html += tile(name, 'whole_body', params, age, { pose });
        } else if (name === 'callout') {
          for (const region of rep) html += tile(name, region, {}, age, {});
        } else {
          for (const region of rep) for (const params of paramCombos(def.params)) html += tile(name, region, params, age, {});
        }
      }
      html += '</div></details>';
    }
  }
  return html;
}

// ================= C. casualties =================
const PROBE_ACTIONS = actionsDoc.actions.filter((a) => a.effect?.probe).map((a) => a.id);

function debriefView(c) {
  const exp = c.expected ?? {};
  const done = ['expose_check_bleeding', ...PROBE_ACTIONS, ...(c.state?.canWalk === true ? ['ask_to_walk'] : []), ...(exp.lifeSavingInterventions ?? []), 'tag_casualty'];
  return { stage: null, done: [...new Set(done)], revealed: 'all', tag: exp.category ?? null, callouts: 'all' };
}

function stageLabel(d, i) {
  const when = d.afterAction ? `after ${d.afterAction} +${d.delaySeconds ?? 0}s` : `t=${d.atSeconds}s`;
  return `Stage ${i + 1}: ${d.id ?? ''} (${when})`;
}

function casualtySection() {
  const list = casualties.filter(({ c }) => !idFilter || c.id.includes(idFilter));
  let html = `<h2 id="casualties">C. Casualties</h2><p class="lead">${list.length} casualties. Approach = pose, look, appearance and visible findings only. Debrief = everything revealed, all vital-sign probes with midpoint values, expected life-saving interventions applied, tag in the expected category. Stage panels show the approach view after each deterioration stage (time stages cumulative, action stages branch).</p>`;
  html += `<ul class="notes">${notes.map((n) => `<li class="${n.startsWith('Skipped') ? 'bad' : ''}">${esc(n)}</li>`).join('')}</ul>`;
  for (const { c, file, theme } of list) {
    const panels = [];
    const warn = [];
    const add = (title, view, sub = '') => {
      const r = svgOf(c, view);
      panels.push(`<figure class="panel"><div class="fig big">${r.svg}</div><figcaption><b>${esc(title)}</b>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</figcaption></figure>`);
      for (const w of r.warnings) warn.push(`${title}: ${w}`);
    };
    add('Approach', { stage: null, callouts: 'none' }, `${c.pose}, ${c.ageGroup}`);
    add('Debrief', debriefView(c), `tag ${c.expected?.category ?? '-'}; interventions: ${(c.expected?.lifeSavingInterventions ?? []).join(', ') || 'none'}`);
    (c.deterioration ?? []).forEach((d, i) => add(stageLabel(d, i), { stage: i, callouts: 'none' }, `${d.note ?? ''}${d.expectedCategory ? ` -> ${d.expectedCategory}` : ''}`));
    html += `<section class="casualty" id="c-${esc(c.id)}"><h3>${esc(c.id)} <span class="muted">${esc(c.title ?? '')} &middot; ${esc(file)}${theme ? ' &middot; ' + esc(theme) : ''}</span></h3><div class="panels">${panels.join('')}</div>`
      + `<div class="text"><p><b>Approach:</b> ${esc(c.approach ?? '(none)')}</p>`
      + `<p class="meta">look: ${esc(JSON.stringify(c.look ?? {}))} &middot; appearance: ${esc((c.appearance ?? []).map((a) => a.overlay + (a.region ? '@' + a.region : '') + (a.params ? ':' + Object.values(a.params).join('/') : '')).join(', ') || 'none')}</p>`
      + `<p class="meta">findings: ${esc((c.findings ?? []).map((x) => `${x.id} [${x.overlay}${x.params && Object.keys(x.params).length ? ':' + Object.values(x.params).join('/') : ''}@${x.regions ? x.regions.join('+') : x.region}${x.visible ? '' : ', hidden'}]`).join('; ') || 'none')}</p>`
      + ((c.teaching ?? []).length ? `<p><b>Teaching points:</b></p><ul>${c.teaching.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '')
      + (warn.length ? `<div class="warn"><b>Renderer warnings (${warn.length})</b><ul>${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<p class="ok">No renderer warnings.</p>')
      + '</div></section>';
  }
  return html;
}

// ================= page =================
const css = `
:root{--bg:#eef1f4;--card:#fff;--ink:#1f2228;--muted:#5c6570;--line:#d3d9df;--bad:#a4262c;--warn:#8a5a00;--ok:#2b6a3a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
header{padding:16px 24px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
header h1{margin:0 0 4px;font-size:20px}nav a{margin-right:16px;color:#1a5a8a}main{padding:8px 24px 48px;max-width:1500px;margin:0 auto}
h2{margin:32px 0 4px;font-size:22px;border-bottom:2px solid var(--line);padding-bottom:4px}h3{margin:20px 0 6px}
.lead{color:var(--muted);max-width:900px}.muted{color:var(--muted);font-weight:400;font-size:12px}
.banner{padding:10px 14px;border-radius:6px;margin:12px 0}.banner.ok{background:#e4f3e8;color:var(--ok)}.banner.bad{background:#fbe6e7;color:var(--bad)}
.grid{display:grid;gap:14px}.grid.poses{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
.card,.panel,.tile{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}
.fig svg{display:block;width:100%;height:auto}.fig{background:#f6f4ee;border-radius:6px;overflow:hidden}
.fig.big{width:240px}.card .fig.big{width:100%}
figcaption{font-size:12px;margin-top:6px}.legend{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:4px}.hidden{color:var(--muted);margin-top:4px}
details.group{background:#fff;border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:6px 10px}summary{cursor:pointer;padding:4px 0}.look{color:var(--muted);font-size:12px;margin:2px 0 8px;max-width:1100px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:8px}.tile{padding:5px}.tile.wide{grid-column:span 2}
.tile figcaption{font-size:10.5px;line-height:1.3;word-break:break-word}.warn{color:var(--warn);font-size:11px;margin-top:3px;background:#fff6e0;border-radius:4px;padding:3px 6px}.warn ul{margin:4px 0 0 16px;padding:0}
.casualty{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:16px 0}.casualty h3{margin-top:0}
.panels{display:flex;flex-wrap:wrap;gap:12px}.panel{width:262px}.panel figcaption{font-size:12px}.panel .sub{color:var(--muted);font-size:11px}
.text{max-width:980px}.meta{color:var(--muted);font-size:12px;margin:2px 0}.ok{color:var(--ok);font-size:12px}ul.notes{font-size:12px;color:var(--muted)}ul.notes .bad{color:var(--bad);font-weight:600}
.err{color:var(--bad);padding:10px}code{background:#eef1f4;padding:0 4px;border-radius:3px}
@media (max-width:640px){main{padding:8px 10px}.panel{width:100%}.fig.big{width:100%}}
`;

const sections = [];
if (!only || only === 'pose') sections.push(poseSheet());
if (!only || only === 'overlays') sections.push(overlaySheet());
if (!only || only === 'casualties') sections.push(casualtySection());

const coverageBanner = gaps.length
  ? `<div class="banner bad"><b>checkCoverage found ${gaps.length} gap${gaps.length === 1 ? '' : 's'}</b><ul>${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`
  : `<div class="banner ok"><b>checkCoverage: no gaps.</b> Every pose x age group has a skeleton, every non-hidden region has an anchor in every pose, every overlay in vocab.overlays has a draw function and every region and param value draws (${coverageMs} ms).</div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NZRT triage art preview</title><style>${css}</style></head><body>
<header><h1>Triage art preview</h1><nav><a href="#poses">A. Pose sheet</a><a href="#overlays">B. Overlay sheet</a><a href="#casualties">C. Casualties (${casualties.length})</a></nav></header>
<main>${coverageBanner}${sections.join('\n')}</main></body></html>`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${relative(process.cwd(), outPath) || outPath} (${(html.length / 1024).toFixed(0)} KB); ${casualties.length} casualties; ${gaps.length} coverage gaps`);
for (const n of notes.filter((x) => x.startsWith('Skipped'))) console.log(`  ${n}`);
if (gaps.length) {
  console.error(`checkCoverage found ${gaps.length} gap(s):`);
  for (const g of gaps) console.error(`  - ${g}`);
  process.exit(1);
}
