import { content } from './engine';
import { challengeCode, openChallengeDialog } from './challenge';
import { bindSettings, header, protocolBanner, settingsPanel } from './components';
import { unlockAudio } from './sound';
import { app, leaveChallenge, startGame, type Challenge } from './state';
import { esc, mmss, plural, randomSeed } from './util';
import type { Briefing } from './types';

const METHANE: { key: keyof Briefing; letter: string; label: string }[] = [
  { key: 'major', letter: 'M', label: 'Major incident' },
  { key: 'exactLocation', letter: 'E', label: 'Exact location' },
  { key: 'type', letter: 'T', label: 'Type' },
  { key: 'hazards', letter: 'H', label: 'Hazards' },
  { key: 'access', letter: 'A', label: 'Access' },
  { key: 'number', letter: 'N', label: 'Number' },
  { key: 'emergencyServices', letter: 'E', label: 'Emergency services' },
];

/** What a challenge link fixes, in words. The player's saved settings are not changed by it. */
function challengeNote(link: Challenge): string {
  const fixed = [link.hints != null ? `hints ${link.hints ? 'on' : 'off'}` : '', link.qte != null ? `quick-time events ${link.qte ? 'on' : 'off'}` : ''].filter(Boolean);
  return `<section class="panel challenge-note" aria-labelledby="ch-h">
      <h2 id="ch-h">Team challenge <span class="code-chip" aria-label="Challenge code">${esc(challengeCode(link.seed))}</span></h2>
      <p>Everyone who opens this link plays the same casualties with the same vitals, so you can compare scores.</p>
      <p>${fixed.length ? `This link sets <strong>${fixed.join(' and ')}</strong> for this play. Your saved settings stay as they are.` : 'This link does not change your settings.'}</p>
      <div class="actions-row">
        <button type="button" class="btn btn-small" data-ch-share>Share this challenge</button>
        <button type="button" class="btn btn-small btn-quiet" data-ch-drop>Play with my own settings and a new seed</button>
      </div>
    </section>`;
}

export function mountBriefing(root: HTMLElement, sceneId: string): boolean {
  const scene = content.scenes.get(sceneId);
  if (!scene) return false;
  const link = app.challenge?.sceneId === sceneId ? app.challenge : null;
  const target = scene.targetSeconds ?? content.rules.scoring.targetSecondsPerCasualty * scene.casualties.length;
  const rows = METHANE.filter((m) => scene.briefing[m.key])
    .map((m) => `<div class="methane-row"><dt><span class="methane-letter" aria-hidden="true">${m.letter}</span>${m.label}</dt><dd>${esc(scene.briefing[m.key])}</dd></div>`)
    .join('');
  // Settings the link fixes are not offered here: changing them would do nothing for this run.
  const free = (['hints', 'qte'] as const).filter((id) => link?.[id] == null);
  root.innerHTML = `${header()}<main class="page page-narrow">
    <p class="crumb"><a href="#/">&larr; All scenes</a></p>
    <h1 tabindex="-1">${esc(scene.title)}</h1>
    <p class="meta-line"><span class="pill">${scene.mode === 'learn' ? 'Learn' : 'Full scene'}</span> ${plural(scene.casualties.length, 'casualty', 'casualties')}</p>
    ${protocolBanner()}
    ${link ? challengeNote(link) : ''}
    <section class="panel" aria-labelledby="meth-h">
      <h2 id="meth-h">Briefing (METHANE)</h2>
      <dl class="methane">${rows}</dl>
      <dl class="facts">
        <div><dt>Scene starts</dt><dd class="mono">${esc(scene.startClock ?? '10:00')}</dd></div>
        <div><dt>Target time</dt><dd class="mono">${mmss(target)}</dd></div>
      </dl>
    </section>
    ${free.length ? settingsPanel(free) : ''}
    <div class="actions-row">
      <button class="btn btn-primary btn-big" data-start>${link ? 'Start challenge' : 'Start'}</button>
      ${link ? '' : '<button class="btn btn-big" data-challenge data-key="challenge">Challenge your team</button>'}
      <a class="btn" href="#/">Back</a>
    </div>
  </main>`;
  bindSettings(root);

  root.querySelector('[data-start]')!.addEventListener('click', () => {
    if ((link?.qte ?? app.qte) && app.sound) unlockAudio();
    startGame(sceneId);
    location.hash = '#/play';
  });

  // A new challenge: a fresh seed and the settings as they are right now. The player can start that exact run.
  root.querySelector('[data-challenge]')?.addEventListener('click', () => {
    const seed = randomSeed();
    const { hints, qte } = app;
    openChallengeDialog({
      sceneId, sceneTitle: scene.title, seed, hints, qte, returnFocusKey: 'challenge',
      onStart: () => {
        if (qte && app.sound) unlockAudio();
        startGame(sceneId, seed, undefined, { hints, qte, challenge: true });
        location.hash = '#/play';
      },
    });
  });

  // An opened challenge link: share it on, or drop it and play with your own settings.
  root.querySelector('[data-ch-share]')?.addEventListener('click', () => {
    if (!link) return;
    openChallengeDialog({ sceneId, sceneTitle: scene.title, seed: link.seed, hints: link.hints ?? app.hints, qte: link.qte ?? app.qte });
  });
  root.querySelector('[data-ch-drop]')?.addEventListener('click', () => {
    leaveChallenge();
    mountBriefing(root, sceneId);
    root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  });
  return true;
}
