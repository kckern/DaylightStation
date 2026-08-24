import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import RepairTab from './RepairTab.jsx';
import { TeacherProfileProvider } from '../TeacherProfileContext.jsx';
import PinPrompt from '../panels/PinPrompt.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant' } })),
} }));

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    staleSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    teachers: vi.fn(),
    reviewLearner: vi.fn(),
    postTeacherNote: vi.fn(),
    attestations: vi.fn(),
    postAttestation: vi.fn(),
    curriculumUnits: vi.fn(),
    attemptsSummary: vi.fn(),
    reassign: vi.fn(),
    attemptDays: vi.fn(),
    retract: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }];
const ok = (data) => ({ ok: true, status: 200, data });

const mount = (ui) => render(<TeacherProfileProvider>{ui}<PinPrompt /></TeacherProfileProvider>);

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessionStorage.setItem('school-teacher-claim', 'kckern');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }));
  schoolApi.reviewLearner.mockResolvedValue(ok([
    { itemId: 'q3', sessionId: 'ses_1', unitId: 'math.01', verdict: 'correct', note: 'Nice clear reasoning!', gradedBy: 'kckern', gradedAt: 't1' },
    { itemId: 'note_1', sessionId: null, unitId: null, verdict: null, kind: 'note', note: 'Great week!', gradedBy: 'kckern', gradedAt: 't2' },
  ]));
  schoolApi.postTeacherNote.mockResolvedValue(ok({ entry: { id: 'note_2' } }));
  schoolApi.attestations.mockResolvedValue(ok({ entries: [] }));
  schoolApi.postAttestation.mockResolvedValue(ok({ entry: { id: 'att_1' } }));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [
    { unitId: 'math-fractions.02', title: 'Adding Fractions', courseId: 'math-fractions' },
  ] }));
  schoolApi.attemptsSummary.mockResolvedValue(ok({ assessments: [
    { assessmentId: 'ses_9', count: 8, bankId: 'creature-quiz-1', firstAt: 't' },
  ] }));
  schoolApi.reassign.mockResolvedValue(ok({ moved: 8 }));
  schoolApi.attemptDays.mockResolvedValue(ok({ days: ['2026-08-06', '2026-08-05'] }));
  schoolApi.retract.mockResolvedValue(ok({ retracted: 'x' }));
});

describe('RepairTab (wave 5, all live)', () => {
  it('renders review feedback AND standalone notes (kind:note)', async () => {
    mount(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Nice clear reasoning!/)).toBeTruthy());
    expect(screen.getByText(/Great week!/)).toBeTruthy();
    expect(screen.getAllByText('note').length).toBeGreaterThan(0);
  });

  it('the composer sends a gated note and refreshes the feed', async () => {
    mount(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByLabelText('Note to learner')).toBeTruthy());
    act(() => { fireEvent.change(screen.getByLabelText('Note to learner'), { target: { value: 'Do the reading tonight' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    await waitFor(() => expect(schoolApi.postTeacherNote).toHaveBeenCalledWith(
      { learnerId: 'felix', note: 'Do the reading tonight', from: 'kckern', pin: null }));
  });

  it('attesting a unit requires a reason and posts through the gate', async () => {
    mount(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attest a unit' })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Attest a unit' })); });
    const attest = screen.getByRole('button', { name: 'Attest' });
    expect(attest.disabled).toBe(true); // no unit, no reason yet
    act(() => {
      fireEvent.change(screen.getByLabelText('Unit to attest'), { target: { value: 'math-fractions.02' } });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'OMR reader was down' } });
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Attest' })); });
    await waitFor(() => expect(schoolApi.postAttestation).toHaveBeenCalledWith(
      { learnerId: 'felix', unitId: 'math-fractions.02', reason: 'OMR reader was down', attestedBy: 'kckern', pin: null }));
  });

  it('reassignment loads a day, requires a target, and moves through the gate', async () => {
    mount(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByLabelText('Day')).toBeTruthy());
    act(() => { fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-08-06' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Load that day' })); });
    await waitFor(() => expect(screen.getByText('Creature Quiz 1')).toBeTruthy());
    const moveBtn = screen.getByRole('button', { name: 'Reassign' });
    expect(moveBtn.disabled).toBe(true); // no target yet
    act(() => { fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'milo' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Reassign' })); });
    await waitFor(() => expect(schoolApi.reassign).toHaveBeenCalledWith({
      fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_9',
      reassignedBy: 'kckern', pin: null,
    }));
  });

  it('no learner selected prompts instead of fetching', async () => {
    mount(<RepairTab learnerId={null} kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.reviewLearner).not.toHaveBeenCalled();
  });

  it('carries no stubs — the whole catalog is live', async () => {
    mount(<RepairTab learnerId="felix" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Attribution repair/)).toBeTruthy());
    expect(document.querySelectorAll('[data-todo]').length).toBe(0);
  });
});
