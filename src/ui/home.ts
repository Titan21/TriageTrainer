import { content } from './engine';
import { bindHintsToggle, header, hintsToggle, protocolBanner } from './components';
import { esc, plural } from './util';
import type { Scene } from './types';

function sceneList(scenes: Scene[]): string {
  return `<ul class="scene-list">${scenes.map((s) => `<li><a class="scene-card" href="#/scene/${esc(s.id)}">
      <span class="scene-title">${esc(s.title)}</span>
      <span class="scene-meta">${plural(s.casualties.length, 'casualty', 'casualties')}</span>
      <span class="scene-sub">${esc(s.teaching?.[0] ?? '')}</span>
    </a></li>`).join('')}</ul>`;
}

export function mountHome(root: HTMLElement): void {
  const learn = content.sceneList.filter((s) => s.mode === 'learn');
  const full = content.sceneList.filter((s) => s.mode === 'full_scene');
  root.innerHTML = `${header()}<main class="page">
    <h1 tabindex="-1">Triage Trainer</h1>
    <p class="lead">Practise the fast triage sieve for mass-casualty incidents. Check each casualty, tag them red, orange, green or black, and see how you did.</p>
    ${protocolBanner()}
    <div class="panel">${hintsToggle()}</div>
    <section aria-labelledby="learn-h">
      <h2 id="learn-h">Learn scenes</h2>
      <p class="section-note">One idea at a time, with one or two casualties.</p>
      ${sceneList(learn)}
    </section>
    <section aria-labelledby="full-h">
      <h2 id="full-h">Full scenes</h2>
      <p class="section-note">A whole incident with a map, bystanders, hazards and a clock.</p>
      ${sceneList(full)}
    </section>
  </main>`;
  bindHintsToggle(root);
}
