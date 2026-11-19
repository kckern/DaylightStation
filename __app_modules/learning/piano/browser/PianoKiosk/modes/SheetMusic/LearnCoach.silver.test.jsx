import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach from './LearnCoach.jsx';
import { createCoachPlan } from '../../../../../../../shared/music/learnCoach.mjs';

const h = vi.hoisted(() => ({ lab: null }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'guest' }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ connected: true }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => ({ config: { timezone: 'UTC' } }) }));
vi.mock('../Exercises/ScorePassage.jsx', () => ({ default: ({ onExpectation }) => <button onClick={() => onExpectation({ events: [] })}>Music ready</button> }));
vi.mock('./LearnLab.jsx', () => ({ default: (props) => { h.lab = props; return <div>Running take</div>; } }));

const seg = (id, a, b) => ({ id, label: `Passage ${id}`, barLabel: `Bars ${a + 1}–${b + 1}`, inMeasure: a, outMeasure: b, playableParts: ['rh', 'lh'] });
const planOf = (segments) => createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }] });
const clean = (id) => ({ assessmentId: id, status: 'completed', diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 }, criteria: { completeness: 1, cleanliness: 1 } });
const messy = (id) => ({ ...clean(id), diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 8, missed_notes: 0 }, criteria: { completeness: 1, cleanliness: 0.5 } });
const button = (name) => screen.getByRole('button', { name });
const mount = (segments = [seg('a', 0, 3), seg('b', 4, 7)], legacy = {}) => {
  const plan = planOf(segments); const onPassageChange = vi.fn();
  render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} legacy={legacy} segment={plan.segments[0]} onBack={vi.fn()} onPassageChange={onPassageChange} />);
  return { onPassageChange };
};
const startCheck = () => {
  fireEvent.click(button('Play it on your own'));
  fireEvent.click(button('Music ready'));
  fireEvent.click(button('Start practice'));
};
const finish = (result) => act(async () => { h.lab.onOutcome(result); });

describe('Silver in LearnCoach', () => {
  beforeEach(() => { h.lab = null; localStorage.clear(); });

  it('groups the skills into Silver and Gold', () => {
    mount();
    expect(screen.getByRole('list', { name: 'Silver steps' })).toHaveTextContent('Play it on your own');
    expect(screen.getByRole('list', { name: 'Gold steps' })).toHaveTextContent('Play at score tempo');
  });

  it('celebrates Silver and points to the next passage', async () => {
    const { onPassageChange } = mount(); startCheck();
    expect(h.lab.coachingTask.assist).toBe('none');
    await finish(clean('one'));
    expect(screen.getByRole('heading', { name: 'Silver!' })).toBeInTheDocument();
    expect(screen.getByText('You can play bars 1-4 on your own.')).toBeInTheDocument();
    expect(button('Next passage: Bars 5–8').className).toContain('is-primary');
    expect(button('Go for Gold')).toBeInTheDocument();
    expect(button('Play again')).toBeInTheDocument();
    fireEvent.click(button('Next passage: Bars 5–8'));
    expect(onPassageChange).toHaveBeenCalledWith('b');
  });

  it('says when the whole piece is Silver and leads with Gold', async () => {
    mount([seg('a', 0, 3)]); startCheck();
    await finish(clean('one'));
    expect(screen.getByText('Your whole piece is Silver.')).toBeInTheDocument();
    expect(button('Go for Gold').className).toContain('is-primary');
  });

  it('does not claim Silver for a passage without it', () => {
    mount(undefined, { learn: { passages: { a: { rungs: {} } } }, fingerprint: {} });
    expect(screen.queryByRole('heading', { name: 'You have this one' })).toBeNull();
  });

  it('opens a certified passage with the way forward', async () => {
    mount(undefined, { learn: { passages: { a: { complete: true } } } });
    expect(screen.getByRole('heading', { name: 'You have this one' })).toBeInTheDocument();
    expect(button('Next passage: Bars 5–8').className).toContain('is-primary');
    expect(button('Go for Gold')).toBeInTheDocument();
    expect(button('Practice again')).toBeInTheDocument();
  });

  it('offers a retry, then a drill and a way to come back later', async () => {
    const { onPassageChange } = mount(); startCheck();
    await finish(messy('one'));
    expect(screen.getByRole('heading', { name: 'Almost on your own' })).toBeInTheDocument();
    expect(button('Try again').className).toContain('is-primary');
    expect(screen.queryByRole('button', { name: 'Come back to this later' })).toBeNull();
    fireEvent.click(button('Try again'));
    await finish(messy('two'));
    expect(screen.getByRole('button', { name: /Practice bars/ }).className).toContain('is-primary');
    fireEvent.click(button('Come back to this later'));
    await act(async () => {});
    expect(onPassageChange).toHaveBeenCalledWith('b');
  });
});
