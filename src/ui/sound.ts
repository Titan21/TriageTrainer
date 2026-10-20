// Whistle signals for quick-time prompts, made with WebAudio (no audio files). Every call is best effort:
// when audio is unavailable or blocked, the prompt still shows the pattern as text and bars.

const GAP_SECONDS = 0.4;
const PITCH_HZ = 2800;
const LEVEL = 0.12;

let ctx: AudioContext | null = null;
let unlocked = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  } catch { ctx = null; }
  return ctx;
}

/** Call from a tap or click so browsers that block autoplay (iOS Safari) allow sound later. */
export function unlockAudio(): void {
  const c = context();
  if (!c || (unlocked && c.state === 'running')) return;
  try {
    if (c.state === 'suspended') void c.resume();
    unlocked = true;
    const silent = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = silent;
    src.connect(c.destination);
    src.start(0);
  } catch { /* audio unavailable */ }
}

/** How long a signal takes to play, in seconds. */
export const signalSeconds = (blasts: number[]): number => blasts.reduce((a, b) => a + b, 0) + GAP_SECONDS * Math.max(0, blasts.length - 1);

/** Start times of each blast, in seconds from the start of the signal. */
export const blastStarts = (blasts: number[]): number[] => {
  let t = 0;
  return blasts.map((len) => { const at = t; t += len + GAP_SECONDS; return at; });
};

export interface Playing { stop(): void }

/**
 * Plays the blasts as whistle-like tones: a pitched sine with a fast wobble, a soft attack and release.
 * Resolves to null when sound cannot play (no audio support, or the browser keeps it suspended).
 */
export async function playBlasts(blasts: number[]): Promise<Playing | null> {
  const c = context();
  if (!c) return null;
  try {
    if (c.state !== 'running') await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 400))]);
    if (c.state !== 'running') return null;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(c.destination);
    const nodes: AudioScheduledSourceNode[] = [];
    const t0 = c.currentTime + 0.05;
    const starts = blastStarts(blasts);
    blasts.forEach((len, i) => {
      const start = t0 + starts[i];
      const end = start + len;
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = PITCH_HZ;
      const wobble = c.createOscillator();
      wobble.frequency.value = 32;
      const depth = c.createGain();
      depth.gain.value = 70;
      wobble.connect(depth).connect(osc.frequency);
      const env = c.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(LEVEL, start + 0.04);
      env.gain.setValueAtTime(LEVEL, Math.max(start + 0.04, end - 0.06));
      env.gain.linearRampToValueAtTime(0, end);
      osc.connect(env).connect(out);
      for (const n of [osc, wobble]) { n.start(start); n.stop(end + 0.05); nodes.push(n); }
    });
    return {
      stop() {
        try {
          out.gain.cancelScheduledValues(c.currentTime);
          out.gain.setValueAtTime(0, c.currentTime);
          for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } }
        } catch { /* audio unavailable */ }
      },
    };
  } catch { return null; }
}
