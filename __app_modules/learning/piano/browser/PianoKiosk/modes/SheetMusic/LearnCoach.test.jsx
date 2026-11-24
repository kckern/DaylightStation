import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach, { passageDrill, recoveryWording } from './LearnCoach.jsx';
import { applyCoachEvent, createCoachPlan, projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';
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
const plan = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', certification: { testOutFirst: false }, segments: [{ id: 'a', label: 'Segment 1', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }] });
const props = { score: { id: 'score', musicXml: '<score />' }, plan, segment: plan.segments[0], onBack: vi.fn(), onListen: vi.fn() };
const passed = { assessmentId: 'take', status: 'completed', score: 1, diagnostics: { expected_notes: 8, matched_notes: 8 }, criteria: { completeness: 1, cleanliness: 1, placement: 1 }, verdict: { passed: true } };
const keyOf = (skill) => plan.tasks.find((task) => task.passageId === 'a' && task.skill === skill).key;
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
 it('hands the passage to the drill as sets and reps: only the steps of its lap, headed by its token', () => {
  render(<LearnCoach {...props} />);
  const { projection, stepId } = h.lab.drill;
  // The Bronze lap: the hands, together, the check. The Gold steps are not drawn (no row of locks).
  expect(projection.steps.map((step) => step.display.key)).toEqual(['Right hand', 'Left hand', 'Together', 'On your own']);
  expect(projection.steps.some((step) => step.locked)).toBe(false);
  expect(projection.steps[0]).toMatchObject({ id: stepId, state: 'current', requirement: { required_passes: 1 }, pass_count: 0, passed: false });
  expect(projection.head).toMatchObject({ text: 'A · steps to Bronze', lap: 'silver', level: 'bronze' });
 });
 it('draws the Gold lap\'s steps for a Gold task: rhythm, beat, one hand with the beat, the timed rungs', () => {
  const segment = projectCoach({ plan }).segments[0];
  const rhythm = segment.skills.find((skill) => skill.skill === 'rhythm');
  const drill = passageDrill(segment, rhythm, { unit: { letter: 'A', state: 'silver' } });
  expect(drill.projection.steps.map((step) => step.display.key)).toEqual(['Rhythm', 'Beat', 'Right 30%', 'Left 30%', '30%', '50%', '75%', '100%']);
  expect(drill.projection.steps[0].requirement.required_passes).toBe(2);
  expect(drill.projection.head).toMatchObject({ text: 'A · steps to Gold', level: 'gold' });
  expect(drill.stepId).toBe(rhythm.key);
 });
 it('counts banked takes as reps, and a drill belongs to the step it came from', () => {
  const segment = projectCoach({ plan }).segments[0];
  const skills = segment.skills.map((skill, index) => index === 0 ? { ...skill, ready: true } : index === 3 ? { ...skill, successes: 5 } : skill);
  const drillTask = { ...skills[1], key: 'smaller', depth: 1, parent: skills[1] };
  const drill = passageDrill({ ...segment, skills }, drillTask);
  expect(drill.stepId).toBe(skills[1].key);
  expect(drill.projection.steps[0]).toMatchObject({ passed: true, pass_count: 1, state: 'complete' });
  expect(drill.projection.steps[3]).toMatchObject({ passed: false, pass_count: 0 });
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
  expect(h.lab.card).toMatchObject({ setIndex: 1, setCount: 4, repIndex: 1, repCount: 1, setClear: true, next: { key: 'Left hand' } });
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
  expect(h.lab.drill.projection.steps.map((step) => step.display.key)).toEqual(['Right hand', 'Left hand', 'Together', 'On your own']);
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
 it('words each recovery once, for its button and its onward sentence', () => {
  expect(recoveryWording({ reason: 'slower-beat', tempoPercent: 75 })).toEqual({ button: 'Try a little slower · 75%', sentence: 'try a little slower (75%)' });
  expect(recoveryWording({ reason: 'slower-beat' })).toEqual({ button: 'Try a little slower', sentence: 'try a little slower' });
  expect(recoveryWording({ reason: 'one-hand', parts: ['lh'] })).toEqual({ button: 'Practice the left hand', sentence: 'practice the left hand' });
  expect(recoveryWording({ reason: 'smaller-span', range: { start: 1, end: 1 } }).sentence).toBe('practice bar 2');
  expect(recoveryWording({ reason: 'smaller-span', range: { start: 0, end: 2 } }).button).toBe('Practice bars 1–3');
 });
 it('words a step down by the half\'s name on the path, or its bars without one', () => {
  expect(recoveryWording({ reason: 'smaller-join', stepDown: 'join:c:d', range: { start: 8, end: 15 } }, { 'join:c:d': 'C–D' })).toEqual({ button: 'Play C–D', sentence: 'play C–D' });
  expect(recoveryWording({ reason: 'smaller-join', stepDown: 'x', range: { start: 8, end: 15 } })).toEqual({ button: 'Play bars 9–16', sentence: 'play bars 9–16' });
 });
 it('heads the strip of a step down with the half first, then the join', () => {
  const segment = projectCoach({ plan }).segments[0];
  const check = segment.skills.find((skill) => skill.assist === 'none');
  const down = { ...check, assist: undefined, key: 'down', depth: 1, parent: check, reason: 'smaller-join', stepDown: 'c' };
  const drill = passageDrill(segment, down, { unit: { letter: 'All', state: 'joined', stepDownName: 'C–D' } });
  expect(drill.projection.head).toMatchObject({ text: 'C–D first · then All', label: 'C–D first, then All' });
  expect(drill.stepId).toBe(check.key);
 });
 it('names a timing recovery by its slower tempo', async () => {
  render(<LearnCoach {...props} skipping={{ default: 'open' }} />);
  act(() => h.lab.onPickStep({ id: keyOf('mastery') }));
  expect(h.lab.coachingTask).toMatchObject({ mode: 'cued', tempoPercent: 100 });
  // A Gold step draws the Gold lap's steps.
  expect(h.lab.drill.projection.head.text).toBe('A · steps to Gold');
  const failed = { ...passed, criteria: { completeness: 1, cleanliness: 1, placement: .2 }, verdict: { passed: false } };
  await outcome(failed); await outcome({ ...failed, assessmentId: 'timing2' });
  expect(screen.getByRole('button', { name: 'Try a little slower · 75%' })).toBeInTheDocument();
  expect(screen.queryByText('slower-beat')).not.toBeInTheDocument();
  // The piano's onward line says it as a sentence: "play any key to try a little slower (75%)".
  expect(h.lab.resultContinueLabel).toBe('try a little slower (75%)');
 });
 it('a take that stalls in the last bar practises the way into it, then builds back a bar at a time', async () => {
  render(<LearnCoach {...props} />);
  const span = (missed) => ({ diagnostics: { expected_notes: 2, missed_notes: missed, wrong_notes: 0 } });
  const stalled = { ...passed, verdict: { passed: false }, criteria: { completeness: .9, cleanliness: 1 },
    spans: { 'measure:0': span(0), 'measure:1': span(0), 'measure:2': span(0), 'measure:3': span(2) } };
  await outcome({ ...stalled, assessmentId: 'stall1' }); await outcome({ ...stalled, assessmentId: 'stall2' });
  fireEvent.click(screen.getByRole('button', { name: 'Practice bars 3–4' }));
  expect(h.lab.segment.barLabel).toBe('Bars 3–4');
  await outcome({ ...passed, assessmentId: 'link1' }); await outcome({ ...passed, assessmentId: 'link2' });
  // The pass card names what follows: the next bar back, not the step the drill came from.
  expect(h.lab.card.copy.line).toBe('Next: Bars 2–4');
  expect(h.lab.coachingTask).toMatchObject({ reason: 'back-chain', range: { start: 1, end: 3 } });
  expect(h.lab.segment.barLabel).toBe('Bars 2–4');
 });
 it('keeps the same step after a shifted entry, names it on the card, and logs the shift', async () => {
  h.log.info.mockClear();
  render(<LearnCoach {...props} skipping={{ default: 'open' }} />);
  act(() => h.lab.onPickStep({ id: keyOf('mastery') }));
  const late = { ...passed, criteria: { completeness: 0.25, cleanliness: 0.25, placement: 0 }, verdict: { passed: false }, entryShift: { beats: 1, matched: 4, possible: 4 } };
  await outcome(late); await outcome({ ...late, assessmentId: 'late2' });
  // No smaller task: the passage was played, the start missed the count.
  expect(screen.queryByRole('button', { name: /slower|Practice/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(h.lab.resultLabel).toBe('Start on the click');
  expect(h.lab.resultContinueLabel).toBe('try again');
  expect(h.log.info).toHaveBeenLastCalledWith('piano.learn.coach.take', expect.objectContaining({ reason: 'entry-late', entryShiftBeats: 1, passed: false }));
 });
 it('logs each take with its tempo and the scores it was judged on', async () => {
  h.log.info.mockClear();
  render(<LearnCoach {...props} skipping={{ default: 'open' }} />);
  act(() => h.lab.onPickStep({ id: keyOf('timed-75') }));
  await act(async () => { h.lab.onStarted(); h.lab.onOutcome({ ...passed, criteria: { completeness: 1, cleanliness: 0.93333, placement: 0.71234 }, verdict: { passed: false } }, { placementShare: 0.6 }); });
  expect(h.log.info).toHaveBeenCalledWith('piano.learn.coach.take', expect.objectContaining({
   tempoPercent: 75, placement: 0.712, completeness: 1, cleanliness: 0.933, passed: false, placementShare: 0.6,
  }));
  // A take judged without the wider share says so: null, not absent.
  await outcome({ ...passed, assessmentId: 'strict', verdict: { passed: false }, criteria: { completeness: 1, cleanliness: 1, placement: 0.5 } });
  expect(h.log.info).toHaveBeenLastCalledWith('piano.learn.coach.take', expect.objectContaining({ placementShare: null }));
 });
 it('puts the passage path under the drill, and a token changes passage', () => {
  const two = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [
    { id: 'a', label: 'Segment 1', barLabel: 'Bars 1–4', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] },
    { id: 'b', label: 'Segment 2', barLabel: 'Bars 5–8', inMeasure: 4, outMeasure: 7, playableParts: ['rh', 'lh'] }] });
  const onPassageChange = vi.fn();
  render(<LearnCoach {...props} plan={two} segment={two.segments[0]} onPassageChange={onPassageChange} />);
  const rail = screen.getByRole('navigation', { name: 'Passages in this piece' });
  expect(rail.querySelectorAll('.piano-passage-path__token')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Learn A, bars 1–4' })).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'B, bars 5–8, Not started' }));
  expect(onPassageChange).toHaveBeenCalledWith('b');
  fireEvent.click(screen.getByRole('button', { name: /^All passages/ }));
  expect(screen.getByRole('dialog', { name: 'Passage board' })).toBeInTheDocument();
 });

 describe('skipping steps', () => {
  const steps = () => h.lab.drill.projection.steps;
  const named = (key) => steps().find((step) => step.display.key === key);
  const lockShown = (step) => render(<div>{step.display.icon}</div>).container.querySelector('.piano-learn-coach__lock') !== null;
  beforeEach(() => { h.log.info.mockClear(); });
  it('by default opens the note steps and the check, and draws no Gold steps as a row of locks', () => {
   render(<LearnCoach {...props} />);
   expect(steps().map((step) => `${step.display.key}:${Boolean(step.locked)}`)).toEqual(['Right hand:false', 'Left hand:false', 'Together:false', 'On your own:false']);
   expect(steps().some(lockShown)).toBe(false);
  });
  it('does nothing when a locked step is tapped', () => {
   render(<LearnCoach {...props} />);
   act(() => h.lab.onPickStep({ id: keyOf('mastery') }));
   expect(h.lab.coachingTask.skill).toBe('right');
   expect(h.log.info).not.toHaveBeenCalledWith('piano.learn.coach.skip', expect.anything());
  });
  it('starts an open step on a tap and logs the skip', () => {
   render(<LearnCoach {...props} />);
   act(() => h.lab.onPickStep({ id: named('Together').id }));
   expect(h.lab.coachingTask).toMatchObject({ skill: 'together', parts: ['rh', 'lh'] });
   expect(h.log.info).toHaveBeenCalledWith('piano.learn.coach.skip', { userId: 'guest', scoreId: 'score', passageId: 'a', from: 'right', to: 'together', mode: 'open-to-silver' });
  });
  it('strict leaves only the current step to start, and draws no locks', () => {
   render(<LearnCoach {...props} skipping={{ default: 'strict' }} />);
   expect(steps().map((step) => Boolean(step.locked))).toEqual([false, true, true, true]);
   expect(steps().some(lockShown)).toBe(false);
   act(() => h.lab.onPickStep({ id: named('Left hand').id }));
   expect(h.lab.coachingTask.skill).toBe('right');
  });
  it('does not resume a saved step the mode now locks', () => {
   const silver = plan.tasks.find((task) => task.skill === 'silver'); const mastery = plan.tasks.find((task) => task.skill === 'mastery');
   const done = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8 }, spans: {} };
   let state = applyCoachEvent(null, { id: 'check', type: 'outcome', task: silver, result: done }, { plan, now: '2026-11-19T18:00:00Z', dayKey: '2026-11-19' });
   state = applyCoachEvent(state, { id: 'pick', type: 'selection', task: mastery }, { plan, now: '2026-11-19T18:01:00Z', dayKey: '2026-11-19' });
   const coach = { profileId: 'learner4', loaded: true, projection: projectCoach({ plan, state, dayKey: '2026-11-19' }), state, saveStatus: 'saved', selectTask: vi.fn(), record: vi.fn() };
   expect(coach.projection.goldResume.skill).toBe('mastery');
   render(<LearnCoach {...props} coach={coach} skipping={{ default: 'strict' }} />);
   expect(h.lab.coachingTask.skill).toBe('rhythm');
  });
  it('a learner set to open may start score tempo first', () => {
   render(<LearnCoach {...props} skipping={{ default: 'strict', learners: { guest: 'open' } }} />);
   expect(steps().some((step) => step.locked)).toBe(false);
   act(() => h.lab.onPickStep({ id: keyOf('mastery') }));
   expect(h.lab.coachingTask).toMatchObject({ skill: 'mastery', tempoPercent: 100 });
   expect(h.log.info).toHaveBeenCalledWith('piano.learn.coach.skip', expect.objectContaining({ from: 'right', to: 'mastery', mode: 'open' }));
  });
 });
});
