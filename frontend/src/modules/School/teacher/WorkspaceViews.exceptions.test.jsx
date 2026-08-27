import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OperationsView, CurriculumView, LearnerOperationsView } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    curriculumUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [
      { unitId: 'u1', title: 'Illinois', courseId: 'atlas', courseTitle: 'Atlas' },
    ] } })),
    allAssignments: vi.fn(async () => ({ ok: true, status: 200, data: { assignments: [] } })),
    syllabi: vi.fn(async () => ({ ok: true, status: 200, data: { syllabi: [] } })),
    periods: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    staleSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    regradeAttempts: vi.fn(),
    programDayBypasses: vi.fn(async () => ({ ok: true, status: 200, data: { active: [], history: [] } })),
    pianoLessonGate: vi.fn(async () => ({ ok: true, status: 200, data: { gated: false, reason: 'not-enrolled' } })),
    grantProgramDayBypass: vi.fn(),
    retractProgramDayBypass: vi.fn(),
  },
}));
vi.mock('./teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
    curriculumExceptions: vi.fn(async () => ({ ok: true, status: 200, data: { active: [
      { exceptionId: 'ex1', kind: 'paused', learnerId: null, targetType: 'lesson', targetId: 'u1', reason: 'defective' },
    ] } })),
    changeCurriculumException: vi.fn(async () => ({ ok: true, status: 200, data: { applied: false } })),
    retractCurriculumException: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    stuckSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    activeOverrides: vi.fn(async () => ({ ok: true, status: 200, data: { overrides: [] } })),
    lesson: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
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
// StaleSessions is left REAL: "which page owns the stuck-session tool" is
// exactly what the one-home tests below assert.
vi.mock('./panels/ActiveOverrides.jsx', () => ({ default: () => null }));
vi.mock('./panels/PeriodsTimeline.jsx', () => ({ default: () => null }));
vi.mock('./panels/CurriculumCatalog.jsx', () => ({ default: () => null }));
vi.mock('./panels/CurriculumBrowser.jsx', () => ({ default: () => null }));
vi.mock('./panels/SchoolMatrix.jsx', () => ({ default: () => null }));
vi.mock('./panels/EnrichmentPanel.jsx', () => ({ default: () => null }));
vi.mock('./panels/AttestationPanel.jsx', () => ({ default: () => null }));
vi.mock('./panels/ReassignPanel.jsx', () => ({ default: () => null }));
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

const KIDS = [{ id: 'learner-b', name: 'Learner B' }];

describe('CurriculumExceptionPanel neutral defaults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts on Choose… for decision and reason, Preview disabled, destructive option last', async () => {
    render(<OperationsView kids={KIDS} />);
    // Wait on a FORM CONTROL, not the panel title: PanelFrame renders its
    // title in every state and its children only in `ok`, so waiting on the
    // title can resolve while the form is still loading.
    const decision = await screen.findByLabelText(/^Decision/);
    expect(decision.value).toBe('');
    const options = within(decision).getAllByRole('option');
    expect(options[0].textContent).toBe('Choose…');
    expect(options.at(-1).textContent).toBe('Paused globally');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('choosing Paused globally leaves reason on Choose… until picked', async () => {
    render(<OperationsView kids={KIDS} />);
    await screen.findByLabelText(/^Decision/);
    const panel = screen.getByText('Curriculum exceptions').closest('.teacher-panel');
    fireEvent.change(within(panel).getByLabelText(/^Decision/), { target: { value: 'paused' } });
    const reason = within(panel).getByLabelText(/^Reason/);
    expect(reason.value).toBe('');
    expect(within(panel).getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('retraction collects its reason inline, never via window.prompt', async () => {
    const promptSpy = vi.fn();
    window.prompt = promptSpy;
    render(<OperationsView kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retract' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retract' }));
    const input = await screen.findByLabelText(/Retraction reason/);
    const confirm = screen.getByRole('button', { name: 'Confirm retraction' });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'authored fix landed' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(teacherWorkspaceApi.retractCurriculumException).toHaveBeenCalled());
    expect(teacherWorkspaceApi.retractCurriculumException.mock.calls[0][1]).toMatchObject({ reason: 'authored fix landed' });
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe('one home per repair panel (UX audit IA4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the curriculum-change form in exactly one place — School Operations', async () => {
    const { unmount } = render(<CurriculumView kids={KIDS} />);
    // Curriculum links to the tool rather than re-rendering it.
    expect(await screen.findByRole('link', { name: /Excuse, postpone, swap, or stop a lesson/ }))
      .toHaveAttribute('href', '/school/teacher/operations');
    expect(screen.queryAllByText('Curriculum exceptions')).toHaveLength(0);
    unmount();
    render(<OperationsView kids={KIDS} />);
    await screen.findByLabelText(/^Decision/);
    expect(screen.getAllByText('Curriculum exceptions')).toHaveLength(1);
  });

  it('keeps the curriculum-change form off the course drill-in too', async () => {
    render(<CurriculumView kids={KIDS} courseId="atlas" lessonId="u1" />);
    expect(await screen.findByRole('link', { name: /Excuse, postpone, swap, or stop a lesson/ })).toBeInTheDocument();
    expect(screen.queryAllByText('Curriculum exceptions')).toHaveLength(0);
  });

  it('keeps stuck-session clearing on School Operations only', async () => {
    const { unmount } = render(<LearnerOperationsView learnerId="learner-b" learnerName="Learner B" kids={KIDS} />);
    // The learner page points at the tool instead of hosting a second copy.
    expect(await screen.findByText('Clear a lesson that never finished')).toBeInTheDocument();
    expect(screen.queryByText(/Stuck sessions/i)).not.toBeInTheDocument();
    unmount();
    render(<OperationsView kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText(/Stuck sessions/i)).toHaveLength(1));
  });

  it('gives each workspace page the interventions index as its way in', async () => {
    render(<LearnerOperationsView learnerId="learner-b" learnerName="Learner B" kids={KIDS} />);
    expect(await screen.findByRole('link', { name: /Give credit for work you saw/ }))
      .toHaveAttribute('href', '/school/teacher/students/learner-b/operations');
  });
});
