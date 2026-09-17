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
  it('draws only pills when labels are off — no placard, no key, no hand', () => {
    const program = {
      id: 'rung:L2',
      steps: [step(1, { state: 'passed', passed: true, pass_count: 3 }), step(2, { state: 'current', pass_count: 1 }), step(3)],
    };
    render(<DrillProgress program={program} stepId="scale-set-2" labels={false} />);

    expect(document.querySelector('.drill-placard')).toBeNull();
    expect(document.querySelector('.drill-cluster__label')).toBeNull();
    expect(screen.queryByText('LH')).toBeNull();
    expect(screen.queryByText('D major')).toBeNull();
    expect(pills()).toEqual(['banked', 'banked', 'banked', 'banked', 'current', 'todo', 'todo', 'todo', 'todo']);
  });

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

  it('reports the key and the hand of the set being played, for the host to title with', async () => {
    learning.mockResolvedValue(drill([
      step(1, { state: 'passed', passed: true, pass_count: 3 }),
      step(2, { state: 'current', display: { key: 'D major', hand: 'L', hand_label: 'left hand' } }),
      step(3),
    ]));
    const onPlacard = vi.fn();

    render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-2" userId="kckern" onPlacard={onPlacard} />);

    // The placard is the RUN'S TITLE and is drawn by the host at the top of the
    // screen, so what this owes is the name, not the markup.
    await waitFor(() => expect(onPlacard).toHaveBeenCalledWith('D major', 'left hand'));
    expect(document.querySelector('.drill-placard')).toBeNull();
    // Hands are labelled, not drawn as clef glyphs — U+1D11E tofus on the kiosk.
    expect(screen.getByText('LH')).toBeInTheDocument();
  });

  it('reports no title where there is no drill to name — a single-set program', async () => {
    learning.mockResolvedValue(drill([step(1, { state: 'current', display: { key: 'D major' } })]));
    const onPlacard = vi.fn();

    render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-1" userId="kckern" onPlacard={onPlacard} />);

    await waitFor(() => expect(learning).toHaveBeenCalled());
    expect(onPlacard).toHaveBeenCalledWith(null, null);
    expect(onPlacard).not.toHaveBeenCalledWith('D major', expect.anything());
  });

  it('takes its title back when it unmounts — a heading cannot outlive its drill', async () => {
    learning.mockResolvedValue(drill([
      step(1, { state: 'current', display: { key: 'D major', hand_label: 'left hand' } }),
      step(2),
    ]));
    const onPlacard = vi.fn();

    const view = render(<DrillProgress programId="scale-drill-3x3" stepId="scale-set-1" userId="kckern" onPlacard={onPlacard} />);
    await waitFor(() => expect(onPlacard).toHaveBeenCalledWith('D major', 'left hand'));

    view.unmount();
    expect(onPlacard).toHaveBeenLastCalledWith(null, null);
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
