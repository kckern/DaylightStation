import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractLayoutSliced, extractEvents } from './osmdRender.js';

// Minimal stub of an already-engraved OSMD instance that drives
// extractLayoutSliced's cursor walk without a real DOM/SVG. `cursor.next()`
// advances an internal step counter and flips EndReached after `steps` steps;
// each next() also fires `onStep` so a test can consume fake main-thread time.
function stubOsmd({ steps = 100, onStep = () => {} } = {}) {
  let i = 0;
  const mkNote = (halfTone) => ({
    halfTone,
    isRest: () => false,
    IsGraceNote: false,
    NoteTie: null,
    Length: { RealValue: 0.25 },
    ParentStaffEntry: { ParentStaff: { idInMusicSheet: 0 } },
  });
  const Iterator = {
    get EndReached() { return i >= steps; },
    // RealValue * 4 = onsetQuarter; distinct per step so each is its own step.
    get currentTimeStamp() { return { RealValue: i * 0.25 }; },
    CurrentMeasureIndex: 0,
    CurrentMeasure: { MeasureNumber: 1 },
    CurrentBpm: 120,
  };
  const cursor = {
    Iterator,
    cursorElement: null, // → opRect null → boxOfEl short-circuits (no DOM)
    show() {},
    reset() { i = 0; },
    hide() {},
    next() { i += 1; onStep(); },
    NotesUnderCursor() { return [mkNote(48 + (i % 12))]; },
  };
  return { cursor };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('extractLayoutSliced — time-budget slicing', () => {
  it('yields by TIME BUDGET, not step count', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // 3ms of fake main-thread time per step; with an 8ms budget a yield should
    // land roughly every ~3 steps → ~33 yields over 100 steps (NOT ~0 like the
    // old 256-step slice, which never triggers over a 100-step walk).
    const osmd = stubOsmd({ steps: 100, onStep: () => { clock += 3; } });
    const yields = [];
    const res = await extractLayoutSliced(osmd, {
      budgetMs: 8,
      yieldFn: (cb) => { yields.push(clock); cb(); },
    });
    expect(res).toBeTruthy();
    expect(res.steps.length).toBeGreaterThan(0);
    expect(yields.length).toBeGreaterThan(20);
  });

  it('returns the full assembled result shape and reaches progress 1', async () => {
    const osmd = stubOsmd({ steps: 40 });
    const progress = [];
    const res = await extractLayoutSliced(osmd, {
      budgetMs: 8,
      yieldFn: (cb) => cb(),
      onProgress: (p) => progress.push(p),
    });
    expect(res).toBeTruthy();
    for (const key of ['events', 'notes', 'steps', 'measures', 'tempoEntries']) {
      expect(Array.isArray(res[key])).toBe(true);
    }
    expect(res.steps.length).toBe(40);
    expect(res.notes.length).toBe(40);
    expect(res.tempoEntries).toEqual([{ onsetQuarter: 0, bpm: 120 }]); // one bpm change
    expect(progress[progress.length - 1]).toBe(1); // onProgress(1) fired at end
  });

  it('returns an empty result when the osmd has no cursor', async () => {
    const progress = [];
    const res = await extractLayoutSliced({}, { onProgress: (p) => progress.push(p) });
    expect(res).toEqual({ events: [], notes: [], tempoEntries: [], steps: [], measures: [] });
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('aborts mid-walk (returns null) when shouldAbort flips', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    let aborted = false;
    const osmd = stubOsmd({ steps: 100, onStep: () => { clock += 3; } });
    const res = await extractLayoutSliced(osmd, {
      budgetMs: 8,
      yieldFn: (cb) => cb(),
      shouldAbort: () => aborted,
      onProgress: () => { aborted = true; }, // flip after the first slice reports
    });
    expect(res).toBe(null);
  });
});

// A cursor element whose fallback-box props match the null-cursor path (all 0),
// so the only thing under test is `style.visibility`.
function fakeCursorEl() {
  return { style: {}, offsetLeft: 0, offsetWidth: 0, offsetTop: 0, offsetHeight: 0, offsetParent: null };
}

describe('cursor visibility during extraction (audit H0)', () => {
  it('keeps the visible cursor hidden from the user during the sliced walk, restores after', async () => {
    const osmd = stubOsmd({ steps: 20 });
    const el = fakeCursorEl();
    osmd.cursor.cursorElement = el;
    let seenDuringWalk;
    const origNext = osmd.cursor.next;
    osmd.cursor.next = () => { seenDuringWalk = el.style.visibility; origNext(); };
    await extractLayoutSliced(osmd, { yieldFn: (cb) => cb() });
    expect(seenDuringWalk).toBe('hidden'); // user never sees the sweep
    expect(el.style.visibility).toBe('');   // restored for real playback use
  });

  it('extractEvents hides the cursor during its synchronous walk, restores after', () => {
    const osmd = stubOsmd({ steps: 20 });
    const el = fakeCursorEl();
    osmd.cursor.cursorElement = el;
    let seenDuringWalk;
    const origNext = osmd.cursor.next;
    osmd.cursor.next = () => { seenDuringWalk = el.style.visibility; origNext(); };
    extractEvents(osmd);
    expect(seenDuringWalk).toBe('hidden');
    expect(el.style.visibility).toBe('');
  });
});
