import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FeedbackNotes from './FeedbackNotes.jsx';

vi.mock('../../schoolApi.js', () => ({ schoolApi: { reviewLearner: vi.fn(), retract: vi.fn() } }));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));
import { schoolApi } from '../../schoolApi.js';

const verdictRow = (n, extra = {}) => ({
  itemId: `i${n}`, sessionId: 'ses_1', unitId: 'atlas-us-p044-illinois', unitTitle: 'Illinois',
  verdict: 'correct', gradedBy: 'engine', gradedAt: '2026-08-24T15:20:00Z', ...extra,
});

describe('FeedbackNotes roll-up', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rolls one session of engine verdicts into a single expandable summary row', async () => {
    schoolApi.reviewLearner.mockResolvedValue({
      ok: true, status: 200,
      data: [1, 2, 3, 4, 5, 6].map((n) => verdictRow(n, n === 6 ? { verdict: 'incorrect' } : {})),
    });
    render(<FeedbackNotes learnerId="milo" learnerName="Milo" />);
    await waitFor(() => expect(screen.getByText(/5 of 6 correct · Illinois/)).toBeTruthy());
    // One summary row, not six visible rows.
    expect(screen.getAllByText(/of 6 correct/)).toHaveLength(1);
    // Engine attribution never renders.
    expect(screen.queryByText(/engine/)).toBeNull();
  });

  it('keeps human attribution and standalone notes with their Retract button', async () => {
    schoolApi.reviewLearner.mockResolvedValue({
      ok: true, status: 200,
      data: [
        verdictRow(1, { gradedBy: 'kckern' }),
        { itemId: 'n1', sessionId: null, unitId: null, unitTitle: null, verdict: null, kind: 'note', note: 'Nice work', gradedBy: 'kckern', gradedAt: '2026-08-23T10:00:00Z' },
      ],
    });
    render(<FeedbackNotes learnerId="milo" learnerName="Milo" />);
    await waitFor(() => expect(screen.getByText('Nice work')).toBeTruthy());
    expect(screen.getAllByText(/kckern/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retract' })).toBeTruthy();
  });
});
