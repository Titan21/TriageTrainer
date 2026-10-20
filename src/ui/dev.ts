// Development-only test hooks (dynamically imported under import.meta.env.DEV, so never in the production bundle).
//
//   #/play?scene=<id>&auto=<n>[&seed=x][&wrong=1][&nodanger=1][&dialog=tag|finish]
//       starts the scene and plays the first n steps of a careful sieve (call out walkers for full scenes, then per
//       casualty: go to them, check for danger, expose, response, breathing (+ airway), pulse, refill, command, tag correctly)
//   #/debrief?scene=<id>&auto=all[&wrong=1]
//       plays every step, finishes, and shows the debrief
//   wrong=1 splints the first casualty and tags them wrongly, to see feedback and mistakes.
//   nodanger=1 skips check_danger at every casualty.
//   localhazard=1 puts broken glass at the first casualty (a copy of the scene, in memory only), so skipping the
//       danger check shows the injury and doing it shows the credit.
//   qte=1 turns quick-time events on. While playing the steps, prompts are answered for you:
//       qteanswer=right (default) | wrong | slow | freeze.
//   prompt=<n> (with qte=1) plays careful steps until the n-th quick-time prompt is waiting (earlier ones are answered
//       as qteanswer says), then stops there, so the play screen opens with that prompt on top.
import { triage } from '../engine/rules.js';
import { answerPrompt, approach as engineApproach, content, debrief, perform as enginePerform } from './engine';
import { app, injuryAfter, startGame } from './state';
import type { Scene, Session } from './types';

// Record the last result like the play screen does, so a jumped-to state shows a realistic result line.
function perform(s: Session, id: string, opts: { category?: string } = {}) {
  const before = s.messages.length;
  const r = enginePerform(s, id, opts);
  const a = content.actions.get(id);
  app.play.notice = injuryAfter(s, before);
  app.play.last = { title: a?.label ?? id, seconds: r.seconds, text: r.text, ok: r.ok, correct: r.correct, feedback: r.feedback };
  return r;
}
function approach(s: Session, id: string) {
  const r = engineApproach(s, id);
  app.play.notice = null;
  app.play.last = { title: 'You walk to the casualty', seconds: r.seconds, text: '', ok: true, correct: true, feedback: null };
  return r;
}

type QteAnswer = 'right' | 'wrong' | 'slow' | 'freeze';

/** Answers the waiting prompt the way `mode` says (the dev hook may read the engine's answer; the real UI never does). */
function answerOne(s: Session, mode: QteAnswer) {
  const p = s.prompt!;
  const def = s.events.find((e) => e.def.id === p.eventId)?.def as { correctResponse?: string | string[] } | undefined;
  const right = [def?.correctResponse ?? []].flat()[p.step];
  const id = mode === 'freeze' ? null : mode === 'wrong' ? 'keep_working' : right;
  const secs = mode === 'freeze' ? p.limitSeconds : mode === 'slow' ? p.limitSeconds + 1.5 : 1.4;
  const r = answerPrompt(s, id, secs);
  app.play.last = { title: 'Quick response', seconds: 0, text: r.text, ok: r.correct, correct: true, feedback: null };
}

function* script(s: Session, o: { wrong: boolean; danger: boolean }): Generator<void> {
  if (s.scene.mode === 'full_scene') { perform(s, 'check_danger'); yield; perform(s, 'call_walking_wounded'); yield; }
  let first = true;
  for (const id of s.order) {
    const rc = s.casualties.get(id) as unknown as { ageGroup: string; state: { breathing: boolean } };
    approach(s, id); yield;
    if (o.danger) { perform(s, 'check_danger'); yield; }
    for (const a of ['expose_check_bleeding', 'check_response', 'check_breathing']) { perform(s, a); yield; }
    if (rc.state.breathing === false) { perform(s, 'open_airway'); yield; perform(s, 'check_breathing'); yield; }
    for (const a of ['check_radial_pulse', 'check_crt', 'give_command']) { perform(s, a); yield; }
    const truth = (triage(content.rules, rc.ageGroup, rc.state) as { category: string }).category;
    let category = truth;
    if (o.wrong && first) { perform(s, 'splint_limb'); yield; category = truth === 'red' ? 'green' : 'red'; }
    first = false;
    perform(s, 'tag_casualty', { category }); yield;
  }
}

/** A copy of the scene with broken glass at the first casualty, registered under its own id. */
function withLocalHazard(sceneId: string): string {
  const scene = content.scenes.get(sceneId)!;
  const id = `${sceneId}~glass`;
  const copy = {
    ...scene,
    id,
    casualties: scene.casualties.map((c, i) => (i > 0 ? c : {
      ...c,
      localHazard: {
        type: 'broken_glass',
        found: 'Glass from the shop window is scattered around them; you sweep a space clear before you kneel.',
        injury: 'You kneel straight onto a shard of window glass and cut your knee.',
        timeLostSeconds: 30,
      },
    })),
  } as Scene;
  content.scenes.set(id, copy);
  return id;
}

/** Sets up app state from the URL. Returns options for the play screen. */
export function setup(screen: 'play' | 'debrief', q: URLSearchParams): { dialog: string | null } {
  if (q.has('qte')) app.qte = q.get('qte') === '1';
  const sceneId = q.get('localhazard') === '1' ? withLocalHazard(q.get('scene')!) : q.get('scene')!;
  const s = startGame(sceneId, q.get('seed') ?? 'dev');
  const stopAt = Number(q.get('prompt')) || 0;
  const mode = (q.get('qteanswer') ?? 'right') as QteAnswer;
  const auto = q.get('auto') ?? (stopAt ? 'all' : '0');
  const limit = auto === 'all' ? Infinity : Number(auto) || 0;
  // Answers waiting prompts; true when the one to stop at is now showing.
  let seen = 0;
  const settle = () => {
    while (s.prompt) {
      if (stopAt && ++seen >= stopAt) return true;
      answerOne(s, mode);
    }
    return false;
  };
  if (limit > 0 && !settle()) {
    let n = 0;
    for (const _ of script(s, { wrong: q.get('wrong') === '1', danger: q.get('nodanger') !== '1' })) {
      if (settle() || ++n >= limit) break;
    }
  }
  if (screen === 'debrief') app.report = debrief(s);
  return { dialog: q.get('dialog') };
}
