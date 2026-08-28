import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompanionFinishCode from './CompanionFinishCode.jsx';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';

const profile = vi.hoisted(() => ({
  requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: 'grant-1' })),
}));

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: { revealCompanionFinishCode: vi.fn() },
}));

vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: profile.requestAuthorization,
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
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
  profile.requestAuthorization.mockResolvedValue({ ok: true, grantToken: 'grant-1' });
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
      'ses_1', { revealedBy: 'kckern', pin: null }, 'grant-1',
    );
  });

  it('asks for a fresh confirmation scoped to this session', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    await waitFor(() => expect(profile.requestAuthorization).toHaveBeenCalledWith({
      action: 'companion.finish-code.reveal', resource: 'ses_1',
    }));
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
    profile.requestAuthorization.mockResolvedValue({ ok: false, refused: true, status: 403,
      message: 'The teacher PIN is missing or wrong.' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /show the code/i }));
    expect(await screen.findByText(/teacher PIN is missing or wrong/i)).toBeInTheDocument();
    expect(screen.queryByText('ACE')).not.toBeInTheDocument();
    expect(teacherWorkspaceApi.revealCompanionFinishCode).not.toHaveBeenCalled();
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
