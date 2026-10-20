// Triage rules engine. Pure functions, no DOM or Node APIs, so the app and the
// validator share it. Reads content/triage-rules.json and a casualty's state.

/** Read a dotted path such as "radialPulse.present" from an object. */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** A named threshold such as "adult.rrHigh" from rules.thresholds. */
export function thresholdValue(thresholds, ref) {
  const v = getPath(thresholds ?? {}, ref);
  if (typeof v !== 'number') throw new Error(`Unknown threshold "${ref}"`);
  return v;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z]+\.[A-Za-z]+)\s*\}\}/g;

/** Every {{group.name}} placeholder in a text, e.g. ["adult.rrHigh"]. */
export function placeholders(text) {
  return typeof text === 'string' ? [...text.matchAll(PLACEHOLDER)].map((m) => m[1]) : [];
}

/** Replace {{adult.rrHigh}}-style placeholders with the numbers in rules.thresholds. Unknown ones stay as they are. */
export function fillThresholds(text, thresholds) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text.replace(PLACEHOLDER, (m, ref) => {
    const v = getPath(thresholds ?? {}, ref);
    return typeof v === 'number' ? String(v) : m;
  });
}

/** A copy of any content object with every string's threshold placeholders filled. */
export function fillThresholdsDeep(node, thresholds) {
  if (typeof node === 'string') return fillThresholds(node, thresholds);
  if (Array.isArray(node)) return node.map((x) => fillThresholdsDeep(x, thresholds));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillThresholdsDeep(v, thresholds)]));
  return node;
}

/**
 * Evaluate a condition from the content condition language against a context.
 * A leaf may use "threshold": "adult.rrHigh" instead of "value"; it is looked up in ctx.__thresholds.
 */
export function evalCond(cond, ctx) {
  if (cond === true || cond === false) return cond;
  if (cond == null || typeof cond !== 'object') throw new Error(`Bad condition: ${JSON.stringify(cond)}`);
  if (cond.all) return cond.all.every((c) => evalCond(c, ctx));
  if (cond.any) return cond.any.some((c) => evalCond(c, ctx));
  if (cond.not) return !evalCond(cond.not, ctx);
  const v = getPath(ctx, cond.field);
  const target = cond.threshold != null ? thresholdValue(ctx.__thresholds, cond.threshold) : cond.value;
  switch (cond.op) {
    case 'eq': return v === target;
    case 'ne': return v !== target;
    case 'lt': return typeof v === 'number' && v < target;
    case 'lte': return typeof v === 'number' && v <= target;
    case 'gt': return typeof v === 'number' && v > target;
    case 'gte': return typeof v === 'number' && v >= target;
    case 'in': return Array.isArray(target) && target.includes(v);
    case 'exists': return (v !== undefined && v !== null) === (target !== false);
    default: throw new Error(`Unknown op: ${cond.op}`);
  }
}

/** Every threshold reference a condition uses (for validation). */
export function condThresholds(cond, out = new Set()) {
  if (cond == null || typeof cond !== 'object') return out;
  if (cond.all) cond.all.forEach((c) => condThresholds(c, out));
  else if (cond.any) cond.any.forEach((c) => condThresholds(c, out));
  else if (cond.not) condThresholds(cond.not, out);
  else if (cond.threshold != null) out.add(cond.threshold);
  return out;
}

/** Collect every field path a condition reads (for validation). */
export function condFields(cond, out = new Set()) {
  if (cond == null || typeof cond !== 'object') return out;
  if (cond.all) cond.all.forEach((c) => condFields(c, out));
  else if (cond.any) cond.any.forEach((c) => condFields(c, out));
  else if (cond.not) condFields(cond.not, out);
  else if (cond.field) out.add(cond.field);
  return out;
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
export const isRange = (v) => isPlainObject(v) && Array.isArray(v.range);

/** Merge a deterioration patch into a state. Objects merge; ranges and scalars replace. */
export function mergeState(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (isPlainObject(v) && !isRange(v) && isPlainObject(base?.[k]) && !isRange(base[k])) {
      out[k] = mergeState(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Paths of every {range:[a,b]} inside a state. */
export function rangePaths(state, prefix = '') {
  const paths = [];
  for (const [k, v] of Object.entries(state ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isRange(v)) paths.push(p);
    else if (isPlainObject(v)) paths.push(...rangePaths(v, p));
  }
  return paths;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    cur[key] = { ...cur[key] };
    cur = cur[key];
  }
  cur[keys.at(-1)] = value;
}

/**
 * Concrete samples of a state: every combination of range ends plus the midpoint.
 * Used to prove a casualty's category is stable whatever the randomised vitals are.
 */
export function sampleStates(state) {
  const paths = rangePaths(state);
  const samples = [];
  const combos = 1 << paths.length;
  for (let mask = 0; mask < combos; mask++) {
    const s = structuredClone(state);
    paths.forEach((p, i) => {
      const [lo, hi] = getPath(state, p).range;
      setPath(s, p, mask & (1 << i) ? hi : lo);
    });
    samples.push(s);
  }
  const mid = structuredClone(state);
  for (const p of paths) {
    const [lo, hi] = getPath(state, p).range;
    setPath(mid, p, Math.round((lo + hi) / 2));
  }
  samples.push(mid);
  return samples;
}

/** Pick concrete vitals for one play-through. rng() returns [0,1). */
export function rollState(state, rng = Math.random) {
  const s = structuredClone(state);
  for (const p of rangePaths(state)) {
    const [lo, hi] = getPath(state, p).range;
    setPath(s, p, lo + Math.floor(rng() * (hi - lo + 1)));
  }
  return s;
}

/** Where a catastrophic bleed is, for actions such as apply_tourniquet. */
export function catastrophicBleedSite(findings, vocab) {
  const bleed = (findings ?? []).find((f) => f.lifeThreat === 'catastrophic_bleed');
  if (!bleed) return null;
  if (vocab.regionGroups.tourniquet_sites.includes(bleed.region)) return 'tourniquet_site';
  if (vocab.regionGroups.junctional.includes(bleed.region)) return 'junctional';
  return 'other';
}

/** Condition-language fields derived from findings rather than stored in state. */
export function findingContext(findings, vocab) {
  return {
    catastrophicBleedSite: catastrophicBleedSite(findings, vocab),
    majorBleed: (findings ?? []).some((f) => f.overlay === 'bleed' && f.params?.severity === 'major'),
  };
}

/**
 * Run the sieve. `state` must be concrete (no ranges). Returns the category and
 * the step that decided it, plus every step evaluated on the way.
 */
export function triage(rules, ageGroup, state, extra = {}) {
  const sieve = rules.sieves[ageGroup];
  if (!sieve) throw new Error(`No sieve for age group "${ageGroup}"`);
  const ctx = { ...state, ageGroup, ...extra, __thresholds: rules.thresholds };
  const path = [];
  for (const step of sieve.steps) {
    path.push(step.id);
    if (evalCond(step.when, ctx)) return { category: step.category, step: step.id, path };
  }
  throw new Error(`Sieve for "${ageGroup}" has no catch-all step`);
}

/**
 * Checks the player must have done to justify the correct category: the checks
 * that rule out every earlier step (`ruleOutChecks`, defaulting to `checks`) plus
 * the deciding step's own `checks`. Each entry is an action id or an array of
 * alternatives (any one is enough).
 */
export function requiredChecks(rules, ageGroup, decidingStepId) {
  const checks = [];
  for (const step of rules.sieves[ageGroup].steps) {
    const list = step.id === decidingStepId ? step.checks : (step.ruleOutChecks ?? step.checks);
    for (const c of list) {
      const key = JSON.stringify(c);
      if (!checks.some((x) => JSON.stringify(x) === key)) checks.push(c);
    }
    if (step.id === decidingStepId) break;
  }
  return checks;
}
