// Small 0-100 scene map for full scenes: an SVG for the scenery, real buttons for the casualty dots.
import { content, moveSeconds } from './engine';
import * as E from '../game/session.js';
import { esc, tagVars } from './util';
import type { Pos, Session } from './types';

const PAD = 8;
const SPAN = 100 + PAD * 2;
const pct = (v: number) => (((v + PAD) / SPAN) * 100).toFixed(2);

export function casualtyLabel(s: Session, id: string): string {
  return E.displayName(s, id);
}

function hazardMark([x, y]: Pos, active: boolean, label: string): string {
  const tri = `M${x} ${y - 4.6} L${x + 4.4} ${y + 3} L${x - 4.4} ${y + 3} Z`;
  return `<g class="map-hazard ${active ? 'is-active' : ''}"><title>${esc(label)}</title><path d="${tri}"/><text x="${x}" y="${y + 1.9}" text-anchor="middle">!</text></g>`;
}

/** Nudge dots apart so they stay tappable (walkers who come to you all land within a few units of each other). */
function spread(points: Pos[], min = 11.5): Pos[] {
  const p = points.map(([x, y]) => [x, y] as Pos);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        let dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) { dx = Math.cos(i * 2.4); dy = Math.sin(i * 2.4); d = 1; } // identical spots: fan out
        const push = (min - d) / 2 + 0.05;
        const ux = dx / d, uy = dy / d;
        p[i] = [Math.min(100, Math.max(0, p[i][0] - ux * push)), Math.min(100, Math.max(0, p[i][1] - uy * push))];
        p[j] = [Math.min(100, Math.max(0, p[j][0] + ux * push)), Math.min(100, Math.max(0, p[j][1] + uy * push))];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return p;
}

export function renderMap(s: Session): string {
  const spots = spread(s.order.map((id) => s.casualties.get(id)!.position));
  const scenery: string[] = [];
  for (const g of [25, 50, 75]) scenery.push(`<line x1="${g}" y1="0" x2="${g}" y2="100"/><line x1="0" y1="${g}" x2="100" y2="${g}"/>`);
  const grid = `<g class="map-grid">${scenery.join('')}</g>`;
  const hazards = s.hazards.map((h) => {
    const desc = content.vocab.hazards[h.type]?.description ?? h.type;
    return hazardMark(h.position, h.active, `${h.type.replace(/_/g, ' ')}${h.active ? ' (active)' : ' (not active)'}: ${desc}`);
  }).join('');
  const bystanders = (s.scene.bystanders ?? []).filter((b) => b.position).map((b) =>
    `<g class="map-bystander"><title>${esc(`Bystander: ${b.description}`)}</title><circle cx="${b.position![0]}" cy="${b.position![1]}" r="2.1"/><circle cx="${b.position![0]}" cy="${b.position![1] - 3.6}" r="1.2"/></g>`).join('');
  const [px, py] = s.position;
  const you = `<g class="map-you"><title>You are here</title><circle cx="${px}" cy="${py}" r="5.2"/><text x="${px}" y="${Math.min(py + 10.5, 104)}" text-anchor="middle">You</text></g>`;
  const svg = `<svg class="map-svg" viewBox="${-PAD} ${-PAD} ${SPAN} ${SPAN}" aria-hidden="true" focusable="false">
    <rect class="map-area" x="0" y="0" width="100" height="100" rx="3"/>${grid}${hazards}${bystanders}${you}</svg>`;

  const dots = s.order.map((id, i) => {
    const rc = s.casualties.get(id)!;
    const cat = rc.tag ? content.categories.get(rc.tag.category) : null;
    const here = s.current === id;
    const [dx, dy] = spots[i];
    const status = cat ? `tagged ${cat.id}, ${cat.label}` : rc.visitedAt != null ? 'seen, not tagged' : `not seen, ${moveSeconds(s.position, rc.position)} seconds away`;
    const cls = ['map-dot', cat ? 'is-tagged' : '', rc.visitedAt != null ? 'is-seen' : '', here ? 'is-current' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" style="left:${pct(dx)}%;top:${pct(dy)}%;${cat ? tagVars(cat.colour) : ''}" data-approach="${esc(id)}" data-key="m-${esc(id)}" aria-label="${esc(`${casualtyLabel(s, id)}: ${status}${here ? ', you are here' : ''}`)}">${i + 1}${cat ? `<small>${esc(cat.id[0].toUpperCase())}</small>` : ''}</button>`;
  }).join('');

  return `<div class="map"><div class="map-frame">${svg}${dots}</div>
    <p class="map-legend"><span class="lg lg-dot">1</span> casualty, tap to go <span class="lg lg-haz">!</span> hazard (red when active) <span class="lg lg-you">You</span> you</p></div>`;
}
