/**
 * The board's voice.
 *
 * Synthesised rather than sampled, for three reasons that all matter here: no
 * asset to load on a tablet that is already tight on memory, no decode step
 * before the first cue can play, and cues that can be retuned by editing two
 * numbers instead of re-recording.
 *
 * Everything is a short enveloped tone. This screen sits in front of a piano,
 * so anything longer or more melodic competes with the instrument the child is
 * actually playing — the cues confirm, they do not perform.
 *
 * The whole module is best-effort: a WebView that refuses an AudioContext, or a
 * page that has not been gestured at yet, must cost the game nothing. Every
 * entry point swallows its own failure.
 */

let context = null;
let failed = false;

/** The shared context, created on first use so nothing is built for a silent game. */
function audio() {
  if (failed) return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { failed = true; return null; }
      context = new Ctor();
    }
    // Autoplay policy parks the context until a gesture. Resuming here is
    // cheap and turns the first cue after a keypress into the one that works.
    if (context.state === 'suspended') context.resume?.();
    return context;
  } catch {
    failed = true;
    return null;
  }
}

/**
 * One enveloped tone.
 *
 * The envelope is the point: a bare oscillator switched on and off clicks at
 * both ends, and a click is what a broken speaker sounds like. Attack is kept
 * very short so a move still feels struck rather than swelled.
 */
function tone({ frequency, durationMs, type = 'sine', gain = 0.06, delayMs = 0 }) {
  const ctx = audio();
  if (!ctx) return;
  const startAt = ctx.currentTime + delayMs / 1000;
  const endAt = startAt + durationMs / 1000;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  envelope.gain.setValueAtTime(0, startAt);
  envelope.gain.linearRampToValueAtTime(gain, startAt + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.02);
}

/**
 * The cue vocabulary.
 *
 * Pitched deliberately against each other: everything the player did right sits
 * in one register, the refusal sits below it, and the alarm is the only
 * dissonance on the board — the same discipline the visual channels follow,
 * where red is spent only on check.
 */
export const CUES = Object.freeze({
  /** A piece lands. Low, short, woody — a piece set down on a board. */
  move: () => tone({ frequency: 180, durationMs: 90, type: 'triangle', gain: 0.05 }),
  /** Something was taken. Brighter, and a touch longer, so it is distinct. */
  capture: () => {
    tone({ frequency: 320, durationMs: 70, type: 'triangle', gain: 0.05 });
    tone({ frequency: 480, durationMs: 120, type: 'triangle', gain: 0.045, delayMs: 55 });
  },
  /** The board says no. Below everything else, and the only square wave. */
  refuse: () => tone({ frequency: 110, durationMs: 160, type: 'square', gain: 0.035 }),
  /** Check. A rising pair — an alarm, not a verdict. */
  check: () => {
    tone({ frequency: 494, durationMs: 110, type: 'sine', gain: 0.055 });
    tone({ frequency: 740, durationMs: 160, type: 'sine', gain: 0.055, delayMs: 100 });
  },
  /** The game is won. The one cue allowed to be a phrase. */
  win: () => {
    [523, 659, 784, 1047].forEach((frequency, index) => {
      tone({ frequency, durationMs: 260, type: 'sine', gain: 0.05, delayMs: index * 110 });
    });
  },
  /** A pawn became a queen. Bright and rising, distinct from a capture. */
  promote: () => {
    [659, 988].forEach((frequency, index) => {
      tone({ frequency, durationMs: 200, type: 'sine', gain: 0.05, delayMs: index * 120 });
    });
  },
  /** The game is lost. The same shape, falling, and shorter. */
  lose: () => {
    [392, 330, 262].forEach((frequency, index) => {
      tone({ frequency, durationMs: 280, type: 'sine', gain: 0.045, delayMs: index * 130 });
    });
  },
});

/** Play a named cue. Unknown names and a dead context are both no-ops. */
export function playCue(name) {
  try {
    CUES[name]?.();
  } catch {
    // A cue is never worth an exception reaching the game.
  }
}

export default { playCue, CUES };
