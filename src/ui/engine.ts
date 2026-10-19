// Typed facade over the JS game engine, plus the content loaded from /content.
import * as E from '../game/session.js';
import { renderCasualty } from '../art/index.js';
import rules from '../../content/triage-rules.json';
import vocab from '../../content/vocab.json';
import actions from '../../content/actions.json';
import type { Action, ActionResult, CardField, Content, Debrief, Session } from './types';

const casualtyFiles = Object.values(import.meta.glob('../../content/casualties/*.json', { eager: true, import: 'default' }));
const sceneFiles = Object.values(import.meta.glob('../../content/scenes/*.json', { eager: true, import: 'default' }));

export const content = E.indexContent({ vocab, actions, rules, casualtyFiles, sceneFiles } as never) as unknown as Content;

const art = { vocab, actions, rules };

export const createSession = (sceneId: string, seed: string, hints: boolean) =>
  E.createSession(content as never, sceneId, { seed, hints }) as unknown as Session;
export const approach = (s: Session, id: string) => E.approach(s, id) as { ok: boolean; seconds: number; text: string };
export const leave = (s: Session) => E.leave(s);
export const perform = (s: Session, id: string, opts: { category?: string } = {}) =>
  E.perform(s, id, opts as never) as unknown as ActionResult;
export const availableActions = (s: Session) =>
  E.availableActions(s) as unknown as { core: Action[]; extras: Action[]; more: Action[] };
export const card = (s: Session, id: string) => E.card(s, id) as unknown as CardField[];
export const hint = (s: Session) => E.hint(s) as string;
export const clockText = (s: Session, t?: number, withSeconds = false) => E.clockText(s, t, withSeconds) as string;
export const moveSeconds = (a: [number, number], b: [number, number]) => E.moveSeconds(a, b) as number;
export const debrief = (s: Session) => E.debrief(s) as unknown as Debrief;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The casualty's picture. In play mode the engine's title would give the diagnosis away, so it is replaced. */
export function picture(s: Session, id: string, mode: 'play' | 'debrief', neutralLabel: string): string {
  const { casualty, view } = E.snapshot(s, id, mode) as { casualty: unknown; view: Record<string, unknown> };
  const { svg } = renderCasualty(casualty, { ...view, animate: !reducedMotion() }, { ...art, uid: `${mode[0]}-${id}` } as never) as { svg: string };
  if (mode === 'debrief') return svg;
  return svg.replace(/<title>[\s\S]*?<\/title>/, '').replace(/aria-label="[^"]*"/, `aria-label="${neutralLabel.replace(/"/g, '')}"`);
}
