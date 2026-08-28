import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import StaleSessions from './StaleSessions.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    staleSessions: vi.fn(),
    abandonSession: vi.fn(),
    sessionReview: vi.fn(),
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

const KIDS = [{ id: 'learner-1', name: 'Test Learner' }];

const row = (overrides = {}) => ({
  sessionId: 'ses_1',
  learnerId: 'learner-1',
  unitId: 'frac.01',
  state: 'issued',
  updatedAt: '2026-07-01T09:00:00.000Z',
  abandonable: true,
  ...overrides,
});

describe('StaleSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pending items, so tests that don't care about the count
    // don't have to stub it every time.
    schoolApi.sessionReview.mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  });

  it('an abandonable row shows the abandon affordance and no settle link', async () => {
    schoolApi.staleSessions.mockResolvedValue({ ok: true, status: 200, data: { sessions: [row({ abandonable: true })] } });
    render(<StaleSessions kids={KIDS} />);

    expect(await screen.findByRole('button', { name: 'Abandon…' })).toBeTruthy();
    expect(screen.queryByText(/Settle by hand/)).toBeNull();
  });

  it('a non-abandonable row shows the settle link and no abandon affordance', async () => {
    schoolApi.staleSessions.mockResolvedValue({
      ok: true, status: 200, data: { sessions: [row({ sessionId: 'ses_2', state: 'submitted', abandonable: false })] },
    });
    render(<StaleSessions kids={KIDS} />);

    const link = await screen.findByRole('link', { name: /Settle by hand/ });
    expect(link.getAttribute('href')).toBe('/school/teacher/sessions/ses_2');
    expect(screen.queryByRole('button', { name: 'Abandon…' })).toBeNull();
  });

  it('a row with pending items shows the count, linking to the action queue', async () => {
    schoolApi.staleSessions.mockResolvedValue({
      ok: true, status: 200, data: { sessions: [row({ sessionId: 'ses_3', state: 'submitted', abandonable: false })] },
    });
    schoolApi.sessionReview.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [{ itemId: 'q1', verdict: null }, { itemId: 'q2', verdict: 'correct' }] },
    });
    render(<StaleSessions kids={KIDS} />);

    const pending = await screen.findByText('1 answer waiting');
    expect(pending.getAttribute('href')).toBe('/school/teacher/queue');
  });

  it('a failed per-row review read renders nothing — never an error state on the row', async () => {
    schoolApi.staleSessions.mockResolvedValue({
      ok: true, status: 200, data: { sessions: [row({ sessionId: 'ses_4', state: 'submitted', abandonable: false })] },
    });
    schoolApi.sessionReview.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<StaleSessions kids={KIDS} />);

    await screen.findByRole('link', { name: /Settle by hand/ });
    await waitFor(() => expect(schoolApi.sessionReview).toHaveBeenCalledWith('ses_4'));
    expect(screen.queryByText(/answer/)).toBeNull();
    expect(screen.queryByText(/Couldn.t load/)).toBeNull();
  });
});
