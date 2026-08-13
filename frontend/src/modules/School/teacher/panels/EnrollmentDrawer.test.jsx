import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EnrollmentDrawer from './EnrollmentDrawer.jsx';
import { schoolApi } from '../../schoolApi.js';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    enroll: vi.fn(),
    unenroll: vi.fn(),
  },
}));

// A claimed teacher, so useTeacherWrite calls straight through instead of
// opening the picker/PIN prompt.
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: 'test-pin-1234',
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));

const LEARNER = { id: 'felix', name: 'Felix' };
const SYLLABI = [
  { syllabusId: 'atlas-upper', title: 'Atlas — upper', courseId: 'history-capitals' },
  { syllabusId: 'atlas-lower', title: 'Atlas — lower', courseId: 'history-capitals' },
];

describe('EnrollmentDrawer — unenrolled cell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers only Enroll, with the course syllabus choices', () => {
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={null}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-materialize' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unenroll' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Atlas — upper' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Atlas — lower' })).toBeInTheDocument();
  });

  it('shows the empty state and disables Enroll when the course has no syllabus', () => {
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="pokemon-basics"
        cell={null}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/No syllabus published for this course yet\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeDisabled();
  });

  it('calls schoolApi.enroll with rematerialize:false, the chosen syllabus, and baseUpdatedAt threaded through', async () => {
    schoolApi.enroll.mockResolvedValue({ ok: true, status: 200, data: {} });
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={null}
        syllabi={SYLLABI}
        baseUpdatedAt="2026-08-01T00:00:00Z"
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(schoolApi.enroll).toHaveBeenCalled());
    expect(schoolApi.enroll).toHaveBeenCalledWith('felix', {
      syllabusId: 'atlas-upper',
      rematerialize: false,
      enrolledBy: 'kckern',
      pin: 'test-pin-1234',
      baseUpdatedAt: '2026-08-01T00:00:00Z',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EnrollmentDrawer — enrolled, managed cell', () => {
  beforeEach(() => vi.clearAllMocks());

  const CELL = {
    enrolled: true, syllabusId: 'atlas-upper', syllabusTitle: 'Atlas — upper',
    profile: 'upper', passing: 80, managed: true,
  };

  it('shows the facts and offers Re-materialize + Unenroll, no hand-authored note', () => {
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={CELL}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Atlas — upper').length).toBeGreaterThan(0);
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-materialize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unenroll' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enroll' })).toBeNull();
    expect(screen.queryByText(/written by hand/)).toBeNull();
  });

  it('surfaces a 409 refusal from re-materialize as a rendered error, not a silent failure', async () => {
    schoolApi.enroll.mockResolvedValue({
      ok: false, status: 409, data: { error: 'Refused: 2 open sessions on this course.' },
    });
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={CELL}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Re-materialize' }));
    await waitFor(() => expect(schoolApi.enroll).toHaveBeenCalled());
    expect(await screen.findByText('Refused: 2 open sessions on this course.')).toBeInTheDocument();
  });

  it('surfaces a 409 refusal from unenroll as a rendered error', async () => {
    schoolApi.unenroll.mockResolvedValue({
      ok: false, status: 409, data: { error: 'Refused: 1 open session on this course.' },
    });
    render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={CELL}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unenroll' }));
    await waitFor(() => expect(schoolApi.unenroll).toHaveBeenCalled());
    expect(await screen.findByText('Refused: 1 open session on this course.')).toBeInTheDocument();
  });
});

describe('EnrollmentDrawer — enrolled, hand-authored (unmanaged) cell', () => {
  beforeEach(() => vi.clearAllMocks());

  const CELL = {
    enrolled: true, syllabusId: null, syllabusTitle: null, profile: 'upper', passing: null, managed: false,
  };

  it('renders as first-class, not broken: the note, not an error, and still offers Re-materialize/Unenroll', () => {
    const { container } = render(
      <EnrollmentDrawer
        learner={LEARNER}
        courseId="history-capitals"
        cell={CELL}
        syllabi={SYLLABI}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/written by hand/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enroll' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-materialize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unenroll' })).toBeInTheDocument();
    // A DOM check, not a text-content check: `teacher-panel__error` is a CSS
    // class, never rendered text, so this must query the element tree.
    expect(container.querySelector('.teacher-panel__error')).toBeNull();
  });
});
