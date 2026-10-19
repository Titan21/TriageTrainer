/// <reference types="vite/client" />
// Boot and hash routing.
//   #/                 home
//   #/scene/<id>       briefing
//   #/play             the game (needs a session, otherwise back to home)
//   #/debrief          the result of the finished session
// In `npm run dev` only, #/play?scene=<id>&auto=<n> and #/debrief?scene=<id>&auto=all jump to a state (see ui/dev.ts).
import './styles.css';
import { mountBriefing } from './ui/briefing';
import { mountDebrief } from './ui/debrief';
import { mountHome } from './ui/home';
import { mountPlay } from './ui/play';
import { app } from './ui/state';
import { parseHash } from './ui/util';
import { startPwa } from './pwa';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;
let token = 0;

function go(hash: string) {
  location.replace(hash);
}

async function route() {
  const mine = ++token;
  const { path, query } = parseHash(location.hash);
  const [screen, arg] = path;
  cleanup?.();
  cleanup = undefined;

  let playOpts: { dialog?: string | null } = {};
  if (import.meta.env.DEV && (screen === 'play' || screen === 'debrief') && query.get('scene')) {
    const dev = await import('./ui/dev');
    if (mine !== token) return;
    playOpts = dev.setup(screen, query);
  }

  document.title = 'Triage Trainer';
  root.className = `screen screen-${screen || 'home'}`;

  if (screen === 'scene' && arg) {
    if (!mountBriefing(root, arg)) return go('#/');
    document.title = 'Briefing · Triage Trainer';
  } else if (screen === 'play') {
    if (!app.session) return go('#/');
    if (app.session.ended || app.report) return go('#/debrief');
    cleanup = mountPlay(root, playOpts);
    document.title = 'Play · Triage Trainer';
  } else if (screen === 'debrief') {
    if (!mountDebrief(root)) return go('#/');
    document.title = 'Debrief · Triage Trainer';
  } else if (!screen) {
    mountHome(root);
  } else {
    return go('#/');
  }
  window.scrollTo(0, 0);
  if (screen !== 'play') root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
void route();

startPwa();
