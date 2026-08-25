import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PrintPendingView from './PrintPendingView.jsx';

vi.mock('../../schoolApi.js', () => ({ schoolApi: { printPending: vi.fn(), printApprove: vi.fn(), printDeny: vi.fn() } }));
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

describe('PrintPendingView unavailable state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('treats a 404 as quiet unavailable, never an unfixable Retry', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: false, status: 404, data: null });
    render(<PrintPendingView kids={[]} />);
    await waitFor(() => expect(screen.getByText(/aren't enabled on this install/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a real failure still errors with Retry', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<PrintPendingView kids={[]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
  });
});
