/**
 * useLoopCapture — pass/take overdub recording engine (Task 6.1).
 *
 * All timing is injected wall-clock milliseconds (the hook never reads
 * Date.now / performance.now), so every scenario is a pure fake-clock script.
 *
 * Fixed grid used throughout (hand-verified):
 *   bpm 120, 4/4, ppq 480
 *   → quarter note (beat) = 60000/120 = 500 ms = 480 ticks
 *   → ticksPerMs = 480/500 = 0.96
 *   → bar = 4 beats = 2000 ms = 1920 ticks
 *   → 2-bar cycle = 4000 ms = 3840 ticks
 *
 *   anchor 1000:
 *     wallMs 1500 → offset  500 ms → tick  480 (beat 1 of bar 0)
 *     wallMs 2000 → offset 1000 ms → tick  960
 *     wallMs 5000 → offset 4000 ms → cycle boundary (pass rolls)
 *     wallMs 5500 → offset 4500 ms → 500 into pass 2 → tick 480
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoopCapture, DRUM_KEY_MAP } from './useLoopCapture.js';
import { GM_DRUM } from '@shared-music/percussion.mjs';
import { workspaceReducer, initialWorkspace, addLayer } from './workspaceReducer.js';

const ANCHOR = 1000;

/** Render the hook and arm it on the standard 2-bar / 120bpm / 4/4 grid. */
function armedHook({ lengthBars = 2, bpm = 120, timeSig = [4, 4], countInBars = 1 } = {}) {
  const hook = renderHook(() => useLoopCapture({ bpm, timeSig }));
  act(() => {
    hook.result.current.arm({ lengthBars, anchorWallMs: ANCHOR, countInBars });
  });
  return hook;
}

/** Play one note: on at `on` ms, off at `off` ms. */
function play(hook, note, on, off, velocity = 90) {
  act(() => {
    hook.result.current.noteOn(note, velocity, on);
    hook.result.current.noteOff(note, off);
  });
}

const roll = (hook, wallMs) => act(() => { hook.result.current.tick(wallMs); });
const kept = (hook, opts) => {
  let out;
  act(() => { out = hook.result.current.keep(opts); });
  return out;
};

// ── state machine ────────────────────────────────────────────────────────────

describe('state transitions', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useLoopCapture({ bpm: 120 }));
    expect(result.current.state).toBe('idle');
  });

  it('arm → counting until the anchor, then cycling on the first tick at/after it', () => {
    const hook = armedHook();
    expect(hook.result.current.state).toBe('counting');
    roll(hook, 999); // still pre-anchor
    expect(hook.result.current.state).toBe('counting');
    roll(hook, 1000); // anchor instant belongs to the cycle
    expect(hook.result.current.state).toBe('cycling');
  });

  it('a note event at/after the anchor also flips counting → cycling', () => {
    const hook = armedHook();
    act(() => { hook.result.current.noteOn(60, 90, 1500); });
    expect(hook.result.current.state).toBe('cycling');
  });

  it('disarm returns to idle', () => {
    const hook = armedHook();
    roll(hook, 1000);
    act(() => { hook.result.current.disarm(); });
    expect(hook.result.current.state).toBe('idle');
  });

  it('events while idle are ignored (no crash, no notes)', () => {
    const hook = renderHook(() => useLoopCapture({ bpm: 120 }));
    act(() => {
      hook.result.current.noteOn(60, 90, 1500);
      hook.result.current.noteOff(60, 2000);
      hook.result.current.tick(9000);
    });
    expect(hook.result.current.state).toBe('idle');
    expect(hook.result.current.passCount).toBe(0);
    expect(hook.result.current.takeNoteCount).toBe(0);
  });
});

// ── tick math ────────────────────────────────────────────────────────────────

describe('cycle tick math (120bpm 4/4, 2 bars: 4000ms = 3840 ticks)', () => {
  it('a note at 1500 lands at tick 480 (offset 500ms = 1 beat)', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000); // off at offset 1000ms = tick 960
    roll(hook, 5000);           // boundary: pass 1 merges
    const take = kept(hook);
    expect(take.notes).toEqual([
      { ticks: 480, durationTicks: 480, midi: 60, velocity: 90 },
    ]);
  });

  it('a note at the anchor itself lands at tick 0', () => {
    const hook = armedHook();
    play(hook, 62, 1000, 1250); // 250ms = 240 ticks
    roll(hook, 5000);
    expect(kept(hook).notes).toEqual([
      { ticks: 0, durationTicks: 240, midi: 62, velocity: 90 },
    ]);
  });

  it('second-pass offsets are cycle-relative (5500 → tick 480 again)', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    play(hook, 64, 5500, 6000); // pass 2, offset-in-cycle 500ms → tick 480
    roll(hook, 9000);           // boundary at 9000: pass 2 merges
    const notes = kept(hook).notes;
    expect(notes).toHaveLength(2);
    expect(notes[1]).toEqual({ ticks: 480, durationTicks: 480, midi: 64, velocity: 90 });
  });

  it('zero-length press (on == off) yields the 1-tick minimum duration', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 1500);
    roll(hook, 5000);
    expect(kept(hook).notes[0].durationTicks).toBe(1);
  });
});

// ── count-in / early-hit grace ───────────────────────────────────────────────

describe('count-in handling', () => {
  it('drops notes played during the count-in (more than 100ms early)', () => {
    const hook = armedHook();
    play(hook, 60, 500, 800);   // deep in the count-in → dropped
    play(hook, 62, 1500, 2000); // real note
    roll(hook, 5000);
    const notes = kept(hook).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(62);
  });

  it('early-hit grace: ≤100ms before the anchor snaps to tick 0', () => {
    const hook = armedHook();
    act(() => { hook.result.current.noteOn(60, 100, 950); }); // 50ms early
    act(() => { hook.result.current.noteOff(60, 1500); });    // off at tick 480
    roll(hook, 5000);
    expect(kept(hook).notes).toEqual([
      { ticks: 0, durationTicks: 480, midi: 60, velocity: 100 },
    ]);
  });

  it('exactly 100ms early is still within grace; 101ms is not', () => {
    const hook = armedHook();
    play(hook, 60, 900, 1200);  // exactly 100ms early → tick 0
    play(hook, 62, 899, 1200);  // 101ms early → dropped
    roll(hook, 5000);
    const notes = kept(hook).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ticks: 0, midi: 60 });
  });
});

// ── boundary behavior ────────────────────────────────────────────────────────

describe('cycle-boundary note handling', () => {
  it('a note held across the boundary closes at cycle end (loop-friendly)', () => {
    const hook = armedHook();
    act(() => { hook.result.current.noteOn(60, 90, 4600); }); // offset 3600 → tick 3456
    roll(hook, 5200); // boundary crossed at 5000 → pending closes at tick 3840
    act(() => { hook.result.current.noteOff(60, 5300); }); // late off: no pending → ignored
    roll(hook, 9000);
    const notes = kept(hook).notes;
    expect(notes).toEqual([
      { ticks: 3456, durationTicks: 384, midi: 60, velocity: 90 }, // 3840 - 3456
    ]);
  });

  it('a note-ON exactly AT the cycle end lands at tick 0 of the next pass', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);              // pass 1 content
    act(() => { hook.result.current.noteOn(64, 90, 5000); }); // boundary instant → pass 2 tick 0
    act(() => { hook.result.current.noteOff(64, 5500); });
    expect(hook.result.current.passCount).toBe(1); // the ON itself rolled pass 1
    roll(hook, 9000);
    const notes = kept(hook).notes; // keep() sorts by ticks: the tick-0 note leads
    expect(notes[0]).toEqual({ ticks: 0, durationTicks: 480, midi: 64, velocity: 90 });
  });

  it('boundary detection is lazy: a noteOn after a silent gap of multiple cycles still lands correctly', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    // Next event arrives two full cycles later: 10500 = anchor + 9500 → cycle 2, offset 1500 → tick 1440
    play(hook, 62, 10500, 11000);
    roll(hook, 13000); // boundary at 13000 merges the cycle-2 pass
    const notes = kept(hook).notes;
    expect(notes[1]).toEqual({ ticks: 1440, durationTicks: 480, midi: 62, velocity: 90 });
  });

  it('retrigger of a still-pending note closes the first at the retrigger tick', () => {
    const hook = armedHook();
    act(() => {
      hook.result.current.noteOn(60, 90, 1000);  // tick 0
      hook.result.current.noteOn(60, 70, 2000);  // tick 960: closes #1, opens #2
      hook.result.current.noteOff(60, 2500);     // tick 1440: closes #2
    });
    roll(hook, 5000);
    expect(kept(hook).notes).toEqual([
      { ticks: 0, durationTicks: 960, midi: 60, velocity: 90 },
      { ticks: 960, durationTicks: 480, midi: 60, velocity: 70 },
    ]);
  });
});

// ── pass merge / undo / clear ────────────────────────────────────────────────

describe('pass lifecycle', () => {
  it('a pass merges into the take at the boundary via tick()', () => {
    const hook = armedHook();
    expect(hook.result.current.passCount).toBe(0);
    play(hook, 60, 1500, 2000);
    expect(hook.result.current.passCount).toBe(0);      // still in-flight
    expect(hook.result.current.takeNoteCount).toBe(0);
    roll(hook, 5000);
    expect(hook.result.current.passCount).toBe(1);
    expect(hook.result.current.takeNoteCount).toBe(1);
  });

  it('silent passes do not increment passCount (undo stays meaningful)', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);   // pass 1 (1 note)
    roll(hook, 9000);   // empty cycle → no pass
    roll(hook, 13000);  // empty cycle → no pass
    expect(hook.result.current.passCount).toBe(1);
  });

  it('layered passes accumulate; undoPass removes only the most recent completed pass', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);  // pass 1
    roll(hook, 5000);
    play(hook, 64, 5500, 6000);  // pass 2
    play(hook, 67, 6500, 7000);  // pass 2
    roll(hook, 9000);
    expect(hook.result.current.passCount).toBe(2);
    expect(hook.result.current.takeNoteCount).toBe(3);

    act(() => { hook.result.current.undoPass(); });
    expect(hook.result.current.passCount).toBe(1);
    expect(hook.result.current.takeNoteCount).toBe(1);
    const notes = kept(hook).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(60); // pass-1 note survived
  });

  it('undoPass with no completed passes is a safe no-op', () => {
    const hook = armedHook();
    act(() => { hook.result.current.undoPass(); });
    expect(hook.result.current.passCount).toBe(0);
    expect(hook.result.current.takeNoteCount).toBe(0);
  });

  it('undoPass does not touch the in-flight pass', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);   // pass 1
    roll(hook, 5000);
    play(hook, 64, 5500, 6000);   // in-flight pass 2
    act(() => { hook.result.current.undoPass(); }); // removes pass 1 only
    roll(hook, 9000);             // in-flight pass merges as the new pass 1
    expect(hook.result.current.passCount).toBe(1);
    expect(kept(hook).notes[0].midi).toBe(64);
  });

  it('clearTake wipes everything (incl. the in-flight pass) but keeps cycling', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);
    play(hook, 64, 5500, 6000);   // in-flight
    act(() => { hook.result.current.clearTake(); });
    expect(hook.result.current.passCount).toBe(0);
    expect(hook.result.current.takeNoteCount).toBe(0);
    expect(hook.result.current.state).toBe('cycling');
    roll(hook, 9000);
    expect(kept(hook).notes).toEqual([]); // the cleared in-flight note is gone too
  });

  it('disarm discards the in-flight pass but KEEPS the take; re-arm resumes layering', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);   // pass 1
    roll(hook, 5000);
    play(hook, 64, 5500, 6000);   // in-flight → will be discarded
    act(() => { hook.result.current.disarm(); });
    expect(hook.result.current.state).toBe('idle');
    expect(hook.result.current.passCount).toBe(1);      // take survives
    expect(hook.result.current.takeNoteCount).toBe(1);

    // Re-arm at a new anchor, same length: layering continues onto the take.
    act(() => { hook.result.current.arm({ lengthBars: 2, anchorWallMs: 20000 }); });
    play(hook, 67, 20500, 21000); // tick 480 of the new pass
    roll(hook, 24000);
    expect(hook.result.current.passCount).toBe(2);
    const notes = kept(hook).notes;
    expect(notes.map((n) => n.midi)).toEqual([60, 67]);
  });

  it('re-arm with a DIFFERENT lengthBars clears the stale take (documented safety)', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);
    act(() => { hook.result.current.disarm(); });
    act(() => { hook.result.current.arm({ lengthBars: 4, anchorWallMs: 20000 }); });
    expect(hook.result.current.passCount).toBe(0);
    expect(hook.result.current.takeNoteCount).toBe(0);
  });
});

// ── drum mode ────────────────────────────────────────────────────────────────

describe('drum mode', () => {
  it('DRUM_KEY_MAP covers the documented C2..D3 white-key pad octave with GM values', () => {
    expect(DRUM_KEY_MAP).toEqual({
      36: GM_DRUM.kick,      // C2 → 36
      38: GM_DRUM.snare,     // D2 → 38
      40: GM_DRUM.hatClosed, // E2 → 42
      41: GM_DRUM.hatOpen,   // F2 → 46
      43: GM_DRUM.tomLo,     // G2 → 45
      45: GM_DRUM.tomMid,    // A2 → 47
      47: GM_DRUM.tomHi,     // B2 → 50
      48: GM_DRUM.crash,     // C3 → 49
      50: GM_DRUM.ride,      // D3 → 51
    });
  });

  it('remaps pad keys on noteOn and DROPS unmapped keys entirely', () => {
    const hook = armedHook();
    act(() => { hook.result.current.setDrumMode(true); });
    play(hook, 40, 1500, 1600); // E2 → closed hat 42
    play(hook, 61, 2000, 2100); // C#4: not a pad → dropped
    roll(hook, 5000);
    const take = kept(hook);
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0].midi).toBe(42);
    expect(take.drumMode).toBe(true);
    expect(take.kind).toBe('groove');
  });

  it('noteOff pairs by the ORIGINAL incoming key (remap is internal)', () => {
    const hook = armedHook();
    act(() => { hook.result.current.setDrumMode(true); });
    act(() => { hook.result.current.noteOn(36, 110, 1000); }); // C2 → kick 36
    act(() => { hook.result.current.noteOff(36, 1250); });
    roll(hook, 5000);
    expect(kept(hook).notes).toEqual([
      { ticks: 0, durationTicks: 240, midi: GM_DRUM.kick, velocity: 110 },
    ]);
  });

  it('drum mode toggled OFF between noteOn and noteOff still pairs the pending note', () => {
    // Safe by construction (pending is keyed by the ORIGINAL key and holds the
    // remapped midi) — pinned so a refactor can't regress it.
    const hook = armedHook();
    act(() => { hook.result.current.setDrumMode(true); });
    act(() => { hook.result.current.noteOn(36, 110, 1000); }); // kick opened under drum mode
    act(() => { hook.result.current.setDrumMode(false); });    // mode flips mid-hold
    act(() => { hook.result.current.noteOff(36, 1250); });     // pairs by original key regardless
    roll(hook, 5000);
    expect(kept(hook).notes).toEqual([
      { ticks: 0, durationTicks: 240, midi: GM_DRUM.kick, velocity: 110 },
    ]);
  });
});

// ── keep(): snap, kind, shape ────────────────────────────────────────────────

describe('keep()', () => {
  it('snap sixteenth quantizes START ticks to the 120 grid, preserving duration', () => {
    const hook = armedHook();
    // tick 250 ≈ on at anchor+260.4ms — use ms that map exactly:
    // 250 ticks / 0.96 = 260.416… → build via ms giving round(ms*0.96)=250: 260ms → 249.6 → 250. ✔
    play(hook, 60, 1260, 1760); // ticks 250 → snapped 240; duration 480 preserved
    play(hook, 62, 1135, 1635); // 135ms → 129.6 → tick 130 → snapped 120
    roll(hook, 5000);
    const notes = kept(hook, { snap: 'sixteenth' }).notes; // sorted by ticks: 120 leads
    expect(notes[0]).toMatchObject({ ticks: 120, durationTicks: 480, midi: 62 });
    expect(notes[1]).toMatchObject({ ticks: 240, durationTicks: 480, midi: 60 });
  });

  it('snap off leaves raw ticks untouched', () => {
    const hook = armedHook();
    play(hook, 60, 1260, 1760); // tick 250
    roll(hook, 5000);
    expect(kept(hook, { snap: 'off' }).notes[0].ticks).toBe(250);
  });

  it('snap near cycle end wraps to tick 0 and clamps the end to the cycle', () => {
    const hook = armedHook();
    // offset 3960ms → tick 3801.6 → 3802; nearest 120-grid = 3840 = cycle end → wraps to 0.
    act(() => { hook.result.current.noteOn(60, 90, 4960); });
    roll(hook, 5100); // boundary-close at 3840: duration 3840-3802=38
    roll(hook, 9000);
    const notes = kept(hook, { snap: 'sixteenth' }).notes;
    expect(notes[0].ticks).toBe(0);
    expect(notes[0].durationTicks).toBe(38);
  });

  it('kind inference: overlapping voicings → chords', () => {
    const hook = armedHook();
    // Triad held together = 3 of 4 notes overlapping (75% ≥ 25%).
    act(() => {
      hook.result.current.noteOn(60, 90, 1000);
      hook.result.current.noteOn(64, 90, 1010);
      hook.result.current.noteOn(67, 90, 1020);
      hook.result.current.noteOff(60, 2000);
      hook.result.current.noteOff(64, 2000);
      hook.result.current.noteOff(67, 2000);
    });
    play(hook, 72, 3000, 3400); // lone melodic note
    roll(hook, 5000);
    expect(kept(hook).kind).toBe('chords');
  });

  it('kind inference: sequential single notes → melody', () => {
    const hook = armedHook();
    play(hook, 60, 1000, 1400);
    play(hook, 62, 1500, 1900);
    play(hook, 64, 2000, 2400);
    play(hook, 65, 2500, 2900);
    roll(hook, 5000);
    expect(kept(hook).kind).toBe('melody');
  });

  it('returns the take WITHOUT clearing it (keep-and-continue-layering)', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);
    const first = kept(hook);
    expect(first.notes).toHaveLength(1);
    expect(hook.result.current.passCount).toBe(1);   // untouched
    expect(hook.result.current.state).toBe('cycling');
    play(hook, 64, 5500, 6000);
    roll(hook, 9000);
    expect(kept(hook).notes).toHaveLength(2);        // layering continued
  });

  it('successive keeps mint distinct takeIds', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);
    const a = kept(hook);
    const b = kept(hook);
    expect(a.takeId).toBeTruthy();
    expect(b.takeId).toBeTruthy();
    expect(a.takeId).not.toBe(b.takeId);
  });

  it('timeline uses the timeSig SNAPSHOTTED at arm, not the live prop (frozen-at-arm doctrine)', () => {
    const hook = renderHook(
      ({ timeSig }) => useLoopCapture({ bpm: 120, timeSig }),
      { initialProps: { timeSig: [4, 4] } },
    );
    act(() => { hook.result.current.arm({ lengthBars: 2, anchorWallMs: ANCHOR }); });
    play(hook, 60, 1000, 3000); // 2000ms = exactly one 4/4 bar: ticks 0..1920
    roll(hook, 5000);
    hook.rerender({ timeSig: [3, 4] }); // live prop shifts AFTER arm
    const take = kept(hook);
    // Armed 4/4 (barTicks 1920): the note spans 1 bar → 4 slots. A live-read
    // [3,4] (barTicks 1440) would reinterpret the same ticks as 2 bars → 8.
    expect(take.timeline.slots).toHaveLength(4);
  });

  it('non-groove takes carry a harmonic-timeline citizenship analysis', () => {
    const hook = armedHook();
    play(hook, 60, 1000, 3000); // long C
    roll(hook, 5000);
    const take = kept(hook);
    expect(take.timeline).toBeTruthy();
    expect(take.timeline.root).toBe(0);              // C detected as root
    expect(Array.isArray(take.timeline.slots)).toBe(true);
  });

  it('output shape slots straight into workspaceReducer addLayer as a take source', () => {
    const hook = armedHook();
    play(hook, 60, 1500, 2000);
    roll(hook, 5000);
    const take = kept(hook);
    expect(take.ppq).toBe(480);
    expect(take.lengthBars).toBe(2);

    const state = workspaceReducer(
      initialWorkspace,
      addLayer({
        source: { kind: 'take', takeId: take.takeId, notes: take.notes, ppq: take.ppq, lengthBars: take.lengthBars },
        role: take.kind === 'groove' ? 'groove' : take.kind,
      }),
    );
    expect(state.lastError).toBeNull();
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].source.notes).toEqual(take.notes);
    expect(state.layers[0].id).toBe(String(take.takeId));
  });

  it('groove takes land on the GM drum channel through addLayer', () => {
    const hook = armedHook();
    act(() => { hook.result.current.setDrumMode(true); });
    play(hook, 36, 1500, 1600);
    roll(hook, 5000);
    const take = kept(hook);
    expect(take.kind).toBe('groove');
    const state = workspaceReducer(
      initialWorkspace,
      addLayer({
        source: { kind: 'take', takeId: take.takeId, notes: take.notes, ppq: take.ppq, lengthBars: take.lengthBars },
        role: 'groove',
      }),
    );
    expect(state.layers[0].channel).toBe(9);
  });
});

// ── other time signatures / lengths ──────────────────────────────────────────

describe('non-default grids', () => {
  it('3/4 at 90bpm: bar = 2000ms, 4-bar cycle = 8000ms; ticks scale by bpm', () => {
    // 90bpm → beat = 666.667ms → ticksPerMs = 480/666.667 = 0.72
    // 3/4 bar = 3 beats = 2000ms = 1440 ticks; 4 bars = 8000ms = 5760 ticks.
    const hook = renderHook(() => useLoopCapture({ bpm: 90, timeSig: [3, 4] }));
    act(() => { hook.result.current.arm({ lengthBars: 4, anchorWallMs: 0 }); });
    play(hook, 60, 2000, 2500); // bar 1 downbeat: 2000*0.72 = tick 1440; dur 500*0.72=360
    roll(hook, 8000);
    expect(kept(hook).notes).toEqual([
      { ticks: 1440, durationTicks: 360, midi: 60, velocity: 90 },
    ]);
  });
});
