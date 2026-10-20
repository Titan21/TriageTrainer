import { content } from './engine';
import { bindSettings, header, protocolBanner, settingsPanel } from './components';
import { openDialog } from './dialog';
import { allProgress, countCompleted, hasProgress, resetProgress, suggestNext, type ProgressMap, type SceneProgress } from './progress';
import { esc, plural } from './util';
import type { Scene } from './types';
import { offlineReady, onOfflineReady } from '../pwa';

const CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The line on a scene card: best scores and number of plays, or "Not played yet". */
function cardProgress(p: SceneProgress | undefined): string {
  if (!p) return '<span class="scene-progress"><span class="muted">Not played yet</span></span>';
  const noHints = p.bestScoreNoHints != null && p.bestScoreNoHints !== p.bestScore
    ? `<span class="score-chip score-chip-quiet">Best without hints ${p.bestScoreNoHints}</span>` : '';
  return `<span class="scene-progress"><span class="score-chip">Best ${p.bestScore}</span>${noHints}<span class="muted">${plural(p.plays, 'play')}</span></span>`;
}

function sceneList(scenes: Scene[], all: ProgressMap): string {
  return `<ul class="scene-list">${scenes.map((s) => `<li><a class="scene-card" href="#/scene/${esc(s.id)}">
      <span class="scene-title">${all[s.id] ? `<span class="check">${CHECK}</span><span class="sr-only">Completed: </span>` : ''}${esc(s.title)}</span>
      <span class="scene-meta">${plural(s.casualties.length, 'casualty', 'casualties')}</span>
      <span class="scene-sub">${esc(s.teaching?.[0] ?? '')}</span>
      ${cardProgress(all[s.id])}
    </a></li>`).join('')}</ul>`;
}

function progressRow(name: string, scenes: Scene[], all: ProgressMap): string {
  const total = scenes.length;
  const done = countCompleted(scenes.map((s) => s.id), all);
  return `<div class="prog-row">
    <div class="prog-head"><span class="prog-name">${name}</span><span class="prog-count">${done} of ${total} scenes completed</span></div>
    <div class="prog-bar" role="progressbar" aria-label="${name} completed" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
  </div>`;
}

function progressPanel(learn: Scene[], full: Scene[], all: ProgressMap): string {
  const next = suggestNext(learn, all);
  return `<section class="panel progress-panel" aria-labelledby="prog-h">
    <h2 id="prog-h">Your progress</h2>
    ${progressRow('Learn scenes', learn, all)}
    ${progressRow('Full scenes', full, all)}
    ${next ? `<a class="suggest" href="#/scene/${esc(next.scene.id)}">
      <span class="suggest-body">
        <span class="suggest-label">Suggested next</span>
        <span class="suggest-title">${esc(next.scene.title)}</span>
        ${next.score != null ? `<span class="suggest-note">All Learn scenes done. This one has your lowest best score (${next.score}).</span>` : ''}
      </span>
      <span class="suggest-arrow" aria-hidden="true">&rarr;</span>
    </a>` : ''}
  </section>`;
}

export function mountHome(root: HTMLElement): void {
  const learn = content.sceneList.filter((s) => s.mode === 'learn');
  const full = content.sceneList.filter((s) => s.mode === 'full_scene');
  root.innerHTML = `${header()}<main class="page">
    <h1 tabindex="-1">Triage Trainer</h1>
    <p class="lead">Practise the fast triage sieve for mass-casualty incidents. Check each casualty, tag them red, orange, green or black, and see how you did.</p>
    ${protocolBanner()}
    <div data-slot="progress"></div>
    ${settingsPanel()}
    <section aria-labelledby="learn-h">
      <h2 id="learn-h">Learn scenes</h2>
      <p class="section-note">One idea at a time, with one or two casualties.</p>
      <div data-slot="learn"></div>
    </section>
    <section aria-labelledby="full-h">
      <h2 id="full-h">Full scenes</h2>
      <p class="section-note">A whole incident with a map, bystanders, hazards and a clock.</p>
      <div data-slot="full"></div>
    </section>
    <div class="reset-row" data-slot="reset" hidden><button type="button" class="btn btn-quiet btn-small" data-key="reset-progress">Reset progress</button></div>
    <p class="offline-note" id="offline-note" role="status"></p>
  </main>`;
  bindSettings(root);

  const slot = (name: string) => root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
  /** Everything that depends on saved progress; called again after a reset. */
  function renderProgress() {
    const all = allProgress();
    slot('progress').innerHTML = progressPanel(learn, full, all);
    slot('learn').innerHTML = sceneList(learn, all);
    slot('full').innerHTML = sceneList(full, all);
    slot('reset').hidden = !hasProgress();
  }
  renderProgress();

  slot('reset').addEventListener('click', () => openDialog({
    title: 'Reset your progress?',
    body: `<p class="dlg-sub">This clears every score, play count and completed scene saved on this device. It cannot be undone. Your hints setting is kept.</p>
      <div class="dlg-actions"><button type="button" class="btn btn-block" data-dlg="cancel" autofocus>Keep my progress</button>
      <button type="button" class="btn btn-danger btn-block" data-dlg="reset">Reset progress</button></div>`,
    returnFocusKey: 'reset-progress',
    onPick: (name, close) => {
      if (name !== 'reset') return;
      resetProgress();
      renderProgress();
      close();
      root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    },
  }));

  const note = root.querySelector<HTMLElement>('#offline-note')!;
  const show = (ok: boolean) => { note.textContent = ok ? 'Saved on this device: works without a connection.' : ''; };
  show(offlineReady());
  onOfflineReady(show);
}
