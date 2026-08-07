import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentPanel from './StudentPanel.jsx';

/**
 * Render-level coverage for the two Task 9 additions (spec R7 + adequacy
 * SHOULD 9): "Where you stand" and "Feedback" actually appear with the
 * right content when there's data, and are ENTIRELY ABSENT — no heading, no
 * empty-state scold — when there isn't. `StudentPanel.test.js` covers the
 * pure `derivePanelModel`/`deriveLatestScore` models; this file covers what
 * a claimed learner actually sees, the way `ReportPanel.test.jsx` does for
 * the report board.
 */

const reportMock = vi.fn(async () => ({ ok: true, status: 200, data: { learners: [{ id: 'kid1', reports: [] }] } }));
const resultsMock = vi.fn(async () => ({ ok: true, status: 200, data: [] }));
const periodsMock = vi.fn(async () => ({ ok: true, status: 200, data: [] }));
const reportCardMock = vi.fn(async () => ({ ok: true, status: 200, data: null }));
const reviewLearnerMock = vi.fn(async () => ({ ok: true, status: 200, data: [] }));
const agendaPreviewMock = vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } }));

vi.mock('../schoolApi.js', () => ({ schoolApi: {
  report: (...a) => reportMock(...a),
  results: (...a) => resultsMock(...a),
  periods: (...a) => periodsMock(...a),
  reportCard: (...a) => reportCardMock(...a),
  reviewLearner: (...a) => reviewLearnerMock(...a),
  wallet: async () => ({ ok: false, status: 503, data: null }),
  agendaPreview: (...a) => agendaPreviewMock(...a),
} }));

vi.mock('../schoolLog.js', () => ({ schoolLog: {
  materialsError: vi.fn(),
  feedback: vi.fn(), feedbackError: vi.fn(), standing: vi.fn(), standingError: vi.fn(),
} }));

const profile = { currentUser: { id: 'kid1', name: 'Alpha' }, openPicker: vi.fn(), roster: [], claim: vi.fn() };
vi.mock('../identity/SchoolProfileContext.jsx', () => ({ useSchoolProfile: () => profile }));

// A period wide enough that the hook's real system clock always falls
// inside it — see useLearnerStanding.test.js for why this avoids faking time.
const PERIOD = {
  schema: 'school.academic-period/v1', periodId: 'fall-2026', kind: 'semester', label: 'Fall 2026',
  startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2030-01-01T00:00:00.000Z',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('feedback list', () => {
  it('renders a note with its verdict icon and is-incorrect class', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: [{
      itemId: 'q1', sessionId: 'ses_1', unitId: 'math-fractions.02', verdict: 'incorrect',
      note: 'Carry the remainder next time', gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z',
      prompt: null, questionNumber: 3,
    }] });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    expect(await screen.findByText('Feedback')).toBeTruthy();
    expect(screen.getByText('Carry the remainder next time')).toBeTruthy();
    const item = container.querySelector('.school-rail__feedback-item');
    expect(item.className).toContain('is-incorrect');
    // House rule: inline SVG, never a unicode glyph — WebView renders
    // unrecognized unicode as tofu.
    expect(item.querySelector('.school-rail__feedback-verdict svg')).toBeTruthy();
  });

  it('renders a correct verdict\'s icon and is-correct class, falling back to the prompt with no note', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: [{
      itemId: 'q2', sessionId: 'ses_1', unitId: 'math-fractions.02', verdict: 'correct',
      note: null, gradedBy: 'parent', gradedAt: '2026-07-27T09:00:00.000Z',
      prompt: 'What is 1/2 + 1/2?', questionNumber: 1,
    }] });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    expect(await screen.findByText('What is 1/2 + 1/2?')).toBeTruthy();
    const item = container.querySelector('.school-rail__feedback-item');
    expect(item.className).toContain('is-correct');
    expect(item.querySelector('.school-rail__feedback-verdict svg')).toBeTruthy();
  });

  it('omits the section entirely — no heading — when there is nothing resolved', async () => {
    reviewLearnerMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Feedback')).toBeNull();
    expect(container.querySelector('.school-rail__feedback')).toBeNull();
  });
});

describe('standing', () => {
  it('renders "Course: N%" for a graded course this period', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [PERIOD] });
    reportCardMock.mockResolvedValue({ ok: true, status: 200, data: {
      schema: 'school.report-card/v1', learnerId: 'kid1', period: { periodId: 'fall-2026' },
      courses: [
        { courseId: 'math-fractions', coursePercent: 87.4 },
        { courseId: 'never-graded', coursePercent: null },
      ],
    } });
    render(<StudentPanel onOpen={vi.fn()} />);
    expect(await screen.findByText('Where you stand')).toBeTruthy();
    expect(screen.getByText('Math Fractions')).toBeTruthy();
    expect(screen.getByText('87%')).toBeTruthy();
    // The ungraded course must never appear.
    expect(screen.queryByText('never-graded')).toBeNull();
  });

  it('omits the section entirely — no heading — with no current period configured', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Where you stand')).toBeNull();
    expect(container.querySelector('.school-rail__standing')).toBeNull();
  });

  it('omits the section entirely — no heading — when the current period has nothing graded', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [PERIOD] });
    reportCardMock.mockResolvedValue({ ok: true, status: 200, data: {
      schema: 'school.report-card/v1', learnerId: 'kid1', period: { periodId: 'fall-2026' }, courses: [],
    } });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Where you stand')).toBeNull();
    expect(container.querySelector('.school-rail__standing')).toBeNull();
  });
});

describe('today plan (debt W7a)', () => {
  it('renders a row per section — subject label, next title, and done-today', async () => {
    agendaPreviewMock.mockResolvedValue({ ok: true, status: 200, data: {
      learnerId: 'kid1',
      sections: [
        { subject: 'math-fractions', servedToday: false, next: { title: 'Adding halves' } },
        { subject: 'reading', servedToday: true, next: null },
        // No title/label -> falls through the chain to the labelized unitId.
        { subject: 'science', servedToday: false, next: { unitId: 'water-cycle.03' } },
      ],
      entries: [],
      errors: [],
    } });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.getByText('Math Fractions')).toBeTruthy();
    expect(screen.getByText('Adding halves')).toBeTruthy();
    expect(screen.getByText('Reading')).toBeTruthy();
    expect(screen.getByText('done today')).toBeTruthy();
    expect(screen.getByText('Water Cycle 03')).toBeTruthy();
    expect(container.querySelectorAll('.school-rail__today-item')).toHaveLength(3);
  });

  it('omits the section entirely — no heading — when there are no sections', async () => {
    agendaPreviewMock.mockResolvedValue({ ok: true, status: 200, data: { sections: [] } });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Today')).toBeNull();
    expect(container.querySelector('.school-rail__today')).toBeNull();
  });

  it('omits the section entirely — never an error card — when the fetch fails', async () => {
    agendaPreviewMock.mockResolvedValue({ ok: false, status: 503, data: null });
    const { container } = render(<StudentPanel onOpen={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Today')).toBeNull();
    expect(container.querySelector('.school-rail__today')).toBeNull();
  });
});
