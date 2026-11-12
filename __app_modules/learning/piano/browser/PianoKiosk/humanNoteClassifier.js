/**
 * humanNoteClassifier — tells a note a child played from a note the piano
 * generated itself. Pure, causal (decides each note when it arrives), no React.
 *
 * Why: the piano's rhythm/style button streams a drum pattern (and, with
 * auto-accompaniment, chord parts) out of the same BLE-MIDI port as the keys.
 * Every one of those notes used to reset the lesson's 90 s "still there?"
 * timer, so a lesson could play to the end — and be credited — with nobody at
 * the piano (ops:docs/_wip/audits/2026-11-12-piano-lesson-engagement-audit.md
 * §4.3, §8.1).
 *
 * What the hardware sends (the piano-port recorder's raw takes, which keep the
 * channel, Oct–Nov 2026): the keys play on channel 1; the rhythm pattern is on
 * channel 10 (GM percussion — kick 36, side-stick 37, hi-hat 42, congas 62–64,
 * triangle 80/81, shaker 82); auto-accompaniment parts sit on channels 5–9 and
 * 11–13. The tablet's piano-bridge forwards notes WITHOUT a channel, so for
 * those the classifier recognises the rhythm loop by its shape instead:
 *
 *   - rhythm loop: a 10 s window with ≥20 notes, ≥40% on core GM-percussion
 *     pitches and ≥70% on percussion-range pitches, held for ≥20 s (the audit's
 *     detector, made causal). While it runs, notes on the loop's own pitches
 *     are machine; anything else the child plays still counts.
 *   - machine-regular: ≥12 consecutive onsets on a ±5 ms grid with velocity
 *     flat to within 2 — clockwork no hand produces (a sequencer, a demo song).
 *
 * MIDI clock / start / stop / active-sensing never reach here: the bridge and
 * parseMidiMessage both drop system real-time bytes before a note exists.
 *
 * Channels are 0-based here (parseMidiMessage's convention): 9 = MIDI ch 10.
 */

/** GM percussion pitches that are (almost) never a beginner's melody note. */
export const CORE_PERCUSSION = new Set([33, 35, 36, 37, 38, 40, 42, 44, 46, 51, 54, 80, 81, 82]);
/** Everything a rhythm pattern plays — includes melodic-range congas/bells. */
export const PERCUSSION_RANGE = new Set([...CORE_PERCUSSION, 49, 53, 56, 57, 59, 62, 63, 64, 67, 68]);

/** 0-based channels a hand plays on: 1 (main) and 2–4 (layer/split). */
const HUMAN_CHANNELS = new Set([0, 1, 2, 3]);
const PERCUSSION_CHANNEL = 9;

export const DEFAULTS = Object.freeze({
  windowMs: 10000,       // loop-detector window
  armMs: 20000,          // window must qualify this long before the loop is "on"
  rearmMs: 3000,         // ...or this long when a loop stopped within rearmGraceMs
  rearmGraceMs: 60000,   //    (rhythm stop/start, a break bar: the same loop again)
  minWindowNotes: 20,
  minCoreShare: 0.4,
  minRangeShare: 0.7,
  minLoopPitchHits: 3,   // at arm time, a pitch recurring this often in the window is a loop pitch
  joinLoopPitchHits: 6,  // once running, a new pitch joins only at this rate (a child's
                         //   melody note on a conga pitch must not be swept in)
  chordMs: 15,           // onsets this close are one onset (a chord / one BLE packet)
  regularRun: 12,        // inter-onset intervals checked for clockwork
  regularJitterMs: 5,
  regularMinIoiMs: 40,
  regularMaxMultiple: 8,
  regularVelocitySpread: 2,
});

export function createHumanNoteClassifier(options = {}) {
  const o = { ...DEFAULTS, ...options };
  /** note-ons in the trailing window: { time, note } */
  let win = [];
  /** onsets (chord-grouped) for the clockwork test: { time, velocities: [] } */
  let onsets = [];
  let qualifySince = null;
  let loopOn = false;
  let loopPitches = new Set();
  let loopOffAt = -Infinity;
  let lastLoopPitches = new Set();
  const counts = { human: 0, machine: 0 };

  function trim(now) {
    const from = now - o.windowMs;
    let i = 0;
    while (i < win.length && win[i].time < from) i++;
    if (i) win = win.slice(i);
  }

  function windowStats() {
    let core = 0;
    let range = 0;
    const hits = new Map();
    for (const e of win) {
      if (CORE_PERCUSSION.has(e.note)) core++;
      if (PERCUSSION_RANGE.has(e.note)) {
        range++;
        hits.set(e.note, (hits.get(e.note) || 0) + 1);
      }
    }
    return { n: win.length, core, range, hits };
  }

  function pitchesFrom(hits) {
    const s = new Set();
    for (const [p, c] of hits) if (c >= o.minLoopPitchHits) s.add(p);
    return s;
  }

  /** Updates loop state for a note at `time`; returns 'loop-on' | 'loop-off' | null. */
  function updateLoop(time) {
    const { n, core, range, hits } = windowStats();
    const qualifies = n >= o.minWindowNotes && core / n >= o.minCoreShare && range / n >= o.minRangeShare;
    if (!loopOn) {
      if (!qualifies) { qualifySince = null; return null; }
      if (qualifySince == null) qualifySince = time;
      const armMs = time - loopOffAt <= o.rearmGraceMs ? o.rearmMs : o.armMs;
      if (time - qualifySince >= armMs) {
        loopOn = true;
        loopPitches = pitchesFrom(hits);
        // A re-arm is the same rhythm restarted: its slow pitches (a conga every
        // 2 s) can't show up in a 3 s arm window, so carry the last set over.
        if (armMs === o.rearmMs) for (const p of lastLoopPitches) loopPitches.add(p);
        return 'loop-on';
      }
      return null;
    }
    // Holding: judge the percussion-range notes alone, so a child playing over
    // the loop doesn't switch it off and let the drums count again.
    const holds = range >= o.minWindowNotes && core / range >= o.minCoreShare;
    if (holds) {
      const next = new Set();
      for (const p of loopPitches) if (hits.has(p)) next.add(p);
      for (const [p, c] of hits) if (c >= o.joinLoopPitchHits) next.add(p);
      loopPitches = next;
      return null;
    }
    loopOn = false;
    qualifySince = null;
    loopOffAt = time;
    lastLoopPitches = loopPitches;
    loopPitches = new Set();
    return 'loop-off';
  }

  function pushOnset(time, velocity) {
    const last = onsets[onsets.length - 1];
    if (last && time - last.time <= o.chordMs) last.velocities.push(velocity);
    else onsets.push({ time, velocities: [velocity] });
    if (onsets.length > o.regularRun + 1) onsets = onsets.slice(-(o.regularRun + 1));
  }

  function isClockwork() {
    if (onsets.length < o.regularRun + 1) return false;
    const iois = [];
    for (let i = 1; i < onsets.length; i++) iois.push(onsets[i].time - onsets[i - 1].time);
    const base = Math.min(...iois);
    if (base < o.regularMinIoiMs) return false;
    for (const d of iois) {
      const k = Math.round(d / base);
      if (k < 1 || k > o.regularMaxMultiple) return false;
      if (Math.abs(d - k * base) > o.regularJitterMs * k) return false;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const on of onsets) for (const v of on.velocities) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo <= o.regularVelocitySpread;
  }

  /**
   * Classify one note-on. `time` is epoch ms of the MIDI event; `channel`
   * (0-based) when the source knows it, else undefined.
   * @returns {{ human: boolean, reason: string, transition: 'loop-on'|'loop-off'|null }}
   */
  function classify({ note, velocity = 64, time = Date.now(), channel } = {}) {
    let reason = 'human';
    let transition = null;
    if (Number.isInteger(channel) && !HUMAN_CHANNELS.has(channel)) {
      // A known non-keyboard channel is machine whatever it plays — and it never
      // feeds the shape detectors, which exist for channel-less sources.
      reason = channel === PERCUSSION_CHANNEL ? 'percussion-channel' : 'accompaniment-channel';
    } else {
      win.push({ time, note });
      trim(time);
      transition = updateLoop(time);
      pushOnset(time, velocity);
      if (loopOn && loopPitches.has(note)) reason = 'rhythm-loop';
      else if (isClockwork()) reason = 'machine-regular';
    }
    const human = reason === 'human';
    counts[human ? 'human' : 'machine']++;
    return { human, reason, transition };
  }

  return {
    classify,
    /** The rhythm loop is on now. */
    get loopActive() { return loopOn; },
    /** Pitches the running loop is playing (empty when off) — never ask a child for one. */
    get loopPitches() { return new Set(loopPitches); },
    get counts() { return { ...counts }; },
    reset() {
      win = []; onsets = []; qualifySince = null; loopOn = false; loopOffAt = -Infinity; lastLoopPitches = new Set(); loopPitches = new Set();
      counts.human = 0; counts.machine = 0;
    },
  };
}

export default createHumanNoteClassifier;
