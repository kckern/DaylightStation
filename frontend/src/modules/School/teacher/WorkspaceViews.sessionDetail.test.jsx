import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionInspector, LearnerOverview } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    teacherDay: vi.fn(async () => ({ ok: true, status: 200, data: { learners: [] } })),
    milestones: vi.fn(async () => ({ ok: true, status: 200, data: { milestones: [] } })),
    curriculumUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [] } })),
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

const KIDS = [{ id: 'milo', name: 'Milo' }];

const SESSION = {
  schema: 'school.teacher-session/v4',
  sessionId: 'ses_1',
  revision: 4,
  state: { learnerId: 'milo', state: 'closed', outcome: { result: 'passed' } },
  taxonomy: { subject: 'civilization', courseTitle: 'United States Regions and States', lessonTitle: 'Illinois', posterUrl: null },
  scores: { machine: { percent: 100 }, effective: { percent: 100 } },
  assignment: {
    documentId: 'doc', documentRevision: 'rev', title: 'Illinois', createdAt: '2026-08-24T14:28:00Z',
    questions: [
      { itemId: 'q-labor', number: 1, prompt: 'Where did unions form?', choices: [{ text: 'Hotels' }, { text: 'Farms' }, { text: 'Factories and stockyards' }], expected: ['Factories and stockyards'] },
      { itemId: 'q-year', number: 2, prompt: 'Statehood year?', choices: [{ text: '1818' }, { text: '1808' }], expected: ['1818'] },
    ],
  },
  assessment: {
    items: [
      { itemId: 'q-labor', questionNumber: 19, prompt: 'Where did unions form?', given: 'Factories and stockyards', expected: ['Factories and stockyards'], verdict: 'correct' },
      { itemId: 'q-year', questionNumber: 20, prompt: 'Statehood year?', given: '1808', expected: ['1818'], verdict: 'incorrect' },
    ],
  },
  artifacts: [],
  events: [],
};

describe('SessionInspector detail coherence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  });

  it('numbers answers with worksheet-local numbers, not bank-global ones', async () => {
    render(<SessionInspector learnerId="milo" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('Question 1').length).toBeGreaterThan(0));
    expect(screen.queryByText('Question 19')).toBeNull();
    expect(screen.queryByText('Question 20')).toBeNull();
  });

  it('letters worksheet choices', async () => {
    render(<SessionInspector learnerId="milo" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/A\. Hotels/)).toBeTruthy());
    expect(screen.getByText(/C\. Factories and stockyards/)).toBeTruthy();
  });

  it('writes an honest answer line — letter derived, no redundant clause when correct', async () => {
    render(<SessionInspector learnerId="milo" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Their answer: Factories and stockyards/)).toBeTruthy());
    // Correct answer clause suppressed when the verdict is correct.
    expect(screen.getByText(/Their answer: Factories and stockyards/).textContent).not.toMatch(/Correct answer/);
    // Incorrect answer shows the expected with its derived letter.
    expect(screen.getByText(/Their answer: 1808 · Correct answer: 1818 \(A\) · Incorrect/)).toBeTruthy();
  });

  it('labels the two scores', async () => {
    render(<SessionInspector learnerId="milo" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('As graded by the machine')).toBeTruthy());
    expect(screen.getByText('After teacher corrections')).toBeTruthy();
  });
});

describe('LearnerOverview study day', () => {
  afterEach(() => vi.useRealTimers());

  it('defaults to the LOCAL date, not the UTC date', async () => {
    vi.useFakeTimers();
    // 9:30pm PDT on Aug 24 is already Aug 25 UTC — the input must say Aug 24.
    vi.setSystemTime(new Date('2026-08-24T21:30:00-07:00'));
    render(<LearnerOverview learnerId="milo" learnerName="Milo" onOpenSession={() => {}} />);
    const input = document.getElementById('agenda-study-day-milo');
    const expected = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();
    expect(input.value).toBe(expected);
  });
});
