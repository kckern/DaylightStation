/**
 * CoinsRosterPanel — Saturday morning: where every learner's week stands in
 * silver, side by side in roster order (never ranked), each row opening that
 * learner's Coins tab.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CoinsRosterPanel from './CoinsRosterPanel.jsx';

vi.mock('../../schoolApi.js', () => ({ schoolApi: { earningsRoster: vi.fn() } }));
import { schoolApi } from '../../schoolApi.js';

const learner = (learnerId, learnerName, silver, extra = {}) => ({
  learnerId, learnerName, totals: { silver, gems: 0 }, pending: { silver: 0, gems: 0 },
  evidence: { school: 'ok', rings: 'ok' },
  work: { days: [{ day: '2026-09-21', state: 'met' }, { day: '2026-09-22', state: 'partial' }], rings: 120 },
  lines: [], ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.earningsRoster.mockResolvedValue({ ok: true, status: 200, data: {
    windows: { school: { from: '2026-09-21', to: '2026-09-27' } }, contestClosed: false, rulesRevision: 2,
    learners: [
      learner('learner-b', 'Learner B', 4),
      learner('learner-a', 'Learner A', 30, { pending: { silver: 5, gems: 1 } }),
    ],
  } });
});

describe('CoinsRosterPanel', () => {
  it('lists every learner in roster order — never sorted by what they earned', async () => {
    render(<CoinsRosterPanel onSelectLearner={() => {}} />);
    const table = await screen.findByRole('table', { name: /everyone's week/i });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Learner B', 'Learner A']);
    expect(within(rows[1]).getByText('30')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/\+5 silver/)).toBeInTheDocument();
    expect(within(rows[0]).getByText('1 of 2')).toBeInTheDocument(); // green days
    expect(screen.getByText(/Week of Sep 21 – 27/)).toBeInTheDocument();
  });

  it('a row opens that learner\'s Coins tab', async () => {
    const onSelectLearner = vi.fn();
    render(<CoinsRosterPanel onSelectLearner={onSelectLearner} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Learner A’s coins' }));
    expect(onSelectLearner).toHaveBeenCalledWith('learner-a');
  });

  it('steps to the previous week', async () => {
    render(<CoinsRosterPanel onSelectLearner={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(schoolApi.earningsRoster).toHaveBeenLastCalledWith('2026-09-14'));
  });
});
