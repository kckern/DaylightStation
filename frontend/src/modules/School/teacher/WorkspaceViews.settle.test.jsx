/**
 * "Settle this by hand" — the session inspector's way out for work that came
 * back and never finished marking (task 1.3).
 *
 * Two things are worth testing here and nothing else is: WHEN the section is
 * offered (it must be exactly the complement of the stuck-session panel's
 * Abandon, or a teacher meets two surfaces that both decline to help), and
 * WHAT one tap of "Settle it" actually does — note, then mark, then close, in
 * that order, with the step-up grant on the mark.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionInspector } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    offerRetake: vi.fn(),
    postTeacherNote: vi.fn(async () => ({ ok: true, status: 201, data: { entry: {} } })),
    gradeSession: vi.fn(async () => ({ ok: true, status: 200, data: { status: 'graded' } })),
    closeSession: vi.fn(async () => ({ ok: true, status: 200, data: { status: 'settled' } })),
  },
}));
vi.mock('./teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
    session: vi.fn(),
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
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: 'grant-1' })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));
import { schoolApi } from '../schoolApi.js';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

const KIDS = [{ id: 'learner-b', name: 'Learner B' }];

const sessionAt = (state, extra = {}) => ({
  schema: 'school.teacher-session/v4',
  sessionId: 'ses_1',
  revision: 3,
  state: { sessionId: 'ses_1', learnerId: 'learner-b', state, terminal: false, ...extra },
  taxonomy: { subject: 'math', lessonTitle: 'Fractions' },
  scores: { machine: null, effective: null },
  artifacts: [],
  events: [],
});

const heading = () => screen.queryByText('Settle this by hand');

async function renderAt(state, extra) {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: sessionAt(state, extra) });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByText('Outcome')).toBeInTheDocument());
}

describe('SessionInspector — settle this by hand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restated per test, not just at declaration: a `mockResolvedValue` in one
    // case would otherwise be the default for every case after it.
    schoolApi.postTeacherNote.mockResolvedValue({ ok: true, status: 201, data: { entry: {} } });
    schoolApi.gradeSession.mockResolvedValue({ ok: true, status: 200, data: { status: 'graded' } });
    schoolApi.closeSession.mockResolvedValue({ ok: true, status: 200, data: { status: 'settled' } });
  });

  it('offers the section for work that came back and never finished', async () => {
    await renderAt('submitted');
    expect(heading()).toBeInTheDocument();
    expect(screen.getByText('This lesson came back but never finished marking. Record what it earned and close it out.')).toBeInTheDocument();
  });

  it('offers it for a session marked but never closed out', async () => {
    await renderAt('graded');
    expect(heading()).toBeInTheDocument();
  });

  it.each(['created', 'issued', 'reprinted', 'media_dispatched'])(
    'shows nothing at all for %s — that is abandoned, not settled', async (state) => {
      await renderAt(state);
      expect(heading()).not.toBeInTheDocument();
      // Not a disabled button either: an affordance that can never fire is a
      // question a teacher has to answer for nothing.
      expect(screen.queryByRole('button', { name: 'Preview settlement' })).not.toBeInTheDocument();
    },
  );

  it('shows nothing for a session that is already finished', async () => {
    await renderAt('rewarded', { terminal: true });
    expect(heading()).not.toBeInTheDocument();
  });

  it('will not preview or settle until a reason is written', async () => {
    await renderAt('submitted');
    const preview = screen.getByRole('button', { name: 'Preview settlement' });
    expect(preview).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Marked on paper at the table.' } });
    expect(preview).toBeEnabled();
    // Still nothing has been written — the first tap only previews.
    fireEvent.click(preview);
    expect(schoolApi.gradeSession).not.toHaveBeenCalled();
    expect(schoolApi.closeSession).not.toHaveBeenCalled();
    expect(schoolApi.postTeacherNote).not.toHaveBeenCalled();
    expect(screen.getByText(/Learner B gets your note/)).toBeInTheDocument();
  });

  it('marks it, tells the child why, then closes it — and refetches', async () => {
    await renderAt('submitted');
    const reads = teacherWorkspaceApi.session.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Marked on paper at the table.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));

    await waitFor(() => expect(schoolApi.closeSession).toHaveBeenCalled());
    expect(schoolApi.postTeacherNote).toHaveBeenCalledWith({
      learnerId: 'learner-b', note: 'Marked on paper at the table.', from: 'kckern', pin: null,
    });
    expect(schoolApi.gradeSession).toHaveBeenCalledWith('ses_1', {
      gradedBy: 'kckern', pin: null, settle: true, settledBy: 'kckern',
    }, 'grant-1');
    expect(schoolApi.closeSession).toHaveBeenCalledWith('ses_1', { pin: null });
    // The inspector re-reads the session, so the state it shows is the one on
    // the server rather than the one the form assumed it produced.
    await waitFor(() => expect(teacherWorkspaceApi.session.mock.calls.length).toBeGreaterThan(reads));
  });

  it('treats an already-marked session as marked and still closes it', async () => {
    schoolApi.gradeSession.mockResolvedValue({ ok: false, status: 409, data: { status: 'duplicate', message: 'That work has already been marked.' } });
    await renderAt('graded');
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Already marked by hand.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(schoolApi.closeSession).toHaveBeenCalled());
    expect(screen.queryByText(/didn’t go through/)).not.toBeInTheDocument();
  });

  it('does not close a session whose questions are still waiting on a person', async () => {
    // `awaiting_review` comes back 200 and `ok`. Closing on the strength of
    // that reports "not marked yet" and blames the close for the grade's
    // refusal, so the sequence stops here and says what is actually wrong.
    schoolApi.gradeSession.mockResolvedValue({ ok: true, status: 200, data: { status: 'awaiting_review', message: 'A grown-up still has some of this to check.' } });
    await renderAt('submitted');
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Closing this out.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(screen.getByText(/A grown-up still has some of this to check/)).toBeInTheDocument());
    expect(schoolApi.closeSession).not.toHaveBeenCalled();
  });

  // The reason the note moved behind the grade. A refused grade means no
  // decision was taken about this child, so they must not read a sentence
  // describing a settlement that did not happen.
  it('says nothing to the child when the marking refuses', async () => {
    schoolApi.gradeSession.mockResolvedValue({ ok: false, status: 404, data: { status: 'unavailable', message: 'There were questions on that one, but none of them could be marked.' } });
    await renderAt('submitted');
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Every question was voided.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(screen.getByText(/none of them could be marked/)).toBeInTheDocument());
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(schoolApi.postTeacherNote).not.toHaveBeenCalled();
    expect(schoolApi.closeSession).not.toHaveBeenCalled();
  });

  // Keyed to the SESSION, not the reason text: rewording at a dead end and
  // trying again must not send the child a second note.
  it('sends one note however many times a settle is retried', async () => {
    schoolApi.closeSession.mockResolvedValue({ ok: false, status: 404, data: { status: 'unavailable', message: 'That work has not been marked yet.' } });
    await renderAt('submitted');
    const reason = screen.getByLabelText('Settlement reason');
    fireEvent.change(reason, { target: { value: 'First wording.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(schoolApi.postTeacherNote).toHaveBeenCalledTimes(1));

    fireEvent.change(reason, { target: { value: 'Second, clearer wording.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(schoolApi.closeSession).toHaveBeenCalledTimes(2));
    expect(schoolApi.postTeacherNote).toHaveBeenCalledTimes(1);
  });

  it('does not claim a settle when only the marking half landed', async () => {
    schoolApi.closeSession.mockResolvedValue({ ok: false, status: 404, data: { status: 'unavailable', message: 'That work has not been marked yet.' } });
    await renderAt('submitted');
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Scan came back empty.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(screen.getByText(/closing it out didn’t go through/)).toBeInTheDocument());
    expect(screen.getByText(/That work has not been marked yet/)).toBeInTheDocument();
  });

  it('does not close anything out when the child could not be told why', async () => {
    schoolApi.postTeacherNote.mockResolvedValue({ ok: false, status: 500, data: { error: 'internal' } });
    await renderAt('submitted');
    fireEvent.change(screen.getByLabelText('Settlement reason'), { target: { value: 'Scan came back empty.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settle it' }));
    await waitFor(() => expect(screen.getByText('internal')).toBeInTheDocument());
    // The mark is on record — it is append-only and cannot be taken back — but
    // the session stays open rather than being settled behind the child's back.
    expect(schoolApi.gradeSession).toHaveBeenCalled();
    expect(schoolApi.closeSession).not.toHaveBeenCalled();
  });
});
