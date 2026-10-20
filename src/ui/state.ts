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

/** A team challenge link: the scene in the hash plus ?seed=&hints=&qte= in the page URL. Everyone who opens it plays the same run. */
export interface Challenge {
  sceneId: string;
  seed: string;
  /** What the link fixes for this play; null when it leaves the setting to the player. */
  hints: boolean | null;
  qte: boolean | null;
}

/** Read once when the app opens. The link's settings apply to that play only; saved preferences are never touched. */
function challengeFromUrl(): Challenge | null {
  try {
    const q = new URLSearchParams(location.search);
    const seed = q.get('seed');
    const m = /^#\/scene\/([^/?]+)/.exec(location.hash);
    const sceneId = m ? decodeURIComponent(m[1]) : '';
    if (!seed || !/^[\w.~-]{1,40}$/.test(seed) || !content.scenes.has(sceneId)) return null;
    const flag = (k: string) => (q.get(k) === '1' ? true : q.get(k) === '0' ? false : null);
    return { sceneId, seed, hints: flag('hints'), qte: flag('qte') };
  } catch { return null; }
}

export const app = {
  session: null as Session | null,
  report: null as Debrief | null,
  hints: getHintsPref(),
  qte: getQtePref(),
  sound: getSoundPref(),
  challenge: challengeFromUrl(),
  /** True when the current (or last) game was a team challenge run. */
  playedChallenge: false,
  play: { last: null, moreOpen: false, cardOpen: true, mapOpen: true, notice: null } as PlayUi,
};

/** Play with your own settings and a new seed again: forget the link and take its parameters out of the address bar. */
export function leaveChallenge(): void {
  app.challenge = null;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* not allowed here */ }
}

/** The injury message added to the session since `fromIndex` (s.messages.length before a step), if any. */
export const injuryAfter = (s: Session, fromIndex: number): Message | null => s.messages.slice(fromIndex).find((m) => m.type === 'injury') ?? null;

export interface StartOptions {
  /** Play with these settings instead of the saved ones (a challenge fixes them). */
  hints?: boolean;
  qte?: boolean;
  /** Mark the run as a team challenge run. */
  challenge?: boolean;
}

/**
 * Start a new game. The seed is the explicit argument; otherwise the challenge link's seed when the link is for this
 * scene (and its hints/qte settings apply to this play only); otherwise ?seed= in the URL (for plain links), or random.
 */
export function startGame(sceneId: string, seed?: string, hashQuery?: URLSearchParams, opts: StartOptions = {}): Session {
  if (!content.scenes.has(sceneId)) throw new Error(`Unknown scene ${sceneId}`);
  const link = app.challenge?.sceneId === sceneId ? app.challenge : null;
  const fromLink = seed === undefined && !!link;
  const playSeed = seed ?? link?.seed ?? (app.challenge ? null : seedFromUrl(hashQuery)) ?? randomSeed();
  const hints = opts.hints ?? (fromLink ? link!.hints ?? app.hints : app.hints);
  const qte = opts.qte ?? (fromLink ? link!.qte ?? app.qte : app.qte);
  app.session = createSession(sceneId, playSeed, hints, qte);
  app.playedChallenge = opts.challenge ?? fromLink;
  app.report = null;
  app.play = { last: null, moreOpen: false, cardOpen: wide(), mapOpen: wide(), notice: null };
  return app.session;
}
