/**
 * usePeek — the press-and-hold audition engine (Task 5.2, design §7).
 *
 * A tiny SECOND playback path, deliberately not a second useProducerTransport:
 * a peek has no bars-swap semantics, no arrangements, no count-in — it is one
 * cached loop fired through the SAME voiceRouter on a reserved channel while
 * the main transport (if playing) keeps looping the jam underneath. The old
 * Producer used a second useLoopTransport for exactly this; this mirrors that
 * simplicity on the router.
 *
 * CHANNEL RESERVATION:
 * - Melodic/harmonic peeks → channel 15 (PEEK_CHANNEL). The workspace pool
 *   assigns lowest-free 0..15 (skipping 9), so 15 is only ever reached at 15
 *   simultaneous melodic layers — practically never.
 * - Groove peeks AND the solo-peek metronome → channel 9 (GM drums). Sharing
 *   9 with workspace grooves is GM-correct: drum-map pitches are instrument
 *   slots, and channel 9 carries no program/gain identity to fight over.
 *
 * COLLISION (documented, tested): if the workspace HAS assigned channel 15
 * (15 melodic layers), a melodic peek is SKIPPED entirely with a sampled log.
 * Peeking anyway would fight that layer's configureLayer program/gain pushes
 * (mis-voicing both the peek and the layer), and stealing 14 just moves the
 * same collision one channel down. At a 15-layer stack the audition adds no
 * honest signal anyway. Groove peeks are unaffected.
 *
 * KEY CONFORMANCE (design §7 "auto-conformed so the audition is honest"):
 * canonical library entries are all in C, and addLayer playback applies
 * exactly ONE transpose — the workspace keyShift (toTransportLayers), with
 * grooves pinned to 0 (percussion never transposes). A base's key IS the
 * workspace keyShift under this single-transpose model, so conforming the
 * peek to the jam = transpose by keyShift for non-grooves, 0 for grooves —
 * the peek then sounds exactly like the entry will once added. Tempo
 * conformance: events are built at the CURRENT workspace bpm, not the
 * entry's.
 *
 * VOICE: melodic peeks push the same default program addLayer would give the
 * entry (bass → 33, everything else → 0) plus unity channel gain — a removed
 * layer's stale channel gain must not mute the audition. Loudness rides
 * velocity: fixed PEEK_GAIN 0.9 through loopToEvents.
 *
 * METRONOME: when the jam is NOT playing at peek start, one bar of click
 * (percussion.metronomeEvents) is tiled across the peek cycle on ch 9 —
 * solo + metronome per design §7. The isJamPlaying snapshot is taken at
 * start; a jam starting mid-peek doesn't retro-add clicks.
 *
 * Timing: 4/4 fixed (the Producer's transport runs its default timeSig);
 * bpm sanitized like the transport. Never throws — this runs in pointer
 * handlers on a kiosk.
 *
 * The 150ms hold-arm delay is the CALLER's job (LibraryBrowser's pointer
 * logic): startPeek starts immediately.
 *
 * @param {object} p
 * @param {object} p.router  voiceRouter instance
 * @param {object} p.lib     useLoopLibrary surface (loadNotes — cached/async)
 * @param {number} p.bpm     current workspace tempo
 * @param {number} [p.keyShift=0]  workspace keyShift (the single transpose)
 * @param {boolean} [p.isJamPlaying=false]  main transport state (metronome gate)
 * @param {Array}  [p.layers=[]]  workspace layers (channel-15 collision guard)
 * @returns {{ peekingId: string|null, startPeek: (entry:object)=>void, stopPeek: (onlyId?:string)=>void }}
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { loopToEvents, layerLengthMs } from '@shared-music/loopScheduler.mjs';
import { metronomeEvents } from '@shared-music/percussion.mjs';
import { roleOf } from '@shared-music/layerMatch.mjs';
import { entryIdentity } from './libraryRanking.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-producer-peek' });
  return _logger;
}

const SAMPLE_OPTS = { maxPerMinute: 10, aggregate: true };

/** Reserved channel for melodic/harmonic peek content (see header). */
export const PEEK_CHANNEL = 15;
/** Groove peeks + the solo-peek metronome ride the GM drum channel. */
export const PEEK_DRUM_CHANNEL = 9;
/** Fixed audition loudness: velocity scale through loopToEvents. */
const PEEK_GAIN = 0.9;
const PEEK_VELOCITY = 90;
const TIME_SIG = { beats: 4, beatType: 4 };
/** Same default-voice rule as workspaceReducer's ADD_LAYER. */
const PEEK_PROGRAM_BY_ROLE = { bass: 33 };

const sanitizeBpm = (bpm) => (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
const isGrooveEntry = (entry) => entry?.type === 'groove' || entry?.kind === 'groove';

export function usePeek({ router, lib, bpm, keyShift = 0, isJamPlaying = false, layers = [] }) {
  const [peekingId, setPeekingId] = useState(null);

  // Latest-value refs so startPeek/stopPeek stay referentially stable.
  const routerRef = useRef(router); routerRef.current = router;
  const libRef = useRef(lib); libRef.current = lib;
  const bpmRef = useRef(bpm); bpmRef.current = bpm;
  const keyShiftRef = useRef(keyShift); keyShiftRef.current = keyShift;
  const isJamPlayingRef = useRef(isJamPlaying); isJamPlayingRef.current = isJamPlaying;
  const layersRef = useRef(layers); layersRef.current = layers;

  /** Bumped on every stop/start: in-flight loads and stale rAF ticks compare
   * against it and drop themselves (the token guard). */
  const tokenRef = useRef(0);
  /** null | { id, startedAt, run: null | { raf, startWall, fired, active:Set, events, lengthMs, usedDrums } } */
  const peekRef = useRef(null);

  /**
   * Stop the current peek: cancel the loop, silence the peek's notes, clear
   * the visual state. `onlyId` (belt-and-braces for multi-touch): only stop
   * if the CURRENT peek is that entry — a stale card's release must not kill
   * a newer peek. No-op stops never bump the token (that would freeze a live
   * run whose tick checks it).
   *
   * Silencing is per-note FIRST (the run tracks exactly what it holds), then
   * allNotesOff(15) as belt-and-braces (15 is exclusively ours). Channel 9 is
   * SHARED with the jam's groove layers, so it only gets the blanket
   * allNotesOff when the jam isn't playing (solo peek / metronome) — a groove
   * peek released over a live jam must not clip the jam's own drum notes.
   */
  const stopPeek = useCallback((onlyId) => {
    const peek = peekRef.current;
    if (onlyId != null && (!peek || peek.id !== onlyId)) return;
    tokenRef.current += 1;
    peekRef.current = null;
    if (peek) {
      const { run } = peek;
      if (run) {
        cancelAnimationFrame(run.raf);
        const r = routerRef.current;
        try {
          run.active.forEach((key) => {
            const sep = key.indexOf(':');
            r?.noteOff?.(Number(key.slice(0, sep)), Number(key.slice(sep + 1)));
          });
          run.active.clear();
          r?.allNotesOff?.(PEEK_CHANNEL);
          if (run.usedDrums && !isJamPlayingRef.current) r?.allNotesOff?.(PEEK_DRUM_CHANNEL);
        } catch { /* router never throws by contract; belt-and-braces */ }
      }
      logger().info('peek.stop', { durationMs: Math.round(performance.now() - peek.startedAt) });
    }
    setPeekingId(null);
  }, []);

  const startPeek = useCallback((entry) => {
    try {
      stopPeek(); // one peek at a time (also invalidates in-flight loads)
      if (!entry) return;
      const isGroove = isGrooveEntry(entry);
      if (!isGroove && (layersRef.current || []).some((l) => l?.channel === PEEK_CHANNEL)) {
        // Channel-15 collision (see header): skip honestly instead of
        // fighting the workspace layer's voice on its own channel.
        logger().sampled('peek.channel-busy', { slug: entry.slug }, SAMPLE_OPTS);
        return;
      }
      const token = tokenRef.current;
      const id = entryIdentity(entry);
      peekRef.current = { id, startedAt: performance.now(), run: null };
      setPeekingId(id);
      logger().info('peek.start', { slug: entry.slug });

      Promise.resolve(libRef.current?.loadNotes?.(entry)).then((loaded) => {
        if (token !== tokenRef.current) return; // stopped/superseded while loading
        if (!loaded?.notes?.length) {
          logger().sampled('peek.load-miss', { slug: entry.slug }, SAMPLE_OPTS);
          peekRef.current = null;
          setPeekingId(null);
          return;
        }
        beginRun(entry, loaded, isGroove, token);
      }).catch((err) => {
        logger().sampled('peek.load-miss', { slug: entry.slug, error: err?.message }, SAMPLE_OPTS);
      });
    } catch (err) {
      logger().error('peek.start-failed', { error: err?.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPeek]);

  /** Build the event cycle and run the rAF loop (refs only — stable). */
  function beginRun(entry, loaded, isGroove, token) {
    const liveBpm = sanitizeBpm(bpmRef.current);
    const shift = Number.isFinite(keyShiftRef.current) ? Math.trunc(keyShiftRef.current) : 0;
    const channel = isGroove ? PEEK_DRUM_CHANNEL : PEEK_CHANNEL;
    // Key conformance (header): keyShift for non-grooves, 0 for grooves.
    const transpose = isGroove ? 0 : shift;
    const lengthMs = layerLengthMs(
      { notes: loaded.notes, ppq: loaded.ppq, barSpan: entry.barSpan },
      liveBpm,
      TIME_SIG,
    );
    const events = loopToEvents(loaded.notes, {
      ppq: loaded.ppq, bpm: liveBpm, transpose, velocity: PEEK_VELOCITY, channel, gain: PEEK_GAIN,
    });

    const withMetro = !isJamPlayingRef.current;
    if (withMetro) {
      // Solo peek: tile one bar of click across the cycle (whole bars by
      // loopLengthTicks construction, so the tiling is exact).
      const barMs = (60000 / liveBpm) * (4 / TIME_SIG.beatType) * TIME_SIG.beats;
      const bar = metronomeEvents(1, { bpm: liveBpm, timeSig: [TIME_SIG.beats, TIME_SIG.beatType] });
      const bars = Math.max(1, Math.round(lengthMs / barMs));
      for (let b = 0; b < bars; b += 1) {
        for (const e of bar) events.push({ ...e, t: e.t + b * barMs });
      }
      events.sort((a, b) => a.t - b.t);
    }

    if (!isGroove) {
      // Same default voice addLayer would give this entry, + unity channel
      // gain so a removed layer's stale gain can't mute the audition.
      routerRef.current?.configureLayer?.(PEEK_CHANNEL, {
        program: PEEK_PROGRAM_BY_ROLE[roleOf(entry)] ?? 0,
        gain: 1,
      });
    }

    const run = {
      raf: 0,
      startWall: performance.now(),
      fired: 0,
      active: new Set(), // "ch:note" of sounding peek notes
      events,
      lengthMs,
      usedDrums: isGroove || withMetro,
    };
    if (!peekRef.current) return; // paranoid: token matched, peek must exist
    peekRef.current.run = run;

    const fire = (e) => {
      const r = routerRef.current;
      if (!r) return;
      const key = `${e.channel}:${e.note}`;
      if (e.type === 'note_on' && (e.velocity ?? 0) > 0) {
        r.noteOn(e.channel, e.note, e.velocity);
        run.active.add(key);
      } else {
        r.noteOff(e.channel, e.note);
        run.active.delete(key);
      }
    };
    const releaseActive = () => {
      const r = routerRef.current;
      run.active.forEach((key) => {
        const sep = key.indexOf(':');
        r?.noteOff(Number(key.slice(0, sep)), Number(key.slice(sep + 1)));
      });
      run.active.clear();
    };

    const tick = () => {
      if (token !== tokenRef.current) return; // stopped — go quiet
      const now = performance.now();
      let elapsed = now - run.startWall;
      if (run.lengthMs > 0 && elapsed >= 2 * run.lengthMs) {
        // Pathological frame gap (tab background): restart the peek from the
        // top instead of bursting a backlog of events at the router.
        releaseActive();
        run.fired = 0;
        run.startWall = now;
      }
      let guard = 4;
      while (guard-- > 0) {
        elapsed = now - run.startWall;
        while (run.fired < run.events.length && run.events[run.fired].t <= elapsed) {
          fire(run.events[run.fired]);
          run.fired += 1;
        }
        if (run.lengthMs > 0 && elapsed >= run.lengthMs) {
          // Wrap: release stragglers, keep exact phase (+=, no drift).
          releaseActive();
          run.fired = 0;
          run.startWall += run.lengthMs;
          continue;
        }
        break;
      }
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
  }

  // Unmount: a live peek must not outlive the surface.
  useEffect(() => () => { stopPeek(); }, [stopPeek]);

  return { peekingId, startPeek, stopPeek };
}

export default usePeek;
