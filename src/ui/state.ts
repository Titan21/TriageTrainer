// Everything lives in memory except the preferences (hints, quick-time events, sound; see util.ts) and progress.
import { createSession, content } from './engine';
import type { Debrief, Message, Session } from './types';
import { getHintsPref, getQtePref, getSoundPref, randomSeed, seedFromUrl } from './util';

/** UI-only state for the play screen. Reset whenever a game starts. */
export interface PlayUi {
  last: LastResult | null;
  moreOpen: boolean;
  cardOpen: boolean;
  mapOpen: boolean;
  /** The injury (if any) caused by the last step, shown prominently until the next step. */
  notice: Message | null;
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
  qte: getQtePref(),
  sound: getSoundPref(),
  play: { last: null, moreOpen: false, cardOpen: true, mapOpen: true, notice: null } as PlayUi,
};

/** The injury message added to the session since `fromIndex` (s.messages.length before a step), if any. */
export const injuryAfter = (s: Session, fromIndex: number): Message | null => s.messages.slice(fromIndex).find((m) => m.type === 'injury') ?? null;

/** Start a new game. The seed comes from ?seed= (first game only), an explicit argument, or is random. */
export function startGame(sceneId: string, seed?: string, hashQuery?: URLSearchParams): Session {
  if (!content.scenes.has(sceneId)) throw new Error(`Unknown scene ${sceneId}`);
  app.session = createSession(sceneId, seed ?? seedFromUrl(hashQuery) ?? randomSeed(), app.hints, app.qte);
  app.report = null;
  app.play = { last: null, moreOpen: false, cardOpen: wide(), mapOpen: wide(), notice: null };
  return app.session;
}
