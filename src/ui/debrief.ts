import { clockText, picture } from './engine';
import { header, protocolBanner, tagBadge } from './components';
import { startGame, app } from './state';
import { esc, mmss, plural, randomSeed } from './util';
import type { DebriefCasualty, Session } from './types';

const VERDICT: Record<string, { text: string; cls: string }> = {
  correct: { text: 'Correct tag', cls: 'ok' },
  under: { text: 'Under-triaged', cls: 'bad' },
  over: { text: 'Over-triaged', cls: 'meh' },
  none: { text: 'Not tagged', cls: 'bad' },
};

const list = (items: string[], cls = '') => (items.length ? `<ul class="plain ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');

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
    </div></article>`;
}

export function mountDebrief(root: HTMLElement): boolean {
  const s = app.session;
  const d = app.report;
  if (!s || !d) return false;
  const nameOf = (id: string | null) => (id ? d.casualties.find((c) => c.id === id)?.name ?? '' : '');
  const over = d.seconds > d.targetSeconds;
  const sceneItems = d.items.filter((i) => i.kind !== 'mistake');
  const kindLabel: Record<string, string> = { danger: 'Danger', time: 'Time', action: 'Wrong action', event: 'Event' };

  root.innerHTML = `${header()}<main class="page page-wide">
    <p class="crumb"><a href="#/">&larr; All scenes</a></p>
    <h1 tabindex="-1">Debrief: ${esc(s.scene.title)}</h1>
    ${protocolBanner()}
    <section class="scorebox" aria-label="Result">
      <div class="score"><span class="score-num">${d.score}</span><span class="score-of">/100</span></div>
      <dl class="stats">
        <div><dt>Correct tags</dt><dd>${d.correctTags} of ${d.total}</dd></div>
        <div><dt>Under-triage</dt><dd>${d.under}</dd></div>
        <div><dt>Over-triage</dt><dd>${d.over}</dd></div>
        <div class="${over ? 'is-over' : ''}"><dt>Time</dt><dd><span class="mono">${mmss(d.seconds)}</span> vs <span class="mono">${mmss(d.targetSeconds)}</span> target</dd></div>
      </dl>
    </section>
    <div class="actions-row">
      <button class="btn btn-primary btn-big" data-again>Play again</button>
      <a class="btn" href="#/">Back to scenes</a>
    </div>
    <section aria-labelledby="cas-h"><h2 id="cas-h">Casualties</h2>
      <div class="dcards">${d.casualties.map((c, i) => casualtyCard(s, c, i)).join('')}</div></section>
    <section class="panel" aria-labelledby="scene-h"><h2 id="scene-h">Time, danger and wrong actions</h2>
      ${sceneItems.length ? `<ul class="items">${sceneItems.map((i) => `<li><span class="item-pts mono">&minus;${i.points}</span><span><span class="item-kind">${esc(kindLabel[i.kind] ?? i.kind)}</span> ${esc(i.text)}${i.casualty ? ` <span class="muted">(${esc(nameOf(i.casualty))})</span>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to report: you stayed safe, kept to time and chose well.</p>'}
    </section>
    ${d.teaching.length ? `<section class="panel" aria-labelledby="teach-h"><h2 id="teach-h">What to remember from this scene</h2>${list(d.teaching, 'teaching')}</section>` : ''}
    <div class="actions-row">
      <button class="btn btn-primary btn-big" data-again>Play again</button>
      <a class="btn" href="#/">Back to scenes</a>
    </div>
    <p class="seed">Scene ${esc(s.scene.id)} &middot; seed <code>${esc(s.seed)}</code> &middot; ${plural(d.casualties.length, 'casualty', 'casualties')}</p>
  </main>`;

  root.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
    startGame(s.scene.id, randomSeed());
    location.hash = '#/play';
  }));
  return true;
}
