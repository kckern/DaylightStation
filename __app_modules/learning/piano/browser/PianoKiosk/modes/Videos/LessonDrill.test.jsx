import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ askProps: [] }));
vi.mock('../../../ask/AskSession.jsx', () => ({
  default: function AskSessionDouble(props) {
    h.askProps.push(props);
    return (
      <div data-testid="ask">
        <span data-testid="ask-instance">{props.materialSpec?.instanceId}</span>
        <button type="button" onClick={() => props.onPassed?.({ score: 0.9 })}>pass</button>
        <button type="button" onClick={() => props.onFailed?.({ score: 0.2 })}>fail</button>
      </div>
    );
  },
}));
const listeners = new Set();
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } }),
}));
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn(), error: vi.fn() };
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));

import LessonDrill from './LessonDrill.jsx';
import { DRILL_TITLE, DRILL_DONE, GENTLE_CLIMB } from './lessonCreditCopy.js';

const scaleDrill = (sets = 1, reps = 2) => ({
  reps: sets * reps,
  spec: { kind: 'exercise', collection: 'scales', roots: ['C', 'G', 'F'].slice(0, sets), mode: 'ionian', direction: 'up-then-down', span_octaves: 1, sets, reps, hands: ['R', 'L', 'RL'].slice(0, sets) },
});
const T0 = 1_762_000_000_000;
const emit = (evt) => act(() => { for (const fn of listeners) fn(evt); });

beforeEach(() => { h.askProps = []; listeners.clear(); vi.useRealTimers(); });

describe('LessonDrill', () => {
  it('intro shows the title and the rep count, and no number score', () => {
    render(<LessonDrill drill={scaleDrill(1, 2)} onRepPassed={vi.fn()} onComplete={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getByText(DRILL_TITLE)).toBeTruthy();
    expect(screen.getByText('2 quick scales — then it counts.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\/10|score|%/i);
  });

  it('passing 2 of 2 reps reports each rep and completes', async () => {
    vi.useFakeTimers();
    const onRepPassed = vi.fn();
    const onComplete = vi.fn();
    render(<LessonDrill drill={scaleDrill(1, 2)} onRepPassed={onRepPassed} onComplete={onComplete} onLeave={vi.fn()} />);
    fireEvent.click(screen.getByText('Start'));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByText('pass'));
    expect(onRepPassed).toHaveBeenLastCalledWith(1);
    await act(async () => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByText('pass'));
    expect(onRepPassed).toHaveBeenLastCalledWith(2);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getByText(DRILL_DONE)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/90%/);
  });

  it('a failed rep is simply played again', async () => {
    const onRepPassed = vi.fn();
    render(<LessonDrill drill={scaleDrill(1, 2)} onRepPassed={onRepPassed} onComplete={vi.fn()} onLeave={vi.fn()} />);
    fireEvent.click(screen.getByText('Start'));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByText('fail'));
    expect(onRepPassed).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask')).toBeTruthy();
  });

  it('leaving calls onLeave with no credit (RF3)', () => {
    const onLeave = vi.fn();
    const onComplete = vi.fn();
    render(<LessonDrill drill={scaleDrill()} onRepPassed={vi.fn()} onComplete={onComplete} onLeave={onLeave} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(onLeave).toHaveBeenCalledWith(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a gentle (preschool) climb passes on 5 rising human notes', async () => {
    vi.useFakeTimers();
    const onRepPassed = vi.fn();
    const onComplete = vi.fn();
    const drill = { reps: 1, spec: { kind: 'gentle', rounds: [{ type: 'climb', count: 5, start: 60 }] } };
    render(<LessonDrill drill={drill} onRepPassed={onRepPassed} onComplete={onComplete} onLeave={vi.fn()} />);
    expect(screen.getByText('One quick finger game — then it counts.')).toBeTruthy();
    fireEvent.click(screen.getByText('Start'));
    expect(screen.getByText(GENTLE_CLIMB)).toBeTruthy();
    [60, 62, 64, 62, 64, 65, 67, 69].forEach((n, i) => emit({ type: 'note_on', note: n, velocity: 60 + i, time: T0 + i * 400 }));
    expect(onRepPassed).toHaveBeenCalledWith(1);
    await act(async () => { vi.advanceTimersByTime(2600); });
    expect(onComplete).toHaveBeenCalled();
  });

  it('a gentle echo passes when the 3 notes are copied in order', () => {
    const onRepPassed = vi.fn();
    const drill = { reps: 1, spec: { kind: 'gentle', rounds: [{ type: 'echo', notes: [60, 64, 62] }] } };
    render(<LessonDrill drill={drill} onRepPassed={onRepPassed} onComplete={vi.fn()} onLeave={vi.fn()} />);
    fireEvent.click(screen.getByText('Start'));
    [60, 62, 60, 64, 62].forEach((n, i) => emit({ type: 'note_on', note: n, velocity: 70, time: T0 + i * 400 }));
    expect(onRepPassed).toHaveBeenCalledWith(1);
  });
});
