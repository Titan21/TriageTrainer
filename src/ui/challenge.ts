// Team challenges: a link that fixes the scene, the seed and the settings, so a team plays the identical run
// (same casualties, same rolled vitals, same random quick-time events) and compares scores.
// This file builds the link and the result text, and shares or copies them.
import { openDialog } from './dialog';
import { esc, mmss } from './util';
import type { Debrief, Session } from './types';

/** The seed, as shown to people. */
export const challengeCode = (seed: string) => seed.toUpperCase();

/** "hints off, quick-time on" */
export const settingsText = (hints: boolean, qte: boolean) => `hints ${hints ? 'on' : 'off'}, quick-time ${qte ? 'on' : 'off'}`;

/** `<page>?seed=K7Q2X&hints=0&qte=1#/scene/<id>`: opens the briefing of that scene, with the run fixed. */
export function challengeUrl(sceneId: string, seed: string, hints: boolean, qte: boolean): string {
  const q = new URLSearchParams({ seed, hints: hints ? '1' : '0', qte: qte ? '1' : '0' });
  return `${location.origin}${location.pathname}?${q}#/scene/${encodeURIComponent(sceneId)}`;
}

/** "Triage Trainer, The quiet one: 87/100, 2 of 2 tags correct, 2:05 (challenge K7Q2, hints off, quick-time on) <link>" */
export function resultText(s: Session, d: Debrief): string {
  return `Triage Trainer, ${s.scene.title}: ${d.score}/100, ${d.correctTags} of ${d.total} tags correct, ${mmss(d.seconds)} `
    + `(challenge ${challengeCode(s.seed)}, ${settingsText(s.hints, s.qte)}) ${challengeUrl(s.scene.id, s.seed, s.hints, s.qte)}`;
}

// ----- sharing -----

export interface SharePayload {
  /** What goes on the clipboard. */
  text: string;
  /** What the phone share sheet gets (defaults to the text). */
  share?: ShareData;
}
export type ShareOutcome = 'shared' | 'copied' | 'manual' | 'cancelled';

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
/** On phones and tablets the share sheet is the natural way to send something; on a computer, copying is. */
const shareFirst = () => canShare() && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Share sheet on touch devices, else the clipboard, else 'manual': the caller shows the text to copy by hand. */
export async function shareOrCopy(p: SharePayload): Promise<ShareOutcome> {
  const share = async (): Promise<ShareOutcome | null> => {
    try { await navigator.share(p.share ?? { text: p.text }); return 'shared'; }
    catch (e) { return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : null; }
  };
  const copy = async (): Promise<ShareOutcome | null> => {
    try { await navigator.clipboard.writeText(p.text); return 'copied'; } catch { return null; }
  };
  const order = shareFirst() ? [share, copy] : canShare() ? [copy, share] : [copy];
  for (const way of order) {
    const outcome = await way();
    if (outcome) return outcome;
  }
  return 'manual';
}

const flashTimers = new WeakMap<HTMLElement, number>();

/** Shares or copies, and says what happened in `status` ("Copied" for a moment). With no way to copy, puts the text in a selectable box. */
export async function shareInto(p: SharePayload, status: HTMLElement, box?: HTMLElement): Promise<void> {
  const outcome = await shareOrCopy(p);
  clearTimeout(flashTimers.get(status));
  if (outcome === 'manual') {
    status.textContent = box ? 'Select the text below and copy it.' : 'Select the link above and copy it.';
    if (box) {
      box.innerHTML = `<textarea class="share-box" readonly rows="4" aria-label="Text to copy">${esc(p.text)}</textarea>`;
      const area = box.querySelector('textarea')!;
      area.focus();
      area.select();
    }
    return;
  }
  if (box) box.innerHTML = '';
  status.textContent = outcome === 'copied' ? 'Copied' : outcome === 'shared' ? 'Shared' : '';
  if (status.textContent) flashTimers.set(status, window.setTimeout(() => { status.textContent = ''; }, 2500));
}

// ----- the "Challenge your team" dialog -----

export interface ChallengeDialog {
  sceneId: string;
  sceneTitle: string;
  seed: string;
  hints: boolean;
  qte: boolean;
  /** When given, the dialog also offers to start this run right away. */
  onStart?: () => void;
  returnFocusKey?: string;
}

export function openChallengeDialog(o: ChallengeDialog): void {
  const url = challengeUrl(o.sceneId, o.seed, o.hints, o.qte);
  const sheet = shareFirst();
  const getStatus = () => document.querySelector<HTMLElement>('dialog.dlg [data-status]')!;
  openDialog({
    title: 'Challenge your team',
    body: `<p class="dlg-sub">Send this link to your team. Everyone who opens it plays <strong>${esc(o.sceneTitle)}</strong> with the same casualties and vitals, so you can compare scores. It sets hints ${o.hints ? 'on' : 'off'} and quick-time events ${o.qte ? 'on' : 'off'} for that play.</p>
      <p class="challenge-code">Code <strong>${esc(challengeCode(o.seed))}</strong></p>
      <textarea class="share-box" readonly rows="3" aria-label="Challenge link" data-link>${esc(url)}</textarea>
      <div class="dlg-actions">
        <button type="button" class="btn btn-primary btn-block" data-dlg="share" autofocus>${sheet ? 'Share link' : 'Copy link'}</button>
        ${o.onStart ? '<button type="button" class="btn btn-block" data-dlg="start">Start this run</button>' : ''}
        <button type="button" class="btn btn-quiet btn-block" data-dlg="cancel">Close</button>
      </div>
      <p class="share-status" role="status" aria-live="polite" data-status></p>`,
    returnFocusKey: o.returnFocusKey,
    onPick: (name, close) => {
      if (name === 'start') { close(); o.onStart?.(); return; }
      if (name === 'share') {
        void shareInto({ text: url, share: { title: 'Triage Trainer challenge', text: `Can you beat my run of "${o.sceneTitle}"? Same casualties, same vitals.`, url } }, getStatus());
      }
    },
  });
  document.querySelector<HTMLTextAreaElement>('dialog.dlg [data-link]')?.addEventListener('focus', (e) => (e.target as HTMLTextAreaElement).select());
}
