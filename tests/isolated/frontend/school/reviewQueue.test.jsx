/**
 * The parent review queue — the screen the paper loop was waiting for.
 *
 * These tests hold the four properties the subsystem's credibility rests on:
 * the queue shows real pending work, a sign-off reaches the right endpoint with
 * the right verdict AND the adult's roster id, a child cannot sign off at all,
 * and every failure is visible rather than swallowed.
 *
 * The API client is mocked at the module boundary rather than `fetch`, so what
 * is asserted is the CONTRACT the component calls with — which is the thing that
 * must not drift.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ReviewQueue from '#frontend/modules/Admin/School/ReviewQueue.jsx';

const rosterMock = vi.fn();
const pendingReviewMock = vi.fn();
const resolveReviewMock = vi.fn();
const curriculumUnitsMock = vi.fn();

vi.mock('#frontend/modules/Admin/School/schoolAdminApi.js', () => ({
  schoolAdminApi: {
    roster: (...a) => rosterMock(...a),
    pendingReview: (...a) => pendingReviewMock(...a),
    resolveReview: (...a) => resolveReviewMock(...a),
    curriculumUnits: (...a) => curriculumUnitsMock(...a),
    teachers: async () => ({ configured: false, teachers: [] }),
  },
  default: {},
}));

const THIS_YEAR = new Date().getFullYear();
const PARENT = { id: 'dad', name: 'Papa', birthyear: THIS_YEAR - 42 };
const CHILD = { id: 'learner-1', name: 'Test Learner', birthyear: THIS_YEAR - 9 };
const NO_BIRTHYEAR = { id: 'aunty', name: 'Aunty', birthyear: null };

const item = (over = {}) => ({
  sessionId: 'ses_a',
  itemId: 'q3',
  learnerId: 'learner-1',
  unitId: 'math-fractions.03',
  reason: 'free_response',
  given: 'Because you flip the second fraction over',
  prompt: 'Why do you turn the second fraction upside down when dividing?',
  questionNumber: 3,
  rubric: 'Mark each working shown, not only the final number.',
  enqueuedAt: '2026-07-27T10:00:00.000Z',
  verdict: null,
  gradedBy: null,
  gradedAt: null,
  ...over,
});

const renderQueue = () => render(
  <MantineProvider>
    <ReviewQueue />
  </MantineProvider>,
);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  rosterMock.mockReset().mockResolvedValue([PARENT, CHILD]);
  pendingReviewMock.mockReset().mockResolvedValue({ items: [item()] });
  resolveReviewMock.mockReset().mockResolvedValue({ ...item(), verdict: 'correct', gradedBy: 'dad' });
  curriculumUnitsMock.mockReset().mockResolvedValue({
    units: [{
      unitId: 'math-fractions.03',
      title: 'Dividing Fractions',
      objectives: ['divide a fraction by a fraction', 'explain why you invert'],
    }],
  });
});

describe('ReviewQueue — showing the work', () => {
  it('renders each pending item with the learner, the unit, and what the child put down', async () => {
    renderQueue();

    expect(await screen.findByText('Test Learner')).toBeInTheDocument();
    // The unit reads as its title once the catalog is in; its id is the fallback.
    expect(await screen.findByText('Dividing Fractions')).toBeInTheDocument();
    expect(screen.getByText('q3')).toBeInTheDocument();
    expect(screen.getByText('Because you flip the second fraction over')).toBeInTheDocument();
    expect(screen.getByText('Written answer')).toBeInTheDocument();
  });

  it('shows WHAT WAS ASKED and HOW TO MARK IT as two different things', async () => {
    renderQueue();

    // The question, under its own heading and with the number printed on the sheet.
    expect(await screen.findByText(/Why do you turn the second fraction upside down/)).toBeInTheDocument();
    expect(screen.getByText(/What was asked/i)).toBeInTheDocument();
    expect(screen.getByText(/Question 3/)).toBeInTheDocument();
    // The unit's rubric, which is the same on every item of the sheet.
    expect(screen.getByText(/Mark each working shown/)).toBeInTheDocument();
    expect(screen.getByText(/How this unit says to mark it/i)).toBeInTheDocument();
  });

  it('two questions off the same sheet read differently', async () => {
    pendingReviewMock.mockResolvedValue({
      items: [
        item({ itemId: 'q3', prompt: 'What is 1/2 + 1/3?', questionNumber: 3 }),
        item({ itemId: 'q4', prompt: 'What is 3/4 - 1/3?', questionNumber: 4 }),
      ],
    });
    renderQueue();

    expect(await screen.findByText('What is 1/2 + 1/3?')).toBeInTheDocument();
    expect(screen.getByText('What is 3/4 - 1/3?')).toBeInTheDocument();
  });

  it('says the question text is missing rather than showing the rubric in its place', async () => {
    pendingReviewMock.mockResolvedValue({ items: [item({ prompt: null, questionNumber: null })] });
    renderQueue();

    expect(await screen.findByText(/We do not have the wording of this question/i)).toBeInTheDocument();
    // The rubric is still there, still labelled as the rubric.
    expect(screen.getByText(/How this unit says to mark it/i)).toBeInTheDocument();
  });

  it('says so in words when the child wrote nothing, rather than showing an empty box', async () => {
    pendingReviewMock.mockResolvedValue({ items: [item({ given: null, reason: 'blank' })] });
    renderQueue();

    expect(await screen.findByText(/Nothing was written/i)).toBeInTheDocument();
    expect(screen.getByText('Left blank')).toBeInTheDocument();
  });

  it('shows the machine marks a reader produced, not just plain text answers', async () => {
    pendingReviewMock.mockResolvedValue({
      items: [item({ reason: 'ambiguous', given: { row: 4, marks: ['B', 'C'] } })],
    });
    renderQueue();

    expect(await screen.findByText('Unreadable marks')).toBeInTheDocument();
    expect(screen.getByText(/"marks"/)).toBeInTheDocument();
  });

  it('orders the queue newest first', async () => {
    pendingReviewMock.mockResolvedValue({
      items: [
        item({ itemId: 'old', enqueuedAt: '2026-07-01T10:00:00.000Z' }),
        item({ itemId: 'new', enqueuedAt: '2026-07-27T10:00:00.000Z' }),
      ],
    });
    renderQueue();

    await screen.findByText('new');
    const cards = screen.getAllByTestId('review-item');
    expect(within(cards[0]).getByText('new')).toBeInTheDocument();
    expect(within(cards[1]).getByText('old')).toBeInTheDocument();
  });

  it('renders an empty state, not a blank screen, when nothing is waiting', async () => {
    pendingReviewMock.mockResolvedValue({ items: [] });
    renderQueue();

    expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument();
    expect(screen.queryByTestId('review-item')).toBeNull();
  });
});

describe('ReviewQueue — naming the unit', () => {
  it('shows the unit\'s TITLE and what it is teaching, not just an id', async () => {
    renderQueue();

    expect(await screen.findByText('Dividing Fractions')).toBeInTheDocument();
    expect(screen.getByText(/divide a fraction by a fraction/)).toBeInTheDocument();
  });

  it('falls back to the id, and still grades, when the catalog will not load', async () => {
    curriculumUnitsMock.mockRejectedValue(new Error('catalog unavailable'));
    renderQueue();

    expect(await screen.findByText('math-fractions.03')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Sign off as Papa/i })).toBeInTheDocument();
  });
});

describe('ReviewQueue — signing off', () => {
  it('posts the chosen verdict with the adult roster id as gradedBy', async () => {
    renderQueue();
    await screen.findByRole('button', { name: /Sign off as Papa/i });

    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByRole('button', { name: /Sign off as Papa/i }));

    await waitFor(() => expect(resolveReviewMock).toHaveBeenCalledWith(
      'ses_a', 'q3', { verdict: 'correct', gradedBy: 'dad', note: null, pin: null },
    ));
  });

  it('posts "incorrect" when that is what the parent chose', async () => {
    resolveReviewMock.mockResolvedValue({ ...item(), verdict: 'incorrect', gradedBy: 'dad' });
    renderQueue();
    await screen.findByRole('button', { name: /Sign off as Papa/i });

    fireEvent.click(screen.getByText('Incorrect'));
    fireEvent.click(screen.getByRole('button', { name: /Sign off as Papa/i }));

    await waitFor(() => expect(resolveReviewMock).toHaveBeenCalledWith(
      'ses_a', 'q3', { verdict: 'incorrect', gradedBy: 'dad', note: null, pin: null },
    ));
  });

  it('sends the parent\'s note with the verdict — the reason is the valuable part', async () => {
    renderQueue();
    await screen.findByRole('button', { name: /Sign off as Papa/i });

    fireEvent.click(screen.getByText('Incorrect'));
    fireEvent.change(screen.getByLabelText(/note for/i), {
      target: { value: 'Right method — you forgot to simplify at the end.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign off as Papa/i }));

    await waitFor(() => expect(resolveReviewMock).toHaveBeenCalledWith(
      'ses_a', 'q3', {
        verdict: 'incorrect', gradedBy: 'dad',
        note: 'Right method — you forgot to simplify at the end.',
        pin: null,
      },
    ));
  });

  it('shows a note already written on an item rather than hiding it', async () => {
    pendingReviewMock.mockResolvedValue({ items: [item({ note: 'We talked about this one.' })] });
    renderQueue();

    expect(await screen.findByDisplayValue('We talked about this one.')).toBeInTheDocument();
  });

  it('will not sign off before a verdict is chosen', async () => {
    renderQueue();

    expect(await screen.findByRole('button', { name: /Sign off as Papa/i })).toBeDisabled();
    expect(resolveReviewMock).not.toHaveBeenCalled();
  });

  it('re-reads the queue from the server after a sign-off instead of guessing', async () => {
    renderQueue();
    await screen.findByRole('button', { name: /Sign off as Papa/i });
    expect(pendingReviewMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByRole('button', { name: /Sign off as Papa/i }));

    await waitFor(() => expect(pendingReviewMock).toHaveBeenCalledTimes(2));
  });
});

describe('ReviewQueue — adults only', () => {
  it('a child on the roster is never offered as the marker', async () => {
    rosterMock.mockResolvedValue([CHILD]);
    renderQueue();

    await screen.findByText('Test Learner');
    expect(screen.getByText('No teachers configured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign off/i })).toBeNull();
  });

  it('a remembered CHILD id cannot sign off — the choice is re-checked, not trusted', async () => {
    localStorage.setItem('daylight.school.admin.gradedBy', 'learner-1');
    renderQueue();

    await screen.findByText('Test Learner');
    // The queue renders, but the sign-off control does not exist for that id.
    expect(screen.queryByRole('button', { name: /Sign off/i })).toBeNull();
    expect(screen.getByText(/no longer a grown-up on this roster/i)).toBeInTheDocument();
    expect(resolveReviewMock).not.toHaveBeenCalled();
  });

  it('an unknown birthyear fails closed — it does not buy adult authority', async () => {
    rosterMock.mockResolvedValue([NO_BIRTHYEAR, CHILD]);
    renderQueue();

    await screen.findByText('Test Learner');
    expect(screen.getByText('No teachers configured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign off/i })).toBeNull();
  });

  it('the single adult in the house is selected for them, so grading is two clicks', async () => {
    renderQueue();
    expect(await screen.findByRole('button', { name: /Sign off as Papa/i })).toBeInTheDocument();
  });
});

describe('ReviewQueue — nothing fails quietly', () => {
  it('a queue that will not load says so instead of showing an empty queue', async () => {
    const err = new Error('school lifecycle is not wired');
    err.status = 404;
    pendingReviewMock.mockRejectedValue(err);
    renderQueue();

    expect(await screen.findByText('Could not load the review queue')).toBeInTheDocument();
    expect(screen.getByText('school lifecycle is not wired')).toBeInTheDocument();
    // Crucially NOT the empty state — "nothing waiting" would be a lie here.
    expect(screen.queryByText('Nothing is waiting for you.')).toBeNull();
  });

  it('a failed sign-off surfaces against the item and leaves it in the queue', async () => {
    const err = new Error('no review item q3 on session ses_a');
    err.status = 404;
    resolveReviewMock.mockRejectedValue(err);
    renderQueue();
    await screen.findByRole('button', { name: /Sign off as Papa/i });

    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByRole('button', { name: /Sign off as Papa/i }));

    const alert = await screen.findByTestId('review-item-error');
    expect(alert).toHaveTextContent(/did not save/i);
    expect(alert).toHaveTextContent('no review item q3 on session ses_a');
    expect(alert).toHaveTextContent(/still waiting/i);
    // The item is still on screen — a lost mark must not look like a done one.
    expect(screen.getAllByTestId('review-item')).toHaveLength(1);
  });

  it('a roster that will not load is reported and locks sign-off shut', async () => {
    rosterMock.mockRejectedValue(new Error('roster unavailable'));
    renderQueue();

    expect(await screen.findByText('Could not load the household roster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign off/i })).toBeNull();
  });
});
