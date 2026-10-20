import { content } from './engine';
import { bindSettings, header, protocolBanner, settingsPanel } from './components';
import { unlockAudio } from './sound';
import { app, startGame } from './state';
import { esc, mmss, plural } from './util';
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

export function mountBriefing(root: HTMLElement, sceneId: string): boolean {
  const scene = content.scenes.get(sceneId);
  if (!scene) return false;
  const target = scene.targetSeconds ?? content.rules.scoring.targetSecondsPerCasualty * scene.casualties.length;
  const rows = METHANE.filter((m) => scene.briefing[m.key])
    .map((m) => `<div class="methane-row"><dt><span class="methane-letter" aria-hidden="true">${m.letter}</span>${m.label}</dt><dd>${esc(scene.briefing[m.key])}</dd></div>`)
    .join('');
  root.innerHTML = `${header()}<main class="page page-narrow">
    <p class="crumb"><a href="#/">&larr; All scenes</a></p>
    <h1 tabindex="-1">${esc(scene.title)}</h1>
    <p class="meta-line"><span class="pill">${scene.mode === 'learn' ? 'Learn' : 'Full scene'}</span> ${plural(scene.casualties.length, 'casualty', 'casualties')}</p>
    ${protocolBanner()}
    <section class="panel" aria-labelledby="meth-h">
      <h2 id="meth-h">Briefing (METHANE)</h2>
      <dl class="methane">${rows}</dl>
      <dl class="facts">
        <div><dt>Scene starts</dt><dd class="mono">${esc(scene.startClock ?? '10:00')}</dd></div>
        <div><dt>Target time</dt><dd class="mono">${mmss(target)}</dd></div>
      </dl>
    </section>
    ${settingsPanel(['hints', 'qte'])}
    <div class="actions-row">
      <button class="btn btn-primary btn-big" data-start>Start</button>
      <a class="btn" href="#/">Back</a>
    </div>
  </main>`;
  bindSettings(root);
  root.querySelector('[data-start]')!.addEventListener('click', () => {
    if (app.qte && app.sound) unlockAudio();
    startGame(sceneId);
    location.hash = '#/play';
  });
  return true;
}
