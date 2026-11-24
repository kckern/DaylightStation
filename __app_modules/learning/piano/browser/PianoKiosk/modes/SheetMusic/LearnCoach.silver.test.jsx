import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LearnCoach, { PASSAGE_CEREMONY_MS, PIECE_CEREMONY_MS } from './LearnCoach.jsx';
import { applyCoachEvent, createCoachPlan, projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';

const h = vi.hoisted(() => ({ lab: null, chime: null }));
h.chime = vi.fn(() => true);
vi.mock('./passageChime.js', () => ({ playPassageChime: (...args) => h.chime(...args) }));
vi.mock('../../../ui/icons/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'guest' }) }));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ connected: true }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => ({ config: { timezone: 'UTC' } }) }));
vi.mock('../Exercises/ScorePassage.jsx', () => ({ default: () => <div>Passage music</div> }));
vi.mock('./LearnLab.jsx', () => ({ default: (props) => { h.lab = props; return <div>Drill surface{props.ceremony}{props.extraControls}{props.resultLabel && <strong>{props.resultLabel}</strong>}{props.resultActions}</div>; } }));

const seg = (id, a, b) => ({ id, label: `Passage ${id}`, barLabel: `Bars ${a + 1}–${b + 1}`, inMeasure: a, outMeasure: b, playableParts: ['rh', 'lh'] });
const planOf = (segments) => createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments, tempoMap: [{ onsetQuarter: 0, bpm: 90 }], certification: { testOutFirst: false } });
const clean = (id) => ({ assessmentId: id, status: 'completed', diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 0, missed_notes: 0 }, criteria: { completeness: 1, cleanliness: 1 } });
const messy = (id) => ({ ...clean(id), diagnostics: { expected_notes: 8, matched_notes: 8, wrong_notes: 8, missed_notes: 0 }, criteria: { completeness: 1, cleanliness: 0.5 } });
const button = (name) => screen.getByRole('button', { name });
const mount = (segments = [seg('a', 0, 3), seg('b', 4, 7)], legacy = {}) => {
  const plan = planOf(segments); const onPassageChange = vi.fn(); const onBack = vi.fn();
  render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} legacy={legacy} segment={plan.segments[0]} onBack={onBack} onPassageChange={onPassageChange} />);
  return { onPassageChange, onBack };
};
// Tapping the "On your own" set is how a child goes straight to the Silver check.
const pickCheck = () => act(() => h.lab.onPickStep({ id: h.lab.drill.projection.steps.find((step) => step.display.key === 'On your own').id }));
const finish = (result) => act(async () => { h.lab.onStarted(); h.lab.onOutcome(result); });

describe('Silver in LearnCoach', () => {
  beforeEach(() => { h.lab = null; h.chime.mockClear(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());
  const ceremony = () => document.querySelector('.gate-ceremony');
  const fakeCoach = (plan, state, dayKey, extra = {}) => ({ profileId: 'guest', loaded: true, saveStatus: 'guest', state, projection: projectCoach({ plan, state, dayKey }),
    record: vi.fn(), selectTask: vi.fn(), setAside: vi.fn(() => new Promise(() => {})), retry: vi.fn(), recoveryData: vi.fn(), ...extra });
  const apply = (state, plan, task, result, dayKey = '2026-11-18') => applyCoachEvent(state, { id: result.assessmentId, type: 'outcome', task, result }, { plan, now: `${dayKey}T12:00:00Z`, dayKey });

  it('lets a set be chosen: the Silver check runs with hints off', () => {
    mount(); pickCheck();
    expect(h.lab.coachingTask).toMatchObject({ assist: 'none', skill: 'silver' });
    expect(h.lab.drill.stepId).toBe(h.lab.coachingTask.key);
  });

  it('closes the drill curtain on Silver: the flower turns into the coin, and it parts onto the next passage', async () => {
    vi.useFakeTimers();
    const { onPassageChange, onBack } = mount(); pickCheck();
    await finish(clean('one'));
    // It is the drill's ceremony, not a rep card.
    expect(h.lab.card).toBeNull();
    expect(ceremony()).toHaveAttribute('aria-label', 'Bars 1–4. Bronze! Next: bars 5–8.');
    expect(ceremony().querySelector('.gate-ceremony__word').textContent).toBe('Bronze!');
    const turn = ceremony().querySelector('.gate-ceremony__mark .piano-passage-turn');
    expect([...turn.children].map((icon) => icon.getAttribute('class') + (icon.dataset.metal ?? ''))).toEqual(['tomato-icon', 'coin-icon piano-passage-coin--bronzegold']);
    expect(ceremony().querySelector('.gate-ceremony__behind').textContent).toBe('NextBars 5–8');
    expect(ceremony().querySelector('.gate-ceremony__behind .tomato-icon')).not.toBeNull();
    // The finished take stays under the curtain; nothing new is mounted yet.
    expect(h.lab.coachingTask.skill).toBe('silver');
    // On the path, this passage's token (the selected one) turns into its bronze coin.
    const tile = screen.getByRole('navigation', { name: 'Passages in this piece' }).querySelector('.piano-passage-path__token[aria-current="step"]');
    expect(tile).toHaveAttribute('data-state', 'silver');
    expect(tile).toHaveAttribute('data-flip', 'silver');
    // The tile turns and the chime sounds when the verdict lands, not before.
    expect(parseInt(tile.style.getPropertyValue('--turn-delay'), 10)).toBeGreaterThan(1000);
    expect(h.chime).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1300));
    expect(h.chime).toHaveBeenCalledWith({ level: 'silver', piece: false });
    expect(onPassageChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PASSAGE_CEREMONY_MS));
    expect(onPassageChange).toHaveBeenCalledWith('b');
    expect(onBack).not.toHaveBeenCalled();
    expect(h.chime).toHaveBeenCalledTimes(1);
  });

  it('puts every passage on the curtain when the whole piece is played through, then returns to the score', async () => {
    vi.useFakeTimers();
    const plan = planOf([seg('a', 0, 3), seg('b', 4, 7), seg('c', 8, 11)]);
    // Every passage is Bronze and the first join is played; the take under test is the final join.
    let state = null; for (const id of ['a', 'b', 'c', 'join:a:b']) state = apply(state, plan, plan.tasks.find((t) => t.skill === 'silver' && t.passageId === id), clean(`s-${id}`));
    const onBack = vi.fn(); const onPassageChange = vi.fn(); let coach = fakeCoach(plan, state, '2026-11-18');
    coach.record = vi.fn((task, result) => { state = apply(state, plan, task, result); });
    const join = plan.segments.find((item) => item.id === 'join:a:c');
    const view = render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} title="Minuet" plan={plan} segment={join} coach={coach} onBack={onBack} onPassageChange={onPassageChange} />);
    pickCheck();
    await finish(clean('last'));
    coach = { ...coach, state, projection: projectCoach({ plan, state, dayKey: '2026-11-18' }) };
    view.rerender(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} title="Minuet" plan={plan} segment={join} coach={coach} onBack={onBack} onPassageChange={onPassageChange} />);
    expect(ceremony()).toHaveAttribute('aria-label', 'You played the whole piece!');
    expect(ceremony().querySelector('.gate-ceremony__word').textContent).toBe('Piece Silver!');
    const coins = ceremony().querySelectorAll('.piano-learn-coach__piece-mark .piano-passage-turn');
    expect(coins).toHaveLength(3);
    const delays = [...coins].map((coin) => parseInt(coin.parentElement.style.getPropertyValue('--turn-delay'), 10));
    expect(delays[0]).toBeLessThan(delays[1]); expect(delays[1]).toBeLessThan(delays[2]);
    expect(ceremony().querySelector('.gate-ceremony__behind').textContent).toBe('NextGo for Gold');
    act(() => vi.advanceTimersByTime(PASSAGE_CEREMONY_MS + 200));
    expect(h.chime).toHaveBeenCalledWith({ level: 'silver', piece: true });
    expect(onBack).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PIECE_CEREMONY_MS - PASSAGE_CEREMONY_MS));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onPassageChange).not.toHaveBeenCalled();
  });

  it('does not call a join Bronze: its ceremony says Silver and points at what is next', async () => {
    vi.useFakeTimers();
    const plan = planOf([seg('a', 0, 3), seg('b', 4, 7), seg('c', 8, 11)]);
    let state = null; for (const id of ['a', 'b', 'c']) state = apply(state, plan, plan.tasks.find((t) => t.skill === 'silver' && t.passageId === id), clean(`s-${id}`));
    const coach = fakeCoach(plan, state, '2026-11-18');
    coach.record = vi.fn((task, result) => { state = apply(state, plan, task, result); });
    const join = plan.segments.find((item) => item.id === 'join:a:b');
    const { rerender } = render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} title="Minuet" plan={plan} segment={join} coach={coach} onBack={vi.fn()} onPassageChange={vi.fn()} />);
    pickCheck();
    await finish(clean('join'));
    rerender(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} title="Minuet" plan={plan} segment={join} coach={{ ...coach, state, projection: projectCoach({ plan, state, dayKey: '2026-11-18' }) }} onBack={vi.fn()} onPassageChange={vi.fn()} />);
    expect(ceremony().querySelector('.gate-ceremony__word').textContent).toBe('Silver!');
    expect(ceremony().querySelector('.gate-ceremony__behind').textContent).toMatch(/^Next/);
  });

  it('opens a Silver passage on its next Gold step', () => {
    mount(undefined, { learn: { passages: { a: { rungs: { right: { passCount: 6 }, left: { passCount: 6 }, together: { passCount: 6 } } } } } });
    expect(h.lab.coachingTask.skill).toBe('silver');
  });

  it('opens an inherited complete passage for replay without a ceremony', () => {
    mount(undefined, { learn: { passages: { a: { complete: true } } } });
    expect(h.lab.card).toBeNull(); expect(ceremony()).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Passages in this piece' }).querySelector('.piano-passage-path__token[aria-current="step"]')).toHaveAttribute('data-state', 'gold');
    expect(h.lab.drill.projection.steps.every((step) => step.passed)).toBe(true);
  });

  it('offers a retry, then a drill and a way to come back later', async () => {
    const { onPassageChange } = mount(); pickCheck();
    await finish(messy('one'));
    expect(screen.getByText('Almost on your own')).toBeInTheDocument();
    expect(button('Try again').className).toContain('is-primary');
    expect(screen.queryByRole('button', { name: 'Come back to this later' })).toBeNull();
    fireEvent.click(button('Try again'));
    await finish(messy('two'));
    expect(screen.getByRole('button', { name: /Practice bars/ }).className).toContain('is-primary');
    fireEvent.click(button('Come back to this later'));
    await act(async () => {});
    expect(onPassageChange).toHaveBeenCalledWith('b');
  });

  it('does not announce Silver until the policy is met: the take is one rep of the set', async () => {
    const plan = createCoachPlan({ scoreId: 'score', fingerprint: 'fp', segments: [seg('a', 0, 3)], tempoMap: [], certification: { silver: { checkPasses: 2 } } });
    render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} segment={plan.segments[0]} onBack={vi.fn()} />);
    pickCheck();
    expect(h.lab.drill.projection.steps[3].requirement.required_passes).toBe(2);
    await finish(clean('one'));
    expect(h.lab.card.copy).toBeUndefined(); expect(ceremony()).toBeNull();
    expect(h.lab.card).toMatchObject({ setIndex: 4, repIndex: 1, repCount: 2, setClear: false, next: { key: 'On your own' } });
    expect(h.lab.coachingTask.skill).toBe('silver');
  });

  it('keeps the way out in the drill chrome when a passage is reopened after two misses', () => {
    const plan = planOf([seg('a', 0, 3), seg('b', 4, 7)]); const check = plan.tasks.find((t) => t.skill === 'silver');
    const state = apply(apply(undefined, plan, check, messy('m1')), plan, check, messy('m2'));
    const onPassageChange = vi.fn();
    render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} segment={plan.segments[0]} coach={fakeCoach(plan, state, '2026-11-18')} onBack={vi.fn()} onPassageChange={onPassageChange} />);
    fireEvent.click(button('Come back to this later'));
    expect(onPassageChange).toHaveBeenCalledWith('b');
  });

  it('turns Silver into a gold coin on the last Gold step', async () => {
    vi.useFakeTimers();
    const plan = planOf([seg('a', 0, 3), seg('b', 4, 7)]); const gold = plan.tasks.find((t) => t.skill === 'mastery' && t.passageId === 'a');
    const timed = (id) => ({ ...clean(id), criteria: { completeness: 1, cleanliness: 1, placement: 1 } });
    let state = null; for (const id of ['a', 'b']) state = apply(state, plan, plan.tasks.find((t) => t.skill === 'silver' && t.passageId === id), clean(`s-${id}`));
    state = apply(state, plan, gold, timed('g1'));
    const onPassageChange = vi.fn(); let coach = fakeCoach(plan, state, '2026-11-18');
    coach.record = vi.fn((task, result) => { state = apply(state, plan, task, result); });
    const view = render(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} segment={plan.segments[0]} coach={coach} onBack={vi.fn()} onPassageChange={onPassageChange} />);
    act(() => h.lab.onPickStep({ id: gold.key }));
    await finish(timed('g2'));
    coach = { ...coach, state, projection: projectCoach({ plan, state, dayKey: '2026-11-18' }) };
    view.rerender(<LearnCoach score={{ id: 'score', musicXml: '<x />' }} plan={plan} segment={plan.segments[0]} coach={coach} onBack={vi.fn()} onPassageChange={onPassageChange} />);
    expect(ceremony().querySelector('.gate-ceremony__word').textContent).toBe('Gold!');
    const turn = ceremony().querySelector('.gate-ceremony__mark .piano-passage-turn');
    expect([...turn.children].map((icon) => icon.getAttribute('class') + (icon.dataset.metal ?? ''))).toEqual(['coin-icon piano-passage-coin--bronzegold', 'coin-icongold']);
    expect(ceremony().querySelector('.gate-ceremony__behind').textContent).toBe('NextBars 5–8');
    act(() => vi.advanceTimersByTime(PASSAGE_CEREMONY_MS));
    expect(onPassageChange).toHaveBeenCalledWith('b');
  });
});
