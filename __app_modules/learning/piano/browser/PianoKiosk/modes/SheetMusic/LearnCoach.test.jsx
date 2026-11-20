import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach, { passageDrill } from './LearnCoach.jsx';
import { createCoachPlan, projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';
const h = vi.hoisted(() => ({ profile: 'guest', lab: null, labs: 0,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() } }));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.profile }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ connected: true }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => null }));
vi.mock('../Exercises/ScorePassage.jsx', () => ({ default: (props) => { h.preview = props; return <div>Passage music</div>; } }));
// The drill surface is the real one elsewhere; here it only shows what the coach hands it.
vi.mock('./LearnLab.jsx', () => ({ default: (props) => { h.lab = props; h.labs += 1;
  return <div>Drill surface{props.notice}{props.extraControls}{props.resultLabel && <strong>{props.resultLabel}</strong>}{props.resultActions}</div>; } }));
const plan = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [{ id: 'a', label: 'Segment 1', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
const props = { score: { id: 'score', musicXml: '<score />' }, plan, segment: plan.segments[0], onBack: vi.fn(), onListen: vi.fn() };
const passed = { assessmentId: 'take', status: 'completed', score: 1, diagnostics: { expected_notes: 8, matched_notes: 8 }, criteria: { completeness: 1, cleanliness: 1, placement: 1 }, verdict: { passed: true } };
const outcome = (result) => act(async () => { h.lab.onStarted(); h.lab.onOutcome(result); });
describe('LearnCoach', () => {
 beforeEach(() => { h.profile = 'guest'; h.lab = null; h.labs = 0; props.onListen.mockClear(); props.onBack.mockClear(); localStorage.clear(); });
 it('opens straight into the drill surface on the current step, with no prepare page', () => {
  render(<LearnCoach {...props} />);
  expect(screen.getByText('Drill surface')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Start practice/ })).toBeNull();
  expect(h.lab.coachingTask).toMatchObject({ parts: ['rh'], skill: 'right' });
  expect(h.lab.startOnReady).toBeFalsy();
  expect(h.lab.segment.barLabel).toBe('Bars 1–4');
  expect(screen.queryByText(/Segment 1/)).toBeNull();
  expect(screen.queryByText(/Practicing as/)).toBeNull();
 });
 it('hands the passage to the drill as sets and reps: one set per Silver and Gold step', () => {
  render(<LearnCoach {...props} />);
  const { projection, stepId } = h.lab.drill;
  expect(projection.steps.map((step) => step.display.key)).toEqual(['Right hand', 'Left hand', 'Together', 'On your own', 'Beat', '50%', '60%', '75%', '100%']);
  expect(projection.steps[0]).toMatchObject({ id: stepId, state: 'current', requirement: { required_passes: 1 }, pass_count: 0, passed: false });
  expect(projection.steps[4].requirement.required_passes).toBe(2);
 });
 it('counts banked takes as reps, and a drill belongs to the step it came from', () => {
  const segment = projectCoach({ plan }).segments[0];
  const skills = segment.skills.map((skill, index) => index === 0 ? { ...skill, ready: true } : index === 4 ? { ...skill, successes: 5 } : skill);
  const drillTask = { ...skills[1], key: 'smaller', depth: 1, parent: skills[1] };
  const drill = passageDrill({ ...segment, skills }, drillTask);
  expect(drill.stepId).toBe(skills[1].key);
  expect(drill.projection.steps[0]).toMatchObject({ passed: true, pass_count: 1, state: 'complete' });
  expect(drill.projection.steps[4]).toMatchObject({ passed: false, pass_count: 1 });
  expect(passageDrill({ ...segment, skills }, { key: 'custom', skill: 'custom' }).stepId).toBeNull();
 });
 it('tells the coach a step was chosen only when the take begins', () => {
  const coach = { profileId: 'learner4', loaded: true, projection: projectCoach({ plan }), state: {}, saveStatus: 'saved', selectTask: vi.fn(), record: vi.fn() };
  render(<LearnCoach {...props} coach={coach} />);
  expect(coach.selectTask).not.toHaveBeenCalled();
  act(() => h.lab.onStarted());
  expect(coach.selectTask).toHaveBeenCalledWith(expect.objectContaining({ skill: 'right' }));
 });
 it('waits for saved practice before choosing a step', () => {
  const coach = { profileId: 'learner4', loaded: false, projection: projectCoach({ plan }), state: {}, saveStatus: 'loading', selectTask: vi.fn(), record: vi.fn() };
  render(<LearnCoach {...props} coach={coach} />);
  expect(h.lab).toBeNull();
  expect(screen.getByRole('status', { name: 'Loading your practice' })).toBeInTheDocument();
 });
 it('offers listening from the drill chrome without starting an assessment', () => {
  render(<LearnCoach {...props} />); act(() => h.lab.onListen());
  expect(props.onListen).toHaveBeenCalledWith(expect.objectContaining({ passageId: 'a' }));
  expect(screen.queryByText('Drill surface')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop listening' }));
  expect(screen.getByText('Drill surface')).toBeInTheDocument();
 });
 it('banks a passing take with the drill card and moves to the next step under it', async () => {
  render(<LearnCoach {...props} />);
  await outcome(passed);
  expect(h.lab.card).toMatchObject({ setIndex: 1, setCount: 9, repIndex: 1, repCount: 1, setClear: true, next: { key: 'Left hand' } });
  expect(h.lab.coachingTask.skill).toBe('left');
  act(() => h.lab.onCardDone());
  expect(h.lab.card).toBeNull();
  expect(props.onBack).not.toHaveBeenCalled();
 });
 it('after two misses offers the smaller practice in the drill result, and starts it on a tap', async () => {
  render(<LearnCoach {...props} />);
  const result = { ...passed, verdict: { passed: false }, criteria: { completeness: .5, cleanliness: 1 } };
  await outcome(result);
  expect(screen.getByText(/missing notes/)).toBeInTheDocument();
  expect(h.lab.card).toBeNull();
  expect(screen.getByRole('button', { name: 'Try again' }).className).toContain('is-primary');
  await outcome({ ...result, assessmentId: 'fail2' });
  const smaller = screen.getByRole('button', { name: /Practice bars 1–2/ });
  expect(smaller.className).toContain('is-primary');
  fireEvent.click(smaller);
  expect(h.lab.coachingTask.range.end).toBeLessThan(3);
  expect(h.lab.segment.barLabel).toBe('Bars 1–2');
  expect(h.lab.drill.stepId).toBe(h.lab.drill.projection.steps[0].id);
  expect(h.lab.resultActions).toBeNull();
 });
 it('clears the result when the child plays again from the piano', async () => {
  render(<LearnCoach {...props} />);
  await outcome({ ...passed, verdict: { passed: false }, criteria: { completeness: .5, cleanliness: 1 } });
  expect(h.lab.resultLabel).toMatch(/missing notes/);
  act(() => h.lab.onStarted());
  expect(h.lab.resultLabel).toBeNull();
 });
 it('leaves operational trouble to the drill surface and records nothing', () => {
  const coach = { profileId: 'learner4', loaded: true, projection: projectCoach({ plan }), state: {}, saveStatus: 'saved', selectTask: vi.fn(), record: vi.fn() };
  render(<LearnCoach {...props} coach={coach} />);
  act(() => h.lab.onUnavailable('parts-empty'));
  expect(coach.record).not.toHaveBeenCalled();
  expect(screen.getByText('Drill surface')).toBeInTheDocument();
 });
 it('disposes the active run on a profile switch', async () => {
  const view = render(<LearnCoach {...props} />);
  await outcome({ ...passed, verdict: { passed: false }, criteria: { completeness: .5, cleanliness: 1 } });
  expect(h.lab.resultLabel).not.toBeNull();
  h.profile = 'another'; view.rerender(<LearnCoach {...props} />);
  await waitFor(() => expect(h.lab.resultLabel).toBeNull());
  expect(h.lab.coachingTask.skill).toBe('right');
 });
 it('has no practice chooser: the sets are how a step is chosen', () => {
  render(<LearnCoach {...props} />);
  expect(h.lab.onChangePractice).toBeUndefined();
  expect(h.lab.drill.projection.steps.map((step) => step.display.key)).toEqual(['Right hand', 'Left hand', 'Together', 'On your own', 'Beat', '50%', '60%', '75%', '100%']);
  // Each set is named by a picture; the words stay as its accessible name.
  expect(h.lab.drill.projection.steps.every((step) => step.display.icon && step.title)).toBe(true);
 });
 it('shows save state only when it failed, and retries the same take', async () => {
  const coach = { profileId: 'learner4', loaded: true, projection: projectCoach({ plan }), state: {}, saveStatus: 'error', selectTask: vi.fn(), record: vi.fn(), retry: vi.fn(async () => {}) };
  render(<LearnCoach {...props} coach={coach} />);
  await outcome(passed);
  expect(screen.getByText('Progress not saved')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  await waitFor(() => expect(coach.record).toHaveBeenCalledTimes(2));
  expect(coach.record.mock.calls[1][1].assessmentId).toBe('take');
 });
 it('says nothing about saving when it is saved', () => {
  const coach = { profileId: 'learner4', loaded: true, projection: projectCoach({ plan }), state: {}, saveStatus: 'saved', selectTask: vi.fn(), record: vi.fn() };
  render(<LearnCoach {...props} coach={coach} />);
  expect(h.lab.notice).toBeNull();
  expect(screen.queryByText(/saved/i)).toBeNull();
 });
 it('names a timing recovery by its slower tempo', async () => {
  render(<LearnCoach {...props} />);
  act(() => h.lab.onPickStep({ id: h.lab.drill.projection.steps.at(-1).id }));
  expect(h.lab.coachingTask).toMatchObject({ mode: 'cued', tempoPercent: 100 });
  const failed = { ...passed, criteria: { completeness: 1, cleanliness: 1, placement: .2 }, verdict: { passed: false } };
  await outcome(failed); await outcome({ ...failed, assessmentId: 'timing2' });
  expect(screen.getByRole('button', { name: 'Try a little slower · 75%' })).toBeInTheDocument();
  expect(screen.queryByText('slower-beat')).not.toBeInTheDocument();
 });
 it('logs each take with its tempo and the scores it was judged on', async () => {
  h.log.info.mockClear();
  render(<LearnCoach {...props} />);
  act(() => h.lab.onPickStep({ id: h.lab.drill.projection.steps.at(-2).id }));
  await outcome({ ...passed, criteria: { completeness: 1, cleanliness: 0.93333, placement: 0.71234 }, verdict: { passed: false } });
  expect(h.log.info).toHaveBeenCalledWith('piano.learn.coach.take', expect.objectContaining({
   tempoPercent: 75, placement: 0.712, completeness: 1, cleanliness: 0.933, passed: false,
  }));
 });
 it('puts the passage rail under the drill, and a tile changes passage', () => {
  const two = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [
    { id: 'a', label: 'Segment 1', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] },
    { id: 'b', label: 'Segment 2', barLabel: 'Bars 5–8', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] }] });
  const onPassageChange = vi.fn();
  render(<LearnCoach {...props} plan={two} segment={two.segments[0]} onPassageChange={onPassageChange} />);
  const rail = screen.getByRole('navigation', { name: 'Passages in this piece' });
  expect(rail.querySelectorAll('.piano-passage-rail__tile')).toHaveLength(2);
  expect(rail.querySelector('.piano-passage-rail__go')).toBeNull();
  expect(screen.getByRole('button', { name: 'Bars 1–4, Not started' })).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'Bars 5–8, Not started' }));
  expect(onPassageChange).toHaveBeenCalledWith('b');
  fireEvent.click(screen.getByRole('button', { name: /Open the passage board/ }));
  expect(screen.getByRole('dialog', { name: 'Passage board' })).toBeInTheDocument();
 });
});
