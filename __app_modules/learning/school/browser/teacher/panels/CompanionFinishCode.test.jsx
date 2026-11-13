import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompanionFinishCode from "./CompanionFinishCode.jsx";
import { teacherWorkspaceApi } from "../teacherWorkspaceApi.js";

vi.mock("../teacherWorkspaceApi.js", () => ({
  teacherWorkspaceApi: { revealCompanionFinishCode: vi.fn() },
}));

vi.mock("../TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => ({ currentTeacher: { id: 't1' } }),
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher_1', name: 'Teacher One' },
    openPicker: vi.fn(),
    pickerOpen: false,
  }),
}));

const ok = (data) => ({ ok: true, status: 200, data });

const REVEALED = {
  schema: 'school.companion-finish-code/v1', sessionId: 'ses_1', lessonId: 'cfm-w35-d1',
  gated: true, available: true, reason: null, finishCode: 'ACE', earned: false,
  satisfiedAt: null, satisfiedVia: null, codeRef: 'cmc_abc', revealedAt: '2026-08-27T15:30:00.000Z',
};

const mount = () => render(<CompanionFinishCode sessionId="ses_1" />);

beforeEach(() => {
  vi.clearAllMocks();
  teacherWorkspaceApi.revealCompanionFinishCode.mockResolvedValue(ok(REVEALED));
});

describe('CompanionFinishCode', () => {
  it('shows no letters until a grown-up deliberately asks', () => {
    mount();
    expect(screen.queryByText('ACE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show the code/i })).toBeInTheDocument();
  });

  it('reads the code out and says plainly that nobody has listened', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText('ACE')).toBeInTheDocument();
    expect(screen.getByText(/nobody has listened/i)).toBeInTheDocument();
    expect(teacherWorkspaceApi.revealCompanionFinishCode).toHaveBeenCalledWith(
      'ses_1', { revealedBy: 'teacher_1' },
    );
  });

  it('says the read-along was actually finished when it was', async () => {
    teacherWorkspaceApi.revealCompanionFinishCode.mockResolvedValue(ok({
      ...REVEALED, earned: true, satisfiedAt: '2026-08-27T14:40:00.000Z', satisfiedVia: 'readalong',
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText('ACE')).toBeInTheDocument();
    expect(screen.getByText(/read-along was finished/i)).toBeInTheDocument();
    expect(screen.queryByText(/nobody has listened/i)).not.toBeInTheDocument();
  });

  it('answers cleanly for a lesson that has no gate at all', async () => {
    teacherWorkspaceApi.revealCompanionFinishCode.mockResolvedValue(ok({
      ...REVEALED, gated: false, available: false, finishCode: null, reason: 'no-companion',
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText(/no read-along/i)).toBeInTheDocument();
    expect(screen.queryByText('ACE')).not.toBeInTheDocument();
  });

  it('says the code has not been made yet rather than showing a blank one', async () => {
    teacherWorkspaceApi.revealCompanionFinishCode.mockResolvedValue(ok({
      ...REVEALED, available: false, finishCode: null, reason: 'not-issued',
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText(/no code for this lesson yet/i)).toBeInTheDocument();
  });

  it('reports a refusal without inventing a code', async () => {
    teacherWorkspaceApi.revealCompanionFinishCode.mockResolvedValue({ ok: false, status: 403,
      data: { error: 'Only a listed teacher can do that.' } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText(/Only a listed teacher can do that/)).toBeInTheDocument();
    expect(screen.queryByText('ACE')).not.toBeInTheDocument();
  });

  it('puts the letters away again so they do not sit on a household screen', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText('ACE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByText('ACE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show the code/i })).toBeInTheDocument();
  });
});
