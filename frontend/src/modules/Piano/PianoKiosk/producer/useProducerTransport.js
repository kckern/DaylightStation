/**
 * useProducerTransport — the multi-channel, bar-aligned playback heart of the
 * Producer (Task 4.2). Evolves useLoopTransport's proven rAF wall-clock
 * skeleton into a transport that:
 *
 *  - dispatches per-channel through the voiceRouter
 *    (`router.noteOn(channel, note, velocity)` / `router.noteOff(channel, note)`),
 *    never through pressNote/releaseNote;
 *  - STACK MODE (arrangement == null): loops one buildLoopCycle forever;
 *  - BAR-ALIGNED MUTATION: layer/bpm changes mid-play do NOT restart playback.
 *    The old cycle keeps sounding until the next bar boundary (wall-clock),
 *    where the new cycle is swapped in phase-matched: it enters at ITS bar
 *    equal to the global elapsed bar count modulo its own bar length. At the
 *    seam ALL sounding loop notes are released (tracked active-set) and the
 *    new cycle re-presses whatever it needs at the boundary — a sub-frame gap
 *    at a bar line, musically acceptable and far simpler than diffing which
 *    channels survived the change (documented design call from review);
 *  - ARRANGEMENT MODE: walks compileArrangement blocks by wall-clock. Block
 *    events are BLOCK-LOCAL (repeats share one events array — never mutate);
 *    zero-length degenerate blocks are skipped without spinning (guarded
 *    walk); the whole arrangement loops (loopArrangement always true for
 *    now); onBlock fires at content start and every boundary; queueJump
 *    relocates live via nextJumpPoint with the seam released like a bar-swap.
 *    Across an arrangement-input swap the playhead is preserved in
 *    MILLISECONDS (old position mod new total), not bar-proportionally — so
 *    after a tempo change the same ms instant lands wherever it falls in the
 *    new layout's bars;
 *  - METRONOME: ONE one-bar click stream (metronomeEvents — ARRAY timeSig
 *    form, it throws on {beats,beatType}) fired bar-locally in both modes.
 *    Built once per bpm/timeSig change; zero per-bar allocation at runtime.
 *    Documented deviation: toggling `metronome` takes effect at the next
 *    click, not the next bar boundary — the content cycle is untouched (the
 *    real no-restart contract) and a click is not musical content;
 *  - COUNT-IN: play() with countInBars > 0 fires ONLY the click for N bars —
 *    onBar sees -N..-1 — then content begins at bar 0. Input changes during
 *    the count-in install immediately (content hasn't started; no phase to
 *    preserve);
 *  - STOP/UNMOUNT: `router.panic()` ALWAYS — not just per-note offs. A lone
 *    terminal note-off can be swallowed by the onboard BLE tier's
 *    one-turn-late bug; panic routes CC123 through the FLUSHED sender (see
 *    the sendNoteOff note in useWebMidiBLE.js);
 *  - MODE FLIP (stack ↔ arrangement) mid-play: clean content restart at the
 *    current instant (release + bar 0), keeping isPlaying. Bar-aligned
 *    continuation is only defined for same-mode input changes.
 *
 * All timing math guards degenerate input centrally: bpm is sanitized to a
 * finite positive number and timeSig to a 2-element positive array BEFORE
 * barMs is derived, so nextJumpPoint never sees barMs ≤ 0/NaN and
 * metronomeEvents never throws.
 *
 * CALLER CONTRACT: `layers` and `arrangement` must be referentially stable
 * across renders unless they actually changed (memoize upstream — e.g. the
 * toTransportLayers result). Every identity change while playing schedules a
 * bar-boundary swap, which releases sounding notes at the seam.
 *
 * @param {object} p
 * @param {object} p.router  voiceRouter instance (stable ref)
 * @param {Array}  p.layers  toTransportLayers output (stack mode)
 * @param {null|{sections:Array, arrangement:Array}} [p.arrangement]
 * @param {number} p.bpm
 * @param {[number,number]|{beats:number,beatType:number}} [p.timeSig=[4,4]]
 * @param {boolean} [p.metronome=false]
 * @param {number}  [p.countInBars=0]
 * @param {(blockIndex:number, block:object) => void} [p.onBlock]
 * @param {(barIndex:number) => void} [p.onBar]  keep cheap — fires in the rAF tick
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { buildLoopCycle } from '@shared-music/loopScheduler.mjs';
import { compileArrangement, nextJumpPoint } from '@shared-music/arrangementScheduler.mjs';
import { metronomeEvents } from '@shared-music/percussion.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'producer-transport' });
  return _logger;
}

const SAMPLE_OPTS = { maxPerMinute: 20, aggregate: true };
/** ms tolerance for float bar math (boundary instants belong to the new bar). */
const EPS = 0.5;

/** timeSig → validated ARRAY form [beats, beatType]; anything malformed → [4,4]. */
function normalizeTimeSig(timeSig) {
  let beats;
  let beatType;
  if (Array.isArray(timeSig)) [beats, beatType] = timeSig;
  else if (timeSig && typeof timeSig === 'object') ({ beats, beatType } = timeSig);
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return [ok(beats) ? beats : 4, ok(beatType) ? beatType : 4];
}

function sanitizeBpm(bpm) {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
}

/** Index of the first event at-or-after tMs (EPS-tolerant), for phase entry. */
function firstIndexAtOrAfter(events, tMs) {
  let i = 0;
  while (i < events.length && events[i].t < tMs - EPS) i += 1;
  return i;
}

export function useProducerTransport({
  router,
  layers,
  arrangement = null,
  bpm,
  timeSig = [4, 4],
  forceLengthBars = null,
  metronome = false,
  countInBars = 0,
  onBlock,
  onBar,
}) {
  const [isPlaying, setIsPlaying] = useState(false);

  const [beatsPerBar, beatType] = normalizeTimeSig(timeSig);
  const safeBpm = sanitizeBpm(bpm);
  const barMs = (60000 / safeBpm) * (4 / beatType) * beatsPerBar;
  const mode = arrangement ? 'arrangement' : 'stack';

  // forceLengthBars (design §4): a positive int overrides the natural cycle
  // length; null/≤0 keeps the longest-layer length.
  const forcedBars = Number(forceLengthBars) > 0 ? Math.trunc(Number(forceLengthBars)) : null;
  const cycle = useMemo(
    () => buildLoopCycle(layers || [], {
      bpm: safeBpm, timeSig: { beats: beatsPerBar, beatType }, forceLengthBars: forcedBars,
    }),
    [layers, safeBpm, beatsPerBar, beatType, forcedBars],
  );

  const compiled = useMemo(() => {
    if (!arrangement) return null;
    try {
      return compileArrangement(
        arrangement.sections,
        arrangement.arrangement,
        { bpm: safeBpm, timeSig: [beatsPerBar, beatType] },
      );
    } catch (err) {
      // Dangling sectionId etc. — a pipeline bug upstream; play as silence
      // rather than crashing the kiosk mid-jam.
      logger().error('transport.compile-error', { error: err?.message });
      return { blocks: [], totalMs: 0 };
    }
  }, [arrangement, safeBpm, beatsPerBar, beatType]);

  // One bar of click, reused every bar (and for count-in) — no per-bar allocation.
  const metroBar = useMemo(
    () => ({ events: metronomeEvents(1, { bpm: safeBpm, timeSig: [beatsPerBar, beatType] }), lengthMs: barMs }),
    [safeBpm, beatsPerBar, beatType, barMs],
  );

  // ── LIVE refs: what is currently SOUNDING (swapped at bar boundaries) ──────
  const modeRef = useRef(mode);
  const cycleRef = useRef(cycle);
  const compiledRef = useRef(compiled);
  const barMsRef = useRef(barMs);
  const beatsPerBarRef = useRef(beatsPerBar);
  const metroRef = useRef(metroBar);

  // ── immediate refs (take effect next tick, no swap semantics) ──────────────
  // Latest render inputs, installed wholesale on play(): a change made while
  // playing only QUEUES a swap, and stop() discards the queue — without this,
  // stop→play after a mid-play change would resurrect the pre-change content.
  const latestInputsRef = useRef(null);
  latestInputsRef.current = { mode, cycle, compiled, barMs, beatsPerBar, metro: metroBar };
  const routerRef = useRef(router); routerRef.current = router;
  const metronomeOnRef = useRef(metronome); metronomeOnRef.current = metronome;
  const countInBarsRef = useRef(countInBars); countInBarsRef.current = countInBars;
  const onBlockRef = useRef(onBlock); onBlockRef.current = onBlock;
  const onBarRef = useRef(onBar); onBarRef.current = onBar;

  // ── playback state (refs only — no React state per frame) ──────────────────
  const rafRef = useRef(null);
  const isPlayingRef = useRef(false);
  const contentStartWallRef = useRef(0);   // wall time of content bar 0 (post count-in)
  const contentStartedRef = useRef(false);
  const anchorRef = useRef({ wall: 0, bar: 0 }); // a known bar boundary (stack mode; survives tempo swaps)
  const cycleStartWallRef = useRef(0);     // stack: wall time of the current cycle pass's t=0
  const firedIdxRef = useRef(0);           // stack: next event index in cycleRef
  const blockIdxRef = useRef(0);           // arrangement walk
  const blockStartWallRef = useRef(0);
  const blockFiredIdxRef = useRef(0);
  const lastBarRef = useRef(-1);           // last bar index emitted via onBar
  const metroBarIdxRef = useRef(null);     // bar the click stream is aligned to (null = realign)
  const metroFiredIdxRef = useRef(0);
  const activeRef = useRef(new Set());     // "ch:note" of sounding LOOP notes (incl. clicks)
  const pendingSwapRef = useRef(null);     // { atWall, atBar, mode, cycle, compiled, barMs, beatsPerBar, metro }
  const pendingJumpRef = useRef(null);     // { targetIdx, atMs, atWall } — exposed for UI affordance
  const positionRef = useRef({ normalized: 0, bar: 0, beat: 0, barFrac: 0, blockIndex: -1 });
  const stopRef = useRef(null);            // set below; lets tick-internal code stop cleanly

  // ── internal helpers (ref-based only, so stale closure instances are fine) ─

  function fireEvent(e) {
    const r = routerRef.current;
    if (!r) return;
    const key = `${e.channel}:${e.note}`;
    if (e.type === 'note_on' && (e.velocity ?? 0) > 0) {
      r.noteOn(e.channel, e.note, e.velocity);
      activeRef.current.add(key);
    } else {
      r.noteOff(e.channel, e.note);
      activeRef.current.delete(key);
    }
  }

  /** Release every tracked sounding loop note (the bar-swap / jump seam). */
  function releaseActive() {
    const r = routerRef.current;
    activeRef.current.forEach((key) => {
      const sep = key.indexOf(':');
      r?.noteOff(Number(key.slice(0, sep)), Number(key.slice(sep + 1)));
    });
    activeRef.current.clear();
  }

  /** Fire the outgoing block's remaining note_offs for notes we actually hold
   * (block events self-close at the boundary via truncateEvents — this only
   * matters when a slow frame skipped them). */
  function finishBlock(block) {
    const evs = block.events;
    for (let i = blockFiredIdxRef.current; i < evs.length; i += 1) {
      const e = evs[i];
      if (e.type !== 'note_on' && activeRef.current.has(`${e.channel}:${e.note}`)) fireEvent(e);
    }
  }

  /** Close out the click stream: fire only the note_offs for clicks that are
   * actually sounding (in the active set) — never spurious offs. */
  function flushMetroOffs() {
    const evs = metroRef.current.events;
    for (let i = metroFiredIdxRef.current; i < evs.length; i += 1) {
      const e = evs[i];
      if (e.type === 'note_off' && activeRef.current.has(`${e.channel}:${e.note}`)) fireEvent(e);
    }
    metroBarIdxRef.current = null;
    metroFiredIdxRef.current = 0;
  }

  /** Run the one-bar click stream aligned to `bar` starting at barStartWall. */
  function runMetronome(now, bar, barStartWall) {
    const evs = metroRef.current.events;
    const elapsedInBar = now - barStartWall;
    if (metroBarIdxRef.current !== bar) {
      if (metroBarIdxRef.current === null) {
        // First alignment (metronome just enabled, or post-swap/jump reset):
        // don't replay clicks for beats already past — enter at the phase point.
        metroFiredIdxRef.current = firstIndexAtOrAfter(evs, elapsedInBar);
      } else {
        // Normal bar advance: flush any note_offs a slow frame left behind
        // (only for clicks actually sounding), then restart the stream
        // (catch-up within the new bar is fine).
        for (let i = metroFiredIdxRef.current; i < evs.length; i += 1) {
          const e = evs[i];
          if (e.type === 'note_off' && activeRef.current.has(`${e.channel}:${e.note}`)) fireEvent(e);
        }
        metroFiredIdxRef.current = 0;
      }
      metroBarIdxRef.current = bar;
    }
    while (metroFiredIdxRef.current < evs.length && evs[metroFiredIdxRef.current].t <= elapsedInBar) {
      fireEvent(evs[metroFiredIdxRef.current]);
      metroFiredIdxRef.current += 1;
    }
  }

  function emitBar(bar) {
    const last = lastBarRef.current;
    if (bar === last) return;
    const cb = onBarRef.current;
    if (bar < last || bar - last > 8) {
      // Teleport (jump/arrangement wrap) or a pathological frame gap: emit
      // the landing bar once instead of storming intermediate bars.
      lastBarRef.current = bar;
      if (cb) cb(bar);
      return;
    }
    for (let b = last + 1; b <= bar; b += 1) {
      lastBarRef.current = b;
      if (cb) cb(b);
    }
  }

  function updatePosition(normalized, bar, elapsedInBar, blockIndex) {
    const p = positionRef.current;
    const bpb = beatsPerBarRef.current;
    p.normalized = Math.max(0, Math.min(1, normalized));
    p.bar = bar;
    p.beat = Math.min(bpb - 1, Math.max(0, Math.floor(elapsedInBar / (barMsRef.current / bpb))));
    // Smooth 0..1 position WITHIN the current bar — lets a playhead sweep
    // continuously instead of stepping per beat/measure.
    p.barFrac = Math.max(0, Math.min(1, elapsedInBar / (barMsRef.current || 1)));
    p.blockIndex = blockIndex;
  }

  function installLive(next) {
    modeRef.current = next.mode;
    cycleRef.current = next.cycle;
    compiledRef.current = next.compiled;
    barMsRef.current = next.barMs;
    beatsPerBarRef.current = next.beatsPerBar;
    metroRef.current = next.metro;
  }

  /** Apply a queued bar-boundary swap (the headline feature's seam). */
  function applySwap(swap) {
    // Where were we in the OLD arrangement at the boundary? (needed before install)
    let oldPosAtBoundary = 0;
    if (swap.mode === 'arrangement' && modeRef.current === 'arrangement') {
      const oldBlock = compiledRef.current?.blocks?.[blockIdxRef.current];
      if (oldBlock) oldPosAtBoundary = swap.atWall - (blockStartWallRef.current - oldBlock.startMs);
    }
    // Simpler-correct seam (documented): release ALL sounding loop notes and
    // let the new cycle re-press at the boundary. Sub-frame gap at a bar line.
    releaseActive();
    installLive(swap);
    anchorRef.current = { wall: swap.atWall, bar: swap.atBar };
    // Pre-align the click stream to the landing bar (a boundary by
    // construction) so the beat-1 accent fires there instead of being
    // swallowed by the lazy first-alignment skip.
    metroBarIdxRef.current = swap.atBar;
    metroFiredIdxRef.current = 0;
    pendingJumpRef.current = null; // a queued jump's timing is stale under the new layout
    if (swap.mode === 'stack') {
      const { events, lengthMs } = swap.cycle;
      if (lengthMs > 0) {
        // Phase-match: the new cycle enters at its bar == global bar count
        // modulo its own bar length — playback continues, never restarts.
        const newBars = Math.max(1, Math.round(lengthMs / swap.barMs));
        const offset = (((swap.atBar % newBars) + newBars) % newBars) * swap.barMs;
        cycleStartWallRef.current = swap.atWall - offset;
        firedIdxRef.current = firstIndexAtOrAfter(events, offset);
      } else {
        cycleStartWallRef.current = swap.atWall;
        firedIdxRef.current = 0;
      }
    } else {
      const { blocks, totalMs } = swap.compiled || { blocks: [], totalMs: 0 };
      if (!(totalMs > 0)) {
        stopRef.current?.(); // arrangement degenerated to nothing — stop cleanly
        return;
      }
      const pos = ((oldPosAtBoundary % totalMs) + totalMs) % totalMs;
      let idx = blocks.findIndex((b) => b.lengthMs > 0 && pos >= b.startMs - EPS && pos < b.startMs + b.lengthMs - EPS);
      let landPos = pos;
      if (idx < 0) {
        idx = blocks.findIndex((b) => b.lengthMs > 0);
        landPos = blocks[idx].startMs;
      }
      blockIdxRef.current = idx;
      blockStartWallRef.current = swap.atWall - (landPos - blocks[idx].startMs);
      blockFiredIdxRef.current = firstIndexAtOrAfter(blocks[idx].events, landPos - blocks[idx].startMs);
      // Arrangement bars are position-derived, not wall-derived — realign the
      // click to the landing position's bar.
      metroBarIdxRef.current = Math.floor((landPos + EPS) / swap.barMs);
      // Announce the landing block: the UI must not keep highlighting a stale
      // block object from the OLD compiled arrangement until the next
      // natural boundary.
      if (onBlockRef.current) onBlockRef.current(idx, blocks[idx]);
    }
    logger().sampled('transport.bar-swap', { atBar: swap.atBar, mode: swap.mode }, SAMPLE_OPTS);
  }

  // ── the rAF tick ────────────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const now = performance.now();

    // 1. Bar-boundary swap due?
    const swap = pendingSwapRef.current;
    if (swap && now >= swap.atWall - EPS) {
      pendingSwapRef.current = null;
      applySwap(swap);
      if (!isPlayingRef.current) return; // swap degenerated into a stop
    }

    const liveBarMs = barMsRef.current;

    // 2. Count-in phase: click only, negative bars.
    if (!contentStartedRef.current) {
      if (now < contentStartWallRef.current) {
        const rel = now - contentStartWallRef.current; // negative
        const bar = Math.floor(rel / liveBarMs);
        const barStartWall = contentStartWallRef.current + bar * liveBarMs;
        emitBar(bar);
        runMetronome(now, bar, barStartWall);
        updatePosition(0, bar, now - barStartWall, -1);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      contentStartedRef.current = true;
      if (!metronomeOnRef.current && metroBarIdxRef.current !== null) flushMetroOffs();
      if (modeRef.current === 'arrangement') {
        const blocks = compiledRef.current?.blocks || [];
        if (blocks.length && onBlockRef.current) onBlockRef.current(blockIdxRef.current, blocks[blockIdxRef.current]);
      }
    }

    // 3. Content phase.
    if (modeRef.current === 'stack') {
      const { events, lengthMs } = cycleRef.current;
      const anchor = anchorRef.current;
      const bar = anchor.bar + Math.floor((now - anchor.wall + EPS) / liveBarMs);
      const barStartWall = anchor.wall + (bar - anchor.bar) * liveBarMs;
      emitBar(bar);
      if (metronomeOnRef.current) runMetronome(now, bar, barStartWall);
      else if (metroBarIdxRef.current !== null) flushMetroOffs();

      // Fast-forward pathological frame gaps (≥ 2 full cycles) as a SILENT
      // resume: rebase into [0, lengthMs) and re-enter at the current phase
      // point — never replay a cycle's worth of events as a burst (that would
      // flood the BLE tier on tab-foreground). Notes whose on-instant fell
      // inside the gap stay silent until the next pass.
      let elapsed = now - cycleStartWallRef.current;
      if (lengthMs > 0 && elapsed >= 2 * lengthMs) {
        releaseActive();
        cycleStartWallRef.current += Math.floor(elapsed / lengthMs) * lengthMs;
        elapsed = now - cycleStartWallRef.current;
        firedIdxRef.current = firstIndexAtOrAfter(events, elapsed);
      }
      let guard = 4;
      while (guard-- > 0) {
        elapsed = now - cycleStartWallRef.current;
        while (firedIdxRef.current < events.length && events[firedIdxRef.current].t <= elapsed) {
          fireEvent(events[firedIdxRef.current]);
          firedIdxRef.current += 1;
        }
        if (lengthMs > 0 && elapsed >= lengthMs) {
          // Wrap: release stragglers, keep exact phase (+=, not =now — no drift).
          releaseActive();
          firedIdxRef.current = 0;
          cycleStartWallRef.current += lengthMs;
          continue;
        }
        break;
      }
      updatePosition(lengthMs > 0 ? elapsed / lengthMs : 0, bar, now - barStartWall, -1);
    } else {
      const { blocks, totalMs } = compiledRef.current || { blocks: [], totalMs: 0 };
      if (!blocks.length || !(totalMs > 0)) {
        stopRef.current?.();
        return;
      }

      // 3a. Queued jump due? Relocate to the target block's start (seam
      // released like a bar-swap; the target re-presses from its top).
      const jump = pendingJumpRef.current;
      if (jump && now >= jump.atWall - EPS) {
        pendingJumpRef.current = null;
        releaseActive();
        const target = Math.min(Math.max(0, jump.targetIdx), blocks.length - 1);
        blockIdxRef.current = target;
        blockStartWallRef.current = jump.atWall;
        blockFiredIdxRef.current = 0;
        const landingBar = Math.floor((blocks[target].startMs + EPS) / liveBarMs);
        lastBarRef.current = landingBar - 1; // onBar fires once for the landing bar
        // Pre-align the click to the landing bar (block starts are whole-bar
        // aligned) so its beat-1 accent isn't swallowed by first-align skip.
        metroBarIdxRef.current = landingBar;
        metroFiredIdxRef.current = 0;
        if (onBlockRef.current) onBlockRef.current(target, blocks[target]);
        logger().sampled('transport.jump-landed', { targetIdx: target }, SAMPLE_OPTS);
      }

      let block = blocks[blockIdxRef.current];

      // Fast-forward pathological frame gaps spanning multiple arrangement passes.
      const arrOrigin = blockStartWallRef.current - block.startMs;
      if (now - arrOrigin >= 2 * totalMs) {
        releaseActive();
        blockStartWallRef.current += (Math.floor((now - arrOrigin) / totalMs) - 1) * totalMs;
      }

      // 3b. Walk blocks. Zero-length (degenerate) blocks satisfy
      // elapsed >= lengthMs immediately and are stepped past; the guard
      // bounds the loop even if every block were zero-length (can't happen
      // while totalMs > 0, but never spin on a rAF thread).
      let elapsedInBlock = now - blockStartWallRef.current;
      let guard = 2 * blocks.length + 4;
      while (guard-- > 0 && elapsedInBlock >= block.lengthMs) {
        finishBlock(block);
        blockStartWallRef.current += block.lengthMs;
        blockIdxRef.current += 1;
        blockFiredIdxRef.current = 0;
        if (blockIdxRef.current >= blocks.length) blockIdxRef.current = 0; // loop the arrangement
        block = blocks[blockIdxRef.current];
        if (onBlockRef.current) onBlockRef.current(blockIdxRef.current, block);
        elapsedInBlock = now - blockStartWallRef.current;
      }

      // 3c. Fire this block's events (block-local t, offset by wall start).
      const evs = block.events;
      while (blockFiredIdxRef.current < evs.length && evs[blockFiredIdxRef.current].t <= elapsedInBlock) {
        fireEvent(evs[blockFiredIdxRef.current]);
        blockFiredIdxRef.current += 1;
      }

      const posMs = block.startMs + Math.min(elapsedInBlock, block.lengthMs);
      const bar = Math.floor((posMs + EPS) / liveBarMs);
      const barStartWall = now - (posMs - bar * liveBarMs);
      emitBar(bar);
      if (metronomeOnRef.current) runMetronome(now, bar, barStartWall);
      else if (metroBarIdxRef.current !== null) flushMetroOffs();
      updatePosition(posMs / totalMs, bar, posMs - bar * liveBarMs, blockIdxRef.current);
    }

    if (isPlayingRef.current) rafRef.current = requestAnimationFrame(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads refs only

  // ── controls ────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    // CONTRACT (review-carried): panic, not per-note offs — the onboard BLE
    // tier's lone terminal note-off can be swallowed by the one-turn-late
    // bug; CC123 rides the flushed sender. See useWebMidiBLE.sendNoteOff.
    routerRef.current?.panic();
    activeRef.current.clear();
    pendingSwapRef.current = null;
    pendingJumpRef.current = null;
    contentStartedRef.current = false;
    metroBarIdxRef.current = null;
    metroFiredIdxRef.current = 0;
    positionRef.current = { normalized: 0, bar: 0, beat: 0, blockIndex: -1 };
    isPlayingRef.current = false;
    setIsPlaying(false);
    logger().info('transport.stop', { mode: modeRef.current });
  }, []);
  stopRef.current = stop;

  const play = useCallback(() => {
    // Restart while already playing: send offs for everything sounding BEFORE
    // the active set is cleared below — a restart affordance must not strand
    // held notes on the synth.
    if (isPlayingRef.current) releaseActive();
    installLive(latestInputsRef.current); // start from the CURRENT inputs, always
    const liveMode = modeRef.current;
    const ci = Math.max(0, Math.floor(Number(countInBarsRef.current) || 0));
    if (liveMode === 'arrangement') {
      if (!(compiledRef.current?.totalMs > 0)) return;
    } else if (!cycleRef.current.events.length && !metronomeOnRef.current && ci <= 0) {
      return;
    }
    cancelAnimationFrame(rafRef.current);
    const now = performance.now();
    const contentStart = now + ci * barMsRef.current;
    contentStartWallRef.current = contentStart;
    contentStartedRef.current = false;
    anchorRef.current = { wall: contentStart, bar: 0 };
    cycleStartWallRef.current = contentStart;
    firedIdxRef.current = 0;
    blockIdxRef.current = 0;
    blockStartWallRef.current = contentStart;
    blockFiredIdxRef.current = 0;
    lastBarRef.current = (ci > 0 ? -ci : 0) - 1;
    // Pre-align the click stream when it will run from t=0 (count-in or
    // metronome on) so beat 1 fires — the lazy first-alignment skips past
    // already-elapsed clicks and would swallow it. Off → stays unaligned.
    metroBarIdxRef.current = ci > 0 ? -ci : (metronomeOnRef.current ? 0 : null);
    metroFiredIdxRef.current = 0;
    activeRef.current.clear();
    pendingSwapRef.current = null;
    pendingJumpRef.current = null;
    isPlayingRef.current = true;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
    logger().info('transport.play', {
      mode: liveMode,
      countInBars: ci,
      ...(liveMode === 'arrangement'
        ? { blocks: compiledRef.current.blocks.length, totalMs: Math.round(compiledRef.current.totalMs) }
        : { events: cycleRef.current.events.length, lengthMs: Math.round(cycleRef.current.lengthMs) }),
    });
  }, [tick]);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) stop();
    else play();
  }, [play, stop]);

  /**
   * Arrangement-mode live override: queue a relocation to BLOCK `targetIdx`
   * in the compiled timeline (one block per arrangement-entry × repeat — the
   * Song view maps its section tiles to block indices), landing at
   * nextJumpPoint(position, blocks, mode, barMs). barMs is the centrally
   * sanitized live value — never ≤ 0/NaN (guarded again here as
   * belt-and-suspenders). No-op outside arrangement playback.
   */
  const queueJump = useCallback((targetIdx, jumpMode = 'repeat') => {
    if (!isPlayingRef.current || modeRef.current !== 'arrangement') return;
    const { blocks, totalMs } = compiledRef.current || {};
    if (!blocks?.length || !(totalMs > 0)) return;
    const bMs = barMsRef.current;
    if (!(Number.isFinite(bMs) && bMs > 0)) return; // nextJumpPoint barMs guard
    const target = Math.min(Math.max(0, Math.trunc(targetIdx) || 0), blocks.length - 1);
    const now = performance.now();
    const block = blocks[blockIdxRef.current];
    const posMs = now - (blockStartWallRef.current - block.startMs); // negative during count-in → nextJumpPoint wraps to 0
    const atMs = nextJumpPoint(posMs, blocks, jumpMode === 'bar' ? 'bar' : 'repeat', bMs);
    let delta = atMs - posMs;
    if (delta <= 0) delta += totalMs; // wrapped to the top of the arrangement
    pendingJumpRef.current = { targetIdx: target, atMs, atWall: now + delta };
    logger().info('transport.jump-queued', { targetIdx: target, mode: jumpMode, atMs: Math.round(atMs) });
  }, []);

  // ── bar-aligned input mutation (THE headline feature) ──────────────────────
  useEffect(() => {
    const next = { mode, cycle, compiled, barMs, beatsPerBar, metro: metroBar };
    if (!isPlayingRef.current || !contentStartedRef.current) {
      // Idle, or still counting in: install immediately — there is no sounding
      // phase to preserve. Mid-count-in, also reset the content entry points.
      installLive(next);
      if (isPlayingRef.current) {
        firedIdxRef.current = 0;
        cycleStartWallRef.current = contentStartWallRef.current;
        blockIdxRef.current = 0;
        blockStartWallRef.current = contentStartWallRef.current;
        blockFiredIdxRef.current = 0;
        pendingSwapRef.current = null;
        pendingJumpRef.current = null; // its timing referenced the replaced layout
      }
      return;
    }
    if (next.mode !== modeRef.current) {
      // stack ↔ arrangement flip mid-play: clean content restart NOW (documented
      // design call — bar-aligned continuation is same-mode only).
      releaseActive();
      installLive(next);
      const now = performance.now();
      contentStartWallRef.current = now;
      contentStartedRef.current = false; // next tick re-enters content at bar 0
      anchorRef.current = { wall: now, bar: 0 };
      cycleStartWallRef.current = now;
      firedIdxRef.current = 0;
      blockIdxRef.current = 0;
      blockStartWallRef.current = now;
      blockFiredIdxRef.current = 0;
      lastBarRef.current = -1;
      metroBarIdxRef.current = 0;
      metroFiredIdxRef.current = 0;
      pendingSwapRef.current = null;
      pendingJumpRef.current = null;
      logger().info('transport.mode-flip', { mode: next.mode });
      return;
    }
    // Same-mode change while sounding: keep the OLD cycle firing, swap at the
    // next bar boundary (wall-clock). Re-queuing within the same bar just
    // overwrites with the latest inputs — same boundary.
    const now = performance.now();
    const liveBarMs = barMsRef.current;
    const anchor = anchorRef.current;
    const atBar = anchor.bar + Math.floor((now - anchor.wall + EPS) / liveBarMs) + 1;
    pendingSwapRef.current = {
      ...next,
      atBar,
      atWall: anchor.wall + (atBar - anchor.bar) * liveBarMs,
    };
    logger().sampled('transport.swap-queued', { atBar, mode: next.mode }, SAMPLE_OPTS);
  }, [mode, cycle, compiled, barMs, beatsPerBar, metroBar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unmount: stop the clock and silence everything through the panic path.
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      routerRef.current?.panic();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isPlaying,
    play,
    stop,
    toggle,
    positionRef,
    queueJump,
    pendingJumpRef,
    lengthMs: mode === 'arrangement' ? (compiled?.totalMs ?? 0) : cycle.lengthMs,
    // Whole-bar length of the current stack loop (design §4 — the bounded loop:
    // the cycling bar:beat readout & loop meter tile this many bars, then reset).
    // 0 when nothing is loaded; arrangement mode has no single loop length.
    loopBars: mode === 'arrangement' || !(cycle.lengthMs > 0)
      ? 0
      : Math.max(1, Math.round(cycle.lengthMs / barMs)),
  };
}

export default useProducerTransport;
