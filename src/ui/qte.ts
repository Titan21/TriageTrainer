// Quick-time prompts: a full-screen modal over the play screen that pauses the game and asks for a response
// within a time limit. The engine decides what is right; this file never learns the answer before the player
// has given theirs. Signals (whistle patterns) are shown as bars and, with sound on, played with WebAudio.
import { answerPrompt } from './engine';
import { crossIcon, tickIcon } from './components';
import { blastStarts, playBlasts, signalSeconds, type Playing } from './sound';
import { esc } from './util';
import type { AnswerResult, Prompt, Session } from './types';

/** Input is ignored for this long after the choices appear, so a double tap on the play screen cannot answer by accident. */
const GUARD_MS = 350;
/** A correct, fast answer is shown this long before the next prompt (or the game) continues. */
const AUTO_CONTINUE_MS = 1500;

type Verdict = 'good' | 'slow' | 'wrong' | 'froze';
const VERDICT_TITLE: Record<Verdict, string> = { good: 'Good response', slow: 'Right call, but slow', wrong: 'Not the right response', froze: 'Time ran out' };

let active: { cancel(): void } | null = null;

/** Closes any open prompt without answering it (the player left the play screen). */
export function cancelPrompts(): void { active?.cancel(); }

const signalHtml = (p: Prompt) => p.signal
  ? `<div class="qte-signal" role="img" aria-label="Signal pattern: ${esc(p.signal.pattern.toLowerCase())}">${p.signal.blasts.map((len) => `<span class="qte-blast is-wait" style="--len:${len}"></span>`).join('')}</div>`
  : '';

const choicesHtml = (p: Prompt) => p.choices.map((c, i) =>
  `<button type="button" class="qte-choice" data-choice="${esc(c.id)}" aria-keyshortcuts="${i + 1}" disabled><span class="qte-num" aria-hidden="true">${i + 1}</span><span class="qte-label">${esc(c.label)}</span></button>`).join('');

/**
 * Shows the pending prompt (and any follow-up or queued ones after it) until all are answered.
 * Resolves with the last answer, or null when there was nothing to ask or the prompt was cancelled.
 */
export async function runPrompts(s: Session, o: { sound: boolean }): Promise<AnswerResult | null> {
  if (!s.prompt || active) return null;

  const host = document.querySelector<HTMLElement>('#app');
  const root = document.createElement('div');
  root.className = 'qte';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'qte-kicker');
  root.setAttribute('aria-describedby', 'qte-cue');
  root.innerHTML = `<div class="qte-panel" tabindex="-1">
    <p class="qte-kicker" id="qte-kicker">Respond now</p>
    <p class="qte-cue" id="qte-cue"></p>
    <div data-slot="signal"></div>
    <p class="qte-status" data-slot="status"></p>
    <div class="qte-timer" data-slot="timer" aria-hidden="true"><div class="qte-bar"><span></span></div><span class="qte-secs mono"></span></div>
    <div class="qte-choices" data-slot="choices" role="group" aria-label="Your response"></div>
    <div class="qte-result" data-slot="result" hidden></div>
    <p class="sr-only" role="status" data-slot="live"></p>
  </div>`;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const panel = q('.qte-panel');
  const cueEl = q('#qte-cue');
  const signalEl = q('[data-slot="signal"]');
  const statusEl = q('[data-slot="status"]');
  const timerEl = q('[data-slot="timer"]');
  const barEl = q('.qte-bar > span');
  const secsEl = q('.qte-secs');
  const choicesEl = q('[data-slot="choices"]');
  const resultEl = q('[data-slot="result"]');
  const liveEl = q('[data-slot="live"]');

  host?.setAttribute('inert', '');
  document.documentElement.classList.add('qte-open');
  document.body.append(root);
  panel.focus({ preventScroll: true });

  // Waits that must end at once when the prompt is cancelled.
  let cancelled = false;
  const pending = new Set<() => void>();
  function gate<T>(setup: (done: (v: T) => void) => () => void): Promise<T | null> {
    return new Promise((resolve) => {
      let off = () => {};
      const release = (v: T | null) => { pending.delete(cancel1); off(); resolve(v); };
      const cancel1 = () => release(null);
      pending.add(cancel1);
      off = setup((v) => release(v));
    });
  }
  const sleep = (ms: number) => gate<true>((done) => { const id = window.setTimeout(() => done(true), ms); return () => clearTimeout(id); });

  let playing: Playing | null = null;
  const close = () => {
    playing?.stop();
    root.remove();
    host?.removeAttribute('inert');
    document.documentElement.classList.remove('qte-open');
    document.removeEventListener('keydown', onKey, true);
    active = null;
  };
  active = { cancel() { cancelled = true; [...pending].forEach((f) => f()); close(); } };

  // Tab stays inside the prompt; Escape does nothing (the prompt has to be answered).
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])')).filter((b) => !b.closest('[hidden]'));
    if (!items.length) { e.preventDefault(); panel.focus({ preventScroll: true }); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);

  /** One prompt: show the cue (and signal), then run the clock until the player answers or time runs out. */
  async function ask(p: Prompt): Promise<{ answer: AnswerResult; answered: boolean } | null> {
    const event = s.events.find((e) => e.def.id === p.eventId);
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    choicesEl.hidden = false;
    cueEl.textContent = p.cue;
    signalEl.innerHTML = signalHtml(p);
    choicesEl.innerHTML = choicesHtml(p);
    barEl.style.width = '100%';
    secsEl.textContent = `${p.limitSeconds.toFixed(1)} s`;
    timerEl.hidden = false;
    timerEl.style.visibility = 'hidden';
    statusEl.textContent = '';
    liveEl.textContent = '';
    panel.classList.remove('is-shaking');
    if (event?.def.type === 'aftershock' && p.step === 0) { void panel.offsetWidth; panel.classList.add('is-shaking'); }

    if (p.signal) {
      const bars = Array.from(signalEl.querySelectorAll<HTMLElement>('.qte-blast'));
      playing = o.sound ? await playBlasts(p.signal.blasts) : null;
      if (cancelled) return null;
      if (playing) {
        statusEl.textContent = 'Listen to the whole signal.';
        const starts = blastStarts(p.signal.blasts);
        bars.forEach((b, i) => {
          window.setTimeout(() => { b.className = 'qte-blast is-on'; }, 50 + starts[i] * 1000);
          window.setTimeout(() => { b.className = 'qte-blast is-done'; }, 50 + (starts[i] + p.signal!.blasts[i]) * 1000);
        });
        await sleep(50 + signalSeconds(p.signal.blasts) * 1000 + 150);
        if (cancelled) return null;
      } else bars.forEach((b) => { b.className = 'qte-blast is-done'; });
    }

    // The clock starts now: the cue (and the whole signal) has been given.
    statusEl.textContent = 'Choose a response. Keys 1 to 6 work too.';
    liveEl.textContent = `${p.limitSeconds} seconds to respond. Choose a response.`;
    timerEl.style.visibility = 'visible';
    const buttons = Array.from(choicesEl.querySelectorAll<HTMLButtonElement>('.qte-choice'));
    buttons.forEach((b) => { b.disabled = false; });
    buttons[0]?.focus({ preventScroll: true });
    const t0 = performance.now();
    // Answer within the limit for full marks; a grace period of the same length still
    // counts a right answer, as slow. After that you froze.
    const limitMs = p.limitSeconds * 1000;
    const hardMs = limitMs * 2;

    const got = await gate<{ id: string | null }>((done) => {
      let raf = 0;
      timerEl.classList.remove('is-late');
      const tick = () => {
        const elapsed = performance.now() - t0;
        const late = elapsed > limitMs;
        const left = late ? Math.max(0, hardMs - elapsed) : limitMs - elapsed;
        timerEl.classList.toggle('is-late', late);
        barEl.style.width = `${(left / limitMs) * 100}%`;
        secsEl.textContent = late ? `Late: ${(left / 1000).toFixed(1)} s` : `${(left / 1000).toFixed(1)} s`;
        if (elapsed < hardMs) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const timeout = window.setTimeout(() => done({ id: null }), hardMs);
      const pick = (id: string) => { if (performance.now() - t0 >= GUARD_MS) done({ id }); };
      const onClick = (e: Event) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-choice]');
        if (b) pick(b.dataset.choice!);
      };
      const onNumber = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
        const n = Number(e.key);
        if (n >= 1 && n <= p.choices.length) { e.preventDefault(); pick(p.choices[n - 1].id); }
      };
      choicesEl.addEventListener('click', onClick);
      document.addEventListener('keydown', onNumber, true);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timeout);
        choicesEl.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onNumber, true);
      };
    });
    if (!got || cancelled) return null;
    const seconds = got.id ? Math.min(hardMs, performance.now() - t0) / 1000 : hardMs / 1000;
    buttons.forEach((b) => { b.disabled = true; });
    return { answer: answerPrompt(s, got.id, seconds), answered: got.id != null };
  }

  /** What happened, until the player continues (a good, fast answer moves on by itself). */
  async function showResult(r: AnswerResult, answered: boolean): Promise<void> {
    const verdict: Verdict = !answered ? 'froze' : !r.correct ? 'wrong' : r.fast ? 'good' : 'slow';
    panel.classList.remove('is-shaking');
    choicesEl.hidden = true;
    timerEl.hidden = true;
    statusEl.textContent = '';
    resultEl.hidden = false;
    resultEl.innerHTML = `<p class="qte-result-head">${verdict === 'good' ? tickIcon() : crossIcon()}<span>${VERDICT_TITLE[verdict]}</span></p>
      <p class="qte-result-text">${esc(r.text)}</p>
      <button type="button" class="btn btn-primary btn-big btn-block" data-continue>Continue</button>`;
    liveEl.textContent = `${VERDICT_TITLE[verdict]}. ${r.text}`;
    const next = resultEl.querySelector<HTMLButtonElement>('[data-continue]')!;
    next.focus({ preventScroll: true });
    await gate<true>((done) => {
      const click = () => done(true);
      next.addEventListener('click', click);
      const timer = verdict === 'good' ? window.setTimeout(() => done(true), AUTO_CONTINUE_MS) : 0;
      return () => { next.removeEventListener('click', click); clearTimeout(timer); };
    });
  }

  let last: AnswerResult | null = null;
  try {
    while (s.prompt && !cancelled) {
      const got = await ask(s.prompt);
      if (!got || cancelled) break;
      last = got.answer;
      await showResult(got.answer, got.answered);
    }
  } finally {
    if (!cancelled) close();
  }
  return cancelled ? null : last;
}
