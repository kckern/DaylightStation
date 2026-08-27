import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProgramDayBypassPanel from './ProgramDayBypassPanel.jsx';
import { schoolApi } from '../../schoolApi.js';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    programDayBypasses: vi.fn(),
    grantProgramDayBypass: vi.fn(),
    retractProgramDayBypass: vi.fn(),
    pianoLessonGate: vi.fn(),
  },
}));

// A claimed, server-authorized teacher, so useTeacherWrite calls straight
// through without exposing or forwarding a PIN.
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

const ok = (data) => ({ ok: true, status: 200, data });

const ACTIVE = {
  schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1',
  learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27',
  reason: 'Recital tonight', decidedBy: 'kckern', decidedAt: '2026-08-27T14:00:00-07:00',
};

const mount = () => render(<ProgramDayBypassPanel learnerId="kid1" learnerName="Kid One" />);

const setup = ({ bypasses = { active: [], history: [] }, gate = { gated: true, reason: 'owed', lesson: { title: 'Lesson 5' } } } = {}) => {
  schoolApi.programDayBypasses.mockResolvedValue(ok(bypasses));
  schoolApi.pianoLessonGate.mockResolvedValue(ok(gate));
};

beforeEach(() => {
  vi.clearAllMocks();
  setup();
  schoolApi.grantProgramDayBypass.mockResolvedValue(ok(ACTIVE));
  schoolApi.retractProgramDayBypass.mockResolvedValue(ok({ operation: 'retracted' }));
});

describe('ProgramDayBypassPanel — status line', () => {
  it('names the lesson a parent is about to excuse', async () => {
    mount();
    expect(await screen.findByText(/Owed today: Lesson 5/)).toBeInTheDocument();
  });

  it('says so when the day is already done', async () => {
    setup({ gate: { gated: false, reason: 'done' } });
    mount();
    expect(await screen.findByText(/Already done today/i)).toBeInTheDocument();
  });

  it('explains when there is no piano course to excuse', async () => {
    setup({ gate: { gated: false, reason: 'not-enrolled' } });
    mount();
    expect(await screen.findByText(/No piano course is assigned/i)).toBeInTheDocument();
  });
});

describe('ProgramDayBypassPanel — granting', () => {
  it('refuses to excuse without a reason', async () => {
    mount();
    const button = await screen.findByRole('button', { name: /excuse today.s piano lesson/i });
    expect(button).toBeDisabled();
  });

  it('excuses the day with the claimed teacher as the actor', async () => {
    mount();
    const reason = await screen.findByLabelText('Reason');
    fireEvent.change(reason, { target: { value: 'Recital tonight' } });
    fireEvent.click(screen.getByRole('button', { name: /excuse today.s piano lesson/i }));

    await waitFor(() => expect(schoolApi.grantProgramDayBypass).toHaveBeenCalledWith({
      learnerId: 'kid1', programId: 'piano-course', reason: 'Recital tonight',
      decidedBy: 'kckern', pin: null,
    }));
  });

  it('re-reads both the ledger and the gate after a grant', async () => {
    mount();
    await screen.findByLabelText('Reason');
    const readsBefore = schoolApi.programDayBypasses.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Recital' } });
    fireEvent.click(screen.getByRole('button', { name: /excuse today.s piano lesson/i }));

    await waitFor(() => expect(schoolApi.programDayBypasses.mock.calls.length).toBeGreaterThan(readsBefore));
  });
});

describe('ProgramDayBypassPanel — an active excusal', () => {
  it('shows who excused it and why, instead of the grant form', async () => {
    setup({ bypasses: { active: [ACTIVE], history: [ACTIVE] } });
    mount();
    expect(await screen.findByText(/Excused by kckern/)).toBeInTheDocument();
    expect(screen.getByText(/Recital tonight/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /excuse today.s piano lesson/i })).toBeNull();
  });

  it('refuses to retract without a reason', async () => {
    setup({ bypasses: { active: [ACTIVE], history: [ACTIVE] } });
    mount();
    expect(await screen.findByRole('button', { name: 'Retract' })).toBeDisabled();
  });

  it('retracts with a reason', async () => {
    setup({ bypasses: { active: [ACTIVE], history: [ACTIVE] } });
    mount();
    const reason = await screen.findByLabelText('Retract reason');
    fireEvent.change(reason, { target: { value: 'Wrong kid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retract' }));

    await waitFor(() => expect(schoolApi.retractProgramDayBypass).toHaveBeenCalledWith('pdb_1', {
      reason: 'Wrong kid', retractedBy: 'kckern', pin: null,
    }));
  });

  it('ignores another learner\'s active excusal', async () => {
    setup({ bypasses: { active: [{ ...ACTIVE, learnerId: 'kid2' }], history: [] } });
    mount();
    expect(await screen.findByRole('button', { name: /excuse today.s piano lesson/i })).toBeInTheDocument();
  });
});
