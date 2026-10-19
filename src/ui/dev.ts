// Development-only test hooks (dynamically imported under import.meta.env.DEV, so never in the production bundle).
//
//   #/play?scene=<id>&auto=<n>[&seed=x][&wrong=1][&dialog=tag|finish]
//       starts the scene and plays the first n steps of a careful sieve (call out walkers for full scenes, then per
//       casualty: go to them, expose, response, breathing (+ airway), pulse, refill, command, tag correctly)
//   #/debrief?scene=<id>&auto=all[&wrong=1]
//       plays every step, finishes, and shows the debrief
//   wrong=1 splints the first casualty and tags them wrongly, to see feedback and mistakes.
import { triage } from '../engine/rules.js';
import { approach as engineApproach, content, debrief, perform as enginePerform } from './engine';
import { app, startGame } from './state';
import type { Session } from './types';

// Record the last result like the play screen does, so a jumped-to state shows a realistic result line.
function perform(s: Session, id: string, opts: { category?: string } = {}) {
  const r = enginePerform(s, id, opts);
  const a = content.actions.get(id);
  app.play.last = { title: a?.label ?? id, seconds: r.seconds, text: r.text, ok: r.ok, correct: r.correct, feedback: r.feedback };
  return r;
}
function approach(s: Session, id: string) {
  const r = engineApproach(s, id);
  app.play.last = { title: 'You walk to the casualty', seconds: r.seconds, text: '', ok: true, correct: true, feedback: null };
  return r;
}

function* script(s: Session, wrong: boolean): Generator<void> {
  if (s.scene.mode === 'full_scene') { perform(s, 'check_danger'); yield; perform(s, 'call_walking_wounded'); yield; }
  let first = true;
  for (const id of s.order) {
    const rc = s.casualties.get(id) as unknown as { ageGroup: string; state: { breathing: boolean } };
    approach(s, id); yield;
    for (const a of ['expose_check_bleeding', 'check_response', 'check_breathing']) { perform(s, a); yield; }
    if (rc.state.breathing === false) { perform(s, 'open_airway'); yield; perform(s, 'check_breathing'); yield; }
    for (const a of ['check_radial_pulse', 'check_crt', 'give_command']) { perform(s, a); yield; }
    const truth = (triage(content.rules, rc.ageGroup, rc.state) as { category: string }).category;
    let category = truth;
    if (wrong && first) { perform(s, 'splint_limb'); yield; category = truth === 'red' ? 'green' : 'red'; }
    first = false;
    perform(s, 'tag_casualty', { category }); yield;
  }
}

/** Sets up app state from the URL. Returns options for the play screen. */
export function setup(screen: 'play' | 'debrief', q: URLSearchParams): { dialog: string | null } {
  const s = startGame(q.get('scene')!, q.get('seed') ?? 'dev');
  const auto = q.get('auto') ?? '0';
  const limit = auto === 'all' ? Infinity : Number(auto) || 0;
  let n = 0;
  if (limit > 0) for (const _ of script(s, q.get('wrong') === '1')) if (++n >= limit) break;
  if (screen === 'debrief') app.report = debrief(s);
  return { dialog: q.get('dialog') };
}
