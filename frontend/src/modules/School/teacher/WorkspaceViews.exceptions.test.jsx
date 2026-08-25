import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OperationsView } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    curriculumUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [
      { unitId: 'u1', title: 'Illinois', courseId: 'atlas', courseTitle: 'Atlas' },
    ] } })),
    allAssignments: vi.fn(async () => ({ ok: true, status: 200, data: { assignments: [] } })),
    syllabi: vi.fn(async () => ({ ok: true, status: 200, data: { syllabi: [] } })),
    periods: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    regradeAttempts: vi.fn(),
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
vi.mock('./panels/StaleSessions.jsx', () => ({ default: () => null }));
vi.mock('./panels/ActiveOverrides.jsx', () => ({ default: () => null }));
vi.mock('./panels/PeriodsTimeline.jsx', () => ({ default: () => null }));
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

const KIDS = [{ id: 'milo', name: 'Milo' }];

describe('CurriculumExceptionPanel neutral defaults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts on Choose… for decision and reason, Preview disabled, destructive option last', async () => {
    render(<OperationsView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Curriculum exceptions')).toBeTruthy());
    const decision = screen.getByLabelText(/^Decision/);
    expect(decision.value).toBe('');
    const options = within(decision).getAllByRole('option');
    expect(options[0].textContent).toBe('Choose…');
    expect(options.at(-1).textContent).toBe('Paused globally');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('choosing Paused globally leaves reason on Choose… until picked', async () => {
    render(<OperationsView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Curriculum exceptions')).toBeTruthy());
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
