// The play screen. The page skeleton is built once; each region is re-rendered on its own
// (setHtml skips regions that did not change), so focus, scroll and the live regions stay stable.
import {
  approach, availableActions, clockText, content, debrief, hint, leave, moveSeconds, perform, picture,
} from './engine';
import { renderCard } from './card';
import { catName, tagBadge } from './components';
import { closeDialog, openDialog } from './dialog';
import { casualtyLabel, renderMap } from './map';
import { app } from './state';
import { esc, groupHeading, GROUP_ORDER, mmss, plural, setHtml, tagVars } from './util';
import type { Action, Session } from './types';

const TOAST_MS = 7000;

const actionBtn = (a: Action) =>
  `<button type="button" class="act" data-action="${esc(a.id)}" data-key="a-${esc(a.id)}"><span class="act-label">${esc(a.label)}</span><span class="act-cost">${a.timeCostSeconds}&nbsp;s</span></button>`;

const capId = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function mountPlay(root: HTMLElement, opts: { dialog?: string | null } = {}): () => void {
  const s = app.session as Session;
  const ui = app.play;
  const scene = s.scene;
  const fullScene = scene.mode === 'full_scene';
  const target = scene.targetSeconds ?? content.rules.scoring.targetSecondsPerCasualty * s.order.length;
  let toastTimer = 0;
  let lastCurrent: string | null = '\0'; // never equal to a real id, so the first render centres the current chip

  root.innerHTML = `<div class="play">
    <header class="topbar">
      <div class="topbar-row" id="pb-bar"></div>
      <div class="urgent" id="pb-urgent" role="alert" hidden></div>
    </header>
    <section class="strip${fullScene ? ' has-map' : ''}" id="pb-strip" aria-label="Casualties"></section>
    <div class="cols">
      <div class="col col-a">
        <section class="block b-casualty" id="pb-casualty"></section>
        <section class="block b-card" id="pb-card"></section>
      </div>
      <div class="col col-b">
        <section class="block b-result" id="pb-result" aria-live="polite" aria-atomic="true"></section>
        <section class="block b-next" id="pb-next"></section>
        <section class="block b-hint" id="pb-hint"></section>
        <section class="block b-actions" id="pb-actions"></section>
        <section class="block b-log" id="pb-log"></section>
      </div>
    </div>
    <div class="toast" id="pb-toast" aria-hidden="true" hidden></div>
  </div>`;
  const play = root.querySelector<HTMLElement>('.play')!;
  const el = (id: string) => root.querySelector<HTMLElement>(`#pb-${id}`)!;
  const R = {
    bar: el('bar'), urgent: el('urgent'), strip: el('strip'), casualty: el('casualty'), card: el('card'),
    result: el('result'), next: el('next'), hint: el('hint'), actions: el('actions'), log: el('log'), toast: el('toast'),
  };

  const displayText = (m: { text: string }) => m.text;

  // ----- regions -----

  function renderBar() {
    const over = s.clock > target;
    const w = Math.min(100, (s.clock / target) * 100).toFixed(0);
    setHtml(R.bar, `<div class="tb-item"><span class="tb-label">Scene clock</span><span class="tb-value mono">${clockText(s, s.clock, true)}</span></div>
      <div class="tb-item tb-time${over ? ' is-over' : ''}"><span class="tb-label">Elapsed / target</span><span class="tb-value mono">${mmss(s.clock)} / ${mmss(target)}</span>
        <span class="meter" aria-hidden="true"><span style="width:${w}%"></span></span></div>
      <button type="button" class="btn btn-quiet tb-finish" data-act="finish" data-key="finish">Finish</button>`);
  }

  function renderUrgent() {
    const m = s.messages.at(-1);
    const ev = m?.event ? s.events.find((e) => e.def.id === m.event) : undefined;
    const show = !!m?.urgent && !ev?.resolved;
    if (!show || !m) { R.urgent.hidden = true; setHtml(R.urgent, ''); return; }
    const left = app.hints && ev?.deadlineAt != null && !ev.missed ? Math.max(0, Math.round(ev.deadlineAt - s.clock)) : null;
    R.urgent.hidden = false;
    setHtml(R.urgent, `<span class="urgent-icon" aria-hidden="true">!</span>
      <div class="urgent-text"><strong>Urgent</strong> <span class="mono">${clockText(s, m.t, true)}</span> ${esc(displayText(m))}${left != null ? ` <span class="urgent-left">About ${left} s to respond.</span>` : ''}</div>
      <button type="button" class="btn btn-small" data-act="scene-actions" data-key="urgent-scene">Scene actions</button>`);
  }

  function renderStrip() {
    const tagged = [...s.casualties.values()].filter((rc) => rc.tag).length;
    const chips = s.order.map((id, i) => {
      const rc = s.casualties.get(id)!;
      const cat = rc.tag ? content.categories.get(rc.tag.category) : null;
      const here = s.current === id;
      const secs = moveSeconds(s.position, rc.position);
      let status: string;
      if (cat) status = `<span class="chip-tag"><span class="tagbadge-dot" aria-hidden="true"></span>${esc(capId(cat.id))} · ${esc(cat.label)}</span>`;
      else if (here) status = 'Here';
      else if (rc.visitedAt != null) status = 'Seen';
      else status = 'Not seen yet';
      const cls = ['chip', here ? 'is-current' : '', cat ? 'is-tagged' : '', rc.visitedAt != null ? 'is-seen' : ''].filter(Boolean).join(' ');
      const aria = `${casualtyLabel(s, id)}, ${cat ? `tagged ${cat.id}, ${cat.label}` : rc.visitedAt != null ? 'seen' : 'not seen yet'}${here ? ', current' : `, ${secs} seconds to reach`}`;
      return `<button type="button" class="${cls}" data-approach="${esc(id)}" data-key="c-${esc(id)}"${here ? ' aria-current="true"' : ''}${cat ? ` style="${tagVars(cat.colour)}"` : ''} aria-label="${esc(aria)}">
        <span class="chip-top"><span class="chip-num" aria-hidden="true">${i + 1}</span><span class="chip-name">${esc(casualtyLabel(s, id))}</span>${here ? '' : `<span class="chip-cost" aria-hidden="true">${secs}&nbsp;s</span>`}</span>
        <span class="chip-status" aria-hidden="true">${status}</span></button>`;
    }).join('');
    const sceneChip = `<button type="button" class="chip chip-scene${s.current ? '' : ' is-current'}" data-act="scene" data-key="c-scene"${s.current ? '' : ' aria-current="true"'}>
      <span class="chip-top"><span class="chip-name">Scene</span></span><span class="chip-status">Overview and scene actions</span></button>`;
    const prevRail = R.strip.querySelector<HTMLElement>('.rail');
    const prevLeft = prevRail?.scrollLeft ?? 0;
    const changed = setHtml(R.strip, `<div class="strip-head"><h2>Casualties</h2><span class="muted">${tagged} of ${s.order.length} tagged</span></div>
      <div class="rail" role="group" aria-label="Casualties, tap one to go to them">${sceneChip}${chips}</div>
      ${fullScene ? `<details class="map-panel"${ui.mapOpen ? ' open' : ''}><summary>Scene map</summary>${renderMap(s)}</details>` : ''}`);
    if (changed) {
      const rail = R.strip.querySelector<HTMLElement>('.rail')!;
      rail.scrollLeft = prevLeft;
      if (lastCurrent !== s.current) {
        const cur = rail.querySelector<HTMLElement>('.is-current');
        if (cur) rail.scrollLeft = cur.offsetLeft - (rail.clientWidth - cur.offsetWidth) / 2;
      }
    }
    lastCurrent = s.current;
  }

  function renderCasualtyPanel() {
    const rc = s.current ? s.casualties.get(s.current) : undefined;
    if (!rc) {
      const b = scene.briefing;
      const near = (scene.bystanders ?? []).map((by) => `<li>${esc(by.description)}${by.lines?.[0] ? ` <q>${esc(by.lines[0])}</q>` : ''}</li>`).join('');
      setHtml(R.casualty, `<article class="cpanel scene-overview"><header class="cpanel-head"><h2 tabindex="-1">Scene overview</h2></header>
        <p class="approach">Choose a casualty above to go to them, or use a scene action. Moving between casualties costs time.</p>
        <dl class="facts facts-stack">
          ${b.type ? `<div><dt>Incident</dt><dd>${esc(b.type)}</dd></div>` : ''}
          ${b.hazards ? `<div><dt>Hazards</dt><dd>${esc(b.hazards)}</dd></div>` : ''}
          <div><dt>Casualties</dt><dd>${plural(s.order.length, 'casualty', 'casualties')} in this scene</dd></div>
        </dl>
        ${near ? `<h3>Nearby</h3><ul class="nearby">${near}</ul>` : ''}</article>`);
      return;
    }
    const idx = s.order.indexOf(rc.id);
    const name = casualtyLabel(s, rc.id);
    const svg = picture(s, rc.id, 'play', `${name}: picture of the casualty as you see them`);
    const cat = rc.tag?.category ?? null;
    setHtml(R.casualty, `<article class="cpanel"><header class="cpanel-head"><h2 tabindex="-1">${esc(name)}</h2>
        <span class="muted">${idx + 1} of ${s.order.length}</span>${tagBadge(cat, cat ? 'Tagged: ' : '')}</header>
      <div class="picture">${svg}</div>
      <p class="approach">${esc(rc.def.approach)}</p></article>`);
  }

  function renderResult() {
    const r = ui.last;
    if (!r) { setHtml(R.result, '<p class="result-empty">Nothing done yet. Go to a casualty, or call out for anyone who can walk.</p>'); return; }
    const wrong = !r.correct && app.hints;
    setHtml(R.result, `<div class="result${r.ok ? '' : ' is-warn'}${wrong ? ' is-wrong' : ''}">
      <div class="result-head"><strong>${esc(r.title)}</strong>${r.seconds ? `<span class="mono">${r.seconds}&nbsp;s</span>` : ''}</div>
      ${r.text ? `<p>${esc(r.text)}</p>` : ''}
      ${wrong ? `<p class="result-feedback"><strong>Not needed here.</strong> ${esc(r.feedback ?? 'This did not help with the sieve.')}</p>` : ''}</div>`);
  }

  function nextCasualty(): string | null {
    const start = s.current ? s.order.indexOf(s.current) : -1;
    for (let k = 1; k <= s.order.length; k++) {
      const id = s.order[(start + k) % s.order.length];
      if (id !== s.current && !s.casualties.get(id)!.tag) return id;
    }
    return null;
  }

  function renderNext() {
    const rc = s.current ? s.casualties.get(s.current) : undefined;
    if (!rc?.tag) { setHtml(R.next, ''); return; }
    const id = nextCasualty();
    if (id) {
      setHtml(R.next, `<button type="button" class="btn btn-primary btn-block" data-approach="${esc(id)}" data-key="next">Go to the next casualty: ${esc(casualtyLabel(s, id))} <span class="mono">${moveSeconds(s.position, s.casualties.get(id)!.position)}&nbsp;s</span></button>`);
    } else {
      setHtml(R.next, `<p class="all-done">Everyone is tagged. Finish when you are ready.</p>
        <button type="button" class="btn btn-primary btn-block" data-act="finish" data-key="finish2">Finish and see the debrief</button>`);
    }
  }

  function renderHint() {
    setHtml(R.hint, app.hints ? `<p class="hint"><span class="hint-label">Hint</span> ${esc(hint(s))}</p>` : '');
  }

  function renderActions() {
    const av = availableActions(s);
    const rc = s.current ? s.casualties.get(s.current) : undefined;
    const title = rc ? `Actions for ${esc(casualtyLabel(s, rc.id))}` : 'Scene actions';
    const main = [...av.core, ...av.extras].map(actionBtn).join('');
    let more = '';
    if (av.more.length) {
      const groups = new Map<string, Action[]>();
      const order = (g: string) => GROUP_ORDER.indexOf(g);
      for (const a of [...av.more].sort((x, y) => order(x.group) - order(y.group))) {
        const h = groupHeading(a.group);
        groups.set(h, [...(groups.get(h) ?? []), a]);
      }
      const body = [...groups].map(([h, list]) => {
        const items = h === 'Other actions' ? [...list].sort((x, y) => x.label.localeCompare(y.label)) : list;
        return `<h3>${esc(h)}</h3><div class="act-list">${items.map(actionBtn).join('')}</div>`;
      }).join('');
      more = `<details class="more"${ui.moreOpen ? ' open' : ''}><summary>More actions <span class="muted">(${av.more.length})</span></summary>${body}</details>`;
    }
    setHtml(R.actions, `<h2>${title}</h2><div class="act-list">${main}</div>${more}`);
  }

  function renderCardPanel() {
    if (!s.current) { R.card.hidden = true; setHtml(R.card, ''); return; }
    R.card.hidden = false;
    const { count, html } = renderCard(s, s.current);
    setHtml(R.card, `<details class="card-panel"${ui.cardOpen ? ' open' : ''}><summary>Triage card <span class="muted">${esc(casualtyLabel(s, s.current))} · ${plural(count, 'entry', 'entries')}</span></summary>
      ${html}</details>`);
  }

  function renderLog() {
    const msgs = s.messages.slice(-5).reverse();
    setHtml(R.log, msgs.length ? `<h2>Scene log</h2><ul class="log">${msgs.map((m) => `<li${m.urgent ? ' class="is-urgent"' : ''}><span class="mono">${clockText(s, m.t, true)}</span> ${esc(displayText(m))}</li>`).join('')}</ul>` : '');
  }

  function renderAll() {
    renderBar(); renderUrgent(); renderStrip(); renderCasualtyPanel(); renderResult(); renderNext();
    renderHint(); renderActions(); renderCardPanel(); renderLog();
  }

  // ----- toast (small screens: the result line may be scrolled out of view) -----

  function showToast() {
    const r = ui.last;
    if (!r) return;
    // No toast when the result line is already fully on screen (wide layouts, or a short scroll).
    const box = R.result.getBoundingClientRect();
    if (box.top >= R.bar.getBoundingClientRect().bottom && box.bottom <= window.innerHeight) { hideToast(); return; }
    const wrong = !r.correct && app.hints;
    R.toast.innerHTML = `<strong>${esc(r.title)}</strong> ${r.seconds ? `<span class="mono">${r.seconds}&nbsp;s</span>` : ''}<br>${esc(r.text)}${wrong ? `<br><em>Not needed here. ${esc(r.feedback ?? '')}</em>` : ''}`;
    R.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, TOAST_MS);
  }
  function hideToast() { R.toast.hidden = true; clearTimeout(toastTimer); }

  // ----- actions -----

  function goTo(id: string) {
    if (s.current === id) { window.scrollTo(0, 0); return; }
    const r = approach(s, id);
    ui.last = { title: `You walk to ${casualtyLabel(s, id)}`, seconds: r.seconds, text: '', ok: true, correct: true, feedback: null };
    hideToast();
    renderAll();
    window.scrollTo(0, 0);
    const active = document.activeElement;
    if (!active || active === document.body || !play.contains(active)) R.casualty.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  function toScene() {
    if (!s.current) return;
    leave(s);
    ui.last = { title: 'Back at the scene overview', seconds: 0, text: '', ok: true, correct: true, feedback: null };
    hideToast();
    renderAll();
    window.scrollTo(0, 0);
  }

  function doAction(id: string) {
    if (id === 'tag_casualty' && s.current) { openTag(); return; }
    const a = content.actions.get(id);
    if (!a) return;
    const r = perform(s, id);
    ui.last = { title: a.label, seconds: r.seconds, text: r.text, ok: r.ok, correct: r.correct, feedback: r.feedback };
    renderAll();
    showToast();
  }

  function openTag() {
    const rc = s.casualties.get(s.current!)!;
    const name = casualtyLabel(s, rc.id);
    const cur = rc.tag ? `<p class="dlg-sub">Currently tagged ${esc(catName(rc.tag.category))}. Choose again to change it.</p>` : '<p class="dlg-sub">Choose the triage category.</p>';
    const buttons = [...content.categories.values()].map((c) =>
      `<button type="button" class="tag-btn" style="${tagVars(c.colour)}" data-dlg="${esc(c.id)}"><span class="tag-swatch" aria-hidden="true"></span><span class="tag-text"><strong>${esc(capId(c.id))}</strong><span>${esc(c.label)}</span></span></button>`).join('');
    openDialog({
      title: `Tag ${esc(name)}`,
      body: `${cur}<div class="tag-grid">${buttons}</div><button type="button" class="btn btn-block" data-dlg="cancel">Cancel</button>`,
      returnFocusKey: 'a-tag_casualty',
      onPick: (cat, close) => {
        close();
        const r = perform(s, 'tag_casualty', { category: cat });
        ui.last = { title: `Tag ${name}`, seconds: r.seconds, text: r.text, ok: r.ok, correct: r.correct, feedback: r.feedback };
        renderAll();
        showToast();
      },
    });
  }

  function confirmFinish() {
    const open = [...s.casualties.values()].filter((rc) => !rc.tag).length;
    openDialog({
      title: 'Finish this scene?',
      body: `<p class="dlg-sub">${open ? `${plural(open, 'casualty', 'casualties')} not tagged yet. Untagged casualties cost points.` : 'Everyone is tagged.'} You cannot come back to this scene afterwards.</p>
        <div class="dlg-actions"><button type="button" class="btn btn-block" data-dlg="cancel" autofocus>Keep playing</button>
        <button type="button" class="btn btn-primary btn-block" data-dlg="finish">Finish and see the debrief</button></div>`,
      returnFocusKey: 'finish',
      onPick: (name, close) => {
        if (name !== 'finish') return;
        close();
        app.report = debrief(s);
        location.hash = '#/debrief';
      },
    });
  }

  play.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-approach],[data-action],[data-act],#pb-toast');
    if (!t) return;
    if (t.id === 'pb-toast') { hideToast(); return; }
    if (t.dataset.approach) goTo(t.dataset.approach);
    else if (t.dataset.action) doAction(t.dataset.action);
    else if (t.dataset.act === 'finish') confirmFinish();
    else if (t.dataset.act === 'scene') toScene();
    else if (t.dataset.act === 'scene-actions') {
      toScene();
      R.actions.querySelector<HTMLElement>('.act')?.focus({ preventScroll: true });
      R.actions.scrollIntoView({ block: 'start' });
    }
  });
  // <details> toggles do not bubble, so listen in the capture phase.
  play.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.classList.contains('more')) ui.moreOpen = d.open;
    else if (d.classList.contains('card-panel')) ui.cardOpen = d.open;
    else if (d.classList.contains('map-panel')) ui.mapOpen = d.open;
  }, true);

  renderAll();
  R.casualty.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  if (opts.dialog === 'tag' && s.current) openTag();
  else if (opts.dialog === 'finish') confirmFinish();

  return () => { clearTimeout(toastTimer); closeDialog(); };
}
