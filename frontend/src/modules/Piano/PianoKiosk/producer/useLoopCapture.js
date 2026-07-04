/**
 * useLoopCapture — the pass/take overdub recording engine (Task 6.1, design §5).
 *
 * DAW-loop-style, never one-shot: arm a cycle length, play; notes land in the
 * current PASS; at each cycle boundary the pass merges into the TAKE and the
 * cycle keeps rolling — you hear yourself immediately and keep thickening.
 *
 * SEAM DECISION (documented per plan): this hook is a WALL-CLOCK-ANCHORED pure
 * machine, NOT a transport consumer. `arm({ anchorWallMs })` fixes the cycle
 * origin; every note/tick event carries its own wallMs and the hook derives
 * bar/tick math from anchor + bpm/timeSig alone. Rationale over the
 * alternative (subscribing to useProducerTransport's onBar + positionRef):
 *   - zero coupling: capture works over a silent metronome, a playing jam, or
 *     in tests with a scripted clock — no transport instance required;
 *   - the transport still OWNS the audible experience (count-in clicks,
 *     metronome, jam playback); the Producer simply hands capture the wall
 *     time of the transport's content-start (or next bar boundary) as the
 *     anchor, so both clocks agree by construction (both are performance.now
 *     wall-clock driven);
 *   - purity: no Date.now / performance.now inside — every wallMs is
 *     injected, so tests are exact and the engine is deterministic.
 *
 * EVENT FEED: `usePianoMidi().subscribe(fn)` already emits
 * `{type:'note_on'|'note_off', note, velocity, time}` (see useWebMidiBLE's
 * raw note-event tap, built for the studio recorder). The Producer wires that
 * straight into noteOn/noteOff here — no MIDI-layer extension needed.
 *
 * INTEGRATION PRESCRIPTION (clock domain — the hook only compares wallMs
 * deltas against its own anchor, so every injected time MUST share ONE
 * monotonic domain):
 *   (a) the anchor and every tick() MUST come from performance.now() —
 *       monotonic; Date.now() can NTP-step mid-capture and shear every
 *       recorded tick;
 *   (b) in the MIDI subscribe callback, IGNORE evt.time (Date.now domain) and
 *       RE-STAMP with performance.now() — emit fires synchronously from the
 *       MIDI message handler, so nothing is lost in the re-stamp;
 *   (c) never mix the rAF callback's timestamp ARGUMENT with a Date.now
 *       anchor — the rAF arg is performance.now-domain, and the mismatch is a
 *       silent stuck-in-'counting' failure (wallMs forever < anchorMs).
 *
 * BOUNDARY DETECTION is lazy: rolls are computed from whatever wallMs arrives
 * next (note event OR the explicit `tick(wallMs)` the capture card's rAF
 * calls each frame). tick() exists so passes merge — and passCount updates —
 * even during silence.
 *
 * SEMANTICS (design-exact, each tested):
 *   - cycle tick = round(((wallMs − anchor) mod cycleMs) × ticksPerMs);
 *   - count-in notes (wallMs < anchor) are DROPPED, except within the 100ms
 *     EARLY-HIT GRACE: musicians anticipate beat 1, so a hit ≤100ms early
 *     snaps to tick 0 of the first cycle;
 *   - a note held ACROSS a cycle boundary closes AT the boundary (duration to
 *     cycle end) — loop-friendly: the loop replays it from its start tick
 *     each pass, so letting it bleed into the next pass would double it;
 *   - empty cycles do NOT increment passCount: a pass is a musical
 *     contribution, and undoPass must always undo something audible;
 *   - undoPass() removes only the most recent COMPLETED pass (per-pass
 *     provenance is kept internally); the in-flight pass is untouched;
 *   - clearTake() wipes completed passes AND the in-flight pass — a true
 *     fresh start — but keeps cycling;
 *   - disarm() discards the in-flight pass, KEEPS the take, → idle. Re-arm
 *     resumes layering onto the kept take (same lengthBars); re-arming with a
 *     DIFFERENT lengthBars clears the stale take (its ticks would spill past
 *     the new cycle) with a warn log. Full reset = clearTake() + disarm();
 *   - keep() returns the merged take WITHOUT clearing anything — design §5:
 *     "keeping doesn't stop the music"; the UI decides whether to keep
 *     layering or clear. In-flight (uncommitted) pass notes are NOT included;
 *     the UI disables Keep until passCount ≥ 1;
 *   - bpm/timeSig are SNAPSHOTTED at arm(): cycle geometry is frozen per
 *     armed session (a mid-capture tempo change would shear every recorded
 *     tick; the Producer re-arms after tempo changes).
 *
 * DRUM MODE (design §5): the keyboard becomes a drum kit, not a piano —
 * noteOn remaps the labeled white-key pad octave C2..D3 to GM drums (ch-10
 * pitches; see DRUM_KEY_MAP) and every key OUTSIDE the map is DROPPED.
 * Pending notes are keyed by the ORIGINAL incoming note so note-offs pair
 * correctly regardless of the remap. The kept take is tagged drumMode (state
 * at keep() time) → kind 'groove'.
 *
 * KEEP OUTPUT slots straight into workspaceReducer's ADD_LAYER take source:
 * { takeId, notes:[{ticks,durationTicks,midi,velocity}], ppq:480, lengthBars,
 *   kind, drumMode, timeline }.
 *   - snap 'sixteenth': note START ticks quantize to the ppq/4 = 120 grid
 *     (durations preserved; a start snapping to the cycle end wraps to tick 0
 *     — that hit IS the downbeat in loop space; ends clamp to the cycle);
 *   - kind inference (simple, documented, one-tap confirmable in the UI):
 *     drumMode → 'groove'; else ≥25% of notes overlapping another note →
 *     'chords', else 'melody' (both are valid layer roles);
 *   - citizenship: non-groove takes run the client-side harmonicTimeline
 *     analysis (root + slot occupancy + specificity) for the glyph/guardrail
 *     pipeline; failures are contained (timeline: null), never thrown.
 *
 * @param {{ bpm:number, timeSig?:[number,number] }} p
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { GM_DRUM } from '@shared-music/percussion.mjs';
import { harmonicTimeline } from '@shared-music/harmonicTimeline.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-producer-capture' });
  return _logger;
}
const SAMPLE_OPTS = { maxPerMinute: 20, aggregate: true };

export const PPQ = 480;
/** Early-hit grace window: a note this many ms before the anchor is beat 1. */
export const EARLY_GRACE_MS = 100;
/** snap:'sixteenth' grid — PPQ/4 ticks. */
const SIXTEENTH_TICKS = PPQ / 4;
/** Kind heuristic: this fraction of notes overlapping ⇒ 'chords'. */
const CHORDS_OVERLAP_RATIO = 0.25;

/**
 * Drum-pad remap (design §5 "labeled kick/snare/hats/toms/crash octave"):
 * incoming MIDI key (white keys C2..D3) → GM drum pitch. Exported for the
 * capture card's pad labels (Task 6.2).
 */
export const DRUM_KEY_MAP = Object.freeze({
  36: GM_DRUM.kick,      // C2
  38: GM_DRUM.snare,     // D2
  40: GM_DRUM.hatClosed, // E2
  41: GM_DRUM.hatOpen,   // F2
  43: GM_DRUM.tomLo,     // G2
  45: GM_DRUM.tomMid,    // A2
  47: GM_DRUM.tomHi,     // B2
  48: GM_DRUM.crash,     // C3
  50: GM_DRUM.ride,      // D3
});

const sanitizeBpm = (bpm) => (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
const sanitizeTimeSig = (ts) => {
  const [beats, beatType] = Array.isArray(ts) ? ts : [];
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return [ok(beats) ? beats : 4, ok(beatType) ? beatType : 4];
};

/** ≥25% of notes overlap another note → 'chords', else 'melody'. O(n²) is
 * fine at take scale; half-open interval overlap so back-to-back notes
 * (end == next start) do NOT count as simultaneous. */
function inferKind(notes) {
  if (notes.length < 2) return 'melody';
  let overlapping = 0;
  for (let i = 0; i < notes.length; i += 1) {
    const a = notes[i];
    const aEnd = a.ticks + a.durationTicks;
    for (let j = 0; j < notes.length; j += 1) {
      if (j === i) continue;
      const b = notes[j];
      if (a.ticks < b.ticks + b.durationTicks && b.ticks < aEnd) {
        overlapping += 1;
        break;
      }
    }
  }
  return overlapping / notes.length >= CHORDS_OVERLAP_RATIO ? 'chords' : 'melody';
}

export function useLoopCapture({ bpm, timeSig = [4, 4] }) {
  const [state, setState] = useState('idle'); // 'idle' | 'counting' | 'cycling'
  const [passCount, setPassCount] = useState(0);
  const [takeNoteCount, setTakeNoteCount] = useState(0);
  const [drumMode, setDrumModeState] = useState(false);

  // Latest props (snapshotted into geometry at arm()).
  const bpmRef = useRef(bpm); bpmRef.current = bpm;
  const timeSigRef = useRef(timeSig); timeSigRef.current = timeSig;
  const drumModeRef = useRef(false);

  // ── engine (refs only — every event handler reads/writes here) ────────────
  /** null | { anchorMs, cycleMs, cycleTicks, ticksPerMs, lengthBars } */
  const geomRef = useRef(null);
  const stateRef = useRef('idle');
  /** Completed passes: array of note-arrays (per-pass provenance for undo). */
  const passesRef = useRef([]);
  /** In-flight pass notes (closed notes only). */
  const passNotesRef = useRef([]);
  /** Pending (still-held) notes keyed by ORIGINAL incoming MIDI key:
   *  Map<key, {startTick, midi, velocity}> */
  const pendingRef = useRef(new Map());
  /** Completed cycles already rolled into passes. */
  const cyclesRolledRef = useRef(0);
  const takeSeqRef = useRef(0);

  const syncCounts = useCallback(() => {
    setPassCount(passesRef.current.length);
    setTakeNoteCount(passesRef.current.reduce((n, p) => n + p.length, 0));
  }, []);

  /** Boundary-close every pending note at cycle end (min 1 tick). */
  function closePendingAtBoundary() {
    const g = geomRef.current;
    for (const p of pendingRef.current.values()) {
      passNotesRef.current.push({
        ticks: p.startTick,
        durationTicks: Math.max(1, g.cycleTicks - p.startTick),
        midi: p.midi,
        velocity: p.velocity,
      });
    }
    pendingRef.current.clear();
  }

  /** Advance the engine to wallMs: flip counting→cycling at the anchor and
   * roll any crossed cycle boundaries (pass merge). Lazy — called from every
   * injected event. Returns the geometry (or null when not armed). */
  function advance(wallMs) {
    const g = geomRef.current;
    if (!g || stateRef.current === 'idle') return null;
    if (wallMs >= g.anchorMs && stateRef.current === 'counting') {
      stateRef.current = 'cycling';
      setState('cycling');
    }
    if (wallMs < g.anchorMs) return g;
    const cycles = Math.floor((wallMs - g.anchorMs) / g.cycleMs);
    if (cycles > cyclesRolledRef.current) {
      // Crossed ≥1 boundary since the last event: close held notes at the
      // FIRST boundary, merge the pass (if it contributed anything), and
      // skip intermediate silent cycles without minting empty passes.
      closePendingAtBoundary();
      if (passNotesRef.current.length > 0) {
        passesRef.current.push(passNotesRef.current);
        passNotesRef.current = [];
        syncCounts();
        logger().sampled('capture.pass-rolled', {
          pass: passesRef.current.length,
          notes: passesRef.current[passesRef.current.length - 1].length,
        }, SAMPLE_OPTS);
      }
      cyclesRolledRef.current = cycles;
    }
    return g;
  }

  const tick = useCallback((wallMs) => { advance(wallMs); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const arm = useCallback(({ lengthBars, anchorWallMs, countInBars = 0 }) => {
    const liveBpm = sanitizeBpm(bpmRef.current);
    const [beats, beatType] = sanitizeTimeSig(timeSigRef.current);
    const bars = Math.max(1, Math.floor(Number(lengthBars) || 0));
    const beatMs = 60000 / liveBpm;                    // quarter-note ms
    const barTicks = PPQ * (4 / beatType) * beats;
    const cycleTicks = bars * barTicks;
    const ticksPerMs = PPQ / beatMs;                   // e.g. 120bpm → 0.96
    const cycleMs = cycleTicks / ticksPerMs;

    // Re-arm with a different cycle length: the kept take's ticks were laid
    // out on the OLD cycle — keeping them would spill/misalign, so clear.
    if (geomRef.current && geomRef.current.lengthBars !== bars && passesRef.current.length > 0) {
      logger().warn('capture.length-changed-take-cleared', {
        from: geomRef.current.lengthBars, to: bars,
      });
      passesRef.current = [];
    }

    geomRef.current = {
      anchorMs: anchorWallMs, cycleMs, cycleTicks, ticksPerMs, lengthBars: bars,
      timeSig: [beats, beatType], // frozen at arm — keep()'s timeline uses THIS, never live props
    };
    passNotesRef.current = [];
    pendingRef.current.clear();
    cyclesRolledRef.current = 0;
    stateRef.current = 'counting';
    setState('counting');
    syncCounts();
    logger().info('capture.armed', {
      lengthBars: bars, bpm: liveBpm, timeSig: [beats, beatType],
      countInBars, cycleMs: Math.round(cycleMs), resumedPasses: passesRef.current.length,
    });
  }, [syncCounts]);

  /** Back to idle: the in-flight pass (incl. held notes) is DISCARDED, the
   * take is KEPT — re-arming resumes layering. Full reset = clearTake + disarm. */
  const disarm = useCallback(() => {
    if (stateRef.current === 'idle') return;
    passNotesRef.current = [];
    pendingRef.current.clear();
    stateRef.current = 'idle';
    setState('idle');
    logger().info('capture.disarmed', { keptPasses: passesRef.current.length });
  }, []);

  const noteOn = useCallback((note, velocity, wallMs) => {
    const g = advance(wallMs);
    if (!g) return;

    let effectiveMs = wallMs;
    if (wallMs < g.anchorMs) {
      if (g.anchorMs - wallMs > EARLY_GRACE_MS) {
        // Count-in: not recording yet.
        logger().sampled('capture.note-dropped-countin', { note }, SAMPLE_OPTS);
        return;
      }
      effectiveMs = g.anchorMs; // early-hit grace → beat 1
    }

    let midi = note;
    if (drumModeRef.current) {
      midi = DRUM_KEY_MAP[note];
      if (midi === undefined) {
        // Drum mode is a drum kit, not a piano: unmapped keys are dropped.
        logger().sampled('capture.note-dropped-unmapped-pad', { note }, SAMPLE_OPTS);
        return;
      }
    }

    const offsetInCycle = (effectiveMs - g.anchorMs) % g.cycleMs;
    // Sub-tick edge: an offset a hair under cycleMs could round UP to
    // cycleTicks; clamp into the cycle (the roll for that boundary hasn't
    // happened yet by floor()).
    const startTick = Math.min(g.cycleTicks - 1, Math.round(offsetInCycle * g.ticksPerMs));

    // Retrigger of a still-held key: close the first note here, then reopen.
    const held = pendingRef.current.get(note);
    if (held) {
      passNotesRef.current.push({
        ticks: held.startTick,
        durationTicks: Math.max(1, startTick - held.startTick),
        midi: held.midi,
        velocity: held.velocity,
      });
    }
    pendingRef.current.set(note, { startTick, midi, velocity });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const noteOff = useCallback((note, wallMs) => {
    const g = advance(wallMs);
    if (!g) return;
    // advance() already boundary-closed anything held across a roll, so a
    // missing pending here means: closed at boundary, dropped at noteOn
    // (count-in / unmapped pad), or plain stray — all ignorable.
    const held = pendingRef.current.get(note);
    if (!held) return;
    pendingRef.current.delete(note);
    const offsetInCycle = (Math.max(wallMs, g.anchorMs) - g.anchorMs) % g.cycleMs;
    const endTick = Math.round(offsetInCycle * g.ticksPerMs);
    passNotesRef.current.push({
      ticks: held.startTick,
      durationTicks: Math.max(1, endTick - held.startTick),
      midi: held.midi,
      velocity: held.velocity,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Drop the most recent COMPLETED pass (provenance-exact). The in-flight
   * pass is not touched — it merges at its own boundary as usual. */
  const undoPass = useCallback(() => {
    if (passesRef.current.length === 0) return;
    const removed = passesRef.current.pop();
    syncCounts();
    logger().info('capture.undo-pass', { removedNotes: removed.length, passesLeft: passesRef.current.length });
  }, [syncCounts]);

  /** Everything gone — completed passes AND the in-flight pass — still cycling. */
  const clearTake = useCallback(() => {
    passesRef.current = [];
    passNotesRef.current = [];
    pendingRef.current.clear();
    syncCounts();
    logger().info('capture.clear-take', {});
  }, [syncCounts]);

  const setDrumMode = useCallback((on) => {
    drumModeRef.current = !!on;
    setDrumModeState(!!on);
  }, []);

  /**
   * Snapshot the merged take (completed passes only) as an ADD_LAYER-ready
   * source payload. Does NOT clear or stop anything — keep-and-continue-
   * layering is the design's spirit; the UI decides when to clear.
   */
  const keep = useCallback(({ snap = 'off' } = {}) => {
    const g = geomRef.current;
    const lengthBars = g?.lengthBars ?? 0;
    const cycleTicks = g?.cycleTicks ?? 0;
    let notes = passesRef.current.flat().map((n) => ({ ...n }));

    if (snap === 'sixteenth' && cycleTicks > 0) {
      notes = notes.map((n) => {
        // Quantize the START to the 1/16 grid; a start snapping to the cycle
        // end IS the next downbeat in loop space → wrap to 0. Duration is
        // preserved but the end clamps to the cycle.
        const snapped = Math.round(n.ticks / SIXTEENTH_TICKS) * SIXTEENTH_TICKS;
        const ticks = snapped >= cycleTicks ? snapped % cycleTicks : snapped;
        return {
          ...n,
          ticks,
          durationTicks: Math.max(1, Math.min(n.durationTicks, cycleTicks - ticks)),
        };
      });
    }
    notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);

    const isDrum = drumModeRef.current;
    const kind = isDrum ? 'groove' : inferKind(notes);

    // Citizenship (design §5): client-side harmonic-timeline analysis for
    // harmonic/melodic takes. Contained — a corrupt take must not throw in
    // the keep path; it just ships without a timeline.
    let timeline = null;
    if (!isDrum && notes.length > 0) {
      try {
        // "Frozen at arm" doctrine: the ticks were laid out on the ARMED
        // geometry, so the timeline reads the armed timeSig snapshot — a live
        // timeSig prop change after arm must not reinterpret them. notes.length
        // > 0 implies an arm happened, so g.timeSig exists (belt: fall back).
        timeline = harmonicTimeline(notes, PPQ, { timeSig: g?.timeSig ?? sanitizeTimeSig(timeSigRef.current) });
      } catch (err) {
        logger().warn('capture.timeline-failed', { error: err?.message });
      }
    }

    takeSeqRef.current += 1;
    const take = {
      takeId: `take-${takeSeqRef.current}`,
      notes,
      ppq: PPQ,
      lengthBars,
      kind,
      drumMode: isDrum,
      timeline,
    };
    logger().info('capture.kept', {
      takeId: take.takeId, kind, notes: notes.length,
      passes: passesRef.current.length, snap, lengthBars,
    });
    return take;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live snapshot of the accumulated take (completed passes only) for the record
  // overlay's live piano-roll (design §8). Cheap flatten; recomputed only when
  // the take note count changes — i.e. a pass merges at the cycle boundary, so
  // your playing "appears" each loop and thickens. In-flight (uncommitted) pass
  // notes aren't included (their ticks aren't laid out until the boundary).
  const takeNotes = useMemo(
    () => passesRef.current.flat().map((n) => ({ ...n })),
    [takeNoteCount],
  );

  return useMemo(() => ({
    state,
    passCount,
    takeNoteCount,
    takeNotes,
    lengthBars: geomRef.current?.lengthBars ?? 0,
    drumMode,
    arm,
    disarm,
    tick,
    noteOn,
    noteOff,
    undoPass,
    clearTake,
    keep,
    setDrumMode,
  }), [state, passCount, takeNoteCount, takeNotes, drumMode, arm, disarm, tick, noteOn, noteOff, undoPass, clearTake, keep, setDrumMode]);
}

export default useLoopCapture;
