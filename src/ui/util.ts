import actionsJson from '../../content/actions.json';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text from content before it goes into innerHTML. */
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 125 -> "2:05" */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Updates innerHTML only when it changed, so focus and scroll survive no-op renders. Returns true if replaced. */
export function setHtml(el: HTMLElement, html: string): boolean {
  if (el.dataset.html === html) return false;
  // Remember focus by data-key so it can be put back after a re-render.
  const active = document.activeElement as HTMLElement | null;
  const key = active && el.contains(active) ? active.dataset.key : undefined;
  el.innerHTML = html;
  el.dataset.html = html;
  if (key) el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  return true;
}

// ----- groups -----

const GROUP_NAMES = (actionsJson as { groups: Record<string, string> }).groups;
/** Readable heading for an action group. The trap and silly groups share a neutral heading so the grouping does not give the answer away. */
export function groupHeading(group: string): string {
  if (group === 'trap' || group === 'silly') return 'Other actions';
  return GROUP_NAMES[group] ?? group;
}
export const GROUP_ORDER = ['scene', 'communication', 'assessment', 'intervention', 'trap', 'silly'];

// ----- prefs (the only things remembered across reloads, besides progress) -----

function getPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return fallback ? v !== 'off' : v === 'on';
  } catch { return fallback; }
}
function setPref(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
}

export const getHintsPref = () => getPref('triage.hints', true);
export const setHintsPref = (on: boolean) => setPref('triage.hints', on);
/** Quick-time events: sudden events that pause the game and ask for a response. Off by default. */
export const getQtePref = () => getPref('triage.qte', false);
export const setQtePref = (on: boolean) => setPref('triage.qte', on);
/** Sound for whistle signals. On by default. */
export const getSoundPref = () => getPref('triage.sound', true);
export const setSoundPref = (on: boolean) => setPref('triage.sound', on);

// ----- url -----

/** Route parts from the hash, e.g. "#/play?scene=x&auto=3" -> { path: ['play'], query } */
export function parseHash(hash: string): { path: string[]; query: URLSearchParams } {
  const [p, q = ''] = hash.replace(/^#/, '').split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

/** ?seed= in the page URL (or in the hash query) when present, otherwise a fresh random one. */
export function seedFromUrl(hashQuery?: URLSearchParams): string | null {
  return new URLSearchParams(location.search).get('seed') ?? hashQuery?.get('seed') ?? null;
}
/** Seeds double as challenge codes, so they are short and easy to read out: five characters, no 0/O or 1/I. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomSeed(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// ----- tag colours -----

/** CSS custom properties for a category colour: the colour and a text colour with enough contrast on it. */
export function tagVars(hex: string): string {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const ink = (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#111111' : '#ffffff';
  return `--tag:${esc(hex)};--tag-ink:${ink}`;
}
