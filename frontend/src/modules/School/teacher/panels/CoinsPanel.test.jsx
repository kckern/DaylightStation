/**
 * CoinsPanel — one learner's weekly earnings preview in the teacher console:
 * the week's work, what it earns under the household rules, and inline
 * per-learner rate edits (the teacher gate rides useTeacherWrite).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CoinsPanel from './CoinsPanel.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { earningsPreview: vi.fn(), putEarnRates: vi.fn() },
}));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher_1', name: 'teacher_1' },
    openPicker: vi.fn(),
    pickerOpen: false,
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
  }),
}));

import { schoolApi } from '../../schoolApi.js';

const ok = (data) => ({ ok: true, status: 200, data });

const preview = (over = {}) => ({
  learnerId: 'learner-a', learnerName: 'Learner A', currency: 'silver', rulesRevision: 3,
  windows: { school: { from: '2026-09-21', to: '2026-09-27' }, rings: { from: '2026-09-21T11:00:00.000Z', to: '2026-09-26T19:00:00.000Z' } },
  contestClosed: false,
  totals: { silver: 13, gems: 0 }, pending: { silver: 5, gems: 1 },
  evidence: { school: 'ok', rings: 'ok' },
  multiplier: 1,
  lines: [
    { ruleId: 'korean-daily', label: 'Korean (each day done)', kind: 'section-day', status: 'earned', count: 4, amount: { silver: 8, gems: 0 },
      priced: { revision: 3, reward: { silver: 2, gems: 0 }, multiplier: 1 }, overridden: false, note: null, evidence: [] },
    { ruleId: 'scripture-week', label: 'Scripture (whole week)', kind: 'section-week', status: 'none', count: 0, amount: { silver: 0, gems: 0 },
      priced: { revision: 3, reward: { silver: 5, gems: 0 }, multiplier: 1 }, overridden: false, note: 'Not done: 2026-09-22', evidence: [] },
    { ruleId: 'rings', label: 'Rings', kind: 'ring-threshold', status: 'earned', count: 540, amount: { silver: 5, gems: 0 },
      priced: { revision: 3, rate: { rings: 100, silver: 1 }, thresholds: [], multiplier: 1 }, overridden: false, note: '460 more to 1000', evidence: [] },
    { ruleId: 'ring-contest', label: 'Most rings this week', kind: 'ring-contest', status: 'pending', leader: true, count: 540, amount: { silver: 5, gems: 1 },
      priced: { revision: 3, reward: { silver: 5, gems: 1 }, multiplier: 1 }, overridden: false, note: 'Leading — decided Saturday noon', evidence: [] },
  ],
  work: {
    days: [{ day: '2026-09-21', state: 'met' }, { day: '2026-09-22', state: 'partial' }],
    sectionDays: [
      { day: '2026-09-21', subject: 'scripture', state: 'served' },
      { day: '2026-09-22', subject: 'scripture', state: 'obligated' },
    ],
    week: { weekId: '2026-09-21', state: 'exempt', open: true }, units: [], rings: 540,
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.earningsPreview.mockResolvedValue(ok(preview()));
  schoolApi.putEarnRates.mockResolvedValue(ok({ revision: 4 }));
});

describe('CoinsPanel', () => {
  it('headlines the silver earned, what is still pending, and says it is only a preview', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    expect(await screen.findByText('13')).toBeInTheDocument();
    expect(screen.getByText(/silver earned/i)).toBeInTheDocument();
    expect(screen.getByText(/\+5 silver and 1 gem pending/i)).toBeInTheDocument();
    expect(screen.getByText(/preview — nothing is paid yet/i)).toBeInTheDocument();
    expect(screen.getByText(/rules revision 3/i)).toBeInTheDocument();
    expect(schoolApi.earningsPreview).toHaveBeenCalledWith('learner-a', null);
  });

  it('draws the week\'s work: a day row and a row per subject, Monday to Sunday', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    const grid = await screen.findByRole('table', { name: /week's work/i });
    expect(within(grid).getByText('Mon 21')).toBeInTheDocument();
    expect(within(grid).getByText('Sun 27')).toBeInTheDocument();
    expect(within(grid).getByText('scripture')).toBeInTheDocument();
    expect(within(grid).getByLabelText('scripture Tue 22: not done')).toBeInTheDocument();
    expect(within(grid).getByText(/540 rings/)).toBeInTheDocument();
  });

  it('lists every rule with its status in words and why it did not pay', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    const lines = await screen.findByRole('table', { name: /what it earns/i });
    const scripture = within(lines).getByText('Scripture (whole week)').closest('tr');
    expect(within(scripture).getByText('Not this week')).toBeInTheDocument();
    expect(within(scripture).getByText('Not done: 2026-09-22')).toBeInTheDocument();
    const contest = within(lines).getByText('Most rings this week').closest('tr');
    expect(within(contest).getByText('Pending')).toBeInTheDocument();
    expect(within(contest).getByText(/leading/i)).toBeInTheDocument();
  });

  it('a rate edit writes this learner\'s override as the teacher, then re-reads', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    const input = await screen.findByLabelText('Silver for Korean (each day done)');
    expect(input).toHaveValue(2);
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate for Korean (each day done)' }));
    await waitFor(() => expect(schoolApi.putEarnRates).toHaveBeenCalledWith('learner-a', {
      actorId: 'teacher_1', pin: null, patch: { rules: { 'korean-daily': { reward: { silver: 3, gems: 0 } } } },
    }));
    await waitFor(() => expect(schoolApi.earningsPreview).toHaveBeenCalledTimes(2));
  });

  it('the ring rate edits the silver per N rings', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    const input = await screen.findByLabelText('Silver for Rings');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate for Rings' }));
    await waitFor(() => expect(schoolApi.putEarnRates).toHaveBeenCalledWith('learner-a', expect.objectContaining({
      patch: { rules: { rings: { rate: { rings: 100, silver: 2 } } } },
    })));
    expect(screen.getByText('per 100 rings')).toBeInTheDocument();
  });

  it('an overridden rule offers to go back to the household rate', async () => {
    const lines = preview().lines.map((l) => (l.ruleId === 'korean-daily' ? { ...l, overridden: true } : l));
    schoolApi.earningsPreview.mockResolvedValue(ok(preview({ lines })));
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use household rate for Korean (each day done)' }));
    await waitFor(() => expect(schoolApi.putEarnRates).toHaveBeenCalledWith('learner-a', expect.objectContaining({
      patch: { rules: { 'korean-daily': null } },
    })));
  });

  it('sets the learner\'s multiplier', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    const input = await screen.findByLabelText('Multiplier for Learner A');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save multiplier' }));
    await waitFor(() => expect(schoolApi.putEarnRates).toHaveBeenCalledWith('learner-a', expect.objectContaining({ patch: { multiplier: 2 } })));
  });

  it('steps back a week and asks for that week', async () => {
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(schoolApi.earningsPreview).toHaveBeenLastCalledWith('learner-a', '2026-09-14'));
  });

  it('says when evidence could not be read, instead of showing a zero as fact', async () => {
    schoolApi.earningsPreview.mockResolvedValue(ok(preview({ evidence: { school: 'unavailable', rings: 'ok' } })));
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    expect(await screen.findByText(/school records could not be read/i)).toBeInTheDocument();
  });

  it('a failed read shows the panel error with a retry', async () => {
    schoolApi.earningsPreview.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<CoinsPanel learnerId="learner-a" learnerName="Learner A" />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
