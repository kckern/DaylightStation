import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrillProgress from './DrillProgress.jsx';

/**
 * The drill chrome reads a PROJECTED program and invents nothing. These tests
 * pin the two things a learner reads off it — how many reps are banked, and
 * which set is live — plus the failure mode that took out 50 unrelated tests
 * the first time this shipped: a `pianoLearningApi` without a `learning`
 * method must produce no pills, never an exception through the run stage.
 */

const learning = vi.fn();
vi.mock('./pianoLearningApi.js', () => ({ pianoLearningApi: { learning: (...args) => learning(...args) } }));

const step = (n, over = {}) => ({
  id: `scale-set-${n}`,
  order: n,
  title: `Set ${n}`,
  requirement: { required_passes: 3 },
  display: { key: ['G major', 'D major', 'A major'][n - 1], hand: ['R', 'L', 'RL'][n - 1], hand_label: 'right hand' },
  state: 'upcoming',
  passed: false,
  pass_count: 0,
  ...over,
});

const drill = (steps) => ({ ok: true, data: { programs: [{ id: 'scale-drill-3x3', steps }] } });

const pills = () => [...document.querySelectorAll('.drill-pill')].map((p) => p.dataset.state);

beforeEach(() => { learning.mockReset(); });

describe('DrillProgress', () => {
  it('banks a pill per pass and marks the live set current', async () => {
    learning.mockResolvedValue(drill([
      step(1, { state: 'current', pass_count: 2 }),
      step(2),
      step(3),
    ]));

    render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-1" userId="kckern" />);

    await waitFor(() => expect(pills()).toHaveLength(9));
    // Two banked, the third live, the remaining six untouched.
    expect(pills()).toEqual([
      'banked', 'banked', 'current',
      'todo', 'todo', 'todo',
      'todo', 'todo', 'todo',
    ]);
  });

  it('fills every pill of a passed set, whatever its pass count reads', async () => {
    learning.mockResolvedValue(drill([
      step(1, { state: 'passed', passed: true, pass_count: 3 }),
      step(2, { state: 'current', pass_count: 0 }),
      step(3),
    ]));

    render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-2" userId="kckern" />);

    await waitFor(() => expect(pills()).toHaveLength(9));
    expect(pills().slice(0, 3)).toEqual(['banked', 'banked', 'banked']);
    expect(pills()[3]).toBe('current');
  });

  it('names the key and the hand of the set being played', async () => {
    learning.mockResolvedValue(drill([
      step(1, { state: 'passed', passed: true, pass_count: 3 }),
      step(2, { state: 'current', display: { key: 'D major', hand: 'L', hand_label: 'left hand' } }),
      step(3),
    ]));

    render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-2" userId="kckern" />);

    expect(await screen.findByText('left hand')).toBeInTheDocument();
    // The key is deliberately in two places — the placard announces the set and
    // the cluster maps it — so this asserts on the placard rather than on a
    // bare string that legitimately matches twice.
    expect(document.querySelector('.drill-placard__key').textContent).toBe('D major');
    // Hands are labelled, not drawn as clef glyphs — U+1D11E tofus on the kiosk.
    expect(screen.getByText('LH')).toBeInTheDocument();
  });

  it('draws nothing for a single-set program — one pill says nothing', async () => {
    learning.mockResolvedValue(drill([step(1, { state: 'current' })]));
    const { container } = render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-1" userId="kckern" />);
    await waitFor(() => expect(learning).toHaveBeenCalled());
    expect(container.querySelector('.drill-progress')).toBeNull();
  });

  it('survives a learning API that has no learning method', async () => {
    // The real regression: AskSession doubles this module with only the methods
    // it uses, and calling an absent one threw straight through ExerciseRun.
    learning.mockImplementation(() => undefined);
    const { container } = render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-1" userId="kckern" />);
    expect(container.querySelector('.drill-progress')).toBeNull();
  });

  it('asks for nothing without a program or a user', () => {
    render(<DrillProgress programId={null} stepId={null} userId="kckern" />);
    expect(learning).not.toHaveBeenCalled();
  });
});
