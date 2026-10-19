#!/usr/bin/env node
// Content validator. Checks every casualty and scene against vocab.json,
// actions.json and triage-rules.json, and runs the rules engine to confirm each
// expected category at the start and after every deterioration stage.
//
//   node tools/validate.mjs                       validate everything
//   node tools/validate.mjs content/casualties/x.json   report only that file
//   node tools/validate.mjs --summary             also print a category table

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triage, sampleStates, mergeState, isRange, findingContext, evalCond, condFields, requiredChecks } from '../src/engine/rules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(root, 'content');
const args = process.argv.slice(2);
const showSummary = args.includes('--summary');
const onlyFiles = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a));

const problems = [];
let currentFile = '';
const err = (where, msg) => problems.push({ level: 'ERROR', file: currentFile, where, msg });
const warn = (where, msg) => problems.push({ level: 'WARN', file: currentFile, where, msg });

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    currentFile = path;
    err('', `Cannot parse JSON: ${e.message}`);
    return null;
  }
}

const vocab = readJson(join(contentDir, 'vocab.json'));
const actionsDoc = readJson(join(contentDir, 'actions.json'));
const rules = readJson(join(contentDir, 'triage-rules.json'));
if (!vocab || !actionsDoc || !rules) {
  for (const p of problems) console.log(`${p.level} ${relative(root, p.file)}: ${p.msg}`);
  process.exit(1);
}

const actions = new Map(actionsDoc.actions.map((a) => [a.id, a]));
const categories = new Set(rules.categories.map((c) => c.id));
const regions = new Set(vocab.regions);

const STATE_SPEC = {
  canWalk: 'bool', canTalk: 'bool', responsive: ['alert', 'voice', 'pain', 'unresponsive'],
  painResponseAppropriate: 'boolOrNull', obeysCommands: 'bool', breathing: 'bool',
  breathesAfterAirwayOpen: 'boolOrNull', breathesAfterRescueBreaths: 'boolOrNull',
  rr: 'numOrRange', breathingDepth: ['normal', 'shallow', 'deep', 'gasping', 'noisy', 'none'],
  radialPulse: 'pulse', crtSeconds: 'numOrRange', catastrophicBleed: 'bool', entrapped: 'bool',
};
const OPTIONAL_STATE = new Set(['painResponseAppropriate', 'breathesAfterAirwayOpen', 'breathesAfterRescueBreaths']);
const CONTEXT_FIELDS = new Set([...Object.keys(STATE_SPEC), 'radialPulse.present', 'radialPulse.rate', 'ageGroup', 'phase',
  'hazardActive', 'bystanderPresent', 'catastrophicBleedSite', 'majorBleed', 'listedForCasualty', 'airwayOpened', 'rescueBreathsGiven', 'glucoseGiven', 'inhalerUsed']);
const EFFECT_TYPES = new Set(['scene', 'reveal_state', 'reveal_findings', 'ask', 'intervene', 'set_pose', 'tag', 'waste']);
const GORE = ['gore', 'guts', 'intestine', 'brain matter', 'eviscerat', 'decapitat', 'exposed bone', 'bone protruding', 'bone sticking', 'severed'];

const isBool = (v) => typeof v === 'boolean';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const lo = (v) => (isRange(v) ? v.range[0] : v);

function regionList(spec) {
  if (Array.isArray(spec)) return spec;
  return vocab.regionGroups[spec] ?? [];
}

// ---------- catalogue self-checks ----------

currentFile = join(contentDir, 'vocab.json');
for (const [id, ov] of Object.entries(vocab.overlays)) {
  for (const r of regionList(ov.regions)) {
    if (!regions.has(r) && r !== 'whole_body') err(`overlays.${id}`, `unknown region "${r}"`);
  }
  if (!Array.isArray(ov.regions) && !vocab.regionGroups[ov.regions]) err(`overlays.${id}`, `unknown region group "${ov.regions}"`);
}
for (const [id, hz] of Object.entries(vocab.hazards)) {
  if (!actions.has(hz.defaultResponse)) err(`hazards.${id}`, `defaultResponse "${hz.defaultResponse}" is not an action`);
}
for (const [id, pose] of Object.entries(vocab.poses)) {
  for (const r of pose.hiddenRegions) if (!regions.has(r)) err(`poses.${id}`, `unknown hidden region "${r}"`);
}

currentFile = join(contentDir, 'actions.json');
{
  const seen = new Set();
  for (const a of actionsDoc.actions) {
    const w = `actions.${a.id}`;
    if (seen.has(a.id)) err(w, 'duplicate action id');
    seen.add(a.id);
    if (!actionsDoc.groups[a.group]) err(w, `unknown group "${a.group}"`);
    if (!isNum(a.timeCostSeconds)) err(w, 'timeCostSeconds must be a number');
    if (!EFFECT_TYPES.has(a.effect?.type)) err(w, `unknown effect type "${a.effect?.type}"`);
    for (const key of ['overlay', 'probe']) {
      const ov = a.effect?.[key];
      if (ov && !vocab.overlays[ov]) err(w, `effect.${key} "${ov}" is not in vocab.overlays`);
    }
    for (const key of ['region', 'fallbackRegion']) {
      const r = a.effect?.[key];
      if (r && !regions.has(r)) err(w, `effect.${key} "${r}" unknown`);
      const ov = vocab.overlays[a.effect?.probe ?? a.effect?.overlay];
      if (r && ov && !regionList(ov.regions).includes(r)) err(w, `effect.${key} "${r}" is not allowed for overlay "${a.effect.probe ?? a.effect.overlay}"`);
    }
    if (a.effect?.pose && !vocab.poses[a.effect.pose]) err(w, `effect.pose "${a.effect.pose}" unknown`);
    for (const f of condFields(a.correctWhen)) {
      if (!CONTEXT_FIELDS.has(f) && !f.startsWith('done.')) err(w, `correctWhen reads unknown field "${f}"`);
    }
    if (a.correctWhen !== true && !a.feedbackWrong) warn(w, 'no feedbackWrong text for when it is used wrongly');
  }
}

currentFile = join(contentDir, 'triage-rules.json');
for (const [age, sieve] of Object.entries(rules.sieves)) {
  if (!vocab.ageGroups[age]) err(`sieves.${age}`, 'age group not in vocab');
  if (sieve.steps.at(-1)?.when !== true) err(`sieves.${age}`, 'last step must be a catch-all (when: true)');
  for (const step of sieve.steps) {
    const w = `sieves.${age}.${step.id}`;
    if (!categories.has(step.category)) err(w, `unknown category "${step.category}"`);
    for (const c of [...step.checks, ...(step.ruleOutChecks ?? [])].flat()) {
      if (!actions.has(c)) err(w, `check "${c}" is not an action`);
    }
    for (const f of condFields(step.when)) if (!CONTEXT_FIELDS.has(f)) err(w, `reads unknown field "${f}"`);
  }
}
for (const age of Object.keys(vocab.ageGroups)) {
  if (!rules.sieves[age]) err('sieves', `no sieve for age group "${age}"`);
}

// ---------- content files ----------

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
}

const casualtyFiles = listJson(join(contentDir, 'casualties'));
const sceneFiles = listJson(join(contentDir, 'scenes'));
const casualtyIndex = new Map(); // id -> file
const summaryRows = [];

function checkParams(where, overlayId, params) {
  const spec = vocab.overlays[overlayId]?.params ?? {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (!(k in spec)) { err(where, `overlay "${overlayId}" has no param "${k}"`); continue; }
    if (spec[k] === 'string') {
      if (typeof v !== 'string' || !v.trim()) err(where, `param "${k}" must be non-empty text`);
      else if (v.length > 40) err(where, `param "${k}" is ${v.length} chars (max 40)`);
    } else if (!spec[k].includes(v)) {
      err(where, `param ${k}=${JSON.stringify(v)} not one of ${JSON.stringify(spec[k])}`);
    }
  }
  for (const k of Object.keys(spec)) {
    if (params?.[k] === undefined && overlayId !== 'eyes' && overlayId !== 'expression') {
      err(where, `overlay "${overlayId}" needs param "${k}"`);
    }
  }
}

function checkFinding(where, f, ctx) {
  const ov = vocab.overlays[f.overlay];
  if (!f.id || !/^[a-z0-9_]+$/.test(f.id)) err(where, 'finding id must be snake_case');
  if (!f.label) err(where, 'finding needs a label (card text)');
  if (!['identification', 'mechanism', 'injuries', 'signs', 'treatment', 'allergies', 'medications', 'background', 'other'].includes(f.cardField)) {
    err(where, `cardField "${f.cardField}" unknown`);
  }
  if (!ov) { err(where, `overlay "${f.overlay}" not in vocab.overlays`); return; }
  if (!['injury', 'entrapment'].includes(ov.kind)) err(where, `findings may only use injury or entrapment overlays, "${f.overlay}" is ${ov.kind}`);
  const allowed = regionList(ov.regions);
  const findingRegions = ov.multiRegion ? f.regions : [f.region];
  if (ov.multiRegion) {
    if (!Array.isArray(f.regions) || f.regions.length === 0) err(where, `"${f.overlay}" needs a non-empty regions list`);
    if (f.region) err(where, `"${f.overlay}" uses regions (a list), not region`);
  } else if (!f.region) {
    err(where, 'finding needs a region');
  }
  for (const r of findingRegions ?? []) {
    if (!regions.has(r)) err(where, `unknown region "${r}"`);
    else if (!allowed.includes(r)) err(where, `overlay "${f.overlay}" is not allowed on "${r}"`);
  }
  checkParams(where, f.overlay, f.params);

  const visible = f.visible === true;
  if (visible && f.revealedBy) err(where, 'a finding is either visible or revealedBy, not both');
  if (!visible && !f.revealedBy) err(where, 'hidden finding needs revealedBy');
  if (f.revealedBy) {
    const a = actions.get(f.revealedBy);
    if (!a) err(where, `revealedBy "${f.revealedBy}" is not an action`);
    else if (a.effect.type !== 'reveal_findings') err(where, `revealedBy "${f.revealedBy}" does not reveal findings`);
  }
  if (visible && f.overlay !== 'entrapment') {
    const hidden = vocab.poses[ctx.pose]?.hiddenRegions ?? [];
    for (const r of findingRegions ?? []) {
      if (hidden.includes(r)) err(where, `visible on "${r}", which pose "${ctx.pose}" does not show`);
    }
  }
  if (f.overlay !== 'entrapment') {
    const covered = (findingRegions ?? []).filter((r) => ctx.covered.has(r));
    if (covered.length) {
      if (visible) err(where, `visible on ${covered.join(', ')}, which is under the entrapment`);
      if (f.revealedBy === 'expose_check_bleeding') err(where, `can't be exposed on ${covered.join(', ')} while under the entrapment`);
    }
  }
  if (f.lifeThreat && f.lifeThreat !== 'catastrophic_bleed') err(where, `lifeThreat "${f.lifeThreat}" unknown (only catastrophic_bleed; airway problems live in state)`);
  if (f.lifeThreat === 'catastrophic_bleed' && !(f.overlay === 'bleed' && f.params?.severity === 'catastrophic')) {
    err(where, 'lifeThreat catastrophic_bleed needs overlay bleed with severity catastrophic');
  }
  if (f.overlay === 'bleed' && f.params?.severity === 'catastrophic' && f.lifeThreat !== 'catastrophic_bleed') {
    err(where, 'catastrophic bleed must set lifeThreat: "catastrophic_bleed"');
  }
  checkText(where, f.label);
}

function checkText(where, text) {
  if (typeof text !== 'string') return;
  const t = text.toLowerCase();
  for (const g of GORE) if (t.includes(g)) warn(where, `text contains "${g}" (keep it gore-free)`);
}

function checkAppearance(where, list) {
  if (!Array.isArray(list)) { err(where, 'appearance must be a list'); return; }
  list.forEach((ap, i) => {
    const w = `${where}[${i}]`;
    const ov = vocab.overlays[ap.overlay];
    if (!ov) { err(w, `overlay "${ap.overlay}" not in vocab.overlays`); return; }
    if (ov.kind !== 'appearance') err(w, `appearance may only use appearance overlays, "${ap.overlay}" is ${ov.kind}`);
    if (ap.region) {
      if (!regionList(ov.regions).includes(ap.region)) err(w, `"${ap.overlay}" not allowed on "${ap.region}"`);
    } else if (ap.overlay === 'guarding') {
      err(w, 'guarding needs a region');
    }
    checkParams(w, ap.overlay, ap.params);
  });
}

function checkLook(where, look) {
  if (!look) { err(where, 'look is required'); return; }
  for (const k of ['skinTone', 'hair', 'top', 'bottom']) {
    if (!vocab.look[k].includes(look[k])) err(where, `look.${k} "${look[k]}" not one of ${vocab.look[k].join(', ')}`);
  }
}

function checkStateShape(where, state) {
  for (const [k, spec] of Object.entries(STATE_SPEC)) {
    const v = state[k];
    if (v === undefined) {
      if (!OPTIONAL_STATE.has(k)) err(where, `state.${k} is missing`);
      continue;
    }
    const w = `${where}.${k}`;
    if (Array.isArray(spec)) { if (!spec.includes(v)) err(w, `must be one of ${spec.join(', ')}`); continue; }
    switch (spec) {
      case 'bool': if (!isBool(v)) err(w, 'must be true/false'); break;
      case 'boolOrNull': if (!isBool(v) && v !== null) err(w, 'must be true/false/null'); break;
      case 'numOrRange': checkNumOrRange(w, v); break;
      case 'pulse':
        if (!v || !isBool(v.present)) { err(w, 'needs present: true/false'); break; }
        if (v.rate !== null && v.rate !== undefined) checkNumOrRange(`${w}.rate`, v.rate);
        break;
    }
  }
  for (const k of Object.keys(state)) if (!(k in STATE_SPEC)) err(where, `unknown state field "${k}"`);
}

function checkNumOrRange(w, v) {
  if (isNum(v)) return;
  if (isRange(v) && v.range.length === 2 && v.range.every(isNum) && v.range[0] <= v.range[1]) return;
  err(w, 'must be a number or { "range": [min, max] } with min <= max');
}

function checkStateConsistency(where, s, ageGroup, findings) {
  const child = ageGroup === 'child';
  if (s.breathing === false && !isBool(s.breathesAfterAirwayOpen)) err(where, 'breathing false needs breathesAfterAirwayOpen true/false');
  if (s.breathing === false && s.responsive !== 'unresponsive') err(where, 'someone not breathing must be responsive: "unresponsive"');
  const rescued = child && s.breathesAfterRescueBreaths === true;
  const neverBreathes = s.breathing === false && s.breathesAfterAirwayOpen === false && !rescued;
  if (child && s.breathing === false && s.breathesAfterAirwayOpen === false && s.radialPulse?.present && !isBool(s.breathesAfterRescueBreaths)) {
    err(where, 'child with a pulse, not breathing after airway: set breathesAfterRescueBreaths true/false');
  }
  if (!child && isBool(s.breathesAfterRescueBreaths)) warn(where, 'breathesAfterRescueBreaths only applies to children');
  if (neverBreathes) {
    if (s.rr !== 0) err(where, 'never breathes, so rr must be 0');
    if (s.breathingDepth !== 'none') err(where, 'never breathes, so breathingDepth must be "none"');
    if (s.obeysCommands || s.canTalk || s.canWalk) err(where, 'never breathes, so obeysCommands, canTalk and canWalk must be false');
    if (!child && s.radialPulse?.present) err(where, 'adult who never breathes has no radial pulse');
  } else {
    if (!(lo(s.rr) > 0)) err(where, 'breathes (now or after airway/rescue breaths), so rr must be above 0');
    if (s.breathingDepth === 'none') err(where, 'breathes, so breathingDepth cannot be "none"');
  }
  if (s.obeysCommands && !['alert', 'voice'].includes(s.responsive)) err(where, 'obeysCommands needs responsive alert or voice');
  if (s.canTalk && !['alert', 'voice'].includes(s.responsive)) err(where, 'canTalk needs responsive alert or voice');
  if (s.canWalk && s.entrapped) err(where, 'canWalk and entrapped cannot both be true');
  if (s.canWalk && !s.obeysCommands) warn(where, 'canWalk but does not obey commands');
  if (s.radialPulse && s.radialPulse.present === false && s.radialPulse.rate != null) err(where, 'radialPulse absent needs rate: null');
  if (s.radialPulse && s.radialPulse.present === true && s.radialPulse.rate == null) err(where, 'radialPulse present needs a rate');
  if (child && s.responsive === 'pain' && !isBool(s.painResponseAppropriate)) err(where, 'child responding to pain needs painResponseAppropriate true/false');
  const hasCat = findings.some((f) => f.lifeThreat === 'catastrophic_bleed');
  if (s.catastrophicBleed !== hasCat) err(where, `catastrophicBleed is ${s.catastrophicBleed} but ${hasCat ? 'there is' : 'there is no'} catastrophic bleed finding`);
  const hasTrap = findings.some((f) => f.overlay === 'entrapment');
  if (s.entrapped !== hasTrap) err(where, `entrapped is ${s.entrapped} but ${hasTrap ? 'there is' : 'there is no'} entrapment finding`);
}

/** Category for a state with ranges; errors if the ranges straddle a threshold. */
function stableCategory(where, state, ageGroup) {
  const results = new Map();
  for (const s of sampleStates(state)) {
    try {
      const r = triage(rules, ageGroup, s);
      const key = `${r.category} (${r.step})`;
      if (!results.has(key)) results.set(key, { ...r, sample: s });
    } catch (e) {
      err(where, e.message);
      return null;
    }
  }
  const cats = new Set([...results.values()].map((r) => r.category));
  if (cats.size > 1) {
    err(where, `vitals straddle a threshold; samples give ${[...results.keys()].join(' / ')}. Narrow the ranges.`);
    return null;
  }
  return [...results.values()][0];
}

function checkCasualty(c, prefix) {
  const where = c.id ?? '(no id)';
  if (!c.id || !/^[a-z0-9_]+$/.test(c.id)) err(where, 'id must be lowercase snake_case');
  if (prefix && c.id && !c.id.startsWith(prefix)) err(where, `id must start with the file prefix "${prefix}"`);
  if (casualtyIndex.has(c.id) && casualtyIndex.get(c.id) !== currentFile) {
    err(where, `duplicate id, also in ${relative(root, casualtyIndex.get(c.id))}`);
  }
  casualtyIndex.set(c.id, currentFile);
  for (const k of ['title', 'approach']) if (typeof c[k] !== 'string' || !c[k].trim()) err(where, `${k} is required`);
  checkText(`${where}.approach`, c.approach);
  if (!vocab.ageGroups[c.ageGroup]) { err(where, `ageGroup "${c.ageGroup}" unknown`); return; }
  if (!vocab.poses[c.pose]) { err(where, `pose "${c.pose}" unknown`); return; }
  if (c.pose === 'recovery') warn(where, 'starting in the recovery position is unusual; it is normally reached by an action');
  checkLook(`${where}.look`, c.look);
  checkAppearance(`${where}.appearance`, c.appearance ?? []);

  const id = c.identity ?? {};
  if (!(typeof id.name === 'string' || id.name === null)) err(`${where}.identity`, 'name must be text or null');
  if (!isNum(id.age)) err(`${where}.identity`, 'age must be a number');
  if (!['male', 'female', 'other', 'unknown'].includes(id.sex)) err(`${where}.identity`, 'sex must be male, female, other or unknown');
  if (!['self', 'bystander', 'id_card', 'none'].includes(id.source)) err(`${where}.identity`, 'source must be self, bystander, id_card or none');
  if (c.ageGroup === 'child' && id.age > 12) warn(`${where}.identity`, `age ${id.age} is old for the child sieve`);
  if (c.ageGroup === 'adult' && id.age < 12) warn(`${where}.identity`, `age ${id.age} is young for the adult sieve`);
  const h = c.history ?? {};
  if (typeof h.mechanism !== 'string') err(`${where}.history`, 'mechanism is required');
  if (!['self', 'bystander', 'none'].includes(h.source)) err(`${where}.history`, 'source must be self, bystander or none');

  const state = c.state;
  if (!state) { err(where, 'state is required'); return; }
  checkStateShape(`${where}.state`, state);

  const findings = c.findings ?? [];
  const covered = new Set(findings.filter((f) => f.overlay === 'entrapment').flatMap((f) => f.regions ?? []));
  const ids = new Set();
  findings.forEach((f, i) => {
    const w = `${where}.findings[${f.id ?? i}]`;
    if (ids.has(f.id)) err(w, 'duplicate finding id');
    ids.add(f.id);
    checkFinding(w, f, { pose: c.pose, covered });
  });
  for (const f of findings.filter((x) => x.overlay === 'amputation')) {
    if (!findings.some((b) => b.overlay === 'bleed' && b.region === f.region)) err(`${where}.findings[${f.id}]`, 'amputation needs a bleed finding on the same region');
  }
  if (c.ageGroup === 'adult' && state.radialPulse?.present === false && state.breathing !== false && !findings.some((f) => f.overlay === 'bleed' && f.params?.severity !== 'minor') && !c.tags?.includes('medical')) {
    warn(where, 'no radial pulse with no major bleed; make sure the cause is clear in findings or teaching');
  }
  checkStateConsistency(`${where}.state`, state, c.ageGroup, findings);

  const exp = c.expected ?? {};
  if (!categories.has(exp.category)) err(`${where}.expected`, `category "${exp.category}" unknown`);
  if (!isNum(exp.targetSeconds)) err(`${where}.expected`, 'targetSeconds is required');
  const start = stableCategory(`${where}.state`, state, c.ageGroup);
  if (start && exp.category && start.category !== exp.category) {
    err(`${where}.expected`, `expected ${exp.category} but the rules give ${start.category} (step "${start.step}")`);
  }

  const derived = findingContext(findings, vocab);
  const listed = new Set([...(c.expected?.lifeSavingInterventions ?? []), ...(c.expected?.keyActions ?? [])]);
  const ctxFor = (s, actionId) => ({ ...s, ageGroup: c.ageGroup, phase: 'sieve', hazardActive: false, bystanderPresent: true, ...derived, listedForCasualty: listed.has(actionId) });
  const sample = sampleStates(state).at(-1);
  for (const a of exp.lifeSavingInterventions ?? []) {
    const act = actions.get(a);
    if (!act) { err(`${where}.expected`, `lifeSavingIntervention "${a}" is not an action`); continue; }
    if (act.group !== 'intervention') err(`${where}.expected`, `"${a}" is not in the intervention group`);
    else if (!evalCond(act.correctWhen, ctxFor(sample, a))) err(`${where}.expected`, `"${a}" is listed as life-saving but its correctWhen is false for this casualty`);
  }
  if (state.catastrophicBleed && !(exp.lifeSavingInterventions ?? []).length) err(`${where}.expected`, 'catastrophic bleed needs lifeSavingInterventions');
  if (state.breathing === false && state.breathesAfterAirwayOpen === true && !(exp.lifeSavingInterventions ?? []).includes('open_airway')) {
    warn(`${where}.expected`, 'breathes only after airway opening; list open_airway as life-saving');
  }
  for (const a of exp.keyActions ?? []) {
    const act = actions.get(a);
    if (!act) err(`${where}.expected`, `keyAction "${a}" is not an action`);
    else if (!evalCond(act.correctWhen, ctxFor(sample, a))) err(`${where}.expected`, `"${a}" is listed as a key action but its correctWhen is false for this casualty`);
  }
  for (const t of exp.traps ?? []) {
    const act = actions.get(t);
    if (!act) err(`${where}.expected`, `trap "${t}" is not an action`);
    else if (evalCond(act.correctWhen, ctxFor(sample, t))) warn(`${where}.expected`, `trap "${t}" is actually correct for this casualty`);
  }
  if (!Array.isArray(c.teaching) || !c.teaching.length) err(where, 'teaching needs at least one point');

  // Deterioration: time stages accumulate; action stages branch off.
  let cur = state;
  let curFindings = findings;
  let curPose = c.pose;
  let curAppearance = new Set((c.appearance ?? []).map((a) => a.overlay));
  let lastAt = -1;
  const stageIds = new Set();
  const stageCats = [];
  (c.deterioration ?? []).forEach((d, i) => {
    const w = `${where}.deterioration[${d.id ?? i}]`;
    if (!d.id) err(w, 'stage needs an id');
    if (stageIds.has(d.id)) err(w, 'duplicate stage id');
    stageIds.add(d.id);
    const timed = d.atSeconds !== undefined;
    const triggered = d.afterAction !== undefined;
    if (timed === triggered) { err(w, 'use either atSeconds or afterAction + delaySeconds'); return; }
    if (timed) {
      if (!isNum(d.atSeconds) || d.atSeconds <= lastAt) err(w, 'atSeconds must be a number, increasing across time stages');
      lastAt = d.atSeconds;
    } else {
      if (!actions.has(d.afterAction)) err(w, `afterAction "${d.afterAction}" is not an action`);
      if (!isNum(d.delaySeconds)) err(w, 'afterAction stages need delaySeconds');
    }
    for (const u of d.unless ?? []) if (!actions.has(u)) err(w, `unless "${u}" is not an action`);
    const pose = d.pose ?? curPose;
    if (d.pose && !vocab.poses[d.pose]) err(w, `pose "${d.pose}" unknown`);
    if (d.appearance) checkAppearance(`${w}.appearance`, d.appearance);
    for (const ov of d.removeAppearance ?? []) {
      if (vocab.overlays[ov]?.kind !== 'appearance') err(w, `removeAppearance "${ov}" is not an appearance overlay`);
      else if (!curAppearance.has(ov)) warn(w, `removeAppearance "${ov}" was not shown before this stage`);
    }
    for (const fid of d.removeFindings ?? []) {
      if (!curFindings.some((f) => f.id === fid)) err(w, `removeFindings "${fid}" is not a finding at this point`);
    }
    const nextAppearance = new Set([...curAppearance].filter((o) => !(d.removeAppearance ?? []).includes(o)));
    for (const a of d.appearance ?? []) nextAppearance.add(a.overlay);
    const next = mergeState(cur, d.state ?? {});
    checkStateShape(`${w}.state`, next);
    const nextCovered = new Set([...curFindings, ...(d.addFindings ?? [])].filter((f) => f.overlay === 'entrapment' && !(d.state?.entrapped === false)).flatMap((f) => f.regions ?? []));
    (d.addFindings ?? []).forEach((f) => {
      if (curFindings.some((x) => x.id === f.id)) err(`${w}.addFindings[${f.id}]`, 'finding id already used');
      checkFinding(`${w}.addFindings[${f.id}]`, f, { pose, covered: nextCovered });
    });
    let nextFindings = [...curFindings.filter((f) => !(d.removeFindings ?? []).includes(f.id)), ...(d.addFindings ?? [])];
    if (next.entrapped === false) nextFindings = nextFindings.filter((f) => f.overlay !== 'entrapment');
    checkStateConsistency(`${w}.state`, next, c.ageGroup, nextFindings);
    if (!categories.has(d.expectedCategory)) err(w, `expectedCategory "${d.expectedCategory}" unknown`);
    const r = stableCategory(`${w}.state`, next, c.ageGroup);
    if (r && d.expectedCategory && r.category !== d.expectedCategory) {
      err(w, `expectedCategory ${d.expectedCategory} but the rules give ${r.category} (step "${r.step}")`);
    }
    stageCats.push(`${d.id}${triggered ? `(after ${d.afterAction})` : `@${d.atSeconds}s`}=${r?.category ?? '?'}`);
    checkText(`${w}.note`, d.note);
    if (timed) { cur = next; curFindings = nextFindings; curPose = pose; curAppearance = nextAppearance; }
  });

  summaryRows.push({
    id: c.id, age: c.ageGroup, pose: c.pose,
    start: start ? `${start.category} (${start.step})` : '?',
    stages: stageCats.join(' ') || '-',
    lsi: (exp.lifeSavingInterventions ?? []).join(',') || '-',
    checks: start ? requiredChecks(rules, c.ageGroup, start.step).map((x) => (Array.isArray(x) ? x.join('|') : x)).join(',') || '-' : '?',
  });
}

const fullNames = new Map();
for (const file of casualtyFiles) {
  currentFile = file;
  const doc = readJson(file);
  if (!doc) continue;
  if (!Array.isArray(doc.casualties)) { err('', 'file needs a "casualties" list'); continue; }
  if (!doc.prefix) warn('', 'file has no "prefix"');
  doc.casualties.forEach((c) => {
    checkCasualty(c, doc.prefix);
    const n = c.identity?.name;
    if (n && fullNames.has(n)) warn(c.id, `name "${n}" is also used by ${fullNames.get(n)}`);
    else if (n) fullNames.set(n, c.id);
  });
}

function checkPos(w, p) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => isNum(n) && n >= 0 && n <= 100)) err(w, 'position must be [x, y] within 0-100');
}

const sceneIds = new Set();
for (const file of sceneFiles) {
  currentFile = file;
  const doc = readJson(file);
  if (!doc) continue;
  if (!Array.isArray(doc.scenes)) { err('', 'file needs a "scenes" list'); continue; }
  for (const s of doc.scenes) {
    const w = s.id ?? '(no id)';
    if (sceneIds.has(s.id)) err(w, 'duplicate scene id');
    sceneIds.add(s.id);
    if (!['learn', 'full_scene'].includes(s.mode)) err(w, 'mode must be learn or full_scene');
    for (const k of ['major', 'exactLocation', 'type', 'hazards', 'access', 'number', 'emergencyServices']) {
      if (typeof s.briefing?.[k] !== 'string') err(`${w}.briefing`, `METHANE field "${k}" is required`);
    }
    if (!/^\d{2}:\d{2}$/.test(s.startClock ?? '')) err(w, 'startClock must be HH:MM');
    if (!isNum(s.targetSeconds)) err(w, 'targetSeconds is required');
    const refs = new Set();
    for (const cs of s.casualties ?? []) {
      if (!casualtyIndex.has(cs.ref)) err(`${w}.casualties`, `"${cs.ref}" is not a casualty`);
      if (refs.has(cs.ref)) err(`${w}.casualties`, `"${cs.ref}" appears twice`);
      refs.add(cs.ref);
      checkPos(`${w}.casualties[${cs.ref}]`, cs.position);
      for (const k of Object.keys(cs.override ?? {})) {
        const ow = `${w}.casualties[${cs.ref}].override`;
        if (!['approach', 'mechanism', 'speech', 'teaching'].includes(k)) err(ow, `only approach, mechanism, speech and teaching can be overridden, not "${k}"`);
        else if (k === 'teaching' && !(Array.isArray(cs.override.teaching) && cs.override.teaching.length)) err(ow, 'teaching override must be a non-empty list');
        else if (k === 'speech' && (typeof cs.override.speech !== 'string' || cs.override.speech.length > 40)) err(ow, 'speech override must be text of at most 40 characters');
        else checkText(`${ow}.${k}`, cs.override[k]);
      }
    }
    const n = refs.size;
    if (s.mode === 'learn' && (n < 1 || n > 3)) err(w, `learn scenes have 1-3 casualties, found ${n}`);
    if (s.mode === 'full_scene' && (n < 6 || n > 12)) err(w, `full scenes have 6-12 casualties, found ${n}`);
    const local = new Set();
    for (const b of s.bystanders ?? []) {
      const bw = `${w}.bystanders[${b.id}]`;
      if (local.has(b.id)) err(bw, 'duplicate id in scene');
      local.add(b.id);
      if (!vocab.ageGroups[b.ageGroup]) err(bw, `ageGroup "${b.ageGroup}" unknown`);
      checkLook(`${bw}.look`, b.look);
      if (!vocab.bystanderBehaviours[b.behaviour]) err(bw, `behaviour "${b.behaviour}" unknown`);
      for (const a of b.canHelp ?? []) if (!actions.has(a)) err(bw, `canHelp "${a}" is not an action`);
      checkPos(bw, b.position);
    }
    const hazardIds = new Set();
    for (const hz of s.hazards ?? []) {
      const hw = `${w}.hazards[${hz.id}]`;
      if (local.has(hz.id)) err(hw, 'duplicate id in scene');
      local.add(hz.id);
      hazardIds.add(hz.id);
      if (!vocab.hazards[hz.type]) err(hw, `type "${hz.type}" unknown`);
      if (!isBool(hz.activeAtStart)) err(hw, 'activeAtStart must be true/false');
      checkPos(hw, hz.position);
    }
    let lastAt = -1;
    for (const ev of s.events ?? []) {
      const ew = `${w}.events[${ev.id}]`;
      if (local.has(ev.id)) err(ew, 'duplicate id in scene');
      local.add(ev.id);
      if (!isNum(ev.atSeconds) || ev.atSeconds < lastAt) err(ew, 'atSeconds must be a number, non-decreasing');
      lastAt = ev.atSeconds;
      if (!vocab.sceneEvents[ev.type]) err(ew, `type "${ev.type}" unknown`);
      if (ev.hazard && !hazardIds.has(ev.hazard)) err(ew, `hazard "${ev.hazard}" is not a hazard in this scene`);
      if (ev.casualty && !refs.has(ev.casualty)) err(ew, `casualty "${ev.casualty}" is not in this scene`);
      if (ev.bystander && !local.has(ev.bystander)) err(ew, `bystander "${ev.bystander}" is not in this scene`);
      for (const r of [ev.correctResponse ?? []].flat()) {
        if (r !== 'ignore' && !actions.has(r)) err(ew, `correctResponse "${r}" is not an action or "ignore"`);
      }
      if (ev.penaltyIfWrong && !['major', 'minor'].includes(ev.penaltyIfWrong)) err(ew, 'penaltyIfWrong must be major or minor');
      checkText(ew, ev.description);
    }
    if (!Array.isArray(s.teaching) || !s.teaching.length) err(w, 'teaching needs at least one point');
  }
}

report();

function report() {
  const shown = onlyFiles.length ? problems.filter((p) => onlyFiles.includes(resolve(p.file))) : problems;
  for (const p of shown) {
    console.log(`${p.level.padEnd(5)} ${relative(root, p.file)} › ${p.where}: ${p.msg}`);
  }
  if (showSummary && summaryRows.length) {
    console.log('\nid | age | pose | start category (step) | stages | life-saving | checks needed');
    for (const r of summaryRows) console.log(`${r.id} | ${r.age} | ${r.pose} | ${r.start} | ${r.stages} | ${r.lsi} | ${r.checks}`);
  }
  const errors = shown.filter((p) => p.level === 'ERROR').length;
  const warnings = shown.length - errors;
  console.log(`\n${casualtyIndex.size} casualties, ${sceneIds.size} scenes checked. ${errors} error(s), ${warnings} warning(s).`);
  process.exit(errors ? 1 : 0);
}
