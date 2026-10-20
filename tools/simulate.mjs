#!/usr/bin/env node
// Plays every scene (and every casualty on its own) through the game engine.
//
// A careful player follows the sieve using only what they have observed, tags by
// running the rules on those observations, and handles hazards. Every casualty
// should end up correctly tagged; a mismatch means the game hides something the
// sieve needs, or the content disagrees with itself. A careless player tags
// everyone green at once and must score badly. An extra-cautious player does the
// careful run plus needless safety actions and must lose only time. Every scene
// runs with quick-time events off and on. Every picture is rendered.
//
//   node tools/simulate.mjs            summary
//   node tools/simulate.mjs --verbose  per-casualty action logs

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexContent, createSession, approach, perform, snapshot, debrief, card, availableActions, answerPrompt, pendingSafety } from '../src/game/session.js';
import { triage } from '../src/engine/rules.js';
import { renderCasualty } from '../src/art/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const dirJson = (d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.json')).map((f) => read(`${d}/${f}`));
const verbose = process.argv.includes('--verbose');

const raw = { vocab: read('content/vocab.json'), actions: read('content/actions.json'), rules: read('content/triage-rules.json'), casualtyFiles: dirJson('content/casualties'), sceneFiles: dirJson('content/scenes') };
const content = indexContent(raw);
const art = { vocab: raw.vocab, actions: raw.actions, rules: raw.rules };
const BENIGN = /other side|face hidden|pinned to the head|hidden under the entrapment|hidden in pose|no anchor/;

// One single-casualty scene per casualty, so every casualty gets played.
for (const c of content.casualties.values()) {
  const s = { id: `solo_${c.id}`, title: c.title, mode: 'learn', briefing: { type: 'Solo test' }, startClock: '10:00', targetSeconds: 120, casualties: [{ ref: c.id, position: [50, 50] }], events: [], hazards: [], bystanders: [] };
  content.scenes.set(s.id, s);
}

const problems = [];
const renderWarnings = new Map();
let renders = 0;

function render(session, id, mode) {
  const { casualty, view } = snapshot(session, id, mode);
  const out = renderCasualty(casualty, view, art);
  renders++;
  if (!out.svg.startsWith('<svg')) problems.push(`${session.scene.id}/${id}: render produced no SVG`);
  for (const w of out.warnings) if (!BENIGN.test(w)) renderWarnings.set(`${id}: ${w}`, (renderWarnings.get(`${id}: ${w}`) ?? 0) + 1);
}

function act(session, id, opts) {
  answerPrompts(session);
  const r = perform(session, id, opts);
  if (verbose) console.log(`   ${String(session.clock).padStart(4)}s ${id}${opts?.category ? `=${opts.category}` : ''}: ${r.text}${r.correct ? '' : `  [wrong: ${r.feedback}]`}`);
  answerPrompts(session);
  handleHazards(session);
  if (session.current) render(session, session.current, 'play');
  return r;
}

/** The careful player answers quick-time prompts correctly in about a second. */
function answerPrompts(session) {
  for (let guard = 0; session.prompt && guard < 10; guard++) {
    const r = answerPrompt(session, session.prompt.expected, 1.2);
    if (verbose) console.log(`   ${String(session.clock).padStart(4)}s QTE -> ${r.expected}: ${r.text}`);
  }
}

function handleHazards(session) {
  for (const ev of session.events) {
    if (!ev.fired || ev.resolved || ev.handling) continue;
    const want = [ev.def.correctResponse ?? []].flat().filter((x) => x && x !== 'ignore');
    if (!want.length) continue;
    const sceneLevel = want.every((w) => content.actions.get(w)?.group === 'scene');
    if (!sceneLevel && !session.current) continue;
    ev.handling = true;
    for (const w of want.slice(ev.progress)) act(session, w);
  }
}

/** What the player can conclude from observations, in the shape the rules engine reads. */
function observedForTriage(session, rc) {
  const obs = (k) => rc.observed[k]?.value;
  const breathChecks = session.log.filter((l) => l.casualty === rc.id && l.action === 'check_breathing');
  const firstBreathing = rc.firstBreathing;
  const seen = rc.findings.filter((f) => f.visible || rc.revealed.has(f.id));
  return {
    canWalk: obs('canWalk') === true,
    breathing: firstBreathing ?? true,
    breathesAfterAirwayOpen: firstBreathing === false ? (rc.afterAirway ?? false) : null,
    breathesAfterRescueBreaths: rc.afterRescue ?? null,
    rr: obs('rr'),
    radialPulse: obs('radialPulse') ?? { present: true, rate: 80 },
    crtSeconds: obs('crtSeconds') ?? 1,
    obeysCommands: obs('obeysCommands') ?? true,
    responsive: obs('responsive') ?? 'alert',
    painResponseAppropriate: obs('painResponseAppropriate') ?? null,
    catastrophicBleed: seen.some((f) => f.lifeThreat === 'catastrophic_bleed'),
    entrapped: seen.some((f) => f.overlay === 'entrapment'),
    _checks: breathChecks.length,
  };
}

function carefulCasualty(session, id, cautious = false) {
  const rc = session.casualties.get(id);
  answerPrompts(session);
  approach(session, id);
  answerPrompts(session);
  handleHazards(session);
  if (!rc.cameToYou || cautious) act(session, 'check_danger');
  if (cautious) act(session, 'check_danger');
  render(session, id, 'play');
  const exp = rc.def.expected ?? {};
  const has = (a) => rc.done.some((d) => d.id === a && d.ok !== false);
  const correctNow = (a) => {
    const r = availableActions(session);
    return [...r.core, ...r.extras, ...r.more].some((x) => x.id === a);
  };
  const doLsi = () => {
    for (const a of [...(exp.lifeSavingInterventions ?? []).slice(0, 1), ...(exp.keyActions ?? [])]) if (!has(a) && correctNow(a)) act(session, a);
  };
  act(session, 'expose_check_bleeding');
  if (rc.findings.some((f) => f.lifeThreat === 'catastrophic_bleed' && (f.visible || rc.revealed.has(f.id)))) doLsi();
  act(session, 'check_response');
  const resp = rc.observed.responsive?.value;
  if (!rc.observed.canWalk && ['alert', 'voice'].includes(resp)) act(session, 'ask_to_walk');
  if (rc.observed.canWalk?.value !== true) {
    act(session, 'check_breathing');
    rc.firstBreathing = rc.observed.breathing.value;
    if (rc.firstBreathing === false) {
      act(session, 'open_airway');
      act(session, 'check_breathing');
      rc.afterAirway = rc.observed.breathing.value;
      if (!rc.afterAirway && rc.ageGroup === 'child') {
        act(session, 'check_radial_pulse');
        if (rc.observed.radialPulse.value?.present) {
          act(session, 'rescue_breaths');
          act(session, 'check_breathing');
          rc.afterRescue = rc.observed.breathing.value;
        }
      }
    }
    if (rc.observed.breathing.value) {
      act(session, 'check_radial_pulse');
      if (rc.ageGroup === 'adult') act(session, 'check_crt');
      act(session, 'give_command');
    }
    doLsi();
  } else doLsi();
  const guess = triage(session.content.rules, rc.ageGroup, observedForTriage(session, rc)).category;
  act(session, 'tag_casualty', { category: guess });
}

function playCareful(sceneId, { qte = false, cautious = false } = {}) {
  const s = createSession(content, sceneId, { seed: 'sim', qte });
  if (verbose) console.log(`\n== ${sceneId}${qte ? ' (quick-time on)' : ''}${cautious ? ' (cautious)' : ''}`);
  for (const x of pendingSafety(s)) act(s, x.action);
  if (cautious) { act(s, 'withdraw'); act(s, 'don_gloves'); act(s, 'drop_cover_hold'); act(s, 'make_safe'); }
  if (s.order.length > 1) act(s, 'call_walking_wounded');
  // Walkers come to you: tag them first, then work through the rest.
  const walkers = s.order.filter((id) => s.casualties.get(id).observed.canWalk?.value === true);
  for (const id of [...walkers, ...s.order.filter((id) => !walkers.includes(id))]) {
    if (verbose) console.log(` -- ${id}`);
    carefulCasualty(s, id, cautious);
  }
  // Re-triage pass: anyone whose picture changed since their tag gets a quick re-check.
  for (const id of s.order) {
    const rc = s.casualties.get(id);
    if (!rc.tag || rc.changedSince <= rc.tag.t) continue;
    if (verbose) console.log(` -- re-triage ${id}`);
    for (const k of Object.keys(rc.observed)) delete rc.observed[k];
    rc.firstBreathing = rc.afterAirway = rc.afterRescue = undefined;
    carefulCasualty(s, id, cautious);
  }
  for (const id of s.order) { render(s, id, 'debrief'); card(s, id); }
  const d = debrief(s);
  const label = `${sceneId}${qte ? ' [qte]' : ''}${cautious ? ' [cautious]' : ''}`;
  for (const c of d.casualties) {
    if (c.verdict !== 'correct' && !cautious) problems.push(`${label}/${c.id}: careful player tagged ${c.assigned}, correct ${c.correct} (${c.step})`);
    if (!cautious) for (const m of c.mistakes.filter((x) => !x.startsWith('Tagged '))) problems.push(`${label}/${c.id}: ${m}`);
  }
  if (!cautious) for (const i of d.items.filter((x) => x.kind !== 'time' && !x.casualty)) problems.push(`${label}: ${i.text}`);
  return d;
}

function playCareless(sceneId) {
  const s = createSession(content, sceneId, { seed: 'sim' });
  for (const id of s.order) { approach(s, id); perform(s, 'tag_casualty', { category: 'green' }); }
  return debrief(s);
}

const results = [];
for (const scene of content.scenes.values()) {
  try {
    const good = playCareful(scene.id);
    const bad = playCareless(scene.id);
    const row = { id: scene.id, good, bad };
    if (!scene.id.startsWith('solo_')) {
      row.qte = playCareful(scene.id, { qte: true });
      row.cautious = playCareful(scene.id, { cautious: true });
      if (bad.score >= good.score) problems.push(`${scene.id}: careless score ${bad.score} >= careful ${good.score}`);
      // Being careful is never wrong in itself: no safety action may be marked wrong or penalised.
      // (Its time cost still counts, and a slower player may meet more deterioration.)
      const safetyLabels = content.actionList.filter((a) => a.safety).map((a) => a.label);
      const punished = row.cautious.items.filter((i) => i.kind === 'action' && safetyLabels.some((l) => i.text.startsWith(`${l}:`)));
      if (punished.length) problems.push(`${scene.id}: safety actions were penalised: ${punished.map((i) => i.text).join(' | ')}`);
    }
    results.push(row);
  } catch (e) {
    problems.push(`${scene.id}: crashed: ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
  }
}

console.log('scene | careful (tags, time/target) | careful + QTE | extra-cautious | careless | safety credits');
for (const r of results.filter((x) => !x.id.startsWith('solo_'))) {
  console.log(`${r.id} | ${r.good.score} (${r.good.correctTags}/${r.good.total}, ${Math.round(r.good.seconds)}/${r.good.targetSeconds}s) | ${r.qte?.score} | ${r.cautious?.score} | ${r.bad.score} | ${r.good.credits.length}`);
}
if (process.argv.includes('--why')) {
  for (const r of results.filter((x) => !x.id.startsWith('solo_') && x.good.score < 90)) {
    console.log(`
${r.id} (${r.good.score}):`);
    for (const i of r.good.items) console.log(`  -${i.points} ${i.casualty ?? ''} ${i.text}`);
  }
}
const solo = results.filter((x) => x.id.startsWith('solo_'));
console.log(`\nSolo casualties: ${solo.filter((r) => r.good.correctTags === 1).length}/${solo.length} tagged correctly by the careful player.`);
console.log(`Rendered ${renders} pictures; ${renderWarnings.size} distinct non-benign render warning(s).`);
for (const [w, n] of [...renderWarnings].slice(0, 25)) console.log(`  RENDER ${w}${n > 1 ? ` (x${n})` : ''}`);
const uniq = [...new Set(problems)];
console.log(`\n${uniq.length} problem(s):`);
for (const p of uniq) console.log(`  ${p}`);
process.exit(uniq.some((p) => p.includes('crashed') || p.includes('careful player tagged')) ? 1 : 0);
