/**
 * Regression test for the wrong-course enrollment bug (task-9 review finding
 * 1): the matrix has no backdrop over the drawer, so a teacher can click a
 * second cell while the drawer for a first cell is still open. Without a
 * `key` on <EnrollmentDrawer> tied to the open target, React reuses the same
 * component instance across that click and the drawer's `choice` state
 * (initialized once from the FIRST cell's syllabus) survives into the second
 * cell's submit — silently enrolling the learner in the wrong course, since
 * `schoolApi.enroll` takes only a `syllabusId`, not a `courseId`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SchoolMatrix from './SchoolMatrix.jsx';
import { schoolApi } from '../../schoolApi.js';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    allAssignments: vi.fn(),
    curriculumUnits: vi.fn(),
    syllabi: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
  },
}));

vi.mock('../TeacherProfileContext.jsx', () => ({
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

const KIDS = [{ id: 'felix', name: 'Felix' }];

describe('SchoolMatrix — switching the open cell without a key remount (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.allAssignments.mockResolvedValue({ ok: true, status: 200, data: { assignments: [] } });
    schoolApi.curriculumUnits.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        units: [
          { unitId: 'x-unit', courseId: 'course-x' },
          { unitId: 'y-unit', courseId: 'course-y' },
        ],
      },
    });
    schoolApi.syllabi.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        syllabi: [
          { syllabusId: 'syl-x', title: 'Syllabus X', courseId: 'course-x' },
          { syllabusId: 'syl-y', title: 'Syllabus Y', courseId: 'course-y' },
        ],
      },
    });
    schoolApi.enroll.mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  it('enrolls the learner in the SECOND clicked course, not a leftover choice from the first', async () => {
    render(<SchoolMatrix kids={KIDS} />);

    await waitFor(() => expect(schoolApi.allAssignments).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('school-matrix')).toBeInTheDocument());

    // Open the drawer on course-x.
    fireEvent.click(screen.getByRole('button', { name: 'Felix, Course X' }));
    await waitFor(() => expect(screen.getByTestId('enrollment-drawer')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Syllabus X' })).toBeInTheDocument();

    // Without touching the select, click a DIFFERENT cell — the matrix table
    // has no backdrop, so this is reachable while the drawer is still open.
    fireEvent.click(screen.getByRole('button', { name: 'Felix, Course Y' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Syllabus Y' })).toBeInTheDocument());

    // Submit immediately.
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }));

    await waitFor(() => expect(schoolApi.enroll).toHaveBeenCalled());
    const [, body] = schoolApi.enroll.mock.calls[0];
    expect(body.syllabusId).toBe('syl-y');
  });
});
