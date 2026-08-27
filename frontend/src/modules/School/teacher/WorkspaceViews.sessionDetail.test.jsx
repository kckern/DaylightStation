import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionInspector, LearnerDayScreen } from './WorkspaceViews.jsx';

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

const KIDS = [{ id: 'learner-b', name: 'Learner B' }];

const SESSION = {
  schema: 'school.teacher-session/v4',
  sessionId: 'ses_1',
  revision: 4,
  state: { learnerId: 'learner-b', state: 'closed', outcome: { result: 'passed' } },
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
  artifacts: [{ artifactId: 'art_1', kind: 'worksheet', availability: 'exact', originalPdfUrl: '/worksheet.pdf', thumbnailUrl: '/worksheet.png' }],
  events: [],
};

describe('SessionInspector detail coherence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  });

  it('numbers answers with worksheet-local numbers, not bank-global ones', async () => {
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('1.')).toBeTruthy());
    expect(screen.queryByText('19.')).toBeNull();
    expect(screen.queryByText('20.')).toBeNull();
  });

  it('letters worksheet choices', async () => {
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/A\. Hotels/)).toBeTruthy());
    expect(screen.getByText(/C\. Factories and stockyards/)).toBeTruthy();
  });

  it('states the recorded answer as words, and the right answer only when wrong', async () => {
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Factories and stockyards', { selector: '.teacher-graded-q__given' })).toBeTruthy());
    // The right answer is repeated only for the question the child got wrong.
    const corrections = screen.getAllByText(/Correct answer:/);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toHaveTextContent('Correct answer: 1818');
  });

  it('states one score when the machine and the teacher agree', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Score')).toBeInTheDocument());
    expect(screen.queryByText('Marked score')).not.toBeInTheDocument();
    expect(screen.queryByText('Current score')).not.toBeInTheDocument();
    expect(screen.queryByText(/corrected from/i)).not.toBeInTheDocument();
  });

  it('shows the correction provenance only when the scores differ', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: {
      ...SESSION, scores: { machine: { percent: 80 }, effective: { percent: 100 } },
    } });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/corrected from 80%/i)).toBeInTheDocument());
  });

  it('prints the questions once, under one heading', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Questions and answers')).toBeInTheDocument());
    expect(screen.queryByText('Worksheet and questions')).not.toBeInTheDocument();
    expect(screen.queryByText('Answers and result')).not.toBeInTheDocument();
    expect(screen.getAllByText('Where did unions form?')).toHaveLength(1);
  });

  it('folds the answer card and the event log away by default', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: {
      ...SESSION, answerSheets: [{ cardId: 'c1', studentNumber: '2487270', usedRows: 16, capacity: 50, remainingContiguousSlots: 34, nextRow: 17 }],
    } });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Answer card')).toBeInTheDocument());
    expect(screen.getByText('Answer card').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Event history').closest('details')).not.toHaveAttribute('open');
  });

  it('offers repair options in the teacher’s words, weighted by importance', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    const fix = await screen.findByRole('button', { name: 'Fix a marked answer' });
    expect(fix).toHaveClass('teacher-btn--primary');
    const credit = screen.getByRole('link', { name: /Give credit for work you saw/ });
    expect(credit).toHaveAttribute('href', '/school/teacher/students/learner-b/operations');
    expect(credit).not.toHaveClass('teacher-back');
  });

  it('puts the reprint control inside the card it reprints', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
    const reprint = await screen.findByRole('button', { name: /Print another copy/i });
    expect(reprint.closest('.teacher-issued-artifact')).not.toBeNull();
  });
});

/**
 * "Offer another try" IS OFFERED EXACTLY ONCE, because that is all the server
 * can honour. `OpenRemediation` returns `already_opened` for any session that
 * has a remediation — live, abandoned, or never scanned — and the route
 * answers it at HTTP 201, which `useTeacherWrite` reads as a save. A button
 * shown past that point reports success, creates nothing, and tells a parent a
 * fresh sheet is waiting when the only sheet is a dead one.
 *
 * A retake that is abandoned therefore strands the parent session. That gap is
 * REAL and is filed as a known residual (audit A10) rather than papered over
 * here: `remediation_opened` has no outgoing edge in the domain's transition
 * table, so a second one is refused on append. Closing it is a domain change.
 */
describe('SessionInspector — offering a retake', () => {
  const needsRemediation = (extra = {}) => ({
    schema: 'school.teacher-session/v4',
    sessionId: 'ses_1',
    revision: 1,
    state: { learnerId: 'learner-b', state: 'outcome_recorded', outcome: { result: 'needs_remediation' }, ...extra },
    taxonomy: { subject: 'math', lessonTitle: 'Fractions' },
    scores: { machine: null, effective: null },
    artifacts: [],
    events: [],
  });
  const remediationChild = (sessionId, terminal) => ({
    schema: 'school.teacher-session/v4', sessionId, state: { terminal },
  });

  beforeEach(() => vi.clearAllMocks());

  it('offers the retake when no remediation has ever been opened', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: needsRemediation() });
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Offer another try' })).toBeInTheDocument();
  });

  it('withholds it once a remediation exists, even one whose session is finished', async () => {
    teacherWorkspaceApi.session.mockImplementation(async (id) => (id === 'ses_1'
      ? { ok: true, status: 200, data: needsRemediation({ remediation: { newSessionId: 'ses_2', variant: 'retry' } }) }
      : { ok: true, status: 200, data: remediationChild('ses_2', true) }));
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Outcome')).toBeInTheDocument());
    // A terminal retake is exactly the abandoned case, and it is exactly the
    // case the server refuses. Offering it here is the defect.
    expect(screen.queryByRole('button', { name: 'Offer another try' })).not.toBeInTheDocument();
  });

  it('withholds it while the remediation session is still live', async () => {
    teacherWorkspaceApi.session.mockImplementation(async (id) => (id === 'ses_1'
      ? { ok: true, status: 200, data: needsRemediation({ remediation: { newSessionId: 'ses_3', variant: 'retry' } }) }
      : { ok: true, status: 200, data: remediationChild('ses_3', false) }));
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Outcome')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Offer another try' })).not.toBeInTheDocument();
  });

  it('never reads the remediation child: the answer needs no second request', async () => {
    teacherWorkspaceApi.session.mockImplementation(async (id) => (id === 'ses_1'
      ? { ok: true, status: 200, data: needsRemediation({ remediation: { newSessionId: 'ses_4', variant: 'retry' } }) }
      : { ok: true, status: 200, data: remediationChild('ses_4', true) }));
    render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Outcome')).toBeInTheDocument());
    expect(teacherWorkspaceApi.session).not.toHaveBeenCalledWith('ses_4');
  });
});

describe('LearnerDayScreen study day', () => {
  afterEach(() => vi.useRealTimers());

  it('defaults to the LOCAL date, not the UTC date', async () => {
    vi.useFakeTimers();
    // 9:30pm PDT on Aug 24 is already Aug 25 UTC — the input must say Aug 24.
    vi.setSystemTime(new Date('2026-08-24T21:30:00-07:00'));
    render(<LearnerDayScreen learnerId="learner-b" learnerName="Learner B" onOpenSession={() => {}} />);
    const input = screen.getByLabelText('Jump to');
    const expected = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();
    expect(input.value).toBe(expected);
  });
});
