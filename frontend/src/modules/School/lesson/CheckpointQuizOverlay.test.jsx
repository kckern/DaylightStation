/**
 * The overlay a child actually answers, tested at the seams that decide
 * whether the gate is a gate:
 *
 *   1. every input arrives on the ActionBus, so a REMOTE and a GAMEPAD are the
 *      same test — neither adapter is stood in for, and no handler is called
 *      directly (the point of the focus ring is that it is device-agnostic);
 *   2. ESCAPE AT A LIVE QUESTION DOES NOTHING — the overlay owns no exit of its
 *      own, and a mutation that gives it one has to fail here;
 *   3. a wrong answer RE-ASKS — the same item, reshuffled, answerable again
 *      (the existing item components latch `submittedRef` on the first tap, so
 *      "answerable again" is a remount, not a wish);
 *   4. "watch it again" is always reachable, keeps the LAST position, and is
 *      never the first thing focused on a fresh question;
 *   5. nothing here opens the gate: only a reply carrying `checkpointCleared`
 *      switches to the ✓, and the parent owns the unmount after it.
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

import { getActionBus, resetActionBus } from '../../../screen-framework/input/ActionBus.js';
import CheckpointQuizOverlay from './CheckpointQuizOverlay.jsx';

const MC = {
  id: 'q4',
  type: 'multiple_choice',
  prompt: 'Which planet has the rings?',
  choices: ['Mars', 'Saturn', 'Venus', 'Mercury'],
};
const MC2 = {
  id: 'q5',
  type: 'multiple_choice',
  prompt: 'How many moons does it have?',
  choices: ['One', 'Lots'],
};
const SHORT = { id: 'q7', type: 'short_answer', prompt: 'Name one planet.' };

const checkpointOf = (...items) => ({ id: 'cp-312', at: 312, items });

const emit = async (action, payload = {}) => {
  await act(async () => { getActionBus().emit(action, payload); });
};
const navigate = (direction) => emit('navigate', { direction });
const select = () => emit('select', {});
const escape = () => emit('escape', {});

/** The ring, in DOM order — what the focus model actually walks. */
const ring = () => [
  ...document.querySelectorAll('.school-item__choice, .school-item__check, [data-testid="checkpoint-rewind"]'),
];
const focused = () => document.activeElement;
const choiceLabels = () => [...document.querySelectorAll('.school-item__choice')]
  .map((b) => b.textContent.replace(/ — .*$/, '').trim());

function setup(overrides = {}) {
  const props = {
    checkpoint: checkpointOf(MC),
    onAnswer: vi.fn(async () => ({ ok: true, status: 200, correct: true, checkpointCleared: true })),
    onRewind: vi.fn(),
    onEscape: vi.fn(() => false),
    notice: null,
    ...overrides,
  };
  const view = render(<CheckpointQuizOverlay {...props} />);
  return { ...view, props };
}

describe('CheckpointQuizOverlay', () => {
  beforeEach(() => { resetActionBus(); });
  afterEach(() => { resetActionBus(); vi.restoreAllMocks(); });

  it('renders the due checkpoint question through the existing item component', () => {
    setup();
    expect(screen.getByText('Which planet has the rings?')).toBeInTheDocument();
    expect(document.querySelectorAll('.school-item--mc').length).toBe(1);
    expect(choiceLabels().sort()).toEqual(['Mars', 'Mercury', 'Saturn', 'Venus']);
  });

  it('lands the initial focus on an ANSWER, never on "watch it again"', () => {
    setup();
    const nodes = ring();
    expect(nodes.length).toBe(5);                       // 4 choices + rewind
    expect(focused()).toBe(nodes[0]);
    expect(nodes[0].className).toContain('school-item__choice');
    expect(focused()).not.toBe(screen.getByTestId('checkpoint-rewind'));
  });

  it('moves the ring with `navigate` and answers with two `select`s', async () => {
    const { props } = setup();
    await navigate('down');
    const second = ring()[1];
    expect(focused()).toBe(second);

    await select();                                     // arms, does not answer
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(second).toHaveAttribute('aria-pressed', 'true');

    await select();                                     // confirms
    await waitFor(() => expect(props.onAnswer).toHaveBeenCalledTimes(1));
    expect(props.onAnswer).toHaveBeenCalledWith('cp-312', 'q4', second.textContent.replace(/ — .*$/, '').trim());
  });

  it('wraps the ring, and `up`/`left` and `down`/`right` both move it', async () => {
    setup();
    const nodes = ring();
    await navigate('up');
    expect(focused()).toBe(nodes[nodes.length - 1]);     // wrapped onto rewind
    await navigate('right');
    expect(focused()).toBe(nodes[0]);
    await navigate('left');
    expect(focused()).toBe(nodes[nodes.length - 1]);
  });

  it('appends "watch it again" as the LAST ring member and takes it on ONE select', async () => {
    const { props } = setup();
    const rewind = screen.getByTestId('checkpoint-rewind');
    expect(ring()[ring().length - 1]).toBe(rewind);

    await navigate('up');                               // wrap straight onto it
    expect(focused()).toBe(rewind);
    await select();
    expect(props.onRewind).toHaveBeenCalledTimes(1);
    expect(props.onAnswer).not.toHaveBeenCalled();
  });

  it('re-asks a wrong answer: reshuffled, no answer leaked, and answerable again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onAnswer = vi.fn(async () => ({ ok: true, status: 200, correct: false, checkpointCleared: false }));
    const { props } = setup({ onAnswer });
    const before = choiceLabels();

    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));

    // Still the same question, still asking — no verdict, no expected answer.
    expect(screen.getByText('Which planet has the rings?')).toBeInTheDocument();
    expect(screen.queryByTestId('mc-verdict')).toBeNull();
    expect(screen.queryByTestId('checkpoint-cleared')).toBeNull();
    expect(choiceLabels()).not.toEqual(before);
    expect(choiceLabels().slice().sort()).toEqual(before.slice().sort());

    // The ring is back at the top, and the item is genuinely answerable again
    // (a stale `submittedRef` would swallow this silently).
    expect(focused()).toBe(ring()[0]);
    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
    expect(props.onRewind).not.toHaveBeenCalled();
  });

  it('nudges the ring onto "watch it again" after a SECOND wrong answer', async () => {
    const onAnswer = vi.fn(async () => ({ ok: true, status: 200, correct: false, checkpointCleared: false }));
    setup({ onAnswer });

    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(focused()).toBe(ring()[0]);                  // first miss: back to the answers

    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
    expect(focused()).toBe(screen.getByTestId('checkpoint-rewind'));
  });

  it('keeps "watch it again" in the last position across a reshuffle', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onAnswer = vi.fn(async () => ({ ok: true, status: 200, correct: false, checkpointCleared: false }));
    setup({ onAnswer });
    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    const nodes = ring();
    expect(nodes[nodes.length - 1]).toBe(screen.getByTestId('checkpoint-rewind'));
    expect(nodes.length).toBe(5);
  });

  it('shows the ✓ on a cleared checkpoint and stops taking input — the parent unmounts', async () => {
    const { props } = setup();
    await select(); await select();
    await waitFor(() => expect(screen.getByTestId('checkpoint-cleared')).toBeInTheDocument());
    expect(screen.queryByText('Which planet has the rings?')).toBeNull();

    await select(); await navigate('down'); await escape();
    expect(props.onAnswer).toHaveBeenCalledTimes(1);
    expect(props.onRewind).not.toHaveBeenCalled();
    expect(props.onEscape).not.toHaveBeenCalled();
  });

  it('advances to the next item when one is right but the checkpoint is not clear', async () => {
    const onAnswer = vi.fn(async () => ({ ok: true, status: 200, correct: true, checkpointCleared: false }));
    setup({ checkpoint: checkpointOf(MC, MC2), onAnswer });
    await select(); await select();
    await waitFor(() => expect(screen.getByText('How many moons does it have?')).toBeInTheDocument());
    expect(screen.queryByTestId('checkpoint-cleared')).toBeNull();
    expect(focused()).toBe(ring()[0]);
    expect(screen.getByTestId('checkpoint-progress')).toHaveTextContent('2');
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('escape at a LIVE QUESTION exits nothing, answers nothing and rewinds nothing', async () => {
    const { props } = setup();
    await escape();
    await escape();

    expect(screen.getByText('Which planet has the rings?')).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument();
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(props.onRewind).not.toHaveBeenCalled();
    // It reaches the session hook (the single authority) and is refused there.
    expect(props.onEscape).toHaveBeenCalled();
    expect(props.onEscape.mock.results.every((r) => r.value === false)).toBe(true);
    // And the child is told why, rather than pressing back into silence.
    expect(screen.getByTestId('checkpoint-escape-blocked')).toBeInTheDocument();
  });

  it('escape at a NOTICE is handed straight to the session hook', async () => {
    const onEscape = vi.fn(() => true);
    const { props } = setup({
      notice: { tone: 'error', title: "That didn't send", detail: 'Try the answer again.' },
      onEscape,
    });
    expect(screen.getByTestId('checkpoint-notice')).toHaveTextContent("That didn't send");
    await escape();
    expect(props.onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('checkpoint-escape-blocked')).toBeNull();
  });

  it('a failed answer POST leaves the question up, unshuffled, and answerable again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onAnswer = vi.fn(async () => ({ ok: false, status: 500, correct: null, checkpointCleared: false }));
    setup({ onAnswer });
    const before = choiceLabels();

    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    // A transport failure is not the child's wrong answer: nothing moves under
    // "try that again", and it does not count toward the rewind nudge.
    expect(choiceLabels()).toEqual(before);
    expect(screen.queryByTestId('checkpoint-cleared')).toBeNull();

    await select(); await select();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
    expect(focused()).toBe(ring()[0]);
  });

  // DISCLOSURE: this invariant currently has TWO enforcers — the overlay's own
  // `inFlightRef` and `MultipleChoiceItem`'s `submittedRef` — and mutation
  // testing showed the item's latch alone satisfies it, so removing the
  // overlay's guard does not fail this test (M14/M14b, both equivalent
  // mutants). The guard is kept as defence for a future item component that
  // does not latch; this test pins the BEHAVIOUR, not that particular guard.
  it('spends one attempt per confirm, even when select repeats before the reply lands', async () => {
    let release;
    const onAnswer = vi.fn(() => new Promise((r) => { release = () => r({ ok: true, status: 200, correct: false, checkpointCleared: false }); }));
    setup({ onAnswer });
    await select(); await select();
    await select(); await select();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  // ── the item types with nothing a d-pad can answer ──────────────────────
  it('focuses "watch it again" for an item a d-pad cannot answer', () => {
    setup({ checkpoint: checkpointOf(SHORT) });
    expect(screen.getByText('Name one planet.')).toBeInTheDocument();
    expect(focused()).toBe(screen.getByTestId('checkpoint-rewind'));
    // The Check button is still in the ring, so a real keyboard still works.
    expect(ring().length).toBe(2);
  });

  it('never shows a blank gate: a checkpoint with no renderable question says so', () => {
    setup({ checkpoint: { id: 'cp-312', at: 312, items: ['q4'] } });   // bare ids, no bodies
    expect(screen.getByTestId('checkpoint-fault')).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-rewind')).toBeInTheDocument();
    expect(focused()).toBe(screen.getByTestId('checkpoint-rewind'));
  });

  it('renders nothing at all without a checkpoint', () => {
    const { container } = render(<CheckpointQuizOverlay checkpoint={null} onAnswer={vi.fn()} onRewind={vi.fn()} onEscape={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
