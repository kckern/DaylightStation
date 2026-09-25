import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { RunDetail } from './RunDetail.jsx';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';
import { DismissStackProvider } from '../../../lib/ui';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

const at = '2026-09-25T15:42:00.000Z';
const live = {
  runId: 'run-a', at, status: 'completed', trigger: ['captures', 'manual'], model: 'gpt-4.1-mini', costUsd: 0.0123,
  usage: { input: 12000, cached: 3000, output: 450 }, manual: true, overCap: true, dryRun: false, summary: 'Tidied lunch',
  outcomes: [
    { status: 'applied', operationId: 'run-a_0', affectedIds: ['fish'] },
    { status: 'applied', operationId: 'run-a_1', before: [{ id: 'rice', name: 'Rice', grams: 100 }], after: [{ id: 'rice', name: 'Rice', grams: 150 }] },
    { status: 'proposed', proposal: { updates: [{ id: 'soup', changes: { name: 'Miso soup' } }] } },
    { status: 'unchanged', operationId: 'run-a_3', affectedIds: [] },
    { status: 'rejected', reason: 'Unknown evidence' },
    { status: 'skipped', reason: 'Entry changed since the snapshot' },
    { status: 'blocked', kinds: ['portion', 'nutrients'], proposal: { updates: [{ id: 'bread', changes: { grams: 80 } }] } },
  ],
  questions: [{ question: 'Which fish?', choices: ['Cod', 'Haddock'] }],
  suppressedQuestions: [
    { question: 'Was that rice?', entryIds: ['rice'], reason: 'questions-off' },
    { question: 'Bread size?', entryIds: ['bread'], reason: 'blocked' },
    { question: 'Soup?', entryIds: ['soup'], reason: 'entries-missing' },
  ],
  transcript: { inputRows: 14, systemPromptChars: 9000, toolCalls: [
    { name: 'read_food_day', args: { date: '2026-09-25' }, result: { rows: 14 }, ok: true, latencyMs: 42 },
  ] },
  transcriptExpired: false,
};
const expired = { ...live, runId: 'run-b', transcript: null, transcriptExpired: true, toolCalls: [{ name: 'read_food_day', args: { date: '2026-09-20' } }] };
const backfilled = { runId: 'run-c', at, status: 'completed', trigger: ['unknown'], model: 'gpt-4o', costUsd: 0.2, usage: null,
  backfilled: true, outcomes: [], summary: 'Old run', transcript: null, transcriptExpired: true,
  proposals: [{ reason: 'Rename toast', updates: [{ id: 'toast', changes: { name: 'Rye toast' } }] }],
  toolCalls: [{ name: 'propose_repairs', args: { count: 1 } }] };

let rows;
beforeEach(() => {
  resetApiResourceCache(); api.mockReset();
  rows = { 'run-a': live, 'run-b': expired, 'run-c': backfilled };
  api.mockImplementation(async (path, body, method) => {
    if (method) return { status: 'undone' };
    const id = path.split('/journal/')[1].split('?')[0];
    return structuredClone(rows[id]);
  });
});
const mount = run => render(<MantineProvider><DismissStackProvider><RunDetail run={run} onClose={() => {}} /></DismissStackProvider></MantineProvider>);

describe('Auditor run detail', () => {
  it('fetches by run id and start time and explains why it ran', async () => {
    mount({ runId: 'run-a', at });
    await screen.findByText('Tidied lunch');
    expect(api).toHaveBeenCalledWith(`${cleanupPath}/journal/run-a?at=${encodeURIComponent(at)}`);
    expect(screen.getByText('New food captured')).toBeTruthy();
    expect(screen.getByText('Run manually')).toBeTruthy();
    expect(screen.getByText('Started by hand · ran over the daily cap')).toBeTruthy();
    expect(screen.getByText(/Model: gpt-4\.1-mini/)).toBeTruthy();
  });
  it('shows what it looked at from the transcript', async () => {
    mount({ runId: 'run-a', at });
    expect(await screen.findByText('14 food entries in scope')).toBeTruthy();
    expect(screen.getByText('read_food_day')).toBeTruthy();
    expect(screen.getByText(/ok · 42 ms/)).toBeTruthy();
    expect(screen.getByText(/"rows": 14/)).toBeTruthy();
  });
  it('lists questions asked and not asked, in words', async () => {
    mount({ runId: 'run-a', at });
    expect(await screen.findByText('Asked: Which fish?')).toBeTruthy();
    expect(screen.getByText('Choices: Cod / Haddock')).toBeTruthy();
    expect(screen.getByText('Questions are switched off')).toBeTruthy();
    expect(screen.getByText("Every answer needed a change it isn't allowed to make")).toBeTruthy();
    expect(screen.getByText('The food it asked about changed')).toBeTruthy();
  });
  it('shows each outcome type', async () => {
    mount({ runId: 'run-a', at });
    expect(await screen.findByText(/Changed 1 food entry/)).toBeTruthy();
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.getByText('soup: name: Miso soup')).toBeTruthy();
    expect(screen.getByText('1 repair had nothing left to change.')).toBeTruthy();
    expect(screen.getByText('Rejected: Unknown evidence')).toBeTruthy();
    expect(screen.getByText('Skipped: Entry changed since the snapshot')).toBeTruthy();
    expect(screen.getByText('Blocked: not allowed to change Portions, Nutrient values')).toBeTruthy();
    expect(screen.getByText('bread: grams: 80')).toBeTruthy();
    expect(screen.getByText('Input 12,000 · cached 3,000 · output 450 tokens')).toBeTruthy();
    expect(screen.getByText('$0.0123')).toBeTruthy();
  });
  it('undoes an applied change by its repair id', async () => {
    mount({ runId: 'run-a', at });
    await screen.findByText('Tidied lunch');
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo this change' })[0]);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/undo/run-a_0`, { operationId: expect.any(String) }, 'POST'));
    expect(await screen.findByText('Undone')).toBeTruthy();
  });
  it('reports an undo failure and keeps the button', async () => {
    api.mockImplementation(async (path, body, method) => {
      if (method) throw new Error('A later edit conflicts');
      return structuredClone(live);
    });
    mount({ runId: 'run-a', at });
    await screen.findByText('Tidied lunch');
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo this change' })[0]);
    expect(await screen.findByText('A later edit conflicts')).toBeTruthy();
  });
  it('says the transcript expired and falls back to the journal digest', async () => {
    mount({ runId: 'run-b', at });
    expect(await screen.findByText('Transcript expired')).toBeTruthy();
    expect(screen.getByText('Tool calls recorded in the journal:')).toBeTruthy();
    expect(screen.getByText(/"date": "2026-09-20"/)).toBeTruthy();
  });
  it('shows a backfilled run\'s proposals and tool digest', async () => {
    mount({ runId: 'run-c', at });
    expect(await screen.findByText('Proposed (from transcript): Rename toast')).toBeTruthy();
    expect(screen.getByText('toast: name: Rye toast')).toBeTruthy();
    expect(screen.getByText('propose_repairs')).toBeTruthy();
    expect(screen.getByText('Before tracking began')).toBeTruthy();
    expect(screen.queryByText('Nothing changed.')).toBeNull();
  });
  it('says so when the transcript could not be read', async () => {
    rows['run-a'] = { ...live, transcript: null, transcriptExpired: false, transcriptError: true };
    mount({ runId: 'run-a', at });
    expect(await screen.findByText('Transcript unavailable')).toBeTruthy();
  });
});
