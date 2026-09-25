import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { RunTimeline } from './RunTimeline.jsx';
import { AuditorHeader } from './AuditorHeader.jsx';
import { AuditorPage } from './AuditorPage.jsx';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';
import { DismissStackProvider } from '../../../lib/ui';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

const run = {
  runId: 'run-a', at: '2026-09-25T15:42:00.000Z', completedAt: '2026-09-25T15:43:00.000Z', status: 'completed',
  trigger: ['captures', 'edits'], model: 'gpt-4.1-mini', costUsd: 0.0123, usage: { input: 1000, cached: 200, output: 50 },
  outcomes: [
    { status: 'applied', operationId: 'run-a_0', affectedIds: ['x'] },
    { status: 'applied', operationId: 'run-a_1', affectedIds: ['y'] },
    { status: 'rejected', reason: 'Unknown evidence' },
    { status: 'skipped', reason: 'Entry changed' },
    { status: 'blocked', kinds: ['portion'], proposal: {} },
    { status: 'unchanged', operationId: 'run-a_5', affectedIds: [] },
  ],
  questions: [{ question: 'Which fish?', choices: ['Cod'] }],
  suppressedQuestions: [{ question: 'Rice?', entryIds: ['r'], reason: 'questions-off' }],
  summary: 'Tidied lunch', dryRun: false, manual: false, overCap: false,
};
const failed = { ...run, runId: 'run-b', at: '2026-09-25T14:00:00.000Z', status: 'failed', costUsd: null, outcomes: [], questions: [], suppressedQuestions: [], trigger: ['dayRollover'] };
const backfilled = { runId: 'run-c', at: '2026-09-24T10:00:00.000Z', status: 'completed', trigger: ['unknown'], model: 'gpt-4o', costUsd: 0.2,
  backfilled: true, proposals: [{ reason: 'a' }, { reason: 'b' }, { reason: 'c' }], outcomes: [], toolCalls: [{ name: 'read_day', args: {} }] };
const capSkip = { at: '2026-09-25T13:00:00.000Z', skipped: 'cap', spentUsd: 1.2, capUsd: 1 };
const filteredSkip = { at: '2026-09-25T12:00:00.000Z', skipped: 'filtered', kinds: ['scaleReconcile'] };

const status = { version: 1, settings: { enabled: true, dryRun: false, telegram: false, model: 'gpt-4.1-mini', dailyCapUsd: 1, minGapMinutes: 15 },
  questions: [], runs: [{ id: 'run-a', status: 'completed', createdAt: run.at, completedAt: run.completedAt }], nextEligibleAt: null };
const spend = { days: [], today: 0.3, week: 1.5, month: 4.25, byTrigger: [], byModel: [], capUsd: 1, cappedToday: true, ledgerTodayUsd: 0.34 };

beforeEach(() => {
  resetApiResourceCache(); api.mockReset();
  api.mockImplementation(async path => {
    if (path.includes('/journal/')) return { ...run, transcript: null, transcriptExpired: true };
    if (path.includes('/journal')) {
      if (path.includes('changed=1')) return { rows: [run], total: 1 };
      if (path.includes('offset=50')) return { rows: [{ ...run, runId: 'run-z', at: '2026-09-20T10:00:00.000Z' }], total: 51 };
      return { rows: [run, failed, capSkip, filteredSkip, backfilled], total: 51 };
    }
    if (path.includes('/spend')) return spend;
    if (path.includes('/history')) return { records: [], total: 0 };
    return structuredClone(status);
  });
});
const mount = component => render(<MantineProvider><MemoryRouter><DismissStackProvider>{component}</DismissStackProvider></MemoryRouter></MantineProvider>);

describe('Auditor run timeline', () => {
  it('counts a run row\'s outcomes in plain words', async () => {
    mount(<RunTimeline onOpen={() => {}} />);
    expect(await screen.findByText('2 changed · 2 rejected · 1 blocked · 1 asked · 1 suppressed')).toBeTruthy();
    expect(screen.getAllByText('New food captured').length).toBeGreaterThan(0);
    expect(screen.getByText('$0.0123')).toBeTruthy();
    expect(screen.getByText('Failed · gpt-4.1-mini').className).toContain('health-auditor-run__failed');
    expect(screen.getByText('—')).toBeTruthy();
  });
  it('shows skip rows muted with the reason', async () => {
    mount(<RunTimeline onOpen={() => {}} />);
    expect(await screen.findByText(/Skipped: over daily cap \(\$1\.20 of \$1\.00\)/)).toBeTruthy();
    expect(screen.getByText(/Skipped: only switched-off triggers \(Scale readings updated\)/)).toBeTruthy();
  });
  it('tags backfilled rows and counts their proposals', async () => {
    mount(<RunTimeline onOpen={() => {}} />);
    expect(await screen.findByText('from transcript')).toBeTruthy();
    expect(screen.getByText('3 proposed')).toBeTruthy();
  });
  it('re-queries with changed=1 when "Changed something" is on', async () => {
    mount(<RunTimeline onOpen={() => {}} />);
    await screen.findByText('from transcript');
    fireEvent.click(screen.getByLabelText('Changed something'));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/journal?changed=1`));
    await waitFor(() => expect(screen.queryByText('from transcript')).toBeNull());
  });
  it('pages with offset and filters by minimum cost on the loaded rows', async () => {
    mount(<RunTimeline onOpen={() => {}} />);
    await screen.findByText('from transcript');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/journal?offset=50`));
    fireEvent.change(screen.getByLabelText('Min cost ($)'), { target: { value: '0.1' } });
    await waitFor(() => expect(screen.queryByText('$0.0123')).toBeNull());
    expect(screen.getByText('$0.2000')).toBeTruthy();
    expect(screen.queryByText(/Skipped:/)).toBeNull();
  });
  it('opens a run with its id and start time', async () => {
    const onOpen = vi.fn();
    mount(<RunTimeline onOpen={onOpen} />);
    await screen.findByText('from transcript');
    fireEvent.click(screen.getAllByRole('button', { name: /^Run at / })[0]);
    expect(onOpen).toHaveBeenCalledWith({ runId: 'run-a', at: run.at });
  });
});

describe('Auditor header', () => {
  it('shows state, model, next run and enforced spend against the cap', async () => {
    const resource = { data: status };
    mount(<AuditorHeader resource={resource} spend={{ data: spend }} />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('gpt-4.1-mini')).toBeTruthy();
    expect(screen.getByText('now')).toBeTruthy();
    expect(screen.getByText(/\$0\.34 of \$1\.00 today/)).toBeTruthy();
    expect(screen.getByText(/includes failed runs/)).toBeTruthy();
    expect(screen.getByText('Over cap')).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
  });
  it('reads preview-only, no cap, and a future next run', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const resource = { data: { ...status, settings: { ...status.settings, dryRun: true, dailyCapUsd: null }, nextEligibleAt: '2026-09-25T12:30:00Z' } };
    mount(<AuditorHeader resource={resource} spend={{ data: { ...spend, capUsd: null, cappedToday: false, ledgerTodayUsd: null } }} now={now} />);
    expect(screen.getByText('Preview only')).toBeTruthy();
    expect(screen.getAllByText('No daily cap').length).toBe(1);
    expect(screen.getByText('$0.30 today')).toBeTruthy();
    expect(screen.queryByText('now')).toBeNull();
    expect(screen.queryByText(/includes failed runs/)).toBeNull();
  });
});

describe('Auditor page', () => {
  it('renders header, timeline and the moved history cards', async () => {
    mount(<AuditorPage />);
    expect(await screen.findByText('Nutrition auditor')).toBeTruthy();
    expect(await screen.findByText('from transcript')).toBeTruthy();
    expect(screen.getByText('Repair history')).toBeTruthy();
    expect(screen.getByText('Cleanup runs')).toBeTruthy();
  });
  it('opens the run detail sheet from a timeline row', async () => {
    mount(<AuditorPage />);
    await screen.findByText('from transcript');
    fireEvent.click(screen.getAllByRole('button', { name: /^Run at / })[0]);
    expect(await screen.findByText('Transcript expired')).toBeTruthy();
    expect(api).toHaveBeenCalledWith(`${cleanupPath}/journal/run-a?at=${encodeURIComponent(run.at)}`);
  });
});
