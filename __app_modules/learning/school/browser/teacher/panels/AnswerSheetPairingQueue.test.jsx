import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnswerSheetPairingQueue from "./AnswerSheetPairingQueue.jsx";
import { humanDateTime } from "../teacherDates.js";

const api = vi.hoisted(() => ({
  answerSheetReviews: vi.fn(),
  resolveAnswerSheetReview: vi.fn(),
}));

vi.mock("../../schoolApi.js", () => ({ schoolApi: api }));
// `busy` / `errors` are steerable per test; the real hook's contract is
// covered in useTeacherWrite.test.jsx.
const write = vi.hoisted(() => ({ busy: null, errors: {} }));
vi.mock("../useTeacherWrite.js", () => ({
  useTeacherWrite: () => ({
    busy: write.busy,
    errors: write.errors,
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

const KIDS = [{ id: 'learner-a', name: 'Learner A' }];

const HELD = {
  heldScanId: 'held-1', createdAt: '2026-08-31T12:00:00.000Z',
  evidence: {
    learnerId: 'learner-a', reason: 'multiple-delivered-live-answer-sheets', rawCardId: '8684155',
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
};

const openReviews = async (held = HELD) => {
  api.answerSheetReviews.mockResolvedValueOnce({ ok: true, data: { items: [held] } });
  render(<AnswerSheetPairingQueue kids={KIDS} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open answer-sheet reviews' }));
  await screen.findByText('Math worksheet');
};

describe('AnswerSheetPairingQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); write.busy = null; write.errors = {}; });

  it('keeps grouped identity recovery separate and shows both physical sheets plus original marks', async () => {
    api.resolveAnswerSheetReview.mockResolvedValueOnce({ ok: true, data: { review: { action: 'reassign' } } });
    await openReviews();
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

  it('names the learner, says why in words, and dates the scan and prints for a person', async () => {
    await openReviews();
    expect(screen.getByRole('heading', { name: 'Learner A' })).toBeInTheDocument();
    expect(screen.getByText(/Two answer sheets were out at once/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`scanned ${humanDateTime('2026-08-31T12:00:00.000Z')}`))).toBeInTheDocument();
    expect(screen.getByText(`Printed ${humanDateTime('2026-08-31T10:00:00.000Z')}`)).toBeInTheDocument();
    expect(screen.queryByText(/learner-a|multiple-delivered|2026-08-31T/)).toBeNull();
  });

  it('explains a scan of an answer sheet that was already replaced', async () => {
    await openReviews({ ...HELD, evidence: { ...HELD.evidence, reason: 'activity-on-historical-answer-sheet' } });
    expect(screen.getByText(/already been replaced/)).toBeInTheDocument();
  });

  it('shows a refused redo, and holds the button while the redo is in flight', async () => {
    write.errors = { 'held-1:redo:none': 'That scan was already resolved.' };
    write.busy = 'held-1:redo:none';
    await openReviews();
    expect(screen.getByText('That scan was already resolved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo without a grade' })).toBeDisabled();
  });
});
