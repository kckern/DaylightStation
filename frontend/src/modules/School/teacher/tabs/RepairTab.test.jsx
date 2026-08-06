import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RepairTab from './RepairTab.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { reviewLearner: vi.fn() },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }];
const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.reviewLearner.mockResolvedValue(ok([
    { itemId: 'q3', sessionId: 'ses_1', unitId: 'math.01', verdict: 'correct', note: 'Nice clear reasoning!', gradedBy: 'kckern', gradedAt: '2026-08-06T09:00:00Z' },
    { itemId: 'q5', sessionId: 'ses_1', unitId: 'math.01', verdict: 'incorrect', note: null, gradedBy: 'kckern', gradedAt: '2026-08-06T09:01:00Z' },
  ]));
});

describe('RepairTab', () => {
  it('renders the learner\'s resolved feedback, notes included', async () => {
    render(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Nice clear reasoning!/)).toBeTruthy());
    expect(screen.getAllByText(/correct/i).length).toBeGreaterThan(0);
  });

  it('no learner selected prompts instead of fetching', async () => {
    render(<RepairTab learnerId={null} kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.reviewLearner).not.toHaveBeenCalled();
  });

  it('carries its three stubs', async () => {
    render(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(document.querySelectorAll('[data-todo]').length).toBe(3));
  });
});
