import { clockText, content, picture } from './engine';
import { challengeCode, openChallengeDialog, resultText, settingsText, shareInto } from './challenge';
import { crossIcon, header, protocolBanner, tagBadge, tickIcon } from './components';
import { startGame, app } from './state';
import { recordResult, type RecordResult } from './progress';
import { unlockAudio } from './sound';
import { esc, mmss, plural, randomSeed } from './util';
import type { Debrief, DebriefCasualty, Session } from './types';

const VERDICT: Record<string, { text: string; cls: string }> = {
  correct: { text: 'Correct tag', cls: 'ok' },
  under: { text: 'Under-triaged', cls: 'bad' },
  over: { text: 'Over-triaged', cls: 'meh' },
  none: { text: 'Not tagged', cls: 'bad' },
};

const list = (items: string[], cls = '') => (items.length ? `<ul class="plain ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');

/** The shortest correct sequence for this casualty, with what you did. Open by default on wide screens, folded on phones. */
function idealRun(c: DebriefCasualty): string {
  const i = c.ideal;
  if (!i?.steps?.length) return '';
  const open = typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches;
  const rows = i.steps.map((st) => `<li class="ideal-row ${st.done ? 'is-done' : 'is-missed'}"><span class="mark">${st.done ? tickIcon() : crossIcon()}</span>
      <span class="ideal-body"><span class="ideal-line"><span class="sr-only">${st.done ? 'Done: ' : 'Not done: '}</span>${esc(st.label)} <span class="mono muted">${st.seconds}&nbsp;s</span></span>${st.why ? `<span class="ideal-why">${esc(st.why)}</span>` : ''}</span></li>`).join('');
  return `<details class="ideal"${open ? ' open' : ''}><summary><span class="ideal-title">Ideal run</span><span class="ideal-times">Ideal <strong>${i.seconds}&nbsp;s</strong> &middot; You <strong>${i.yours}&nbsp;s</strong></span></summary>
      <ol class="ideal-steps">${rows}</ol></details>`;
}

function casualtyCard(s: Session, c: DebriefCasualty, index: number): string {
  const v = VERDICT[c.verdict ?? 'none'];
  const svg = picture(s, c.id, 'debrief', `${c.name}: picture of the casualty`);
  const happened = c.stages.filter((st) => st.status === 'applied');
  const prevented = c.stages.filter((st) => st.status === 'prevented');
  const stages = [
    ...happened.map((st) => `<li><span class="stage-tag stage-bad">Happened${st.at != null ? ` at ${clockText(s, st.at)}` : ''}</span> ${esc(st.note ?? st.id)}</li>`),
    ...prevented.map((st) => `<li><span class="stage-tag stage-ok">Prevented</span> ${esc(st.note ?? st.id)}</li>`),
  ].join('');
  return `<article class="dcard">
    <div class="dcard-pic picture">${svg}</div>
    <div class="dcard-body">
      <header class="dcard-head">
        <h3>${index + 1}. ${esc(c.name)}</h3>
        <span class="verdict verdict-${v.cls}">${v.text}</span>
      </header>
      ${c.title !== c.name ? `<p class="dcard-title">${esc(c.title)}</p>` : ''}
      <div class="tagpair">
        <div><span class="tagpair-label">You tagged</span>${tagBadge(c.assigned)}</div>
        <div><span class="tagpair-label">Correct</span>${tagBadge(c.correct)}</div>
      </div>
      ${c.reason ? `<p class="reason"><span class="reason-label">The sieve step that decided it</span>${esc(c.reason)}</p>` : ''}
      ${c.mistakes.length ? `<h4>What went wrong</h4>${list(c.mistakes, 'mistakes')}` : ''}
      ${c.missedFindings.length ? `<h4>You did not find</h4>${list(c.missedFindings)}` : ''}
      ${stages ? `<h4>What changed over time</h4><ul class="plain stages">${stages}</ul>` : ''}
      ${c.teaching.length ? `<h4>Teaching points</h4>${list(c.teaching, 'teaching')}` : ''}
      ${idealRun(c)}
    </div></article>`;
}

/** How this result compares with the player's earlier plays of the scene. */
function resultNote(r: RecordResult): string {
  const plays = plural(r.plays, 'play');
  let best: string;
  if (r.firstPlay) best = '<strong class="best-flag">First play saved</strong>';
  else if (r.newBest) best = `<strong class="best-flag">New best!</strong> <span class="muted">Previous best ${r.previousBest}</span>`;
  else if (r.newBestNoHints) best = `<strong class="best-flag">New best without hints!</strong> <span class="muted">Overall best ${r.best} (${plays})</span>`;
  else best = `Your best: <strong>${r.best}</strong> <span class="muted">(${plays})</span>`;
  return `<p class="best-line">${best}</p>
    <p class="hints-line"><span class="pill-quiet">${r.hints ? 'Played with hints' : 'Played without hints'}</span></p>`;
}

/** One line of the Safety section: a tick for done, a cross for missed. The words say it too, so colour is not needed. */
const markRow = (done: boolean, html: string) =>
  `<li class="mark-row ${done ? 'is-done' : 'is-missed'}"><span class="mark">${done ? tickIcon() : crossIcon()}</span><span><span class="sr-only">${done ? 'Done: ' : 'Missed: '}</span>${html}</span></li>`;

const actionLabel = (id: string | null) => (id ? content.actions.get(id)?.label ?? id : '');

/** A quick-time answer as one line: what you sensed, what you chose, how long it took. */
function reactionRow(s: Session, q: Session['qteResults'][number]): string {
  const def = s.events.find((e) => e.def.id === q.eventId)?.def;
  const cue = esc((q.step === 0 ? def?.cue ?? def?.description : def?.followUpCue) ?? 'Quick response');
  const chose = q.answer ? `You chose "${esc(actionLabel(q.answer))}"` : 'You froze';
  const secs = `${q.seconds.toFixed(1)} s`;
  if (q.ok && q.fast) return markRow(true, `${cue} <span class="muted">${chose} in ${secs}.</span>`);
  if (q.ok) return markRow(false, `${cue} <span class="muted">${chose}: right, but slow (${secs}).</span>`);
  return markRow(false, `${cue} <span class="muted">${chose}; you needed to: ${esc(actionLabel(q.expected))}.</span>`);
}

/** Being careful is rewarded: scene safety actions, danger checks at casualties, quick responses. Penalties stay in the list further down. */
function safetySection(s: Session, d: Debrief): string {
  const { dangerChecks, expected } = d.safety;
  const everyCasualty = 'Checked for danger before going hands-on at every casualty';
  const expectedCredits = new Set(expected.filter((x) => x.ok).map((x) => x.credit ?? `${actionLabel(x.action)}: done.`));
  const other = d.credits.filter((c) => c.kind === 'safety' && !expectedCredits.has(c.text) && !c.text.startsWith(everyCasualty));

  const checks = dangerChecks.of
    ? `<p class="safety-summary ${dangerChecks.checked === dangerChecks.of ? 'is-done' : 'is-missed'}">${dangerChecks.checked === dangerChecks.of ? tickIcon() : crossIcon()}<span>Checked for danger at <strong>${dangerChecks.checked} of ${plural(dangerChecks.of, 'casualty', 'casualties')}</strong> before going hands-on.</span></p>`
    : '';
  const scene = expected.length
    ? `<h3>Scene safety</h3><ul class="marks">${expected.map((x) => markRow(x.ok, esc(x.ok ? x.credit ?? `${actionLabel(x.action)}: done.` : x.miss ?? `Missed: ${actionLabel(x.action)}.`))).join('')}</ul>` : '';
  const done = other.length ? `<h3>Also done well</h3><ul class="marks">${other.map((c) => markRow(true, esc(c.text))).join('')}</ul>` : '';
  const reactions = s.qteResults.length ? `<h3>Quick-time reactions</h3><ul class="marks">${s.qteResults.map((q) => reactionRow(s, q)).join('')}</ul>` : '';
  if (!checks && !scene && !done && !reactions) return '';
  return `<section class="panel safety" aria-labelledby="safe-h"><h2 id="safe-h">Safety</h2>${checks}${scene}${done}${reactions}</section>`;
}

function scoreBox(d: Debrief, r: RecordResult): string {
  const over = d.seconds > d.targetSeconds;
  return `<section class="scorebox" aria-label="Result">
      <div class="score-col">
        <div class="score"><span class="score-num">${d.score}</span><span class="score-of">/100</span></div>
        ${resultNote(r)}
      </div>
      <dl class="stats">
        <div><dt>Correct tags</dt><dd>${d.correctTags} of ${d.total}</dd></div>
        <div><dt>Under-triage</dt><dd>${d.under}</dd></div>
        <div><dt>Over-triage</dt><dd>${d.over}</dd></div>
        <div class="${over ? 'is-over' : ''}"><dt>Time</dt><dd><span class="mono">${mmss(d.seconds)}</span> vs <span class="mono">${mmss(d.targetSeconds)}</span> target</dd></div>
      </dl>
      ${d.ideal ? `<p class="ideal-total">Ideal total <strong class="mono">${mmss(d.ideal.seconds)}</strong> of action time; you used <strong class="mono">${mmss(d.ideal.yours)}</strong>.</p>` : ''}
    </section>`;
}

/** Same run again for the team: the code, the link, and the result as text to post. */
function teamSection(s: Session, fromChallenge: boolean): string {
  return `<section class="panel team" aria-labelledby="team-h">
      <h2 id="team-h">Team challenge</h2>
      <p>${fromChallenge ? 'You played a team challenge. ' : ''}Run code <strong class="code-chip">${esc(challengeCode(s.seed))}</strong> <span class="muted">(${esc(settingsText(s.hints, s.qte))})</span>. Send the link and everyone plays the same casualties with the same vitals.</p>
      <div class="team-actions">
        <button type="button" class="btn btn-primary" data-challenge data-key="challenge">Challenge your team to this run</button>
        <button type="button" class="btn" data-copy-result data-key="copy-result">Copy result</button>
      </div>
      <p class="share-status" role="status" aria-live="polite" data-copy-status></p>
      <div data-copy-box></div>
    </section>`;
}

const againRow = (fromChallenge: boolean) => `<div class="actions-row">
      <button class="btn btn-primary btn-big" data-again>Play again</button>
      ${fromChallenge ? '<button class="btn btn-big" data-retry>Try this challenge again</button>' : ''}
      <a class="btn" href="#/">Back to scenes</a>
    </div>`;

export function mountDebrief(root: HTMLElement): boolean {
  const s = app.session;
  const d = app.report;
  if (!s || !d) return false;
  const nameOf = (id: string | null) => (id ? d.casualties.find((c) => c.id === id)?.name ?? '' : '');
  const progress = recordResult(s, d);
  const fromChallenge = app.playedChallenge;
  const sceneItems = d.items.filter((i) => i.kind !== 'mistake');
  const kindLabel: Record<string, string> = { danger: 'Danger', safety: 'Safety', time: 'Time', action: 'Wrong action', event: 'Event' };

  root.innerHTML = `${header()}<main class="page page-wide">
    <p class="crumb"><a href="#/">&larr; All scenes</a></p>
    <h1 tabindex="-1">Debrief: ${esc(s.scene.title)}</h1>
    ${protocolBanner()}
    ${scoreBox(d, progress)}
    ${againRow(fromChallenge)}
    ${teamSection(s, fromChallenge)}
    ${safetySection(s, d)}
    <section aria-labelledby="cas-h"><h2 id="cas-h">Casualties</h2>
      <div class="dcards">${d.casualties.map((c, i) => casualtyCard(s, c, i)).join('')}</div></section>
    <section class="panel" aria-labelledby="scene-h"><h2 id="scene-h">Time, danger and wrong actions</h2>
      ${sceneItems.length ? `<ul class="items">${sceneItems.map((i) => `<li><span class="item-pts mono">&minus;${i.points}</span><span><span class="item-kind">${esc(kindLabel[i.kind] ?? i.kind)}</span> ${esc(i.text)}${i.casualty ? ` <span class="muted">(${esc(nameOf(i.casualty))})</span>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to report: you stayed safe, kept to time and chose well.</p>'}
    </section>
    ${d.teaching.length ? `<section class="panel" aria-labelledby="teach-h"><h2 id="teach-h">What to remember from this scene</h2>${list(d.teaching, 'teaching')}</section>` : ''}
    ${againRow(fromChallenge)}
    <p class="seed">Scene ${esc(s.scene.id)} &middot; code <code>${esc(challengeCode(s.seed))}</code> &middot; ${plural(d.casualties.length, 'casualty', 'casualties')}</p>
  </main>`;

  root.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
    if (app.qte && app.sound) unlockAudio();
    startGame(s.scene.id, randomSeed());
    location.hash = '#/play';
  }));
  // The same run again: same seed and the settings it was played with.
  root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
    if (s.qte && app.sound) unlockAudio();
    startGame(s.scene.id, s.seed, undefined, { hints: s.hints, qte: s.qte, challenge: true });
    location.hash = '#/play';
  }));
  root.querySelector('[data-challenge]')!.addEventListener('click', () => openChallengeDialog({
    sceneId: s.scene.id, sceneTitle: s.scene.title, seed: s.seed, hints: s.hints, qte: s.qte, returnFocusKey: 'challenge',
  }));
  root.querySelector('[data-copy-result]')!.addEventListener('click', () => {
    void shareInto({ text: resultText(s, d) }, root.querySelector<HTMLElement>('[data-copy-status]')!, root.querySelector<HTMLElement>('[data-copy-box]')!);
  });
  return true;
}
