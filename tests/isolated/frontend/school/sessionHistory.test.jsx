/**
 * Work-session history — the screen that has to make a fail and its retry read
 * as one piece of work.
 *
 * The index endpoint carries none of the detail, so this component fans out to
 * one event read per session. Both halves are tested: that the fan-out produces
 * a single threaded card, and that a session whose log will not load is called
 * out instead of appearing complete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import SessionHistory from '#frontend/modules/Admin/School/SessionHistory.jsx';

const rosterMock = vi.fn();
const learnerSessionsMock = vi.fn();
const sessionEventsMock = vi.fn();

vi.mock('#frontend/modules/Admin/School/schoolAdminApi.js', () => ({
  schoolAdminApi: {
    roster: (...a) => rosterMock(...a),
    learnerSessions: (...a) => learnerSessionsMock(...a),
    sessionEvents: (...a) => sessionEventsMock(...a),
  },
  default: {},
}));

const THIS_YEAR = new Date().getFullYear();
const PARENT = { id: 'dad', name: 'Papa', birthyear: THIS_YEAR - 42 };
const CHILD = { id: 'learner-1', name: 'Test Learner', birthyear: THIS_YEAR - 9 };

const FAILED = {
  sessionId: 'ses_1', learnerId: 'learner-1', unitId: 'math-fractions.03',
  state: 'remediation_opened', terminal: true, outcome: { result: 'needs_remediation' },
  day: '2026-07-20', updatedAt: '2026-07-20T12:00:00.000Z',
};
const RETRY = {
  sessionId: 'ses_2', learnerId: 'learner-1', unitId: 'math-fractions.03',
  state: 'outcome_recorded', terminal: true, outcome: { result: 'passed' },
  day: '2026-07-27', updatedAt: '2026-07-27T12:00:00.000Z',
};

const EVENTS = {
  ses_1: [
    { type: 'created', seq: 1, learnerId: 'learner-1', unitId: 'math-fractions.03' },
    { type: 'issued', seq: 2, artifactId: 'art_1' },
    { type: 'reprinted', seq: 3, artifactId: 'art_1' },
    { type: 'graded', seq: 4, attemptIds: ['a1'], percent: 40 },
    { type: 'outcome_recorded', seq: 5, outcomeId: 'o1', result: 'needs_remediation' },
    { type: 'remediation_opened', seq: 6, newSessionId: 'ses_2', variant: 1 },
  ],
  ses_2: [
    { type: 'created', seq: 1, remediationOf: 'ses_1', variant: 1 },
    { type: 'issued', seq: 2, artifactId: 'art_2' },
    { type: 'graded', seq: 3, attemptIds: ['a2'], percent: 95 },
    { type: 'outcome_recorded', seq: 4, outcomeId: 'o2', result: 'passed' },
  ],
};

const renderHistory = () => render(
  <MantineProvider>
    <SessionHistory />
  </MantineProvider>,
);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  rosterMock.mockReset().mockResolvedValue([PARENT, CHILD]);
  learnerSessionsMock.mockReset().mockResolvedValue({ sessions: [FAILED, RETRY] });
  sessionEventsMock.mockReset().mockImplementation(
    async (id) => ({ events: EVENTS[id] ?? [] }),
  );
});

describe('SessionHistory — lineage', () => {
  it('a failed session and its retry are ONE card, not two rows', async () => {
    renderHistory();

    await waitFor(() => expect(screen.getAllByTestId('session-thread')).toHaveLength(1));
    const thread = screen.getByTestId('session-thread');
    expect(within(thread).getByText('math-fractions.03')).toBeInTheDocument();
    expect(within(thread).getByText('2 attempts')).toBeInTheDocument();
    expect(within(thread).getByText('Attempt 1')).toBeInTheDocument();
    expect(within(thread).getByText('Attempt 2')).toBeInTheDocument();
  });

  it('the thread carries the LATEST outcome, so a passed retry reads as passed', async () => {
    renderHistory();
    const thread = await screen.findByTestId('session-thread');
    expect(within(thread).getByText('Passed')).toBeInTheDocument();
  });

  it('names the session a retry came from', async () => {
    renderHistory();
    const thread = await screen.findByTestId('session-thread');
    const link = within(thread).getByText(/Retry of/);
    expect(link).toHaveTextContent('Retry of ses_1');
    // ses_1 appears twice on purpose: as attempt 1's own id, and as the thing
    // attempt 2 is retrying. That second mention IS the lineage.
    expect(within(thread).getAllByText('ses_1')).toHaveLength(2);
  });

  it('shows what was issued and that a reprint reused the same sheet', async () => {
    renderHistory();
    const thread = await screen.findByTestId('session-thread');
    expect(within(thread).getByText(/art_1.*reprinted 1×, same sheet/)).toBeInTheDocument();
    expect(within(thread).getByText(/art_2/)).toBeInTheDocument();
  });

  it('shows attempts and the score for each go', async () => {
    renderHistory();
    const thread = await screen.findByTestId('session-thread');
    expect(within(thread).getByText('Score: 40%')).toBeInTheDocument();
    expect(within(thread).getByText('Score: 95%')).toBeInTheDocument();
  });

  it('reads the event log for every session in the index', async () => {
    renderHistory();
    await screen.findByTestId('session-thread');
    expect(sessionEventsMock).toHaveBeenCalledWith('ses_1');
    expect(sessionEventsMock).toHaveBeenCalledWith('ses_2');
  });

  it('defaults to the child on the roster, not the parent', async () => {
    renderHistory();
    await waitFor(() => expect(learnerSessionsMock).toHaveBeenCalledWith('learner-1'));
  });
});

describe('SessionHistory — nothing fails quietly', () => {
  it('an index that will not load is reported instead of showing no sessions', async () => {
    const err = new Error('unknown learner');
    err.status = 404;
    learnerSessionsMock.mockRejectedValue(err);
    renderHistory();

    expect(await screen.findByText(/Could not load this learner's sessions/)).toBeInTheDocument();
    expect(screen.getByText('unknown learner')).toBeInTheDocument();
    expect(screen.queryByText(/has not started anything yet/)).toBeNull();
  });

  it('one unreadable event log is called out, and its session still renders', async () => {
    sessionEventsMock.mockImplementation(async (id) => {
      if (id === 'ses_2') throw new Error('events file is corrupt');
      return { events: EVENTS[id] ?? [] };
    });
    renderHistory();

    expect(await screen.findByText('Some session logs would not load')).toBeInTheDocument();
    expect(screen.getByText(/events file is corrupt/)).toBeInTheDocument();
    // The session is still on screen — from its index row alone.
    expect(screen.getAllByTestId('session-thread').length).toBeGreaterThan(0);
  });

  it('renders an empty state for a learner who has not started anything', async () => {
    learnerSessionsMock.mockResolvedValue({ sessions: [] });
    renderHistory();

    expect(await screen.findByText(/has not started anything yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('session-thread')).toBeNull();
  });

  it('a roster that will not load is reported', async () => {
    rosterMock.mockRejectedValue(new Error('roster unavailable'));
    renderHistory();

    expect(await screen.findByText('Could not load the household roster')).toBeInTheDocument();
  });
});
