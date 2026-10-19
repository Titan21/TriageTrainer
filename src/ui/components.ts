import { content } from './engine';
import { app } from './state';
import { esc, setHintsPref, tagVars } from './util';

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

export function hintsToggle(): string {
  return `<label class="switch"><input type="checkbox" role="switch" data-hints ${app.hints ? 'checked' : ''}>
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    <span class="switch-text"><strong>Hints</strong><small>A nudge line and an explanation when an action is wrong. Turn off to test yourself.</small></span></label>`;
}

export function bindHintsToggle(root: HTMLElement): void {
  root.querySelector<HTMLInputElement>('[data-hints]')?.addEventListener('change', (e) => {
    app.hints = (e.target as HTMLInputElement).checked;
    setHintsPref(app.hints);
  });
}

export function header(): string {
  return `<header class="appbar"><a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">+</span>Triage Trainer</a></header>`;
}
