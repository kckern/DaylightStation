import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach from './LearnCoach.jsx';
import { createCoachPlan } from '../../../../../../../shared/music/learnCoach.mjs';
const h = vi.hoisted(() => ({ profile: 'guest', lab: null, unavailable: null }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.profile }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => null }));
vi.mock('../Exercises/ScorePassage.jsx', () => ({ default: ({ onExpectation, onUnrunnable }) => {
  h.unavailable = onUnrunnable;
  return <button onClick={() => onExpectation({ events: [{ notes: [60] }] })}>Music ready</button>;
} }));
vi.mock('./LearnLab.jsx', () => ({ default: (props) => { h.lab = props; return <div>Running take</div>; } }));
const plan = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [{ id: 'a', label: 'Opening', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
const props = { score: { id: 'score', musicXml: '<score />' }, plan, segment: plan.segments[0], onBack: vi.fn(), onListen: vi.fn() };
const passed = { assessmentId: 'take', status: 'completed', diagnostics: { expected_notes: 8, matched_notes: 8 }, criteria: { completeness: 1, cleanliness: 1, placement: 1 }, verdict: { passed: true } };
const start = async () => { fireEvent.click(screen.getByRole('button', { name: 'Music ready' })); fireEvent.click(screen.getByRole('button', { name: 'Start practice', exact: true })); await screen.findByText('Running take'); };
describe('LearnCoach', () => {
 beforeEach(() => { h.profile = 'guest'; h.lab = null; props.onListen.mockClear(); localStorage.clear(); });
 it('prepares one clear task and waits for notation and a deliberate start', async () => {
  render(<LearnCoach {...props} />);
  expect(screen.getByRole('heading', { name: 'Find the right-hand notes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
  expect(screen.getByText(/Choose your name to save/)).toBeInTheDocument();
  expect(screen.getByText(/Find every note/)).toBeInTheDocument();
  await start(); expect(h.lab.startOnReady).toBe(true); expect(h.lab.coachingTask.parts).toEqual(['rh']);
 });
 it('offers listening without starting an assessment', () => {
  render(<LearnCoach {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
  expect(props.onListen).toHaveBeenCalledWith(expect.objectContaining({ passageId: 'a' })); expect(h.lab).toBeNull();
 });
 it('ends each take with feedback and a choice, and retains achievements through replay', async () => {
  render(<LearnCoach {...props} />); await start();
  await act(async () => h.lab.onOutcome(passed));
  expect(screen.getByRole('heading', { name: 'Nice work!' })).toBeInTheDocument();
  expect(screen.queryByText('Running take')).not.toBeInTheDocument();
  expect(screen.getByText(/One more successful take/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
  expect(screen.getByText('Running take')).toBeInTheDocument();
  await act(async () => h.lab.onOutcome({ ...passed, assessmentId: 'take2' }));
  expect(screen.getByText(/Skill earned/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Next: Find the left-hand notes/ })).toBeInTheDocument();
 });
 it('recommends a bounded smaller task after two real difficulties, with deliberate acceptance', async () => {
  render(<LearnCoach {...props} />); await start();
  const result = { ...passed, verdict: { passed: false }, criteria: { completeness: .5, cleanliness: 1 } };
  await act(async () => h.lab.onOutcome(result)); fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
  await act(async () => h.lab.onOutcome({ ...result, assessmentId: 'fail2' }));
  expect(screen.getByRole('heading', { name: /missing notes/ })).toBeInTheDocument();
  const smaller = screen.getByRole('button', { name: /Try a smaller task/ });
  expect(screen.queryByText('Running take')).not.toBeInTheDocument(); fireEvent.click(smaller);
  expect(h.lab.coachingTask.range.end).toBeLessThan(3);
 });
 it('keeps operational trouble separate from musical feedback', async () => {
  render(<LearnCoach {...props} />); await start();
  act(() => h.lab.onUnavailable('parts-empty'));
  expect(screen.getByRole('heading', { name: 'This take could not be checked' })).toBeInTheDocument();
  expect(screen.queryByText(/missing notes/)).not.toBeInTheDocument();
 });
 it('disposes the active run on a profile switch and returns to preparation', async () => {
  const view = render(<LearnCoach {...props} />); await start();
  h.profile = 'another'; view.rerender(<LearnCoach {...props} />);
  await waitFor(() => expect(screen.queryByText('Running take')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Start practice', exact: true })).toBeInTheDocument();
 });
});
