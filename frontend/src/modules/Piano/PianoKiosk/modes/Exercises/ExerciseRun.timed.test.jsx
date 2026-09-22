// ExerciseRun.timed.test.jsx — ONE JUDGE, ON THE STAFF A CHILD SEES.
//
// The field incident this pins (2026-09-22): in a cued run the staff painted a
// note green whenever the held key matched the clock cursor's note, and the
// cursor sits on a note from its onset until the next one. A child playing
// every note ~450 ms late therefore saw green on every note while the grader
// charged each one to the NEXT beat and scored the run 0.
//
// Unlike ExerciseRun.component.test.jsx this mounts the REAL SvgSequenceStaff
// and the real assessment runtime, on a fake clock, and plays notes stamped
// with their own MIDI time — the path the kiosk takes.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  activeNotes: new Map(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() },
  record: vi.fn(),
}));

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: true }),
  usePianoMidiNotes: () => ({ activeNotes: h.activeNotes }),
}));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'learner4' }) }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({
  PianoKeyboard: ({ wrongNotes }) => <div data-testid="keyboard" data-wrong={[...(wrongNotes ?? [])].join(',')} />,
}));
vi.mock('../SheetMusic/useMetronomeClick.js', () => ({ useMetronomeClick: () => {} }));
vi.mock('../../../performance/attemptEvidence.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pianoAttemptClient: { record: h.record } };
});

const { default: ExerciseRun, timingSentence, timedWindowOpen } = await import('./ExerciseRun.jsx');

// Four quarters at 120 bpm: onsets 500 ms apart, so each beat's window is
// 0.4 × 500 = 200 ms and a right note up to 500 ms off is claimed early/late.
const INSTANCE = Object.freeze({
  id: 'scales/timed@test',
  title: 'Timed fragment',
  form: 'scale',
  ordering: 'strict',
  key: 'C',
  meter: '4/4',
  tempo: { start_bpm: 120 },
  level: { cued: 3 },
  events: [60, 62, 64, 65].map((midi, i) => ({ id: `beat-${i}`, value: 'quarter', notes: [{ midi, hand: 'right' }] })),
});
const LEAD_IN_MS = 4 * 60000 / 120;
const GAP_MS = 500;

const props = { instance: INSTANCE, score: null, intent: 'practice', practiceMode: 'cued', tier: 2 };

let view;
let armedAt;
const rerender = () => view.rerender(<ExerciseRun {...props} />);
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
/** Press at the CURRENT fake time, stamped with that time, and release. */
const strike = (midi, { holdMs = 60 } = {}) => {
  act(() => { h.activeNotes = new Map([[midi, { velocity: 1, timestamp: Date.now() }]]); rerender(); });
  advance(holdMs);
};
const release = () => act(() => { h.activeNotes = new Map(); rerender(); });
const advanceTo = (offsetMs) => advance(armedAt + offsetMs - Date.now());
const headState = (midi) => {
  const head = document.querySelector(`.action-staff__note[data-midi="${midi}"]`);
  return [...head.classList].find((name) => name.startsWith('sequence-note-'));
};

function mountAndArm() {
  view = render(<ExerciseRun {...props} />);
  expect(screen.getByText(/Press any key to start/)).toBeInTheDocument();
  armedAt = Date.now();
  strike(55, { holdMs: 0 });
  release();
  expect(document.querySelector('.piano-exercise-run').dataset.stage).toBe('sequence');
}

describe('a timed run paints the judge, not the held key', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-22T16:54:00Z') });
    h.activeNotes = new Map();
    h.record.mockReset();
    h.record.mockResolvedValue({ ok: true, status: 201, data: { attempt_id: 'stored' }, durationMs: 4 });
    for (const logger of Object.values(h.log)) logger.mockClear();
  });
  afterEach(() => { view?.unmount(); vi.useRealTimers(); });

  it('a child ~450 ms late on every note sees amber ▸ — never green — and is told they were late', async () => {
    mountAndArm();
    const midis = [60, 62, 64, 65];
    for (const [index, midi] of midis.entries()) {
      advanceTo(LEAD_IN_MS + index * GAP_MS + 450);
      strike(midi);
      // The key is STILL DOWN and the clock cursor is still on this note —
      // exactly the frame the old staff painted green.
      expect(headState(midi)).toBe('sequence-note-late');
      expect(document.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      release();
    }
    expect(document.querySelectorAll('.sequence-staff__drift--late')).toHaveLength(4);
    advanceTo(LEAD_IN_MS + 4 * GAP_MS + 100);
    await act(async () => {});
    const copy = screen.getByText(/Every note was right, but 4 of 4 came late — about 0\.[45] s behind the click\./);
    expect(copy).toBeInTheDocument();
    // Still no green anywhere once it is over.
    expect(document.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
    // The judge's numbers ride on the trace and in one summary line.
    expect(h.log.info).toHaveBeenCalledWith('piano.exercise-observation', expect.objectContaining({
      eventType: 'offbeat', side: 'late', driftMs: 450,
    }));
    expect(h.log.info).toHaveBeenCalledWith('piano.exercise-timing-summary', expect.objectContaining({
      kind: 'timing', late: 4, early: 0, medianDriftMs: 450, windowMs: 200,
    }));
  });

  it('on the beat is green, and the run passes', () => {
    mountAndArm();
    for (const [index, midi] of [60, 62, 64, 65].entries()) {
      advanceTo(LEAD_IN_MS + index * GAP_MS + 10);
      strike(midi);
      expect(headState(midi)).toBe('sequence-note-hit');
      release();
    }
    expect(document.querySelectorAll('.sequence-note-late, .sequence-note-early, .sequence-staff__drift')).toHaveLength(0);
    advanceTo(LEAD_IN_MS + 4 * GAP_MS + 100);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('a wrong pitch draws a red ghost on its beat and does not shift the notes after it', () => {
    mountAndArm();
    advanceTo(LEAD_IN_MS + 10);
    strike(60);
    release();
    advanceTo(LEAD_IN_MS + GAP_MS + 10);
    strike(63); // D# where D was asked
    release();
    const ghost = document.querySelector('.sequence-staff__ghost--wrong');
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('data-entry-index')).toBe('1');
    expect(ghost.querySelector('[data-midi="63"]')).not.toBeNull();
    advanceTo(LEAD_IN_MS + 2 * GAP_MS + 10);
    strike(64);
    expect(headState(64)).toBe('sequence-note-hit');
    release();
  });

  it('judges a note at its own MIDI time, not when the effect ran', () => {
    mountAndArm();
    // Struck 10 ms after the first beat, delivered 300 ms later: on the beat.
    advanceTo(LEAD_IN_MS + 310);
    act(() => { h.activeNotes = new Map([[60, { velocity: 1, timestamp: armedAt + LEAD_IN_MS + 10 }]]); rerender(); });
    advance(60);
    expect(headState(60)).toBe('sequence-note-hit');
  });

  it('a note struck before the first window opens is a count-in gesture, not a note', () => {
    mountAndArm();
    advanceTo(LEAD_IN_MS - 500);
    strike(60);
    release();
    expect(h.log.info).toHaveBeenCalledWith('piano.exercise-input-ignored', expect.objectContaining({ reason: 'countdown', ignored: [60] }));
    // Inside the first window, even while the count-in is still on screen, it
    // is the first note — early by 100 ms, inside a 200 ms window: a hit.
    advanceTo(LEAD_IN_MS - 100);
    strike(60);
    advanceTo(LEAD_IN_MS + 60);
    expect(headState(60)).toBe('sequence-note-hit');
  });

  it('lights the cursor only while the current beat\'s window is open', () => {
    mountAndArm();
    advanceTo(LEAD_IN_MS + 50);
    expect(document.querySelector('.sequence-staff__cursor').classList.contains('is-window-open')).toBe(true);
    advanceTo(LEAD_IN_MS + 300);
    expect(document.querySelector('.sequence-staff__cursor').classList.contains('is-window-closed')).toBe(true);
  });
});

describe('timingSentence', () => {
  it('names lateness, earliness and mixed timing, in seconds to one decimal', () => {
    expect(timingSentence({ kind: 'timing', late: 6, early: 0, offbeat: 6, medianDriftMs: 420 }, 8))
      .toBe('Every note was right, but 6 of 8 came late — about 0.4 s behind the click.');
    expect(timingSentence({ kind: 'timing', late: 0, early: 3, offbeat: 3, medianDriftMs: -260 }, 8))
      .toBe('Every note was right, but 3 of 8 came early — about 0.3 s ahead of the click.');
    expect(timingSentence({ kind: 'timing', late: 2, early: 2, offbeat: 4, medianDriftMs: 10 }, 8))
      .toBe('Every note was right, but 4 of 8 were off the beat.');
    expect(timingSentence({ kind: 'notes', late: 0, early: 0, offbeat: 0, medianDriftMs: null }, 8)).toBeNull();
  });
});

describe('timedWindowOpen', () => {
  it('is undefined for a rest or a missing event', () => {
    expect(timedWindowOpen({ expectation: { events: [{ notes: [] }] }, startedAt: 0 }, 0, 0)).toBeUndefined();
    expect(timedWindowOpen({ expectation: { events: [] }, startedAt: 0 }, 3, 0)).toBeUndefined();
  });
});
