// Progress tracking: which scenes the player has finished and how well, kept in localStorage on this device.
// Every storage access is wrapped, so the app works (without remembering anything) when storage is blocked.
//
// Stored under "triage-trainer:progress:v1" as JSON:
//   { version: 1, scenes: { <sceneId>: SceneProgress }, recorded: [<session key>, ...] }
// A scene counts as completed once one session of it has reached the debrief.
import type { Debrief, Session } from './types';

const KEY = 'triage-trainer:progress:v1';
const VERSION = 1;
/** How many recent session keys are remembered, to avoid counting a reloaded debrief twice. */
const KEEP_RECORDED = 10;

export interface SceneProgress {
  plays: number;
  bestScore: number;
  /** Best score from plays with hints off, or null if there were none. */
  bestScoreNoHints: number | null;
  lastScore: number;
  /** ISO dates. */
  lastPlayed: string;
  firstCompleted: string;
  /** Best share of casualties tagged correctly, 0 to 1. */
  bestCorrectRatio: number;
}

export type ProgressMap = Record<string, SceneProgress>;

interface Store { version: number; scenes: ProgressMap; recorded: string[] }

/** What the debrief shows about the result it just recorded. */
export interface RecordResult {
  plays: number;
  best: number;
  previousBest: number | null;
  firstPlay: boolean;
  newBest: boolean;
  newBestNoHints: boolean;
  hints: boolean;
}

const empty = (): Store => ({ version: VERSION, scenes: {}, recorded: [] });

// ----- storage -----

/** The copy for this page visit. If storage is blocked or full it is the only copy, so progress still shows until reload. */
let memory: Store | null = null;
let persisted = true;

const num = (v: unknown, max = 100): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function sanitize(v: unknown): SceneProgress | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const best = num(o.bestScore);
  if (best == null) return null;
  return {
    plays: Math.max(1, Math.floor(num(o.plays, 1e6) ?? 1)),
    bestScore: best,
    bestScoreNoHints: num(o.bestScoreNoHints),
    lastScore: num(o.lastScore) ?? best,
    lastPlayed: text(o.lastPlayed),
    firstCompleted: text(o.firstCompleted),
    bestCorrectRatio: num(o.bestCorrectRatio, 1) ?? 0,
  };
}

/** Reads a stored value. Anything unreadable or from another format version counts as no progress. */
function parse(raw: string): Store {
  try {
    const o = JSON.parse(raw) as Partial<Store> | null;
    if (!o || typeof o !== 'object' || o.version !== VERSION || !o.scenes || typeof o.scenes !== 'object') return empty();
    const scenes: ProgressMap = {};
    for (const [id, v] of Object.entries(o.scenes)) {
      const p = sanitize(v);
      if (p) scenes[id] = p;
    }
    const recorded = Array.isArray(o.recorded) ? o.recorded.filter((k) => typeof k === 'string').slice(-KEEP_RECORDED) : [];
    return { version: VERSION, scenes, recorded };
  } catch {
    return empty();
  }
}

function load(): Store {
  if (!persisted && memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? parse(raw) : empty();
  } catch {
    memory ??= empty();
  }
  return memory;
}

function save(store: Store): void {
  memory = store;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    persisted = true;
  } catch {
    persisted = false;
  }
}

// ----- reading -----

export const allProgress = (): ProgressMap => load().scenes;
export const hasProgress = (): boolean => Object.keys(load().scenes).length > 0;

/** Counts the given scenes that have been completed. */
export function countCompleted(sceneIds: string[], all: ProgressMap = allProgress()): number {
  return sceneIds.filter((id) => all[id]).length;
}

/** The first scene not completed yet; when all are done, the one with the lowest best score (score is then that score). */
export function suggestNext<T extends { id: string }>(scenes: T[], all: ProgressMap = allProgress()): { scene: T; score: number | null } | null {
  const todo = scenes.find((s) => !all[s.id]);
  if (todo) return { scene: todo, score: null };
  let low: T | undefined;
  for (const s of scenes) if (!low || all[s.id].bestScore < all[low.id].bestScore) low = s;
  return low ? { scene: low, score: all[low.id].bestScore } : null;
}

// ----- writing -----

/** Results already recorded in this page visit. Re-rendering the debrief must not count a session twice. */
let recordedSessions = new WeakMap<Session, RecordResult>();

/**
 * Records a finished session and says how it compared. Safe to call on every render of the debrief:
 * the same session is recorded once, and a session replayed identically (same scene, seed, time and score,
 * such as the dev-hook URL after a reload) is not counted again.
 */
export function recordResult(s: Session, d: Debrief): RecordResult {
  const seen = recordedSessions.get(s);
  if (seen) return seen;

  const store = load();
  const id = s.scene.id;
  const prev = store.scenes[id];
  const key = [id, s.seed, Math.round(d.seconds * 10), d.score].join('|');

  let result: RecordResult;
  if (prev && store.recorded.includes(key)) {
    result = { plays: prev.plays, best: prev.bestScore, previousBest: null, firstPlay: false, newBest: false, newBestNoHints: false, hints: s.hints };
  } else {
    const now = new Date().toISOString();
    const next: SceneProgress = {
      plays: (prev?.plays ?? 0) + 1,
      bestScore: Math.max(prev?.bestScore ?? 0, d.score),
      bestScoreNoHints: s.hints ? (prev?.bestScoreNoHints ?? null) : Math.max(prev?.bestScoreNoHints ?? 0, d.score),
      lastScore: d.score,
      lastPlayed: now,
      firstCompleted: prev?.firstCompleted ?? now,
      bestCorrectRatio: Math.max(prev?.bestCorrectRatio ?? 0, d.total ? d.correctTags / d.total : 0),
    };
    save({ ...store, scenes: { ...store.scenes, [id]: next }, recorded: [...store.recorded, key].slice(-KEEP_RECORDED) });
    result = {
      plays: next.plays,
      best: next.bestScore,
      previousBest: prev?.bestScore ?? null,
      firstPlay: !prev,
      newBest: !prev || d.score > prev.bestScore,
      newBestNoHints: !s.hints && (prev?.bestScoreNoHints == null || d.score > prev.bestScoreNoHints),
      hints: s.hints,
    };
  }
  recordedSessions.set(s, result);
  return result;
}

/** Forgets everything. The hints preference is stored separately and is kept. */
export function resetProgress(): void {
  memory = empty();
  persisted = true;
  recordedSessions = new WeakMap();
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
