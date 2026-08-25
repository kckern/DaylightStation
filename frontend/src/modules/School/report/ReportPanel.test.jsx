import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReportPanel from './ReportPanel.jsx';

/**
 * The contract's value is that this view renders ANY program without knowing
 * what it does. So these tests deliberately use invented programs — if the
 * panel ever needs to know about quizzes or sentence ladders, they fail.
 */
const reportMock = vi.fn();
const progressMock = vi.fn(async () => ({
  ok: true, status: 200, data: {
    summary: { evidenceCount: 0, responseCount: 0, correctCount: 0, scorePercent: null, completionCount: 0, pendingCount: 0 },
    facets: { subjects: [] }, recentScores: [], followUps: [],
  },
}));
const optionsMock = vi.fn(async () => ({ ok: true, status: 200, data: { learners: [], scopes: [], periods: [] } }));
const insightsMock = vi.fn(async () => ({ ok: true, status: 200, data: {
  concepts: [], items: [], pacing: [],
} }));
const teacherTodayMock = vi.fn(async () => ({ ok: true, status: 200, data: [] }));
const flashcardReportMock = vi.fn(async () => ({ ok: true, status: 200, data: { decks: [] } }));
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  report: (...a) => reportMock(...a),
  progress: (...a) => progressMock(...a),
  progressOptions: (...a) => optionsMock(...a),
  instructionalInsights: (...a) => insightsMock(...a),
  teacherToday: (...a) => teacherTodayMock(...a),
  flashcardReport: (...a) => flashcardReportMock(...a),
} }));

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

describe('flashcard reporting', () => {
  it('shows each learner’s deck summary in the household report', async () => {
    reportMock.mockResolvedValue(payload([learner(), learner({ id: 'kid2', name: 'Beta' })]));
    flashcardReportMock.mockImplementation(async (id) => ({ ok: true, status: 200, data: { decks: [{ id: `${id}/deck`, title: `${id} cards`, summary: { counts: { due: id === 'kid1' ? 2 : 1, new: 0, mastered: 3, reviewed: 4, activeSeconds: 60 } } }] } }));
    render(<ReportPanel />);
    await waitFor(() => expect(screen.getAllByLabelText('Flashcard progress')).toHaveLength(2));
    expect(screen.getByText('kid1 cards')).toBeTruthy();
    expect(screen.getByText('kid2 cards')).toBeTruthy();
    expect(flashcardReportMock).toHaveBeenCalledWith('kid1');
    expect(flashcardReportMock).toHaveBeenCalledWith('kid2');
  });
  it('shows formative deck counts separately from assessment metrics', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    flashcardReportMock.mockResolvedValue({ ok: true, status: 200, data: { decks: [{ id: 'cells', title: 'Cell organelles', summary: { counts: { due: 2, new: 3, mastered: 4, reviewed: 9, activeSeconds: 120 } } }] } });
    render(<ReportPanel userId="kid1" />);
    expect(await screen.findByLabelText('Flashcard progress')).toHaveTextContent('2 due · 3 new · 4 mastered');
    expect(screen.getByLabelText('Flashcard progress')).toHaveTextContent('9 reviews · 2 active min');
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
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('failure and emptiness', () => {
  it('says so when the report cannot be loaded', async () => {
    reportMock.mockResolvedValue({ ok: false, status: 500, data: null });
    progressMock.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    render(<ReportPanel />);
    expect(await screen.findByText(/Could not load progress/)).toBeTruthy();
  });

  it('says so when nobody has started anything', async () => {
    reportMock.mockResolvedValue(payload([]));
    render(<ReportPanel />);
    expect(await screen.findByText(/Nobody has started anything/)).toBeTruthy();
  });
});

describe('the "Today" strip', () => {
  it('says so when a learner has done nothing today', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    teacherTodayMock.mockResolvedValueOnce({ ok: true, status: 200, data: [
      { learnerId: 'kid1', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 },
    ] });
    render(<ReportPanel />);
    await screen.findByText('Alpha');
    expect(await screen.findByText('No work recorded today')).toBeTruthy();
  });

  it('shows attempts, correct count, sessions in flight, and a needs-marking badge', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    teacherTodayMock.mockResolvedValueOnce({ ok: true, status: 200, data: [
      {
        learnerId: 'kid1', attemptsToday: 3, correctToday: 2,
        sessionsToday: [{ unitId: 'math-fractions.03', state: 'active' }],
        pendingReview: 1,
      },
    ] });
    render(<ReportPanel />);
    expect(await screen.findByText(/3 attempts today/)).toBeTruthy();
    expect(screen.getByText(/2 correct/)).toBeTruthy();
    expect(screen.getByText(/math-fractions\.03/)).toBeTruthy();
    const badge = screen.getByRole('link', { name: /1 item needs marking/ });
    expect(badge.getAttribute('href')).toBe('/admin/school/review');
  });

  it('shows the needs-marking badge even when nothing happened today', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    teacherTodayMock.mockResolvedValueOnce({ ok: true, status: 200, data: [
      { learnerId: 'kid1', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 2 },
    ] });
    render(<ReportPanel />);
    expect(await screen.findByText('No work recorded today')).toBeTruthy();
    expect(screen.getByRole('link', { name: /2 items need marking/ })).toBeTruthy();
  });

  it('says so, visibly, when the digest fails to load', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    teacherTodayMock.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    render(<ReportPanel />);
    await screen.findByText('Alpha');
    expect(await screen.findByText(/Could not load today.s activity/)).toBeTruthy();
  });

  it('shows the zero-state, not a blank strip, when the digest has no row for a learner', async () => {
    // Reachable in prod: the route answers `[]` whenever the school lifecycle
    // isn't fully wired, even though the report itself has learners.
    reportMock.mockResolvedValue(payload([learner(), learner({ id: 'kid2', name: 'Beta' })]));
    teacherTodayMock.mockResolvedValueOnce({ ok: true, status: 200, data: [] });
    render(<ReportPanel />);
    await screen.findByText('Alpha');
    await screen.findByText('Beta');
    expect(screen.getAllByText('No work recorded today')).toHaveLength(2);
  });
});

describe('cross-surface evidence progress', () => {
  it('uses the same overview and inspector grammar for adult content signals', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    insightsMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      concepts: [{
        target: { kind: 'concept', id: 'equivalent-fractions' }, signal: 'review_instruction',
        responseCount: 6, accuracyPercent: 50, affectedLearnerCount: 2,
        lastActivityAt: '2026-08-01T12:00:00.000Z',
        suggestedAction: { recommendation: {
          basis: { kind: 'evidence_aggregate', correctCount: 3, responseCount: 6, evidenceCount: 6, learnerCount: 2 },
          policy: { version: 'school.instructional-review/v1', expiresAt: '2026-08-08T00:00:00.000Z' },
        } },
      }],
      items: [],
      pacing: [{
        expectationId: 'unit-a-due', target: { kind: 'unit', id: 'fractions' },
        status: 'review_pacing', completedPercent: 50, expectedCompletedPercent: 80,
        completedLearnerCount: 1, learnerCount: 2, dueAt: '2026-08-01T00:00:00.000Z',
      }],
    } });
    render(<ReportPanel />);
    expect(await screen.findByText('Instructional view')).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Instructional content and pacing signals' })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /Equivalent Fractions/ })).toBeTruthy();
    expect(screen.getByText(/not learner rankings/)).toBeTruthy();
    expect(screen.getByText('Why this is suggested')).toBeTruthy();
    expect(screen.getByText(/3\/6 correct across 6 records and 2 learners/)).toBeTruthy();
    expect(screen.getByText(/school\.instructional-review\/v1/)).toBeTruthy();
  });

  it('shows exact recent scores, pending sync, and a learner follow-up action', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    progressMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      summary: { evidenceCount: 3, responseCount: 3, correctCount: 2, scorePercent: 67, completionCount: 1, pendingCount: 1 },
      facets: { subjects: [{ id: 'math', evidenceCount: 3 }] },
      recentScores: [{
        learnerId: 'kid1', assessmentId: 'quiz-1', activityId: 'math/check',
        occurredAt: new Date().toISOString(), score: { correct: 2, total: 3, percent: 67 },
        verification: 'pending', learning: { lessonId: 'fractions' },
      }],
      followUps: [{
        actionId: 'review-1', learnerId: 'kid1', kind: 'review', label: 'Review this quiz',
        availability: 'ready', target: { type: 'bank', id: 'math/check' }, priority: 30,
      }],
    } });
    const onFollowUp = vi.fn();
    render(<ReportPanel userId="kid1" onFollowUp={onFollowUp} />);
    expect(await screen.findByText('67%')).toBeTruthy();
    expect(screen.getByText('2/3 · 67%')).toBeTruthy();
    expect(screen.getAllByText('Pending sync').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Review this quiz' }));
    expect(onFollowUp).toHaveBeenCalledWith(expect.objectContaining({ kind: 'review' }));
  });

  it('re-queries with period, subject, and elective exclusion controls', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    optionsMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      learners: [{ id: 'kid1', name: 'Alpha' }], scopes: [],
      periods: [{ periodId: 'fall', label: 'Fall', kind: 'semester' }],
    } });
    progressMock.mockResolvedValue({ ok: true, status: 200, data: {
      summary: { evidenceCount: 1, responseCount: 1, correctCount: 1, scorePercent: 100, completionCount: 0, pendingCount: 0 },
      facets: { subjects: [{ id: 'math', evidenceCount: 1 }] }, recentScores: [], followUps: [],
    } });
    render(<ReportPanel userId="kid1" />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Academic period'), { target: { value: 'fall' } });
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'math' } });
    fireEvent.click(await screen.findByLabelText('Hide electives'));
    await waitFor(() => expect(progressMock).toHaveBeenLastCalledWith(expect.objectContaining({
      learnerId: 'kid1', periodId: 'fall', subjectIds: ['math'], excludeClassifications: ['elective'],
    })));
  });

  it('uses a focusable overview and stable inspector for hierarchical learning history', async () => {
    reportMock.mockResolvedValue(payload([learner()]));
    const summary = (over = {}) => ({
      evidenceCount: 2, activityCount: 1, completionCount: 0, scorePercent: 50,
      lastActivityAt: '2026-08-01T12:00:00.000Z', ...over,
    });
    progressMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      summary: { ...summary(), responseCount: 2, correctCount: 1, pendingCount: 0 },
      facets: { subjects: [{ id: 'math', evidenceCount: 2 }] }, recentScores: [], followUps: [],
      curriculumHistory: {
        hierarchy: ['catalog', 'subject', 'course', 'unit', 'lesson', 'module'],
        roots: [{
          key: 'subject=math', kind: 'subject', id: 'math', directEvidenceCount: 0,
          evidenceState: 'recorded', summary: summary(), path: { subjectId: 'math' },
          children: [{
            key: 'subject=math|course=fractions', kind: 'course', id: 'fractions',
            directEvidenceCount: 2, evidenceState: 'recorded', summary: summary({ scorePercent: 75 }),
            path: { subjectId: 'math', courseId: 'fractions' }, children: [],
          }],
        }],
        unscoped: summary({ evidenceCount: 1 }),
      },
    } });
    render(<ReportPanel userId="kid1" />);

    const overview = await screen.findByRole('grid', { name: 'Curriculum progress history' });
    const math = screen.getByRole('gridcell', { name: /Subject Math 50%/ });
    expect(math.getAttribute('aria-selected')).toBe('true');
    math.focus();
    fireEvent.keyDown(math, { key: 'ArrowRight' });
    const fractions = screen.getByRole('gridcell', { name: /Course Fractions 75%/ });
    expect(fractions.getAttribute('aria-selected')).toBe('true');
    expect(overview.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Math › Fractions')).toBeTruthy();
    expect(screen.getByText(/1 record not assigned/)).toBeTruthy();
  });
});
