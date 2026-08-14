import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import PlanningTab from './PlanningTab.jsx';
import { TeacherProfileProvider } from '../TeacherProfileContext.jsx';
import PinPrompt from '../panels/PinPrompt.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    teachers: vi.fn(),
    assignments: vi.fn(),
    allAssignments: vi.fn(async () => ({ ok: true, status: 200, data: { assignments: [] } })),
    putAssignments: vi.fn(),
    periods: vi.fn(),
    putPeriods: vi.fn(),
    curriculumUnits: vi.fn(),
    syllabi: vi.fn(),
    periodsMeta: vi.fn(),
    attestations: vi.fn(async () => ({ ok: true, status: 200, data: { entries: [] } })),
    passOverrides: vi.fn(),
    putPassOverride: vi.fn(),
    milestones: vi.fn(),
    putMilestones: vi.fn(),
    enrichment: vi.fn(),
    postEnrichment: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

const mount = (ui) => render(<TeacherProfileProvider>{ui}<PinPrompt /></TeacherProfileProvider>);

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessionStorage.setItem('school-teacher-claim', 'kckern');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }));
  schoolApi.assignments.mockResolvedValue(ok({
    learnerId: 'felix', courses: ['math-fractions'], units: ['language-daily'], assignedBy: 'kckern', updatedAt: '2026-08-01T00:00:00Z',
  }));
  schoolApi.putAssignments.mockResolvedValue(ok({ learnerId: 'felix' }));
  schoolApi.periods.mockResolvedValue(ok([
    // The LIVE calendar's instants carry a timezone-offset time-of-day
    // (midnight LA = T07:00Z) — the editor must round-trip them verbatim.
    { periodId: '2026-spring', kind: 'semester', label: 'Spring 2026', startsAt: '2026-01-05T07:00:00.000Z', endsAt: '2026-06-12T07:00:00.000Z' },
    { periodId: '2026-fall', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T07:00:00.000Z' },
  ]));
  schoolApi.putPeriods.mockResolvedValue(ok({ periods: [] }));
  schoolApi.periodsMeta.mockResolvedValue(ok({ historyLength: 2 }));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [
    { unitId: 'math-fractions.02', title: 'Adding Fractions', subject: 'math', courseId: 'math-fractions', sequence: 2, hasBank: true, passingPercent: 80 },
    { unitId: 'math-fractions.01', title: 'What Is a Fraction', subject: 'math', courseId: 'math-fractions', sequence: 1, hasBank: true, passingPercent: 80 },
    { unitId: 'language-daily', title: 'Daily Language', subject: 'language', courseId: null, sequence: null, hasBank: false, passingPercent: null },
  ] }));
  schoolApi.syllabi.mockResolvedValue(ok({ syllabi: [] }));
  schoolApi.passOverrides.mockResolvedValue(ok({ overrides: { 'math-fractions.01': 65 } }));
  schoolApi.putPassOverride.mockResolvedValue(ok({ unitId: 'math-fractions.01', percent: 60 }));
  schoolApi.milestones.mockResolvedValue(ok({ milestones: [
    { id: 'm1', learnerId: 'felix', courseId: 'math-fractions', unitId: 'math-fractions.02', dueBy: '2026-10-01', status: 'upcoming' },
  ] }));
  schoolApi.putMilestones.mockResolvedValue(ok({ milestones: [] }));
  schoolApi.enrichment.mockResolvedValue(ok({ entries: [
    { id: 'enr_1', title: 'Yellowstone trip', from: '2026-08-10', to: '2026-08-14', learnerIds: ['felix'], subjectIds: ['science'], recordedBy: 'kckern' },
  ] }));
  schoolApi.postEnrichment.mockResolvedValue(ok({ entry: { id: 'enr_2' } }));
});

describe('PlanningTab (wave 3, all live)', () => {
  it('renders assignments and offers edit; saving PUTs with the stamp and pin', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText('Math Fractions').length).toBeGreaterThan(0));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit assignments' })); });
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(schoolApi.putAssignments).toHaveBeenCalledWith('felix',
      expect.objectContaining({
        courses: ['math-fractions'], units: ['language-daily'], assignedBy: 'kckern', pin: null,
        baseUpdatedAt: '2026-08-01T00:00:00Z', // the B14 concurrent-edit guard
      })));
    await waitFor(() => expect(schoolApi.assignments.mock.calls.length).toBeGreaterThan(1));
  });

  it('an assignments 404 still offers Edit (empty, never an error)', async () => {
    schoolApi.assignments.mockResolvedValue(fail(404));
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    const assignmentsSection = screen.getByRole('heading', { name: 'Assignments' }).closest('section');
    await waitFor(() => expect(within(assignmentsSection).getByText(/Nothing assigned to/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Edit assignments' })).toBeTruthy();
  });

  it('an untouched save round-trips the ORIGINAL instants verbatim — no boundary shift', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Fall 2026')).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit periods' })); });
    await waitFor(() => expect(screen.getByLabelText('Ends 1')).toBeTruthy()); // editor rows loaded (startEditing awaits the baseline)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(schoolApi.putPeriods).toHaveBeenCalledWith(expect.objectContaining({
      editedBy: 'kckern',
      baseHistoryLength: 2, // the B14 baseline travels
      periods: expect.arrayContaining([expect.objectContaining({
        periodId: '2026-fall', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T07:00:00.000Z',
      })]),
    })));
  });

  it('an edited date keeps the original time-of-day suffix', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Fall 2026')).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit periods' })); });
    await waitFor(() => expect(screen.getByLabelText('Ends 1')).toBeTruthy());
    act(() => { fireEvent.change(screen.getByLabelText('Ends 1'), { target: { value: '2026-12-20' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(schoolApi.putPeriods).toHaveBeenCalledWith(expect.objectContaining({
      periods: expect.arrayContaining([expect.objectContaining({
        periodId: '2026-fall', endsAt: '2026-12-20T07:00:00.000Z',
      })]),
    })));
  });

  it('shows the effective pass percent with the override marked, and sets one through the gate', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('pass 65%')).toBeTruthy()); // override wins over 80
    expect(screen.getAllByText('pass 80%').length).toBe(1); // the unoverridden unit
    act(() => {
      fireEvent.change(screen.getByLabelText('Pass override for math-fractions.02'), { target: { value: '70' } });
    });
    const row = screen.getByLabelText('Pass override for math-fractions.02').closest('li');
    const { getByRole } = await import('@testing-library/react').then((m) => ({ getByRole: (r, o) => m.within(row).getByRole(r, o) }));
    act(() => { fireEvent.click(getByRole('button', { name: 'Set' })); });
    await waitFor(() => expect(schoolApi.putPassOverride).toHaveBeenCalledWith('math-fractions.02',
      expect.objectContaining({ percent: 70, editedBy: 'kckern' })));
  });

  it('milestones render status chips and save learner-scoped', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('upcoming')).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Edit milestones' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(schoolApi.putMilestones).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'felix',
      milestones: [expect.objectContaining({ id: 'm1', unitId: 'math-fractions.02', dueBy: '2026-10-01' })],
    })));
  });

  it('enrichment lists entries and records a new one with learners and subjects', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Yellowstone trip')).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Record enrichment' })); });
    act(() => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Museum day' } });
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Felix' }));
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(schoolApi.postEnrichment).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Museum day', from: '2026-09-01', learnerIds: ['felix'], recordedBy: 'kckern',
    })));
  });

  it('no learner selected: household panels still render, learner panels prompt', async () => {
    mount(<PlanningTab learnerId={null} kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.assignments).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Fall 2026')).toBeTruthy());
  });

  it('carries no stubs — every planning use case is live', async () => {
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('Fall 2026')).toBeTruthy());
    expect(document.querySelectorAll('[data-todo]').length).toBe(0);
  });

  it('standalone units handles object-form entries with unitId property', async () => {
    schoolApi.assignments.mockResolvedValue(ok({
      learnerId: 'felix', courses: ['math-fractions'], units: ['language-daily', { unitId: 'poetry-study' }], assignedBy: 'kckern', updatedAt: '2026-08-01T00:00:00Z',
    }));
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    const standaloneSection = screen.getByRole('heading', { name: 'Standalone work' }).closest('section');
    await waitFor(() => {
      expect(within(standaloneSection).getByText('Language Daily')).toBeTruthy();
      expect(within(standaloneSection).getByText('Poetry Study')).toBeTruthy();
    });
  });

  it('standalone units shows empty state when learner has courses but no standalone work', async () => {
    schoolApi.assignments.mockResolvedValue(ok({
      learnerId: 'felix', courses: ['math-fractions'], units: [], assignedBy: 'kckern', updatedAt: '2026-08-01T00:00:00Z',
    }));
    mount(<PlanningTab learnerId="felix" kids={KIDS} />);
    const standaloneSection = screen.getByRole('heading', { name: 'Standalone work' }).closest('section');
    await waitFor(() => {
      expect(within(standaloneSection).getByText('Nothing assigned outside a course.')).toBeTruthy();
      expect(standaloneSection).toHaveAttribute('data-state', 'empty');
    });
  });
});
