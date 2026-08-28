import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PrintPendingView from './PrintPendingView.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    printPending: vi.fn(),
    printApprove: vi.fn(),
    printDeny: vi.fn(),
    printQuota: vi.fn(),
    printablePreviewUrl: (printableId) => `/api/v1/school/print/printables/${printableId}/preview`,
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

describe('PrintPendingView — the sheet preview and the requester\'s quota (audit 4.3)', () => {
  const KIDS = [{ id: 'learner-b', name: 'Learner B' }];

  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.printQuota.mockResolvedValue({ ok: true, status: 200, data: { pagesInWindow: 14, pagesPerWindow: 5, remaining: 0, windowMinutes: 60 } });
  });

  it('renders a preview link per job, carrying its own printableId', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: true, status: 200, data: [
      { id: 'job-1', userId: 'learner-b', printableId: 'printable-a', label: 'Worksheet A', pages: 2, copies: 1 },
      { id: 'job-2', userId: 'learner-b', printableId: 'printable-b', label: 'Worksheet B', pages: 3, copies: 1 },
    ] });
    render(<PrintPendingView kids={KIDS} />);
    const links = await screen.findAllByRole('link', { name: 'Preview sheet' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/api/v1/school/print/printables/printable-a/preview');
    expect(links[1]).toHaveAttribute('href', '/api/v1/school/print/printables/printable-b/preview');
  });

  it('shows the quota line when the read succeeds, approve/deny present', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: true, status: 200, data: [
      { id: 'job-1', userId: 'learner-b', printableId: 'printable-a', label: 'Worksheet A', pages: 2, copies: 1 },
    ] });
    render(<PrintPendingView kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('14 of 5 pages this window')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('renders nothing for the quota when the read fails — approve/deny keep working', async () => {
    schoolApi.printQuota.mockResolvedValue({ ok: false, status: 500, data: null });
    schoolApi.printPending.mockResolvedValue({ ok: true, status: 200, data: [
      { id: 'job-1', userId: 'learner-b', printableId: 'printable-a', label: 'Worksheet A', pages: 2, copies: 1 },
    ] });
    render(<PrintPendingView kids={KIDS} />);
    await screen.findByText('Worksheet A');
    await waitFor(() => expect(schoolApi.printQuota).toHaveBeenCalled());
    expect(screen.queryByText(/pages this window/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('reads quota once per distinct child, even with two of their jobs pending', async () => {
    schoolApi.printPending.mockResolvedValue({ ok: true, status: 200, data: [
      { id: 'job-1', userId: 'learner-b', printableId: 'printable-a', label: 'Worksheet A', pages: 2, copies: 1 },
      { id: 'job-2', userId: 'learner-b', printableId: 'printable-b', label: 'Worksheet B', pages: 3, copies: 1 },
    ] });
    render(<PrintPendingView kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText('14 of 5 pages this window')).toHaveLength(2));
    expect(schoolApi.printQuota).toHaveBeenCalledTimes(1);
    expect(schoolApi.printQuota).toHaveBeenCalledWith('learner-b');
  });
});
