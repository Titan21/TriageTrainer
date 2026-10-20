// Game session engine. Pure ES module (no DOM, no Node APIs): the app drives it,
// and tools/simulate.mjs plays every scene with it in Node.
//
//   const content = indexContent({ vocab, actions, rules, casualtyFiles, sceneFiles });
//   const s = createSession(content, sceneId, { seed, hints });
//   approach(s, casualtyId)          walk to a casualty (costs time)
//   perform(s, actionId, opts)       do an action on the current casualty or the scene
//   availableActions(s)              core / extras / more lists for the action panel
//   answerPrompt(s, actionId, secs)  answer a quick-time prompt (s.prompt) within its time limit
//   snapshot(s, casualtyId, mode)    { casualty, view } to pass to renderCasualty
//   card(s, casualtyId)              IMISTAMBO triage card fields
//   debrief(s)                       scores, mistakes and teaching for the end screen
//
// Time is game time: each action costs its timeCostSeconds. Deterioration stages
// run on the scene clock; a stage is prevented when one of its `unless` actions
// was finished at or before the stage time.

import { triage, rollState, mergeState, evalCond, findingContext, requiredChecks, fillThresholdsDeep } from '../engine/rules.js';
import { makeRng } from '../art/util.js';

export const CARD_FIELDS = [
  { id: 'identification', letter: 'I', label: 'Identification' },
  { id: 'mechanism', letter: 'M', label: 'Mechanism' },
  { id: 'injuries', letter: 'I', label: 'Injuries' },
  { id: 'signs', letter: 'S', label: 'Signs' },
  { id: 'treatment', letter: 'T', label: 'Treatment and trends' },
  { id: 'allergies', letter: 'A', label: 'Allergies', laterPhase: true },
  { id: 'medications', letter: 'M', label: 'Medications', laterPhase: true },
  { id: 'background', letter: 'B', label: 'Background', laterPhase: true },
  { id: 'other', letter: 'O', label: 'Other' },
];

/** Sieve actions shown in a fixed order so their position becomes habit. */
export const CORE_ACTIONS = [
  'check_danger', 'ask_to_walk', 'check_response', 'check_breathing', 'open_airway', 'check_radial_pulse', 'check_crt',
  'give_command', 'expose_check_bleeding', 'apply_tourniquet', 'direct_pressure', 'pack_wound',
  'recovery_position', 'tag_casualty',
];
export const SCENE_ACTIONS = ['check_danger', 'don_gloves', 'call_walking_wounded', 'make_safe', 'withdraw', 'drop_cover_hold', 'evacuate', 'stop_and_listen', 'resume_work', 'radio_methane', 'call_for_help'];
/** Answers offered in every quick-time prompt (shuffled), so the right one has to be recognised. */
export const QTE_CHOICES = ['drop_cover_hold', 'withdraw', 'evacuate', 'stop_and_listen', 'resume_work', 'keep_working'];
// Time to notice the prompt, read the cue and the six options, weigh them and choose. The UI adds a grace
// period of the same length in which a right answer still counts, as slow.
const QTE_SECONDS = 12;
/** Actions that put hands on a casualty: check for danger first. */
const isHandsOn = (a) => ['assessment', 'intervention', 'trap'].includes(a.group) && a.id !== 'ask_to_walk';
const ENTRY_POINT = [50, 100];
const EXTRA_COUNT = 3;

// ---------- content ----------

/**
 * Index raw content. casualtyFiles/sceneFiles are the parsed JSON files. Every text's {{adult.rrHigh}}-style
 * placeholders are filled from rules.thresholds here, so all screens quote the same numbers the rules use.
 */
export function indexContent(raw) {
  const t = raw.rules.thresholds;
  const { vocab, actions, rules, casualtyFiles, sceneFiles } = {
    ...raw,
    actions: fillThresholdsDeep(raw.actions, t),
    rules: fillThresholdsDeep(raw.rules, t),
    casualtyFiles: fillThresholdsDeep(raw.casualtyFiles, t),
    sceneFiles: fillThresholdsDeep(raw.sceneFiles, t),
  };
  const actionList = actions.actions ?? actions;
  const casualties = new Map();
  for (const f of casualtyFiles) for (const c of f.casualties) casualties.set(c.id, c);
  const sceneList = sceneFiles.flatMap((f) => f.scenes);
  return {
    vocab, rules, actionList,
    actions: new Map(actionList.map((a) => [a.id, a])),
    casualties, sceneList,
    scenes: new Map(sceneList.map((s) => [s.id, s])),
    categories: new Map(rules.categories.map((c) => [c.id, c])),
  };
}

/** A casualty as it appears in a scene, with the scene's text overrides applied. */
function placeCasualty(def, placement) {
  const o = placement.override ?? {};
  const c = structuredClone(def);
  if (o.approach) c.approach = o.approach;
  if (o.mechanism) c.history = { ...c.history, mechanism: o.mechanism };
  if (o.teaching) c.teaching = o.teaching;
  if (o.speech) {
    const sp = (c.appearance ?? []).find((a) => a.overlay === 'speech');
    if (sp) sp.params = { ...sp.params, text: o.speech };
    else (c.appearance ??= []).push({ overlay: 'speech', params: { text: o.speech } });
  }
  return c;
}

// ---------- session ----------

export function createSession(content, sceneId, { seed = String(Date.now()), hints = true, qte = false } = {}) {
  const scene = content.scenes.get(sceneId);
  if (!scene) throw new Error(`Unknown scene "${sceneId}"`);
  const session = {
    content, scene, seed: String(seed), hints, qte,
    prompt: null,       // the quick-time prompt waiting for an answer, if any
    qteResults: [],     // { eventId, step, expected, answer, seconds, ok, fast }
    clock: 0,
    startClock: scene.startClock ?? '10:00',
    position: ENTRY_POINT,
    current: null,
    order: [],
    casualties: new Map(),
    // active: the hazard is there (shown, reported by check_danger). acute: an event made it urgent and a
    // response is due; only acute hazards make withdrawing or moving a casualty the right call.
    hazards: (scene.hazards ?? []).map((h) => ({ ...h, active: h.activeAtStart === true, acute: false })),
    events: [...(scene.events ?? []), ...(qte ? randomQtes(content, scene, String(seed)) : [])]
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map((e) => ({ def: withSignal(content, e), fired: false, progress: 0, resolved: false, missed: false })),
    sceneDone: [],
    log: [],
    messages: [],
    ended: false,
  };
  for (const placement of scene.casualties) {
    const def = content.casualties.get(placement.ref);
    if (!def) throw new Error(`Scene ${sceneId} references unknown casualty ${placement.ref}`);
    session.order.push(def.id);
    const rc = newRuntime(session, placeCasualty(def, placement), placement.position);
    rc.localHazard = placement.localHazard ?? null;
    session.casualties.set(def.id, rc);
  }
  fireEvents(session);
  return session;
}

/** Signal events take their meaning and correct response from vocab.signals. */
function withSignal(content, e) {
  if (e.type !== 'signal') return e;
  const sig = content.vocab.signals?.[e.signal];
  if (!sig) return e;
  return { correctResponse: sig.response, deadlineSeconds: 20, description: `Signal: ${sig.pattern.toLowerCase()} (${sig.meaning.toLowerCase()}).`, cue: `You hear ${sig.pattern.toLowerCase()} on a whistle.`, qte: true, ...e };
}

/**
 * Extra quick-time events when the option is on: picked from vocab.qtePool by the
 * scene's tags and briefing, at seeded times that don't collide with scripted events.
 */
function randomQtes(content, scene, seed) {
  const pool = content.vocab.qtePool ?? [];
  const words = new Set([...(scene.tags ?? []), ...`${scene.briefing?.type ?? ''} ${scene.briefing?.hazards ?? ''}`.toLowerCase().split(/[^a-z]+/)]);
  const fits = pool.filter((q) => q.when.some((w) => words.has(w)));
  if (!fits.length) return [];
  const rng = makeRng(`${seed}|qte|${scene.id}`);
  const count = scene.mode === 'full_scene' ? 2 : 1;
  const span = Math.max(90, (scene.targetSeconds ?? 120) * 0.8);
  const taken = (scene.events ?? []).map((e) => e.atSeconds);
  const out = [];
  const choices = [...fits];
  while (out.length < count && choices.length) {
    const q = choices.splice(Math.floor(rng() * choices.length), 1)[0];
    let at = Math.round(30 + rng() * (span - 30));
    for (let tries = 0; tries < 10 && taken.some((t) => Math.abs(t - at) < 30); tries++) at = Math.round(30 + rng() * (span - 30));
    taken.push(at);
    out.push({ ...q.event, id: `qte_${q.id}_${out.length}`, atSeconds: at, qte: true, random: true });
    if (q.then) out.push({ ...q.then, id: `qte_${q.id}_${out.length}_then`, atSeconds: at + (q.then.after ?? 40), qte: true, random: true });
  }
  return out;
}

function newRuntime(session, def, position) {
  const rng = makeRng(`${session.seed}|${def.id}|start`);
  return {
    id: def.id, def, position,
    ageGroup: def.ageGroup,
    state: rollState(def.state, rng),
    pose: def.pose,
    appearance: structuredClone(def.appearance ?? []),
    findings: structuredClone(def.findings ?? []),
    flags: { airwayOpened: false, rescueBreathsGiven: false, glucoseGiven: false, inhalerUsed: false },
    stages: (def.deterioration ?? []).map((d) => ({ def: d, status: 'pending', dueAt: d.atSeconds ?? null, appliedAt: null })),
    done: [],          // { id, t, ok } every attempt, for prevention, triggers and process checks
    drawn: [],         // action ids whose effect shows in the picture
    revealed: new Set(),
    observed: {},      // field -> { value, t } as last checked
    cardEntries: [],
    tag: null,
    visitedAt: null,
    changedSince: 0,   // clock time of the last applied stage, for "nothing changed" notes
    cameToYou: false,  // walked to the rescuer after the call-out: no danger check needed
    dangerChecked: false,
    dangerSkipped: false,
    hazardFound: false,
    hazardMet: false,
  };
}

export function clockText(session, t = session.clock, withSeconds = false) {
  const [h, m] = session.startClock.split(':').map(Number);
  const total = h * 3600 + m * 60 + Math.round(t);
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

const regionText = (r) => String(r ?? '').replace(/_/g, ' ');
const yesNo = (v) => (v ? 'yes' : 'no');
const doneAt = (rc, id, t = Infinity) => rc.done.some((d) => d.id === id && d.ok !== false && d.t <= t);
const hazardActive = (s) => s.hazards.some((h) => h.acute) || s.events.some((ev) => ev.fired && !ev.resolved && !ev.missed && ['aftershock', 'hazard_appears', 'signal'].includes(ev.def.type) && expectedResponses(ev.def).length);
const bystanderPresent = (s) => (s.scene.bystanders ?? []).some((b) => (b.canHelp ?? []).includes('instruct_bystander_pressure'));

/** Is the casualty breathing right now, counting an opened airway or rescue breaths? */
export function effectiveBreathing(rc) {
  const st = rc.state;
  return st.breathing === true
    || (rc.flags.airwayOpened && st.breathesAfterAirwayOpen === true)
    || (rc.flags.rescueBreathsGiven && st.breathesAfterRescueBreaths === true);
}

function condContext(session, rc, actionId) {
  const exp = rc.def.expected ?? {};
  const listed = new Set([...(exp.lifeSavingInterventions ?? []), ...(exp.keyActions ?? [])]);
  const done = Object.fromEntries(rc.done.map((d) => [d.id, true]));
  return {
    ...rc.state,
    ...findingContext(rc.findings, session.content.vocab),
    ageGroup: rc.ageGroup,
    phase: rc.tag ? 're_triage' : 'sieve',
    hazardActive: hazardActive(session),
    bystanderPresent: bystanderPresent(session),
    listedForCasualty: listed.has(actionId),
    airwayOpened: rc.flags.airwayOpened,
    rescueBreathsGiven: rc.flags.rescueBreathsGiven,
    done,
  };
}

// ---------- time ----------

function advance(session, seconds) {
  session.clock += seconds;
  for (const rc of session.casualties.values()) runStages(session, rc);
  fireEvents(session);
}

function runStages(session, rc) {
  for (const st of rc.stages) {
    if (st.status !== 'pending' || st.dueAt == null || st.dueAt > session.clock) continue;
    const prevented = (st.def.unless ?? []).some((id) => doneAt(rc, id, st.dueAt));
    if (prevented) { st.status = 'prevented'; continue; }
    applyStage(session, rc, st);
  }
}

function applyStage(session, rc, st) {
  const d = st.def;
  st.status = 'applied';
  st.appliedAt = session.clock;
  if (d.state) {
    const rolled = rollState(d.state, makeRng(`${session.seed}|${rc.id}|${d.id}`));
    rc.state = mergeState(rc.state, rolled);
    if (d.state.breathing === false) rc.flags.airwayOpened = false;
  }
  if (d.pose) rc.pose = d.pose;
  for (const id of d.removeAppearance ?? []) rc.appearance = rc.appearance.filter((a) => a.overlay !== id);
  for (const a of d.appearance ?? []) {
    const single = ['eyes', 'expression', 'speech', 'motion', 'mobility_aid'].includes(a.overlay);
    const i = rc.appearance.findIndex((x) => x.overlay === a.overlay && (single || x.region === a.region));
    if (i >= 0) rc.appearance[i] = a; else rc.appearance.push(a);
  }
  const gone = new Set(d.removeFindings ?? []);
  rc.findings = rc.findings.filter((f) => !gone.has(f.id));
  for (const f of d.addFindings ?? []) {
    rc.findings.push(f);
    if (f.visible && rc.visitedAt != null) addCard(session, rc, f.cardField, f.label);
  }
  rc.changedSince = session.clock;
  if (rc.visitedAt != null && (d.pose || d.appearance?.length || d.addFindings?.some((f) => f.visible))) {
    session.messages.push({ t: session.clock, casualty: rc.id, text: `${displayName(session, rc.id)} looks different.` });
  }
}

function fireEvents(session) {
  for (const ev of session.events) {
    const e = ev.def;
    if (!ev.fired && e.atSeconds <= session.clock) {
      ev.fired = true;
      ev.firedAt = session.clock;
      // The deadline runs from when the player sees the alert (the end of the action in progress).
      if (e.deadlineSeconds != null) ev.deadlineAt = session.clock + e.deadlineSeconds;
      const hz = e.hazard && session.hazards.find((h) => h.id === e.hazard);
      if (hz && ['hazard_appears', 'aftershock'].includes(e.type)) { hz.active = true; hz.acute = true; }
      if (session.qte && e.qte !== false && ['aftershock', 'hazard_appears', 'signal'].includes(e.type) && expectedResponses(e).length) {
        // Quick-time: play stops until the player answers. The cue is what you sense, never the answer.
        ev.deadlineAt = null;
        if (!session.prompt) session.prompt = makePrompt(session, ev, 0);
        else (session.queuedPrompts ??= []).push(ev);
      } else {
        session.messages.push({ t: session.clock, event: e.id, type: e.type, text: e.description ?? e.cue ?? e.type, urgent: !!expectedResponses(e).length });
      }
    }
    if (ev.fired && !ev.resolved && !ev.missed && ev.progress === 0 && ev.startedAt == null && ev.deadlineAt != null && session.clock > ev.deadlineAt && expectedResponses(e).length) {
      ev.missed = true;
      session.messages.push({ t: session.clock, event: e.id, type: 'missed', text: `Too slow: ${e.description ?? 'the hazard'} needed ${expectedResponses(e).join(' then ')}.`, urgent: true });
    }
  }
}

const expectedResponses = (e) => [e.correctResponse ?? []].flat().filter((r) => r && r !== 'ignore');

function makePrompt(session, ev, step) {
  const e = ev.def;
  const rng = makeRng(`${session.seed}|prompt|${e.id}|${step}`);
  const choices = [...QTE_CHOICES];
  for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
  const signal = e.type === 'signal' ? session.content.vocab.signals?.[e.signal] ?? null : null;
  return {
    eventId: e.id,
    step,
    cue: step === 0 ? (e.cue ?? e.description) : (e.followUpCue ?? 'What now?'),
    signal: signal ? { id: e.signal, pattern: signal.pattern, blasts: signal.blasts } : null,
    choices: choices.map((id) => ({ id, label: session.content.actions.get(id)?.label ?? id })),
    expected: expectedResponses(e)[step],
    limitSeconds: e.qteSeconds ?? QTE_SECONDS,
    at: session.clock,
  };
}

/**
 * Answer the current quick-time prompt. `seconds` is the real reaction time the UI
 * measured; pass actionId null when the time ran out. The chosen action then runs
 * like any other (it costs game time). Returns { ok, correct, fast, text, expected }.
 */
export function answerPrompt(session, actionId, seconds) {
  const p = session.prompt;
  if (!p) return { ok: false, text: 'Nothing to respond to.' };
  const ev = session.events.find((x) => x.def.id === p.eventId);
  const correct = actionId === p.expected;
  const fast = correct && seconds <= p.limitSeconds;
  session.qteResults.push({ eventId: p.eventId, step: p.step, expected: p.expected, answer: actionId, seconds, ok: correct, fast });
  session.prompt = null;
  let text;
  const want = session.content.actions.get(p.expected)?.label ?? p.expected;
  if (correct) {
    const r = perform(session, actionId);
    text = `${r.text}${fast ? '' : ` Right call, but it took you ${seconds.toFixed(1)} s.`}`;
    const next = expectedResponses(ev.def)[p.step + 1];
    if (next && !ev.resolved) session.prompt = makePrompt(session, ev, p.step + 1);
  } else {
    ev.missed = true;
    if (actionId && actionId !== 'keep_working') perform(session, actionId);
    text = actionId ? `Wrong call. You needed to: ${want}.` : `You froze. You needed to: ${want}.`;
    session.messages.push({ t: session.clock, event: p.eventId, type: 'missed', text, urgent: true });
  }
  if (!session.prompt && session.queuedPrompts?.length) session.prompt = makePrompt(session, session.queuedPrompts.shift(), 0);
  return { ok: true, correct, fast, text, expected: p.expected };
}

/** A response only has to start before the deadline: note the start before the action's time passes. */
function markResponseStart(session, actionId) {
  for (const ev of session.events) {
    if (!ev.fired || ev.resolved || ev.missed || ev.startedAt != null) continue;
    if (expectedResponses(ev.def)[0] === actionId) ev.startedAt = session.clock;
  }
}

/** Count an action towards open events. startedAt is when the action began. */
function noteResponse(session, actionId, startedAt) {
  for (const ev of session.events) {
    if (!ev.fired || ev.resolved) continue;
    const want = expectedResponses(ev.def);
    if (!want.length) continue;
    if (want[ev.progress] === actionId) {
      if (ev.progress === 0) {
        ev.startedAt ??= startedAt;
        if (ev.deadlineAt != null && ev.startedAt > ev.deadlineAt) ev.missed = true;
      }
      ev.progress++;
      if (ev.progress >= want.length) {
        ev.resolved = true;
        ev.resolvedAt = session.clock;
        const hz = ev.def.hazard && session.hazards.find((h) => h.id === ev.def.hazard);
        if (hz) hz.acute = false;
        if (hz && ['withdraw', 'make_safe', 'evacuate'].includes(actionId)) hz.active = false;
        if (ev.def.type === 'aftershock' && !ev.def.hazard && actionId === 'drop_cover_hold') {
          for (const h of session.hazards) if (h.active && h.type === 'aftershock') h.active = false;
        }
      }
    }
  }
}

// ---------- moving ----------

export function moveSeconds(from, to) {
  const d = Math.hypot(from[0] - to[0], from[1] - to[1]);
  return Math.round(3 + d * 0.25);
}

/** Walk to a casualty. The first visit fills the card with what you can see. */
export function approach(session, casualtyId) {
  const rc = session.casualties.get(casualtyId);
  if (!rc) throw new Error(`No casualty ${casualtyId}`);
  if (session.current === casualtyId) return { ok: true, seconds: 0, text: '' };
  if (session.prompt) return { ok: false, seconds: 0, text: 'Respond to what is happening first.' };
  const seconds = moveSeconds(session.position, rc.position);
  advance(session, seconds);
  session.position = rc.position;
  session.current = casualtyId;
  if (rc.visitedAt == null) {
    rc.visitedAt = session.clock;
    rc.atVisit = { state: structuredClone(rc.state), findings: structuredClone(rc.findings) };
    const brief = session.scene.briefing?.type;
    if (brief) addCard(session, rc, 'mechanism', `${brief} (briefing)`);
    for (const f of rc.findings) if (f.visible) addCard(session, rc, f.cardField, f.label);
  }
  session.log.push({ t: session.clock, casualty: casualtyId, action: 'approach', seconds, correct: true });
  return { ok: true, seconds, text: rc.def.approach };
}

/** Step back to the scene overview (no time cost; moving to the next casualty costs time). */
export function leave(session) {
  session.current = null;
}

// ---------- actions ----------

/** Actions for the panel: fixed core list, a few rotating traps, and everything else. */
export function availableActions(session) {
  const rc = session.current && session.casualties.get(session.current);
  const all = session.content.actionList;
  if (!rc) {
    return { core: SCENE_ACTIONS.map((id) => session.content.actions.get(id)).filter(Boolean), extras: [], more: [] };
  }
  const core = CORE_ACTIONS.map((id) => session.content.actions.get(id)).filter(Boolean);
  const pool = all.filter((a) => (a.group === 'trap' || a.group === 'silly'));
  const rng = makeRng(`${session.seed}|${rc.id}|extras|${rc.done.length}`);
  const extras = [];
  const copy = [...pool];
  while (extras.length < EXTRA_COUNT && copy.length) extras.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  const used = new Set([...CORE_ACTIONS, ...extras.map((a) => a.id)]);
  const more = all.filter((a) => !used.has(a.id) && a.id !== 'move_on' && !a.qteOnly);
  return { core, extras, more };
}

const SCOPE_SCENE = new Set(['scene']);

/**
 * Do an action. Scene actions work without a current casualty; others need one.
 * opts.category is required for tag_casualty.
 * Returns { ok, text, correct, feedback, seconds }.
 */
export function perform(session, actionId, opts = {}) {
  const a = session.content.actions.get(actionId);
  if (!a) throw new Error(`Unknown action ${actionId}`);
  const rc = session.current && session.casualties.get(session.current);
  const sceneLevel = SCOPE_SCENE.has(a.group) || a.effect.scope === 'scene' || ['radio_methane', 'call_for_help'].includes(a.id);
  if (session.prompt) return { ok: false, text: 'Respond to what is happening first.', correct: true, seconds: 0 };
  if (!rc && !sceneLevel) return { ok: false, text: 'Go to a casualty first.', correct: true, seconds: 0 };
  if (a.effect.type === 'tag' && !opts.category) return { ok: false, text: 'Choose a category.', correct: true, seconds: 0 };
  if (a.qteOnly) return { ok: false, text: 'Not now.', correct: true, seconds: 0 };

  // Judge the action against the situation before it happens.
  const correct = rc ? evalCond(a.correctWhen, condContext(session, rc, a.id)) : evalCond(a.correctWhen, sceneContext(session));
  const seconds = a.timeCostSeconds ?? 0;
  markResponseStart(session, a.id);
  // The action finishes at the new clock time; record it first so a stage due at
  // exactly that moment counts it, then run stages and events, then the effect.
  session.clock += seconds;
  const t = session.clock;
  if (rc) rc.done.push({ id: a.id, t, ok: true });
  if (sceneLevel) session.sceneDone.push({ id: a.id, t });
  for (const r of session.casualties.values()) runStages(session, r);
  fireEvents(session);

  // Hands on without checking for danger first: note it, and meet any local hazard.
  let injury = null;
  if (rc && isHandsOn(a) && needsDangerCheck(session, rc) && !rc.dangerChecked) {
    rc.dangerSkipped = true;
    if (rc.localHazard && !rc.hazardMet) {
      rc.hazardMet = true;
      const lost = rc.localHazard.timeLostSeconds ?? 30;
      session.clock += lost;
      injury = `${rc.localHazard.injury} (${lost} s lost)`;
      session.messages.push({ t: session.clock, casualty: rc.id, type: 'injury', text: rc.localHazard.injury, urgent: true });
      for (const r of session.casualties.values()) runStages(session, r);
      fireEvents(session);
    }
  }

  let result;
  if (rc && !sceneLevel) {
    result = applyEffect(session, rc, a, opts);
    if (!result.ok) rc.done.at(-1).ok = false;
    else if (!rc.drawn.includes(a.id) && drawsSomething(a)) rc.drawn.push(a.id);
    scheduleActionStages(session, rc, a.id);
  } else {
    result = applySceneEffect(session, a, rc);
  }
  noteResponse(session, a.id, t - seconds);
  for (const r of session.casualties.values()) runStages(session, r);
  if (injury) result = { ...result, text: `${injury} ${result.text}` };

  const entry = { t, casualty: rc?.id ?? null, action: a.id, seconds, correct, feedback: correct ? null : a.feedbackWrong ?? null, text: result.text, injury: !!injury };
  session.log.push(entry);
  return { ...result, correct, feedback: entry.feedback, seconds };
}

/** Does this casualty need a danger check before hands-on care? Walkers who came to you don't. */
export function needsDangerCheck(session, rc) {
  return session.scene.safety?.dangerCheckEachCasualty !== false && !rc.cameToYou;
}

function sceneContext(session) {
  return { hazardActive: hazardActive(session), bystanderPresent: bystanderPresent(session), phase: 'sieve', done: Object.fromEntries(session.sceneDone.map((d) => [d.id, true])) };
}

const drawsSomething = (a) => ['reveal_state', 'reveal_findings', 'intervene', 'set_pose', 'tag'].includes(a.effect.type);

function scheduleActionStages(session, rc, actionId) {
  for (const st of rc.stages) {
    if (st.status === 'pending' && st.def.afterAction === actionId && st.dueAt == null) st.dueAt = session.clock + (st.def.delaySeconds ?? 0);
  }
}

function applySceneEffect(session, a, rc) {
  const e = a.effect;
  if (e.type === 'reveal_state' && e.fields?.includes('canWalk')) {
    const walkers = [];
    for (const r of session.casualties.values()) {
      if (!r.done.some((d) => d.id === a.id)) r.done.push({ id: a.id, t: session.clock, ok: true });
      observe(session, r, 'canWalk', r.state.canWalk === true);
      if (r.state.canWalk) {
        walkers.push(r);
        r.cameToYou = true;
        if (!r.drawn.includes(a.id)) r.drawn.push(a.id);
        // They come to you: tagging them is now a short step away.
        r.position = [Math.min(100, session.position[0] + 4 + walkers.length * 3), Math.max(0, session.position[1] - 4)];
        if (r.visitedAt == null) {
          r.visitedAt = session.clock;
          r.atVisit = { state: structuredClone(r.state), findings: structuredClone(r.findings) };
          for (const f of r.findings) if (f.visible) addCard(session, r, f.cardField, f.label);
        }
        addCard(session, r, 'signs', 'Walking: yes');
      }
    }
    return { ok: true, text: walkers.length ? `${walkers.length === 1 ? '1 person gets up and makes' : `${walkers.length} people get up and make`} their way to you: ${walkers.map((r) => displayName(session, r.id)).join(', ')}.` : 'Nobody moves towards you.' };
  }
  switch (e.do) {
    case 'check_danger': {
      const act = session.hazards.filter((h) => h.active);
      const parts = act.map((h) => session.content.vocab.hazards[h.type]?.description ?? h.type);
      if (rc) {
        rc.dangerChecked = true;
        if (rc.localHazard && !rc.hazardMet) { rc.hazardFound = true; parts.push(rc.localHazard.found); }
        else if (!act.length) parts.push('No immediate danger around this casualty.');
      }
      return { ok: true, text: parts.length ? parts.join(' ') : 'No immediate danger that you can see.' };
    }
    case 'withdraw': return { ok: true, text: hazardActive(session) ? 'You leave the danger zone and move to a safe distance.' : 'You step back to a safe distance. Nothing needed it this time, but better safe.' };
    case 'drop_cover_hold': return { ok: true, text: 'You drop, cover and hold until the shaking stops.' };
    case 'make_safe': {
      const fixable = session.hazards.filter((h) => h.active && session.content.vocab.hazards[h.type]?.defaultResponse === 'make_safe');
      for (const h of fixable) { h.active = false; h.acute = false; }
      return { ok: true, text: fixable.length ? 'Cones out, hazard lights on and a lookout posted: traffic now passes slowly and wide.' : 'You make the area as safe as you can.' };
    }
    case 'evacuate': return { ok: true, text: 'You leave by the safe route and report to the assembly point.' };
    case 'stop_and_listen': return { ok: true, text: 'You stop work and stay quiet while the team listens.' };
    case 'resume_work': return { ok: true, text: 'Back to work.' };
    case 'keep_working': return { ok: true, text: 'You keep working.' };
    case 'radio_methane': return { ok: true, text: 'METHANE report sent to control.' };
    case 'call_for_help': return { ok: true, text: 'You call for more help.' };
    case 'don_gloves': return { ok: true, text: 'Gloves on.' };
    case 'move_on': session.current = null; return { ok: true, text: 'You move on.' };
    case 'reassure': return { ok: true, text: rc?.state.canTalk ? 'They calm a little.' : 'There is no response.' };
    case 'flag_for_medical':
      if (rc) addCard(session, rc, 'other', fill(session, rc, a.effect.card?.template ?? 'Flagged for medical'));
      return { ok: true, text: 'Flagged: medical support needed before release.' };
    case 'move_casualty':
      return { ok: true, text: 'You drag them to a safer spot.' };
    default: return { ok: true, text: 'Done.' };
  }
}

function observe(session, rc, field, value) {
  rc.observed[field] = { value, t: session.clock };
}

function applyEffect(session, rc, a, opts) {
  const e = a.effect;
  const st = rc.state;
  switch (e.type) {
    case 'reveal_state': {
      const parts = [];
      for (const field of e.fields) {
        if (field === 'breathing' || field === 'rr' || field === 'breathingDepth') continue;
        if (field === 'painResponseAppropriate' && st.responsive !== 'pain') continue;
        observe(session, rc, field, structuredClone(st[field]));
      }
      if (e.fields.includes('breathing')) {
        const b = effectiveBreathing(rc);
        observe(session, rc, 'breathing', b);
        observe(session, rc, 'rr', b ? st.rr : 0);
        observe(session, rc, 'breathingDepth', b ? st.breathingDepth : 'none');
      }
      for (const field of e.fields) parts.push(describeObservation(rc, field));
      if (e.card) addCard(session, rc, e.card.field, fill(session, rc, e.card.template));
      if (e.fields.includes('canWalk') && !st.canWalk) parts.splice(0, parts.length, entrappedOr(rc, 'They try, but cannot get up.'));
      const text = parts.filter(Boolean).join(' ');
      const repeat = rc.done.filter((d) => d.id === a.id).length > 1 && rc.changedSince < (rc.done.filter((d) => d.id === a.id).at(-2)?.t ?? 0);
      return { ok: true, text: repeat ? `${text} (No change since you last checked.)` : text };
    }
    case 'reveal_findings': {
      const found = rc.findings.filter((f) => !f.visible && !rc.revealed.has(f.id) && (e.all || f.revealedBy === a.id)
        && !(underDebris(rc, f) && !e.all));
      for (const f of found) { rc.revealed.add(f.id); addCard(session, rc, f.cardField, f.label); }
      return { ok: true, text: found.length ? `You find: ${found.map((f) => f.label).join('; ')}.` : 'You find nothing new.' };
    }
    case 'scene': return applySceneEffect(session, a, rc);
    case 'ask': return ask(session, rc, a);
    case 'intervene': return intervene(session, rc, a);
    case 'set_pose': {
      if (st.entrapped) return { ok: false, text: 'Not possible while they are trapped.' };
      rc.pose = e.pose;
      if (e.card) addCard(session, rc, e.card.field, fill(session, rc, e.card.template));
      return { ok: true, text: 'They are now in the recovery position.' };
    }
    case 'tag': {
      const truth = triage(session.content.rules, rc.ageGroup, rc.state);
      rc.tag = { category: opts.category, t: session.clock, truth, state: structuredClone(rc.state), findings: structuredClone(rc.findings) };
      const cat = session.content.categories.get(opts.category);
      return { ok: true, text: `Tagged ${cat?.label ?? opts.category} (${opts.category}).` };
    }
    case 'waste': return { ok: true, text: wasteText(a) };
    default: return { ok: true, text: 'Done.' };
  }
}

function wasteText(a) {
  if (a.id === 'start_cpr') return 'You start CPR. Two minutes pass.';
  if (a.id === 'give_water') return 'You give them a drink.';
  return `${a.label}: done.`;
}

const entrappedOr = (rc, text) => (rc.state.entrapped ? 'They cannot move: they are trapped.' : text);

function underDebris(rc, f) {
  if (!rc.state.entrapped) return false;
  const covered = new Set(rc.findings.filter((x) => x.overlay === 'entrapment').flatMap((x) => x.regions ?? []));
  return covered.has(f.region);
}

function describeObservation(rc, field) {
  const o = rc.observed[field]?.value;
  switch (field) {
    case 'canWalk': return o ? 'They get up and make their own way to you.' : '';
    case 'responsive': return { alert: 'Alert: they answer you.', voice: 'They respond to your voice.', pain: 'They respond only to pain.', unresponsive: 'No response to voice or pain.' }[o] ?? '';
    case 'painResponseAppropriate': return o === false ? 'The response to pain looks abnormal.' : o === true ? 'They pull away from the pain.' : '';
    case 'breathing': return rc.observed.breathing?.value ? `Breathing, ${rc.observed.rr.value} breaths a minute, ${rc.observed.breathingDepth.value}.` : 'Not breathing.';
    case 'radialPulse': return o?.present ? `Radial pulse ${o.rate} a minute.` : 'No radial pulse.';
    case 'crtSeconds': return `Capillary refill ${o} s.`;
    case 'obeysCommands': return o ? 'They squeeze your hand.' : 'They do not follow the command.';
    default: return '';
  }
}

function ask(session, rc, a) {
  const st = rc.state;
  const info = a.effect.info;
  const id = rc.def.identity ?? {};
  const h = rc.def.history ?? {};
  const fromBystander = h.source === 'bystander' || id.source === 'bystander';
  const canAnswer = a.effect.requires === 'none' ? id.source === 'id_card' : st.canTalk || (fromBystander && (session.scene.bystanders ?? []).length > 0);
  if (!canAnswer) {
    if (info === 'identity') addCard(session, rc, 'identification', 'Unknown');
    return { ok: false, text: a.id === 'search_for_id' ? 'No ID found.' : 'No answer.' };
  }
  const who = st.canTalk ? '' : ' (from a bystander)';
  const lines = [];
  if (info === 'identity' || info === 'all') {
    const t = `${id.name ?? 'Unknown'}, ${id.age ?? '?'}, ${id.sex ?? 'unknown'}${who}`;
    addCard(session, rc, 'identification', t);
    lines.push(t);
  }
  if (info === 'mechanism' || info === 'all') { addCard(session, rc, 'mechanism', h.mechanism + who); lines.push(h.mechanism); }
  if (info === 'amb' || info === 'all') {
    for (const k of ['allergies', 'medications', 'background']) if (h[k]) { addCard(session, rc, k, h[k]); lines.push(`${k[0].toUpperCase() + k.slice(1)}: ${h[k]}`); }
  }
  return { ok: true, text: lines.join(' ') || 'No answer.' };
}

function intervene(session, rc, a) {
  const e = a.effect;
  const st = rc.state;
  if (e.target) {
    const visible = rc.findings.filter((f) => f.visible || rc.revealed.has(f.id));
    const m = /^(minor|major|catastrophic)_bleed$/.exec(e.target);
    const target = visible.find((f) => f.lifeThreat === e.target || (m && f.overlay === 'bleed' && f.params?.severity === m[1]) || f.overlay === e.target)
      ?? (e.target === 'catastrophic_bleed' ? visible.find((f) => f.overlay === 'bleed') : null);
    if (!target) return { ok: false, text: 'There is nothing you can see to treat with that.' };
    if (underDebris(rc, target)) return { ok: false, text: 'You cannot reach it under the debris.' };
    if (a.id === 'apply_tourniquet' && !session.content.vocab.regionGroups.tourniquet_sites.includes(target.region)) {
      return { ok: false, text: `A tourniquet will not fit above a wound on the ${regionText(target.region)}.` };
    }
    if (e.card) addCard(session, rc, e.card.field, fill(session, rc, e.card.template, { region: target.region }));
    return { ok: true, text: `${a.label}: ${regionText(target.region)}.` };
  }
  if (e.sets?.entrapped === false && !st.entrapped) return { ok: false, text: 'They are not trapped.' };
  for (const [k, v] of Object.entries(e.sets ?? {})) {
    if (k === 'entrapped') st.entrapped = v;
    else rc.flags[k] = v;
  }
  if (e.card) addCard(session, rc, e.card.field, fill(session, rc, e.card.template));
  if (a.id === 'open_airway') return { ok: true, text: 'You tilt the head and lift the chin. Check breathing again.' };
  if (a.id === 'rescue_breaths') return { ok: true, text: 'You give 5 rescue breaths. Check breathing again.' };
  if (a.id === 'release_from_entrapment') return { ok: true, text: 'You lift the debris off and pull them free.' };
  return { ok: true, text: `${a.label}: done.` };
}

// ---------- card ----------

/**
 * How the player knows a casualty: their name once learned, otherwise "Casualty N".
 * Never the internal title, which describes the diagnosis.
 */
export function displayName(session, casualtyId) {
  const rc = session.casualties.get(casualtyId);
  const n = rc?.def.identity?.name;
  return n && rc.observedName ? n : `Casualty ${session.order.indexOf(casualtyId) + 1}`;
}

/** State of a scene event, for banners: { fired, resolved, missed, deadlineAt, progress, needed }. */
export function eventStatus(session, eventId) {
  const ev = session.events.find((e) => e.def.id === eventId);
  if (!ev) return null;
  return { fired: ev.fired, resolved: ev.resolved, missed: ev.missed, deadlineAt: ev.deadlineAt ?? null, progress: ev.progress, needed: expectedResponses(ev.def) };
}

function fill(session, rc, template, extra = {}) {
  const o = (k) => rc.observed[k]?.value;
  const p = o('radialPulse');
  const values = {
    time: clockText(session),
    region: regionText(extra.region),
    breathingText: o('breathing') ? `RR ${o('rr')}` : 'Not breathing',
    pulseText: p?.present ? `${p.rate}` : 'absent',
    crtSeconds: o('crtSeconds'),
    obeysCommands: yesNo(o('obeysCommands')),
    responsive: o('responsive'),
    canWalk: yesNo(o('canWalk')),
  };
  return template.replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? '').toString()).replace(/\s+/g, ' ').trim();
}

function addCard(session, rc, field, text) {
  if (!field || !text) return;
  if (field === 'identification' && text !== 'Unknown') rc.observedName = true;
  const last = rc.cardEntries.filter((c) => c.field === field).at(-1);
  if (last && last.text === text) return;
  rc.cardEntries.push({ field, text, t: session.clock });
}

/** The IMISTAMBO card: every field with its entries; later-phase fields are greyed during the sieve. */
export function card(session, casualtyId) {
  const rc = session.casualties.get(casualtyId);
  return CARD_FIELDS.map((f) => ({
    ...f,
    entries: rc.cardEntries.filter((c) => c.field === f.id),
    greyed: !!f.laterPhase && !rc.tag,
  }));
}

// ---------- picture ----------

/** What the player has observed, layered over the true state, for the renderer's probes. */
function observedState(rc) {
  const s = { ...rc.state, breathesAfterAirwayOpen: null, breathesAfterRescueBreaths: null };
  for (const [k, v] of Object.entries(rc.observed)) s[k] = v.value;
  if (rc.observed.breathing == null) s.breathing = effectiveBreathing(rc);
  return s;
}

/**
 * Casualty + view for renderCasualty. mode 'play' shows only what the player knows;
 * 'debrief' shows everything at the moment of tagging (or now, if untagged).
 */
export function snapshot(session, casualtyId, mode = 'play') {
  const rc = session.casualties.get(casualtyId);
  const times = {};
  for (const d of rc.done) times[d.id] = clockText(session, d.t);
  const base = { ...rc.def, deterioration: [] };
  if (mode === 'debrief') {
    const st = rc.tag?.state ?? rc.state;
    const probes = ['check_breathing', 'check_radial_pulse', 'check_crt', 'give_command'];
    const truthState = { ...st, breathing: st.breathing || st.breathesAfterAirwayOpen === true || st.breathesAfterRescueBreaths === true, breathesAfterAirwayOpen: null, breathesAfterRescueBreaths: null };
    return {
      casualty: { ...base, pose: rc.pose, appearance: rc.appearance, findings: rc.tag?.findings ?? rc.findings, state: truthState },
      view: { done: [...new Set([...rc.drawn.filter((id) => id !== 'tag_casualty'), ...probes])], revealed: 'all', tag: rc.tag?.category ?? null, state: truthState, times, callouts: 'none' },
    };
  }
  const state = observedState(rc);
  return {
    casualty: { ...base, pose: rc.pose, appearance: rc.appearance, findings: rc.findings, state },
    view: { done: rc.drawn.filter((id) => id !== 'tag_casualty' || rc.tag), revealed: [...rc.revealed], tag: rc.tag?.category ?? null, state, times },
  };
}

// ---------- safety ----------

/** Expected scene safety actions not done yet (scene.safety.expected). */
export function pendingSafety(session) {
  const doneIds = new Set(session.sceneDone.map((d) => d.id));
  return (session.scene.safety?.expected ?? []).filter((x) => !doneIds.has(x.action));
}

function safetyResults(session) {
  const firstApproach = session.log.find((l) => l.action === 'approach')?.t ?? Infinity;
  return (session.scene.safety?.expected ?? []).map((x) => {
    const when = session.sceneDone.find((d) => d.id === x.action)?.t;
    const limit = x.by === 'first_casualty' ? firstApproach : typeof x.by === 'number' ? x.by : Infinity;
    // A scene action done before the first approach finishes before it, so compare start times.
    const a = session.content.actions.get(x.action);
    const started = when == null ? null : when - (a?.timeCostSeconds ?? 0);
    return { ...x, ok: started != null && started <= limit, at: when ?? null };
  });
}

// ---------- hints ----------

/** A Learn-mode nudge based on what is visible and what has been checked. */
export function hint(session) {
  const rc = session.current && session.casualties.get(session.current);
  if (!rc) {
    const pending = pendingSafety(session).filter((x) => x.by === 'first_casualty');
    if (pending.length) return pending[0].hint ?? 'Make sure the scene is safe before you go in.';
    return 'Pick a casualty, or call out for anyone who can walk.';
  }
  const has = (id) => rc.done.some((d) => d.id === id);
  if (needsDangerCheck(session, rc) && !rc.dangerChecked) return 'Check for danger before you kneel down.';
  const seenCat = rc.findings.some((f) => f.lifeThreat === 'catastrophic_bleed' && (f.visible || rc.revealed.has(f.id)));
  if (seenCat && !['apply_tourniquet', 'direct_pressure', 'pack_wound', 'instruct_bystander_pressure'].some(has)) return 'Catastrophic bleeding comes first.';
  if (!has('ask_to_walk') && !has('call_walking_wounded') && rc.observed.responsive?.value !== 'unresponsive') return 'Can they make their own way to you?';
  if (!has('check_breathing')) return 'Check breathing and count the rate.';
  if (rc.observed.breathing?.value === false && !rc.flags.airwayOpened) return 'Not breathing: open the airway once, then check again.';
  if (rc.observed.breathing?.value === false && rc.ageGroup === 'child' && !has('check_radial_pulse')) return 'Child still not breathing: is there a pulse?';
  if (rc.observed.breathing?.value === false && rc.ageGroup === 'child' && rc.observed.radialPulse?.value?.present && !has('rescue_breaths')) return 'Child with a pulse but not breathing: give 5 rescue breaths.';
  if (rc.observed.breathing?.value === false) return 'Still not breathing after the airway was opened. What does the sieve say?';
  if (!has('check_radial_pulse') && !has('check_crt')) return 'Check circulation: radial pulse or capillary refill.';
  if (!has('give_command') && rc.ageGroup !== 'child') return 'Can they follow a simple command?';
  if (rc.ageGroup === 'child' && !has('check_response')) return 'Check how they respond (AVPU).';
  const breathingNow = rc.observed.breathing?.value === true;
  const notResponding = rc.observed.obeysCommands?.value === false || ['pain', 'unresponsive'].includes(rc.observed.responsive?.value);
  if (breathingNow && notResponding && !rc.state.entrapped && rc.pose !== 'recovery') return 'Breathing but not responding: protect the airway before you move on.';
  if (rc.state.entrapped && !has('flag_for_medical')) return 'Trapped: make sure medical support is lined up before anyone frees them.';
  if (!rc.tag) return 'You have what you need. Tag them and move on.';
  return 'Tagged. Move on to the next casualty.';
}

// ---------- ideal run ----------

/** Why each sieve check is in the ideal run (the deciding sieve question goes on the tag step). */
const CHECK_WHY = {
  check_breathing: 'Breathing? Count the rate for the full check.',
  open_airway: 'Not breathing: open the airway once, then look again.',
  check_radial_pulse: 'Circulation: is there a radial pulse?',
  check_crt: 'Circulation: capillary refill.',
  give_command: 'Can they follow a simple command?',
  check_response: 'How do they respond to voice and pain?',
  rescue_breaths: 'A child with a pulse but not breathing gets 5 rescue breaths.',
};

const IDEAL_WHY = {
  recovery_position: 'Breathing but not responding: protect the airway.',
  open_airway: 'Opening the airway is what keeps them breathing.',
  rescue_breaths: 'A child with a pulse but not breathing gets 5 rescue breaths.',
  flag_for_medical: 'Trapped: line up medical support before anyone frees them.',
  give_oral_glucose: 'Low blood sugar but still able to swallow: sugar now.',
  help_use_inhaler: 'Their own reliever inhaler is the quickest help.',
  self_pressure: 'Have them press on their own bleeding while you carry on.',
};

/**
 * The shortest correct sequence for one casualty, from the state they were in when first reached:
 * danger check, catastrophic bleed control, the sieve checks in rule order, life-saving and key
 * actions, then the tag. Each step says why and whether the player did it before tagging.
 */
export function idealRun(session, rc) {
  const { rules, actions, categories } = session.content;
  const st = rc.atVisit?.state ?? rc.state;
  const findings = rc.atVisit?.findings ?? rc.findings;
  const truth = triage(rules, rc.ageGroup, st);
  const exp = rc.def.expected ?? {};
  const steps = [];
  const add = (id, why, { again = false, seconds } = {}) => {
    if (!id || (!again && steps.some((x) => x.id === id))) return;
    const a = actions.get(id);
    steps.push({ id, label: a?.label ?? id, seconds: seconds ?? a?.timeCostSeconds ?? 0, why });
  };

  const lsi = exp.lifeSavingInterventions ?? [];
  // Interventions aimed at a finding need it in view: expose first when it is hidden.
  const treat = (id, why) => {
    const target = actions.get(id)?.effect?.target;
    if (target) {
      const m = /^(minor|major|catastrophic)_bleed$/.exec(target);
      const hit = findings.find((f) => f.lifeThreat === target || f.overlay === target || (m && f.overlay === 'bleed' && f.params?.severity === m[1]));
      if (hit && !hit.visible) add('expose_check_bleeding', 'It is hidden under clothing: expose to find it.');
    }
    add(id, why);
  };
  const cat = findings.find((f) => f.lifeThreat === 'catastrophic_bleed');
  if (rc.cameToYou) {
    add('call_walking_wounded', 'They answered the call-out and walked to you.', { seconds: 0 });
    if (lsi[0]) treat(lsi[0], IDEAL_WHY[lsi[0]] ?? 'Life-saving for this casualty.');
    for (const k of exp.keyActions ?? []) treat(k, IDEAL_WHY[k] ?? 'Needed for this casualty.');
  } else {
    if (needsDangerCheck(session, rc)) add('check_danger', 'Check for danger before you kneel down.');
    if (cat) treat(lsi[0], 'Catastrophic bleeding comes first.');
    const canBeAsked = ['alert', 'voice'].includes(st.responsive) && st.obeysCommands && !st.entrapped;
    if (canBeAsked && truth.step !== 'catastrophic_bleed') add('ask_to_walk', st.canWalk ? 'Can they walk? Yes, so they are green.' : 'Can they walk? No, so carry on with the sieve.');
    for (const step of rules.sieves[rc.ageGroup].steps) {
      const deciding = step.id === truth.step;
      for (const c of deciding ? step.checks : (step.ruleOutChecks ?? step.checks)) {
        const id = Array.isArray(c) ? c[0] : c;
        if (id === 'ask_to_walk' || id === 'call_walking_wounded') continue; // handled above
        add(id, CHECK_WHY[id] ?? step.question);
        if ((id === 'open_airway' || id === 'rescue_breaths') && st.breathing === false) add('check_breathing', 'Look, listen and feel again.', { again: true });
      }
      if (deciding) break;
    }
    if (!cat && lsi[0]) treat(lsi[0], IDEAL_WHY[lsi[0]] ?? 'Life-saving for this casualty.');
    for (const k of exp.keyActions ?? []) treat(k, IDEAL_WHY[k] ?? 'Needed for this casualty.');
  }
  const category = categories.get(truth.category);
  const decider = rules.sieves[rc.ageGroup].steps.find((x) => x.id === truth.step);
  const decided = truth.step === 'otherwise' ? 'none of the sieve questions apply.' : decider?.question ?? '';
  add('tag_casualty', `Tag ${category?.label ?? truth.category} (${truth.category}): ${decided}`.trim());

  // Done: the player did this action (that many times, for repeats) before tagging.
  const cutoff = rc.tag?.t ?? session.clock;
  const seen = {};
  for (const x of steps) {
    seen[x.id] = (seen[x.id] ?? 0) + 1;
    const times = x.id === 'call_walking_wounded' ? (rc.cameToYou ? 1 : 0) : rc.done.filter((d) => d.id === x.id && d.ok !== false && d.t <= cutoff).length;
    x.done = times >= seen[x.id];
  }
  const yours = session.log.filter((l) => l.casualty === rc.id && l.action !== 'approach' && l.t <= cutoff).reduce((sum, l) => sum + (l.seconds ?? 0), 0);
  return { steps, seconds: steps.reduce((sum, x) => sum + x.seconds, 0), yours, category: truth.category };
}

// ---------- debrief ----------

const maxOf = (row) => Math.max(...Object.values(row));

export function debrief(session) {
  session.ended = true;
  const { rules, actions } = session.content;
  const sc = rules.scoring;
  const items = [];
  let penalty = 0;
  const add = (points, text, casualty = null, kind = 'mistake') => { penalty += points; items.push({ points, text, casualty, kind }); };
  const credits = [];
  const credit = (text, kind = 'safety') => credits.push({ text, kind });
  const w = (k, d) => sc[k] ?? d;

  const casualties = session.order.map((id) => {
    const rc = session.casualties.get(id);
    const exp = rc.def.expected ?? {};
    const truth = rc.tag?.truth ?? triage(rules, rc.ageGroup, rc.state);
    const cutoff = rc.tag?.t ?? session.clock;
    const assigned = rc.tag?.category ?? null;
    const name = rc.def.identity?.name ?? rc.def.title;
    const out = { id, name, title: rc.def.title, correct: truth.category, step: truth.step, assigned, mistakes: [], teaching: rc.def.teaching ?? [] };
    const stepDef = rules.sieves[rc.ageGroup].steps.find((s) => s.id === truth.step);
    out.reason = stepDef?.question ?? '';
    const mark = (points, text) => { out.mistakes.push(text); add(points, text, id); };

    if (!assigned) mark(maxOf(sc.triagePenalty[truth.category]), `Not tagged (should be ${truth.category}).`);
    else if (assigned !== truth.category) {
      const pa = session.content.categories.get(assigned).priority, pc = session.content.categories.get(truth.category).priority;
      const under = truth.category === 'black' ? false : assigned === 'black' || pa > pc;
      out.verdict = under ? 'under' : 'over';
      mark(sc.triagePenalty[truth.category][assigned], `Tagged ${assigned}, correct was ${truth.category} (${under ? 'under' : 'over'}-triage).`);
    } else out.verdict = 'correct';

    const doneBefore = (aid) => doneAt(rc, aid, cutoff);
    const lsi = exp.lifeSavingInterventions ?? [];
    if (lsi.length && rc.def.state && triage(rules, rc.ageGroup, rollState(rc.def.state, () => 0.5)).category !== 'black' && !lsi.some(doneBefore)) {
      mark(sc.missedLifeSavingIntervention, `Missed life-saving intervention: ${lsi.map((x) => actions.get(x)?.label ?? x).join(' or ')}.`);
    }
    for (const k of exp.keyActions ?? []) if (!doneBefore(k)) mark(w('missedKeyAction', 3), `Missed: ${actions.get(k)?.label ?? k}.`);
    if (rc.visitedAt != null && needsDangerCheck(session, rc)) {
      if (rc.hazardMet) mark(w('rescuerInjured', 10), `Hurt yourself: ${rc.localHazard.injury}`);
      else if (rc.dangerSkipped) mark(w('skippedDangerCheck', 2), 'Went hands-on without checking for danger first.');
      if (rc.hazardFound) credit(`Checked for danger at ${displayName(session, id)}: ${rc.localHazard.found}`);
    }
    if (assigned) {
      for (const chk of requiredChecks(rules, rc.ageGroup, truth.step)) {
        const opts = [chk].flat();
        if (!opts.some(doneBefore)) mark(w('skippedCheck', 2), `Tagged without: ${opts.map((x) => actions.get(x)?.label ?? x).join(' or ')}.`);
      }
    }
    // Deteriorated after the (last) tag and never re-triaged.
    if (assigned && out.verdict === 'correct') {
      const now = triage(rules, rc.ageGroup, rc.state);
      const pNow = session.content.categories.get(now.category).priority, pTag = session.content.categories.get(assigned).priority;
      if (now.category !== 'black' && pNow < pTag) {
        out.deteriorated = now.category;
        mark(w('missedRetriage', 3), `Deteriorated to ${now.category} after you tagged ${assigned}; a re-triage would have caught it.`);
      }
    }
    out.ideal = idealRun(session, rc);
    out.missedFindings = rc.findings.filter((f) => !f.visible && !rc.revealed.has(f.id) && f.overlay !== 'entrapment').map((f) => f.label);
    out.stages = rc.stages.map((st) => ({ id: st.def.id, note: st.def.note, status: st.status, at: st.appliedAt }));
    return out;
  });

  const wrong = session.log.filter((l) => l.correct === false && !actions.get(l.action)?.safety);
  for (const l of wrong) {
    const a = actions.get(l.action);
    add(a.group === 'silly' ? w('sillyAction', 2) : w('wrongAction', 1), `${a.label}: ${l.feedback ?? 'not needed here.'}`, l.casualty, 'action');
  }
  const qteByEvent = new Map();
  for (const q of session.qteResults) (qteByEvent.get(q.eventId) ?? qteByEvent.set(q.eventId, []).get(q.eventId)).push(q);
  for (const ev of session.events) {
    const qs = qteByEvent.get(ev.def.id) ?? [];
    const needed = expectedResponses(ev.def).map((x) => actions.get(x)?.label ?? x).join(', then ');
    const what = ev.def.cue ?? ev.def.description;
    if (qs.length) {
      const bad = qs.find((q) => !q.ok);
      if (bad) add(w('qteWrong', 15), `${what} ${bad.answer ? `You chose "${actions.get(bad.answer)?.label ?? bad.answer}"` : 'You froze'}; you needed to: ${needed}.`, null, 'danger');
      else {
        const slow = qs.filter((q) => !q.fast);
        if (slow.length) add(w('qteSlow', 3), `${what} Right response, but slow (${slow.map((q) => `${q.seconds.toFixed(1)} s`).join(', ')}; aim for under ${QTE_SECONDS} s).`, null, 'danger');
        else credit(`${what} You responded correctly in ${qs.map((q) => `${q.seconds.toFixed(1)} s`).join(' and ')}.`, 'reaction');
      }
      continue;
    }
    if (ev.resolved && !ev.missed && expectedResponses(ev.def).length) {
      if (['hazard_appears', 'aftershock', 'signal'].includes(ev.def.type)) credit(`${ev.def.description} You responded in time.`);
      continue;
    }
    if (!(ev.missed || (ev.fired && !ev.resolved && expectedResponses(ev.def).length && ev.def.deadlineSeconds != null))) continue;
    if (['hazard_appears', 'aftershock', 'signal'].includes(ev.def.type)) add(sc.enteredOrStayedInDanger, `Danger not handled in time: ${ev.def.description} You needed to: ${needed}.`, null, 'danger');
    else add(w('otherEventMissed', 3), `Not handled in time: ${ev.def.description} You needed to: ${needed}.`, ev.def.casualty ?? null, 'event');
  }
  for (const x of safetyResults(session)) {
    if (x.ok) credit(x.credit ?? `${actions.get(x.action)?.label ?? x.action}: done.`);
    else add(w('missedSafetyAction', 5), x.miss ?? `Missed: ${actions.get(x.action)?.label ?? x.action}.`, null, 'safety');
  }
  const checkable = session.order.map((id) => session.casualties.get(id)).filter((rc) => rc.visitedAt != null && needsDangerCheck(session, rc));
  const checked = checkable.filter((rc) => rc.dangerChecked && !rc.dangerSkipped);
  if (checkable.length && checked.length === checkable.length) credit(`Checked for danger before going hands-on at every casualty (${checked.length}).`);
  const target = session.scene.targetSeconds ?? sc.targetSecondsPerCasualty * session.order.length;
  if (session.clock > target) {
    const over = session.clock - target;
    add(Math.ceil(over / 10) * sc.overtimePenaltyPer10Seconds, `${Math.round(over)} s over the target time of ${target} s.`, null, 'time');
  }

  const tagged = casualties.filter((c) => c.assigned);
  const visited = casualties.filter((c) => session.casualties.get(c.id).visitedAt != null);
  const ideal = { seconds: visited.reduce((sum, c) => sum + c.ideal.seconds, 0), yours: visited.reduce((sum, c) => sum + c.ideal.yours, 0), casualties: visited.length };
  return {
    score: Math.max(0, 100 - penalty),
    penalty,
    seconds: session.clock,
    targetSeconds: target,
    correctTags: casualties.filter((c) => c.verdict === 'correct').length,
    total: casualties.length,
    under: tagged.filter((c) => c.verdict === 'under').length,
    over: tagged.filter((c) => c.verdict === 'over').length,
    casualties,
    ideal,
    items,
    credits,
    safety: { dangerChecks: { checked: checked.length, of: checkable.length }, expected: safetyResults(session) },
    teaching: session.scene.teaching ?? [],
  };
}
