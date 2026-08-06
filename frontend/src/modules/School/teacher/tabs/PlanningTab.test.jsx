import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PlanningTab from './PlanningTab.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    assignments: vi.fn(),
    periods: vi.fn(),
    curriculumUnits: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.assignments.mockResolvedValue(ok({
    learnerId: 'felix', courses: ['math-fractions'], units: ['language-daily'], assignedBy: 'kckern', updatedAt: '2026-08-01T00:00:00Z',
  }));
  schoolApi.periods.mockResolvedValue(ok([
    { periodId: '2026-spring', kind: 'semester', label: 'Spring 2026', startsAt: '2026-01-05T00:00:00.000Z', endsAt: '2026-06-12T00:00:00.000Z' },
    { periodId: '2026-fall', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z' },
  ]));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [
    { unitId: 'math-fractions.02', title: 'Adding Fractions', subject: 'math', courseId: 'math-fractions', sequence: 2, hasBank: true },
    { unitId: 'math-fractions.01', title: 'What Is a Fraction', subject: 'math', courseId: 'math-fractions', sequence: 1, hasBank: true },
    { unitId: 'language-daily', title: 'Daily Language', subject: 'language', courseId: null, sequence: null, hasBank: false },
  ] }));
});

describe('PlanningTab', () => {
  it('renders assignments for the selected learner', async () => {
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText('math-fractions').length).toBeGreaterThan(0));
    expect(screen.getAllByText('language-daily').length).toBeGreaterThan(0);
    expect(screen.getByText(/Assigned by kckern/)).toBeTruthy();
  });

  it('an assignments 404 is "nothing assigned", never an error', async () => {
    schoolApi.assignments.mockResolvedValue(fail(404));
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Nothing assigned/)).toBeTruthy());
    expect(screen.queryByText(/couldn.t load/i)).toBe(null);
  });

  it('no learner selected prompts for a pick instead of fetching', async () => {
    render(<PlanningTab learnerId={null} kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.assignments).not.toHaveBeenCalled();
  });

  it('marks the current period on the timeline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00Z'));
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText('Fall 2026').closest('[data-current]')).toBeTruthy());
    expect(screen.getByText('Spring 2026').closest('[data-current]')).toBe(null);
    vi.useRealTimers();
  });

  it('groups curriculum units by course in sequence order', async () => {
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('What Is a Fraction')).toBeTruthy());
    const titles = [...document.querySelectorAll('.teacher-curriculum__unit-title')].map((el) => el.textContent);
    expect(titles.indexOf('What Is a Fraction')).toBeLessThan(titles.indexOf('Adding Fractions'));
    expect(screen.getByText('Daily Language')).toBeTruthy();
  });

  it('curriculum 404 renders the unavailable posture, not an error', async () => {
    schoolApi.curriculumUnits.mockResolvedValue(fail(404));
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/curriculum catalog isn.t available on this install/i)).toBeTruthy());
  });

  it('carries its five stubs', async () => {
    render(<PlanningTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(document.querySelectorAll('[data-todo]').length).toBe(5));
  });
});
