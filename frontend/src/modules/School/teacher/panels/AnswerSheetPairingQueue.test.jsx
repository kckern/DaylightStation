import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnswerSheetPairingQueue from './AnswerSheetPairingQueue.jsx';

const api = vi.hoisted(() => ({
  answerSheetReviews: vi.fn(),
  resolveAnswerSheetReview: vi.fn(),
}));

vi.mock('../../schoolApi.js', () => ({ schoolApi: api }));
vi.mock('../useTeacherWrite.js', () => ({
  useTeacherWrite: () => ({
    busy: null,
    errors: {},
    run: async (_key, call, { onSuccess } = {}) => {
      const response = await call({ actorId: 'parent', pin: null, stepUpToken: null });
      if (response.ok) onSuccess?.(response.data);
      return response.ok;
    },
  }),
}));

const icon = (offset) => ({
  version: 'v1', size: 5,
  cells: Array.from({ length: 25 }, (_, index) => (index + offset) % 3 === 0),
});

describe('AnswerSheetPairingQueue', () => {
  it('keeps grouped identity recovery separate and shows both physical sheets plus original marks', async () => {
    api.answerSheetReviews.mockResolvedValueOnce({
      ok: true,
      data: { items: [{
        heldScanId: 'held-1', createdAt: '2026-08-31T12:00:00.000Z',
        evidence: {
          learnerId: 'user_4', reason: 'multiple-delivered-live-answer-sheets', rawCardId: '8684155',
          rawRows: [{ row: 22, marks: ['B'] }, { row: 24, marks: ['B', 'C'] }],
          candidateWorksheets: [
            {
              cardId: '8684155', recordId: 'math-record', title: 'Math worksheet',
              rowRange: { start: 22, end: 27 }, renderedAt: '2026-08-31T10:00:00.000Z', identicon: icon(0),
            },
            {
              cardId: '8424408', recordId: 'scripture-record', title: 'Scripture worksheet',
              rowRange: { start: 1, end: 3 }, renderedAt: '2026-08-31T11:00:00.000Z', identicon: icon(1),
            },
          ],
        },
      }] },
    });
    api.resolveAnswerSheetReview.mockResolvedValueOnce({ ok: true, data: { review: { action: 'reassign' } } });
    render(<AnswerSheetPairingQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Open answer-sheet reviews' }));
    expect(await screen.findByText('Math worksheet')).toBeInTheDocument();
    expect(screen.getByText('Scripture worksheet')).toBeInTheDocument();
    expect(screen.getByText(/Student No\. 8684155 · rows 22–27/)).toBeInTheDocument();
    expect(screen.getByText(/Student No\. 8424408 · rows 1–3/)).toBeInTheDocument();
    expect(screen.getByText(/22: B · 24: B\+C/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Answer-sheet symbol v1/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Confirm this worksheet' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reassign marks here' }));
    await waitFor(() => expect(api.resolveAnswerSheetReview).toHaveBeenCalledWith('held-1', expect.objectContaining({
      action: 'reassign', targetRecordId: 'scripture-record', reviewerId: 'parent',
    })));
    expect(await screen.findByText('There are no answer-sheet pairings to check.')).toBeInTheDocument();
  });
});
