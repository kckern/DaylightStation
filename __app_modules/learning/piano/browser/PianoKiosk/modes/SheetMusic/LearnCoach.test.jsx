import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach from './LearnCoach.jsx';
import { createCoachPlan, projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';
const h = vi.hoisted(() => ({ profile: 'guest', connected: true, lab: null, unavailable: null }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.profile }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ connected: h.connected }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => null }));
vi.mock('../Exercises/ScorePassage.jsx', () => ({ default: (props) => { const { onExpectation, onUnrunnable } = props; h.preview = props;
  h.unavailable = onUnrunnable;
  return <button onClick={() => onExpectation({ events: [{ notes: [60] }] })}>Music ready</button>;
} }));
vi.mock('./LearnLab.jsx', () => ({ default: (props) => { h.lab = props; return <div>Running take</div>; } }));
const plan = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [{ id: 'a', label: 'Opening', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
const props = { score: { id: 'score', musicXml: '<score />' }, plan, segment: plan.segments[0], onBack: vi.fn(), onListen: vi.fn() };
const passed = { assessmentId: 'take', status: 'completed', diagnostics: { expected_notes: 8, matched_notes: 8 }, criteria: { completeness: 1, cleanliness: 1, placement: 1 }, verdict: { passed: true } };
const start = async () => { fireEvent.click(screen.getByRole('button', { name: 'Music ready' })); fireEvent.click(screen.getByRole('button', { name: 'Start practice', exact: true })); await screen.findByText('Running take'); };
describe('LearnCoach', () => {
 beforeEach(() => { h.profile = 'guest'; h.connected = true; h.lab = null; props.onListen.mockClear(); localStorage.clear(); });
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
  const smaller = screen.getByRole('button', { name: /Practice bars 1–2/ });
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
 it('keeps custom hands, beat and tempo through preparation and another setup visit', async () => {
  render(<LearnCoach {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change practice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Left hand', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Play on time', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Slow 40%' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use this setup' }));
  expect(screen.getByRole('heading', { name: 'Your practice' })).toBeInTheDocument();
  expect(h.lab).toBeNull();
  await start(); expect(h.lab.coachingTask).toMatchObject({ parts: ['lh'], mode: 'cued', tempoPercent: 40 });
  act(() => h.lab.onChangePractice());
  expect(screen.getByRole('button', { name: 'Left hand', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Slow 40%' })).toHaveAttribute('aria-pressed', 'true');
 });

 it('explains missing MIDI separately and never starts until the connection is restored', () => {
  h.connected = false; const view = render(<LearnCoach {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Music ready' }));
  expect(screen.getByText(/Connect the piano/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
  h.connected = true; view.rerender(<LearnCoach {...props} />);
  expect(screen.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
 });
 it('shows preparation failure and retries the music without losing the selected task', () => {
  render(<LearnCoach {...props} />); act(() => h.unavailable('engrave-failed'));
  expect(screen.getByRole('alert')).toHaveTextContent('music could not be prepared');
  fireEvent.click(screen.getByRole('button', { name: 'Retry music' }));
  expect(screen.getByText('Preparing the music…')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Music ready' }));
  expect(screen.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
 });
 it('keeps success visible beside save failure and retries the same take', async () => {
  const coach = { profileId:'learner4', projection:projectCoach({plan}), state:{}, saveStatus:'error', selectTask:vi.fn(), record:vi.fn(), retry:vi.fn(async()=>{}) };
  render(<LearnCoach {...props} coach={coach} />); await start();
  act(()=>h.lab.onOutcome(passed));expect(screen.getByRole('heading',{name:'Nice work!'})).toBeInTheDocument();
  expect(screen.getByText('Progress not saved')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry saving'}));
  await waitFor(()=>expect(coach.record).toHaveBeenCalledTimes(2));expect(coach.record.mock.calls[1][1].assessmentId).toBe('take');
 });

 it('uses the changed task for its excerpt and waits for that task to become ready', async()=>{
  render(<LearnCoach {...props}/>);await start();await act(async()=>h.lab.onOutcome(passed));
  fireEvent.click(screen.getByRole('button',{name:'Change practice'}));fireEvent.click(screen.getByRole('button',{name:'Left hand',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Use this setup'}));
  expect(h.preview.activeParts).toEqual(['lh']);expect(screen.getByRole('button',{name:'Start practice',exact:true})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Music ready'}));expect(screen.getByRole('button',{name:'Start practice',exact:true})).toBeEnabled();
 });
 it('names a timing recovery by its slower tempo, without internal reason enums',async()=>{
  render(<LearnCoach {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Try the full passage'}));await start();
  const failed={...passed,criteria:{completeness:1,cleanliness:1,placement:.2},verdict:{passed:false}};
  await act(async()=>h.lab.onOutcome(failed));fireEvent.click(screen.getByRole('button',{name:'Play again'}));
  await act(async()=>h.lab.onOutcome({...failed,assessmentId:'timing2'}));
  expect(screen.getByRole('button',{name:'Try a little slower · 80%'})).toBeInTheDocument();
  expect(screen.queryByText('slower-beat')).not.toBeInTheDocument();
 });

 it('labels inherited completion without claiming a newly measured full-tempo performance',()=>{
  render(<LearnCoach {...props} legacy={{learn:{passages:{a:{complete:true}}}}}/>);
  expect(screen.getByText('Previously completed')).toBeInTheDocument();
  expect(screen.queryByText('Played at score tempo',{exact:true})).not.toBeInTheDocument();
 });

});
