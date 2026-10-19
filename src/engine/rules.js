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

/** Evaluate a condition from the content condition language against a context. */
export function evalCond(cond, ctx) {
  if (cond === true || cond === false) return cond;
  if (cond == null || typeof cond !== 'object') throw new Error(`Bad condition: ${JSON.stringify(cond)}`);
  if (cond.all) return cond.all.every((c) => evalCond(c, ctx));
  if (cond.any) return cond.any.some((c) => evalCond(c, ctx));
  if (cond.not) return !evalCond(cond.not, ctx);
  const v = getPath(ctx, cond.field);
  switch (cond.op) {
    case 'eq': return v === cond.value;
    case 'ne': return v !== cond.value;
    case 'lt': return typeof v === 'number' && v < cond.value;
    case 'lte': return typeof v === 'number' && v <= cond.value;
    case 'gt': return typeof v === 'number' && v > cond.value;
    case 'gte': return typeof v === 'number' && v >= cond.value;
    case 'in': return Array.isArray(cond.value) && cond.value.includes(v);
    case 'exists': return (v !== undefined && v !== null) === (cond.value !== false);
    default: throw new Error(`Unknown op: ${cond.op}`);
  }
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
  const ctx = { ...state, ageGroup, ...extra };
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
