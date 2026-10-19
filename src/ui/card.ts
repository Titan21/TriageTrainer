// The IMISTAMBO triage card for one casualty.
import { card, clockText } from './engine';
import { esc } from './util';
import type { Session } from './types';

export function renderCard(s: Session, id: string): { count: number; html: string } {
  const fields = card(s, id);
  const count = fields.reduce((n, f) => n + f.entries.length, 0);
  const rows = fields.map((f) => {
    let body: string;
    if (f.entries.length) {
      body = `<ul class="imi-entries">${f.entries.map((e) => `<li><time class="mono">${clockText(s, e.t)}</time> ${esc(e.text)}</li>`).join('')}</ul>`;
    } else if (f.greyed) {
      body = '<span class="imi-note">after the first sweep</span>';
    } else {
      body = '<span class="imi-empty">empty</span>';
    }
    const note = f.greyed && f.entries.length ? '<span class="imi-note">after the first sweep</span>' : '';
    return `<li class="imi-row${f.greyed ? ' is-greyed' : ''}${f.entries.length ? '' : ' is-empty'}"${f.greyed ? ' aria-disabled="true"' : ''}>
      <span class="imi-letter" aria-hidden="true">${esc(f.letter)}</span>
      <div class="imi-body"><span class="imi-label">${esc(f.label)}</span>${note}${body}</div></li>`;
  }).join('');
  return { count, html: `<ol class="imi">${rows}</ol>` };
}
