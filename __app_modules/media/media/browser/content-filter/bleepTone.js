/**
 * bleepTone — the broadcast censor bleep: a 1 kHz sine (the test-pattern tone),
 * synthesized with Web Audio so no asset ships. Short gain ramps avoid the click
 * of a hard start/stop; level sits near dialogue, not full scale.
 *
 * The caller has already muted the video, so a tone that cannot sound (no Web
 * Audio, or a context the browser holds suspended until a gesture) degrades to a
 * plain mute — never to a leaked word. `onDegraded(reason)` reports it.
 */
export const BLEEP_HZ = 1000;

// One AudioContext for every tone in the page: browsers cap live contexts, and a
// player is built per profile. Created on first start (not import), and replaced
// if it has been closed.
let sharedCtx = null;
function sharedContext() {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  try { sharedCtx = Ctor ? new Ctor() : null; } catch (_) { sharedCtx = null; }
  return sharedCtx;
}

// A context the browser may hand back to us after a gesture or an interruption.
const RESUMABLE = new Set(['suspended', 'interrupted']);

export function createBleepTone({ createContext = sharedContext, level = 0.25, rampSec = 0.008, onDegraded } = {}) {
  let ctx = null;
  let osc = null;
  let gain = null;

  return {
    start() {
      if (osc) return true;
      if (!ctx || ctx.state === 'closed') ctx = createContext();
      if (!ctx) { onDegraded?.('no-audio-context'); return false; }
      if (ctx.state !== 'running') {
        if (RESUMABLE.has(ctx.state)) {
          try { ctx.resume?.()?.catch?.(() => {}); } catch (_) { /* ignore */ }
        }
        onDegraded?.(ctx.state);
        return false;
      }
      const t = ctx.currentTime;
      // Build both nodes before connecting either, so a failure leaves nothing
      // attached to the destination.
      let g; let o;
      try {
        g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + rampSec);
        o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(BLEEP_HZ, t);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
      } catch (_) {
        try { o?.disconnect?.(); g?.disconnect?.(); } catch (__) { /* ignore */ }
        onDegraded?.('node-error');
        return false;
      }
      osc = o; gain = g;
      return true;
    },
    stop() {
      if (!osc) return;
      const t = ctx.currentTime;
      const o = osc; const g = gain;
      osc = null; gain = null;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + rampSec);
      o.stop(t + rampSec);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (_) { /* ignore */ } };
    },
  };
}
