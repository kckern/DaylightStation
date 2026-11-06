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

function defaultContext() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  try { return Ctor ? new Ctor() : null; } catch (_) { return null; }
}

export function createBleepTone({ createContext = defaultContext, level = 0.25, rampSec = 0.008, onDegraded } = {}) {
  let ctx = null;
  let osc = null;
  let gain = null;

  return {
    start() {
      if (osc) return true;
      if (!ctx) ctx = createContext();
      if (!ctx) { onDegraded?.('no-audio-context'); return false; }
      if (ctx.state === 'suspended') {
        try { ctx.resume?.()?.catch?.(() => {}); } catch (_) { /* ignore */ }
        onDegraded?.('suspended');
        return false;
      }
      const t = ctx.currentTime;
      gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + rampSec);
      gain.connect(ctx.destination);
      osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(BLEEP_HZ, t);
      osc.connect(gain);
      osc.start(t);
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
