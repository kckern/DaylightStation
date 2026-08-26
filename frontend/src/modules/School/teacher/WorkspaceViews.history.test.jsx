import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryView } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
    milestones: vi.fn(async () => ({ ok: true, status: 200, data: { milestones: [] } })),
    curriculumUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [] } })),
    reviewLearner: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    postTeacherNote: vi.fn(),
    retract: vi.fn(),
    offerRetake: vi.fn(),
  },
}));
vi.mock('./teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
    session: vi.fn(),
    timeline: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
    adjustGrade: vi.fn(),
    reprintArtifact: vi.fn(),
    retractGradeAdjustment: vi.fn(),
    lessonPreviewUrl: () => '',
  },
}));
vi.mock('./TeacherProfileContext.jsx', () => ({
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
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

beforeEach(() => vi.clearAllMocks());

describe('HistoryView', () => {
  it('groups sessions under one heading per study day', async () => {
    teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
      { sessionId: 'ses_1', studyDay: '2026-08-25', lessonTitle: 'Psalms 62–66', subject: 'scripture' },
      { sessionId: 'ses_2', studyDay: '2026-08-25', lessonTitle: 'Psalms 49–51', subject: 'scripture' },
      { sessionId: 'ses_3', studyDay: '2026-08-23', lessonTitle: 'The Midwestern States', subject: 'civilization' },
    ] } });
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    expect(screen.getByText('Sunday, Aug 23')).toBeInTheDocument();
    expect(screen.getAllByText('Tuesday, Aug 25')).toHaveLength(1);
  });

  it('links each day heading to that day’s record', async () => {
    teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
      { sessionId: 'ses_1', studyDay: '2026-08-25', lessonTitle: 'Psalms 62–66', subject: 'scripture' },
    ] } });
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    const link = await screen.findByRole('link', { name: /Tuesday, Aug 25/ });
    expect(link).toHaveAttribute('href', '/school/teacher/students/learner-a/day/2026-08-25');
  });

  it('shows a score for timeline rows, which carry only gradedPercent', async () => {
    teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
      { sessionId: 'ses_1', day: '2026-08-25', lessonTitle: 'Psalms 62–66', subject: 'scripture', gradedPercent: 80 },
    ] } });
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument());
  });

  it('files a row under its study day, not the day it was last touched', async () => {
    teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
      { sessionId: 'ses_1', day: '2026-08-24', updatedAt: '2026-08-28T10:00:00Z', lessonTitle: 'Psalms 49–51', subject: 'scripture' },
    ] } });
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Monday, Aug 24')).toBeInTheDocument());
    expect(screen.queryByText('Friday, Aug 28')).not.toBeInTheDocument();
  });
});
