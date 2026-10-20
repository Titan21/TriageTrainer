import { content } from './engine';
import { app } from './state';
import { playBlasts, unlockAudio, type Playing } from './sound';
import { esc, setHintsPref, setQtePref, setSoundPref, tagVars } from './util';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Category as colour AND text: "Red · Immediate". */
export function tagBadge(catId: string | null, prefix = ''): string {
  if (!catId) return `<span class="tagbadge tagbadge-none">${esc(prefix)}Not tagged</span>`;
  const c = content.categories.get(catId);
  if (!c) return `<span class="tagbadge tagbadge-none">${esc(prefix)}${esc(catId)}</span>`;
  return `<span class="tagbadge" style="${tagVars(c.colour)}"><span class="tagbadge-dot" aria-hidden="true"></span>${esc(prefix)}${esc(cap(c.id))} · ${esc(c.label)}</span>`;
}

export const catName = (id: string) => `${cap(id)} · ${content.categories.get(id)?.label ?? id}`;
export const catShort = (id: string) => cap(id);

/** Visible whenever the rules are still the placeholder protocol. */
export function protocolBanner(): string {
  const r = content.rules;
  if (r.approved) return '';
  const rest = (r.notice ?? 'These triage rules are not the approved NZRT protocol.').replace(/^placeholder protocol\.?\s*/i, '');
  return `<aside class="banner banner-warn" role="note"><strong>Placeholder protocol.</strong> ${esc(rest)}</aside>`;
}

type SettingId = 'hints' | 'qte' | 'sound';

const SETTINGS: Record<SettingId, { title: string; text: string; set: (on: boolean) => void }> = {
  hints: {
    title: 'Hints',
    text: 'A nudge line and an explanation when an action is wrong. Turn off to test yourself.',
    set: (on) => { app.hints = on; setHintsPref(on); },
  },
  qte: {
    title: 'Quick-time events',
    text: 'Sudden events like aftershocks, gas or whistle signals pause the game. You have 12 seconds to read and respond; a little longer still counts, as slow.',
    set: (on) => { app.qte = on; setQtePref(on); },
  },
  sound: {
    title: 'Sound',
    text: 'Plays whistle signals. Only matters when quick-time events are on.',
    set: (on) => { app.sound = on; setSoundPref(on); },
  },
};

const switchRow = (id: SettingId) => `<label class="switch"><input type="checkbox" role="switch" data-setting="${id}" ${app[id] ? 'checked' : ''}>
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    <span class="switch-text"><strong>${SETTINGS[id].title}</strong><small>${SETTINGS[id].text}</small></span></label>`;

/** Under the Sound switch: one short whistle blast at game pitch and volume, to set the device volume. */
const soundTest = () => `<div class="sound-test">
    <button type="button" class="btn btn-quiet btn-small" data-sound-test>Play example</button>
    <span class="sound-test-note" role="status" aria-live="polite">One short whistle blast, as loud as the game plays it.</span>
  </div>`;

/** The on/off settings, one panel. Call bindSettings on the page afterwards. */
export function settingsPanel(which: SettingId[] = ['hints', 'qte', 'sound']): string {
  return `<div class="panel settings">${which.map((id) => (id === 'sound' ? `<div class="setting-group">${switchRow(id)}${soundTest()}</div>` : switchRow(id))).join('')}</div>`;
}

let example: Playing | null = null;

async function playExample(button: HTMLButtonElement, note: HTMLElement): Promise<void> {
  example?.stop();
  unlockAudio();
  button.disabled = true;
  example = await playBlasts([1]);
  if (!example) {
    note.textContent = 'No sound could play. Check that this tab and your device are not muted, then try again.';
    button.disabled = false;
    return;
  }
  note.textContent = 'Playing…';
  window.setTimeout(() => {
    button.disabled = false;
    note.textContent = app.sound
      ? 'Set your volume so that was clearly audible but not uncomfortable.'
      : "Sound is off, so the game won't play signals. Turn it on above to hear them.";
  }, 1200);
}

export function bindSettings(root: HTMLElement): void {
  const test = root.querySelector<HTMLButtonElement>('[data-sound-test]');
  if (test) test.addEventListener('click', () => void playExample(test, root.querySelector<HTMLElement>('.sound-test-note')!));
  root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      SETTINGS[input.dataset.setting as SettingId].set(input.checked);
      // A tap is the moment browsers allow sound to start, so get audio ready for the whistle signals.
      if (app.qte && app.sound) unlockAudio();
    });
  });
}

const icon = (path: string) => `<svg class="mark-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** Tick and cross for done / not done. Shape carries the meaning, so they need no colour. */
export const tickIcon = () => icon('M3.5 8.5l3 3 6-7');
export const crossIcon = () => icon('M4 4l8 8M12 4l-8 8');

export function header(): string {
  return `<header class="appbar"><a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">+</span>Triage Trainer</a></header>`;
}
