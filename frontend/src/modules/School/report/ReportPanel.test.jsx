import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportPanel from './ReportPanel.jsx';

/**
 * The contract's value is that this view renders ANY program without knowing
 * what it does. So these tests deliberately use invented programs — if the
 * panel ever needs to know about quizzes or sentence ladders, they fail.
 */
const reportMock = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: { report: (...a) => reportMock(...a) } }));

const metric = (kind, extra) => ({ id: kind, kind, label: kind, ...extra });

const report = (over = {}) => ({
  program: 'invented',
  label: 'Underwater Basket Weaving',
  userId: 'kid1',
  state: 'active',
  lastActivity: new Date(Date.now() - 86400000).toISOString(),
  headline: 'Level 3',
  next: { label: '2 baskets to finish', detail: 'Reeds prepared', blocked: false, blockedReason: null },
  metrics: [],
  ...over,
});

const payload = (learners) => ({ ok: true, status: 200, data: { learners } });

const learner = (over = {}) => ({
  id: 'kid1', name: 'Alpha', reports: [report()], needsAttention: false, active: 1, ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('scope', () => {
  it('shows the whole household when no learner is given', async () => {
    reportMock.mockResolvedValue(payload([learner(), learner({ id: 'kid2', name: 'Beta' })]));
    render(<ReportPanel />);
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(reportMock).toHaveBeenCalledWith(null);
  });

  it('opens on one learner when signed in, and drilling out is the same endpoint', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    render(<ReportPanel userId="kid1" />);
    await screen.findByText('Alpha');
    expect(reportMock).toHaveBeenCalledWith('kid1');

    fireEvent.click(screen.getByText('‹ Everyone'));
    expect(reportMock).toHaveBeenLastCalledWith(null);
  });

  it('flags a learner who needs attention', async () => {
    reportMock.mockResolvedValue(payload([learner({ needsAttention: true })]));
    render(<ReportPanel />);
    expect(await screen.findByText('Needs attention')).toBeTruthy();
  });
});

describe('the next step', () => {
  it('shows what to do next', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    render(<ReportPanel />);
    expect(await screen.findByText('2 baskets to finish')).toBeTruthy();
  });

  it('shows the REMEDY, not the label, when blocked', async () => {
    // A lock that does not say what to do is the trap this replaces.
    reportMock.mockResolvedValue(payload([learner({
      reports: [report({
        state: 'blocked',
        next: { label: 'Locked', detail: null, blocked: true, blockedReason: 'Pass the quiz for “Reeds” first' },
      })],
    })]));
    render(<ReportPanel />);
    expect(await screen.findByText(/Pass the quiz for/)).toBeTruthy();
    expect(screen.queryByText('Locked')).toBeNull();
  });

  it('renders a program that assigns no work at all', async () => {
    reportMock.mockResolvedValue(payload([learner({ reports: [report({ next: null, metrics: [] })] })]));
    render(<ReportPanel />);
    expect(await screen.findByText('Underwater Basket Weaving')).toBeTruthy();
  });
});

describe('metric kinds', () => {
  const withMetrics = (metrics) => payload([learner({ reports: [report({ metrics })] })]);

  it('renders progress as a bar with its totals', async () => {
    reportMock.mockResolvedValue(withMetrics([
      metric('progress', { label: 'Baskets', value: 1352, total: 4143 }),
    ]));
    render(<ReportPanel />);
    expect(await screen.findByText('1,352 / 4,143')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('renders a score as a percentage, from a ratio', async () => {
    reportMock.mockResolvedValue(withMetrics([metric('score', { label: 'Accuracy', value: 0.742 })]));
    render(<ReportPanel />);
    expect(await screen.findByText('74%')).toBeTruthy();
  });

  it('renders count, streak and duration', async () => {
    reportMock.mockResolvedValue(withMetrics([
      metric('count', { label: 'Made', value: 752, unit: 'baskets' }),
      metric('streak', { label: 'Day', value: 59, unit: 'days' }),
      metric('duration', { label: 'Spent', ms: 12000000 }),
    ]));
    render(<ReportPanel />);
    expect(await screen.findByText('752')).toBeTruthy();
    expect(screen.getByText('59')).toBeTruthy();
    expect(screen.getByText('3h 20m')).toBeTruthy();
  });

  it('renders a trend as an accessible sparkline', async () => {
    reportMock.mockResolvedValue(withMetrics([metric('trend', {
      label: 'Over time',
      points: [{ at: 'Day 1', value: 0.5 }, { at: 'Day 2', value: 0.9 }],
    })]));
    render(<ReportPanel />);
    expect(await screen.findByRole('img', { name: /Trend from 50% to 90%/ })).toBeTruthy();
  });

  it('does not break on a kind it has no branch for', async () => {
    // Version skew: newer backend, cached frontend. Visible gap, not a crash.
    reportMock.mockResolvedValue(withMetrics([{ id: 'x', kind: 'from-the-future', label: 'Mystery' }]));
    render(<ReportPanel />);
    expect(await screen.findByText('Mystery')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('failure and emptiness', () => {
  it('says so when the report cannot be loaded', async () => {
    reportMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<ReportPanel />);
    expect(await screen.findByText(/Could not load progress/)).toBeTruthy();
  });

  it('says so when nobody has started anything', async () => {
    reportMock.mockResolvedValue(payload([]));
    render(<ReportPanel />);
    expect(await screen.findByText(/Nobody has started anything/)).toBeTruthy();
  });
});
