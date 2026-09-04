import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AssignmentsView from './AssignmentsView.jsx';
import { mergeEntries } from './assignmentEntries.js';
import { schoolApi } from '../../schoolApi.js';

// Mock the API
vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    assignments: vi.fn(),
    curriculumUnits: vi.fn(),
    putAssignments: vi.fn(),
  },
}));

// Mock useTeacherProfile to provide a claimed teacher
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

const ENROLLED = {
  courseId: 'young-peoples-atlas-us',
  profile: 'upper',
  enrollment: {
    schema: 'school.course-enrollment/v1',
    enrollmentId: 'enr-user_4-young-peoples-atlas-us',
    courseId: 'young-peoples-atlas-us',
    profile: 'upper',
    moduleOrder: ['united-states', 'midwest'],
    optionalModules: ['bonus'],
    lessonOrder: { midwest: ['atlas-us-p012-midwest'] },
  },
};

describe('mergeEntries — a save must never flatten an enrollment', () => {
  it('keeps the whole object entry for a course that stays checked', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us'], 'courseId');
    expect(out).toEqual([ENROLLED]);
    expect(out[0].enrollment.lessonOrder.midwest).toEqual(['atlas-us-p012-midwest']);
  });

  it('drops an entry the teacher unchecked', () => {
    expect(mergeEntries([ENROLLED], [], 'courseId')).toEqual([]);
  });

  it('adds a newly checked id as a bare string', () => {
    const out = mergeEntries([ENROLLED], ['young-peoples-atlas-us', 'math-fractions'], 'courseId');
    expect(out).toEqual([ENROLLED, 'math-fractions']);
  });

  it('preserves a bare string entry as a bare string', () => {
    expect(mergeEntries(['math-fractions'], ['math-fractions'], 'courseId')).toEqual(['math-fractions']);
  });

  it('preserves unknown fields on an object entry it does not understand', () => {
    const odd = { courseId: 'x', elective: true, somethingNew: 42 };
    expect(mergeEntries([odd], ['x'], 'courseId')).toEqual([odd]);
  });
});

describe('AssignmentsView — the enrolled note points at its actual source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CATALOG = {
    ok: true,
    status: 200,
    data: {
      units: [
        { unitId: 'atlas-unit-1', courseId: 'young-peoples-atlas-us', courseTitle: 'Young People’s Atlas of the US' },
      ],
    },
  };

  it('names the syllabus and links to the syllabi panel on the Curriculum page, for a managed enrollment', async () => {
    schoolApi.assignments.mockResolvedValue({
      ok: true,
      status: 200,
      data: { courses: [{ ...ENROLLED, syllabusId: 'atlas-upper' }], units: [], updatedAt: '2026-08-13T00:00:00Z' },
    });
    schoolApi.curriculumUnits.mockResolvedValue(CATALOG);

    render(<AssignmentsView learnerId="user_4" learnerName="User_4" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit assignments/i }));

    const note = await screen.findByText(/has an enrollment — order, profile, and pass bar come from its syllabus/);
    expect(note).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Curriculum → Syllabi' });
    expect(link).toHaveAttribute('href', '/school/teacher/curriculum');
    // The old dead-end sentence is gone.
    expect(screen.queryByText(/edited from The whole school/)).toBeNull();
  });

  it('names it hand-authored and links nowhere when the enrollment carries no syllabusId', async () => {
    schoolApi.assignments.mockResolvedValue({
      ok: true,
      status: 200,
      data: { courses: [ENROLLED], units: [], updatedAt: '2026-08-13T00:00:00Z' },
    });
    schoolApi.curriculumUnits.mockResolvedValue(CATALOG);

    render(<AssignmentsView learnerId="user_4" learnerName="User_4" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit assignments/i }));

    expect(await screen.findByText(/has a hand-authored enrollment — order, profile, and pass bar were set directly on the record/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Curriculum → Syllabi' })).toBeNull();
  });
});

describe('AssignmentsView — the rendered component preserves enrollments on save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves assignedBy to a display name, never the raw user id', async () => {
    schoolApi.assignments.mockResolvedValue({
      ok: true, status: 200,
      data: { courses: [ENROLLED], units: [], assignedBy: 'kckern', updatedAt: '2026-08-13T00:00:00Z' },
    });
    schoolApi.curriculumUnits.mockResolvedValue({ ok: true, status: 200, data: { units: [] } });
    render(<AssignmentsView learnerId="user_4" learnerName="User_4" />);
    await waitFor(() => expect(screen.getByText('Assigned by KC')).toBeTruthy());
    expect(screen.queryByText('Assigned by kckern')).toBeNull();
  });

  it('round-trips an enrolled course unchanged when saved without edits', async () => {
    // Set up: learner has one enrolled course + catalog has courses available
    schoolApi.assignments.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        courses: [ENROLLED],
        units: [],
        updatedAt: '2026-08-13T00:00:00Z',
      },
    });

    schoolApi.curriculumUnits.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        units: [
          { unitId: 'math-fractions', courseId: 'math-fractions' },
          { unitId: 'atlas-unit-1', courseId: 'young-peoples-atlas-us', courseTitle: 'Young People’s Atlas of the US' },
        ],
      },
    });

    schoolApi.putAssignments.mockResolvedValue({
      ok: true,
      status: 200,
      data: null,
    });

    render(<AssignmentsView learnerId="user_4" learnerName="User_4" />);

    // Wait for data to load
    await waitFor(() => {
      expect(schoolApi.assignments).toHaveBeenCalled();
    });

    // Verify the enrolled course is displayed (not flattened to a string)
    await waitFor(() => {
      expect(screen.getByText(/Young People’s Atlas of the US/i)).toBeInTheDocument();
    });

    // Click Edit
    const editButton = screen.getByRole('button', { name: /Edit assignments/i });
    fireEvent.click(editButton);

    // Verify edit mode is active (we see checkboxes)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Young People’s Atlas of the US/i })).toBeInTheDocument();
    });

    // Click Save without making any changes
    const saveButton = screen.getByRole('button', { name: /Save/i });
    fireEvent.click(saveButton);

    // Wait for the putAssignments call to complete
    await waitFor(() => {
      expect(schoolApi.putAssignments).toHaveBeenCalled();
    });

    // Assert that putAssignments was called with the ENROLLED object intact
    const callArgs = schoolApi.putAssignments.mock.calls[0][1];
    expect(callArgs.courses).toHaveLength(1);
    expect(callArgs.courses[0]).toEqual(ENROLLED);
    // Specifically verify the deep enrollment block was not flattened
    expect(callArgs.courses[0].enrollment).toBeDefined();
    expect(callArgs.courses[0].enrollment.lessonOrder.midwest).toEqual(['atlas-us-p012-midwest']);
  });

  it('round-trips a piano video cap when another assignment is saved', async () => {
    const piano = {
      programId: 'piano-course', corpusId: 'plex:123', courseId: 'plex:123',
      subject: 'arts', videosLockedAfter: 2,
    };
    schoolApi.assignments.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        courses: [], units: [], programs: [piano], updatedAt: '2026-09-03T00:00:00Z',
      },
    });
    schoolApi.curriculumUnits.mockResolvedValue({
      ok: true, status: 200, data: { units: [{ unitId: 'math-1', subject: 'math' }] },
    });
    schoolApi.putAssignments.mockResolvedValue({ ok: true, status: 200, data: null });

    render(<AssignmentsView learnerId="user_4" learnerName="User_4" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit assignments/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(schoolApi.putAssignments).toHaveBeenCalled());

    expect(schoolApi.putAssignments.mock.calls[0][1].programs).toEqual([piano]);
  });
});
