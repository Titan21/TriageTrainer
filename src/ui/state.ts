// Everything lives in memory except the hints preference (see util.ts).
import { createSession, content } from './engine';
import type { Debrief, Session } from './types';
import { getHintsPref, randomSeed, seedFromUrl } from './util';

/** UI-only state for the play screen. Reset whenever a game starts. */
export interface PlayUi {
  last: LastResult | null;
  moreOpen: boolean;
  cardOpen: boolean;
  mapOpen: boolean;
}

export interface LastResult {
  title: string;
  seconds: number;
  text: string;
  ok: boolean;
  correct: boolean;
  feedback: string | null;
}

const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches;

export const app = {
  session: null as Session | null,
  report: null as Debrief | null,
  hints: getHintsPref(),
  play: { last: null, moreOpen: false, cardOpen: true, mapOpen: true } as PlayUi,
};

/** Start a new game. The seed comes from ?seed= (first game only), an explicit argument, or is random. */
export function startGame(sceneId: string, seed?: string, hashQuery?: URLSearchParams): Session {
  if (!content.scenes.has(sceneId)) throw new Error(`Unknown scene ${sceneId}`);
  app.session = createSession(sceneId, seed ?? seedFromUrl(hashQuery) ?? randomSeed(), app.hints);
  app.report = null;
  app.play = { last: null, moreOpen: false, cardOpen: wide(), mapOpen: wide() };
  return app.session;
}
