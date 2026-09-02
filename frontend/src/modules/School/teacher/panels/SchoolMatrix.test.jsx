import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SchoolMatrix from './SchoolMatrix.jsx';
import { deriveMatrix } from './schoolMatrixModel.js';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    allAssignments: vi.fn(), curriculumUnits: vi.fn(), syllabi: vi.fn(), enroll: vi.fn(), unenroll: vi.fn(),
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
import { schoolApi } from '../../schoolApi.js';

const KIDS = [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }];
const UNITS = [
  { unitId: 'frac.01', courseId: 'math-fractions' },
  { unitId: 'caps.01', courseId: 'history-capitals' },
  { unitId: 'poke.01', courseId: 'creature-basics' },
];

describe('deriveMatrix (admin advocacy A4 — the bird\'s-eye view)', () => {
  it('rows per kid, columns per published course, assignment dots where they meet', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      assignments: [
        { learnerId: 'user_4', courses: ['math-fractions', { courseId: 'history-capitals', elective: true }] },
        { learnerId: 'user_2', courses: ['math-fractions'] },
      ],
    });
    expect(m.courseIds).toEqual(['creature-basics', 'history-capitals', 'math-fractions']);
    expect([...m.rows[0].assigned].sort()).toEqual(['history-capitals', 'math-fractions']);
    expect(m.unenrolled).toEqual(['creature-basics']); // zero-enrollment flag
  });

  it('flags DEAD references — an assigned course the catalog no longer publishes', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      assignments: [{ learnerId: 'user_4', courses: ['math-fractions', 'ghost-course'] }],
    });
    expect(m.rows[0].deadRefs).toEqual(['ghost-course']);
  });

  it('flags ORPHAN assignment records — ids not on the roster still holding courses', () => {
    const m = deriveMatrix({
      kids: KIDS,
      units: UNITS,
      assignments: [{ learnerId: 'departed-kid', courses: ['math-fractions'] }],
    });
    expect(m.orphanLearners).toEqual(['departed-kid']);
  });
});

describe('deriveMatrix — enrollment cells', () => {
  const SYLLABI = [{ syllabusId: 'atlas-upper', title: 'Atlas — upper', courseId: 'history-capitals' }];

  it('names the syllabus and profile in the cell', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{
        learnerId: 'user_4',
        courses: [{ courseId: 'history-capitals', profile: 'upper', syllabusId: 'atlas-upper', enrollment: { schema: 'school.course-enrollment/v1' } }],
      }],
    });
    const cell = m.rows[0].cells['history-capitals'];
    expect(cell).toMatchObject({
      enrolled: true, syllabusId: 'atlas-upper', syllabusTitle: 'Atlas — upper', profile: 'upper', managed: true, hasEnrollment: true,
    });
  });

  it('marks a hand-authored enrollment as unmanaged rather than broken', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{ learnerId: 'user_4', courses: [{ courseId: 'history-capitals', profile: 'upper', enrollment: { schema: 'school.course-enrollment/v1' } }] }],
    });
    expect(m.rows[0].cells['history-capitals']).toMatchObject({
      enrolled: true, managed: false, profile: 'upper', hasEnrollment: true,
    });
  });

  // The unmanaged (⚑) flag must fire ONLY for an entry that genuinely carries
  // an `enrollment` block without a `syllabusId` — not for every plain
  // bare-string course, which is most entries in real data. This pins the
  // three-way distinction: no enrollment at all, an unmanaged enrollment, and
  // a managed one.
  it('distinguishes hasEnrollment from managed across the three cell shapes', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: SYLLABI,
      assignments: [{
        learnerId: 'user_4',
        courses: [
          'math-fractions',
          { courseId: 'history-capitals', profile: 'upper', enrollment: { schema: 'school.course-enrollment/v1' } },
          { courseId: 'creature-basics', profile: 'lower', syllabusId: 'atlas-upper', enrollment: { schema: 'school.course-enrollment/v1' } },
        ],
      }],
    });
    // Bare string: enrolled (assigned), but no enrollment block at all — must
    // NOT read as unmanaged since it was never materialized in the first place.
    expect(m.rows[0].cells['math-fractions']).toMatchObject({ hasEnrollment: false, managed: false });
    // Object with an enrollment block but no syllabusId — the genuine
    // hand-authored case the ⚑ flag exists for.
    expect(m.rows[0].cells['history-capitals']).toMatchObject({ hasEnrollment: true, managed: false });
    // Object with both — fully managed, never flagged.
    expect(m.rows[0].cells['creature-basics']).toMatchObject({ hasEnrollment: true, managed: true });
  });

  it('treats a bare-string course as enrolled with no enrollment record', () => {
    const m = deriveMatrix({
      kids: KIDS, units: UNITS, syllabi: [],
      assignments: [{ learnerId: 'user_2', courses: ['math-fractions'] }],
    });
    expect(m.rows[1].cells['math-fractions']).toMatchObject({ enrolled: true, managed: false, hasEnrollment: false, syllabusId: null });
  });

  it('leaves an unassigned intersection absent from cells', () => {
    const m = deriveMatrix({ kids: KIDS, units: UNITS, syllabi: [], assignments: [] });
    expect(m.rows[0].cells['math-fractions']).toBeUndefined();
  });
});

describe('SchoolMatrix — transposed render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.allAssignments.mockResolvedValue({ ok: true, status: 200, data: { assignments: [
      { learnerId: 'user_4', courses: [{ courseId: 'history-capitals', syllabusId: 'atlas-upper', profile: 'upper', enrollment: {} }] },
    ] } });
    schoolApi.curriculumUnits.mockResolvedValue({ ok: true, status: 200, data: { units: [
      { unitId: 'caps.01', courseId: 'history-capitals', courseTitle: 'History Capitals' },
      { unitId: 'poke.01', courseId: 'creature-basics', courseTitle: 'Creature Basics' },
    ] } });
    schoolApi.syllabi.mockResolvedValue({ ok: true, status: 200, data: { syllabi: [
      { syllabusId: 'atlas-upper', title: 'Atlas — upper', courseId: 'history-capitals' },
    ] } });
  });

  it('renders courses as rows and students as columns, with a legend', async () => {
    render(<SchoolMatrix kids={[{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }]} />);
    await waitFor(() => expect(screen.getByTestId('school-matrix')).toBeInTheDocument());
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Course', 'User_4', 'User_2']);
    const rowHeaders = screen.getAllByRole('rowheader').map((th) => th.textContent);
    expect(rowHeaders).toEqual(['Creature Basics', 'History Capitals']);
    expect(screen.getByText('⚑ hand-authored enrollment · — not enrolled')).toBeInTheDocument();
    expect(screen.getByText(/Atlas — upper · upper/)).toBeInTheDocument();
    // The old run-on text wall is gone; the unassigned note counts instead.
    expect(screen.queryByText(/Nobody is enrolled in/)).toBeNull();
    expect(screen.getByTestId('matrix-unenrolled').textContent).toMatch(/Unassigned courses \(1\)/);
  });

  it('an unenrolled intersection renders — and still opens the drawer', async () => {
    render(<SchoolMatrix kids={[{ id: 'user_4', name: 'User_4' }]} />);
    await waitFor(() => expect(screen.getByTestId('school-matrix')).toBeInTheDocument());
    const cell = screen.getByRole('button', { name: 'User_4, Creature Basics' });
    expect(cell.textContent).toBe('—');
  });
});
