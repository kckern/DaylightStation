/**
 * Curriculum planning — the parent decides what a learner works through.
 *
 * Two properties matter more than the rest: reassignment is adults only, and the
 * screen writes PLANNER CONFIG and nothing else. The second is asserted by
 * pinning the exact call shape — `putAssignment` with courses, units and the
 * adult who made the change, no other API surface reachable.
 *
 * `assignedBy` is not decoration. The server refuses a planning write that does
 * not name a grown-up on the roster, so a screen that stopped sending it would
 * save nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import CurriculumPlanner from '#frontend/modules/Admin/School/CurriculumPlanner.jsx';

const rosterMock = vi.fn();
const assignmentsMock = vi.fn();
const putAssignmentMock = vi.fn();

vi.mock('#frontend/modules/Admin/School/schoolAdminApi.js', () => ({
  schoolAdminApi: {
    roster: (...a) => rosterMock(...a),
    assignments: (...a) => assignmentsMock(...a),
    putAssignment: (...a) => putAssignmentMock(...a),
    teachers: async () => ({ configured: false, teachers: [] }),
  },
  default: {},
}));

const THIS_YEAR = new Date().getFullYear();
const PARENT = { id: 'dad', name: 'Papa', birthyear: THIS_YEAR - 42 };
const CHILD = { id: 'learner-1', name: 'Test Learner', birthyear: THIS_YEAR - 9 };

const record = (over = {}) => ({
  learnerId: 'learner-1',
  courses: ['math-fractions'],
  units: [{ unitId: 'art.01', elective: true }],
  updatedAt: '2026-07-27T10:00:00.000Z',
  ...over,
});

const renderPlanner = () => render(
  <MantineProvider>
    <CurriculumPlanner />
  </MantineProvider>,
);

/**
 * Wait for the editor to be fully settled — assignments loaded AND the sole
 * adult auto-selected. Waiting on entry text alone races the identity effect,
 * and the elective/priority controls only become live once it lands.
 */
const settled = (id = 'math-fractions') => screen.findByRole('button', { name: new RegExp(`Remove ${id}`, 'i') });

/** Mantine's Switch is an input with role="switch", not "checkbox". */
const electives = () => screen.getAllByRole('switch', { name: /Elective/i });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  rosterMock.mockReset().mockResolvedValue([PARENT, CHILD]);
  assignmentsMock.mockReset().mockResolvedValue({ assignments: [record()] });
  putAssignmentMock.mockReset().mockResolvedValue(record());
});

describe('CurriculumPlanner — reading a plan', () => {
  it('shows the learner\'s courses and units, and which are electives', async () => {
    renderPlanner();
    await settled();

    expect(screen.getByRole('button', { name: /Remove art.01/i })).toBeInTheDocument();
    const flags = electives();
    expect(flags).toHaveLength(2);
    expect(flags[0]).not.toBeChecked();  // the course
    expect(flags[1]).toBeChecked();      // the unit
  });

  it('numbers each entry, because order IS priority in the assignment record', async () => {
    assignmentsMock.mockResolvedValue({
      assignments: [record({ courses: ['first-course', 'second-course'] })],
    });
    renderPlanner();

    await settled('first-course');
    expect(screen.getByText(/agenda offers required work in this order/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('entry-courseId')).toHaveLength(2);
  });

  it('a learner with no record is an empty plan, not an error', async () => {
    assignmentsMock.mockResolvedValue({ assignments: [] });
    renderPlanner();

    await screen.findByText('Courses');
    expect(screen.getAllByText(/Nothing assigned/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Could not load the assignments')).toBeNull();
  });
});

describe('CurriculumPlanner — adults only', () => {
  it('a household with no adult cannot edit anything', async () => {
    rosterMock.mockResolvedValue([CHILD]);
    renderPlanner();

    await settled();
    expect(screen.getByText('No teachers configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save plan/i })).toBeDisabled();
    // The controls render, but every one of them is shut.
    expect(screen.getByRole('button', { name: /Remove math-fractions/i })).toBeDisabled();
    expect(electives()[0]).toBeDisabled();
  });

  it('a remembered child id leaves the plan read-only', async () => {
    localStorage.setItem('daylight.school.admin.gradedBy', 'learner-1');
    renderPlanner();

    await settled();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save plan/i })).toBeDisabled();
    expect(putAssignmentMock).not.toHaveBeenCalled();
  });
});

describe('CurriculumPlanner — writing a plan', () => {
  it('saves courses and units in the explicit form, so an elective flag survives', async () => {
    renderPlanner();
    await settled();

    // Flip the course to elective, which makes the plan dirty.
    fireEvent.click(electives()[0]);
    fireEvent.click(screen.getByRole('button', { name: /Save plan/i }));

    await waitFor(() => expect(putAssignmentMock).toHaveBeenCalledWith('learner-1', {
      courses: [{ courseId: 'math-fractions', elective: true }],
      units: [{ unitId: 'art.01', elective: true }],
      assignedBy: 'dad',
      pin: null,
      baseUpdatedAt: '2026-07-27T10:00:00.000Z', // arms the stale-save guard (wave 8 #19)
    }));
  });

  it('reordering an entry is the priority control', async () => {
    assignmentsMock.mockResolvedValue({
      assignments: [record({ courses: ['first-course', 'second-course'], units: [] })],
    });
    renderPlanner();
    await settled('first-course');

    fireEvent.click(screen.getByRole('button', { name: /Move second-course up/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save plan/i }));

    await waitFor(() => expect(putAssignmentMock).toHaveBeenCalledWith('learner-1', {
      courses: [
        { courseId: 'second-course', elective: false },
        { courseId: 'first-course', elective: false },
      ],
      units: [],
      assignedBy: 'dad',
      pin: null,
      baseUpdatedAt: '2026-07-27T10:00:00.000Z', // arms the stale-save guard (wave 8 #19)
    }));
  });

  it('removing an entry drops it from the saved plan', async () => {
    renderPlanner();
    await settled();

    fireEvent.click(screen.getByRole('button', { name: /Remove math-fractions/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save plan/i }));

    await waitFor(() => expect(putAssignmentMock).toHaveBeenCalledWith('learner-1', {
      courses: [],
      units: [{ unitId: 'art.01', elective: true }],
      assignedBy: 'dad',
      pin: null,
      baseUpdatedAt: '2026-07-27T10:00:00.000Z', // arms the stale-save guard (wave 8 #19)
    }));
  });

  it('the save button stays shut until something actually changed', async () => {
    renderPlanner();
    await settled();
    expect(screen.getByRole('button', { name: /Save plan/i })).toBeDisabled();
  });
});

describe('CurriculumPlanner — nothing fails quietly', () => {
  it('assignments that will not load are reported, not shown as an empty plan', async () => {
    const err = new Error('assignments store unavailable');
    err.status = 500;
    assignmentsMock.mockRejectedValue(err);
    renderPlanner();

    expect(await screen.findByText('Could not load the assignments')).toBeInTheDocument();
    expect(screen.getByText('assignments store unavailable')).toBeInTheDocument();
  });

  it('a failed save says the screen no longer matches what the console will use', async () => {
    const err = new Error('courses and units must be arrays');
    err.status = 400;
    putAssignmentMock.mockRejectedValue(err);
    renderPlanner();
    await settled();

    fireEvent.click(electives()[0]);
    fireEvent.click(screen.getByRole('button', { name: /Save plan/i }));

    expect(await screen.findByText('The plan did not save')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was saved.*courses and units must be arrays/)).toBeInTheDocument();
    expect(screen.getByText(/not what the console will use/)).toBeInTheDocument();
    // Still dirty — the parent must not think the change landed.
    expect(screen.getByText('Unsaved changes.')).toBeInTheDocument();
  });
});
