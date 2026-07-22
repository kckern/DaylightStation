import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrintCenter from './PrintCenter.jsx';

const printablesMock = vi.fn();
const quotaMock = vi.fn();
const requestPrintMock = vi.fn();
const pendingMock = vi.fn();
const approveMock = vi.fn();
const denyMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    printables: (...a) => printablesMock(...a),
    printQuota: (...a) => quotaMock(...a),
    requestPrint: (...a) => requestPrintMock(...a),
    printPending: (...a) => pendingMock(...a),
    approvePrint: (...a) => approveMock(...a),
    denyPrint: (...a) => denyMock(...a),
  },
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

beforeEach(() => {
  profile = {
    currentUser: { id: 'felix', name: 'Felix', birthyear: 2016 },
    roster: [{ id: 'felix', name: 'Felix', birthyear: 2016 }, { id: 'dad', name: 'Papa', birthyear: 1984 }],
    openPicker: vi.fn(),
  };
  printablesMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [{ id: 'caps', label: 'State Capitals', type: 'bank', pages: 2 }] });
  quotaMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { pagesInWindow: 1, remaining: 4, pagesPerWindow: 5, windowMinutes: 60 } });
  requestPrintMock.mockReset();
  pendingMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: [] });
  approveMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { decision: 'printed' } });
  denyMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { decision: 'denied' } });
});

describe('PrintCenter', () => {
  it('shows the quota banner and the printables', async () => {
    render(<PrintCenter />);
    expect(await screen.findByText('State Capitals')).toBeInTheDocument();
    expect(screen.getByText('4 of 5')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
  });

  it('a print under quota shows the printing confirmation', async () => {
    requestPrintMock.mockResolvedValue({ ok: true, status: 200, data: { decision: 'printed', pages: 2, remaining: 2 } });
    render(<PrintCenter />);
    fireEvent.click((await screen.findByText('State Capitals')).closest('button'));
    expect(await screen.findByText(/check the kitchen printer/i)).toBeInTheDocument();
    expect(requestPrintMock).toHaveBeenCalledWith({ userId: 'felix', printableId: 'caps', copies: 1 });
  });

  it('an over-quota print shows the "asked a grown-up" message', async () => {
    requestPrintMock.mockResolvedValue({ ok: true, status: 200, data: { decision: 'approval', pages: 6, requestId: 'pr_1' } });
    render(<PrintCenter />);
    fireEvent.click((await screen.findByText('State Capitals')).closest('button'));
    expect(await screen.findByText(/needs a grown-up/i)).toBeInTheDocument();
  });

  it('a child does NOT see the approvals panel even when requests are pending', async () => {
    profile.currentUser = { id: 'felix', name: 'Felix', birthyear: 2016 };
    pendingMock.mockResolvedValue({ ok: true, status: 200, data: [{ id: 'pr_1', userId: 'milo', label: 'Big', pages: 8 }] });
    render(<PrintCenter />);
    await screen.findByText('State Capitals');
    expect(screen.queryByText(/waiting for your ok/i)).toBeNull();
  });

  it('an adult sees pending approvals and can allow one', async () => {
    profile.currentUser = { id: 'dad', name: 'Papa', birthyear: 1984 };
    pendingMock.mockResolvedValue({ ok: true, status: 200, data: [{ id: 'pr_1', userId: 'felix', label: 'Big Worksheet', pages: 8 }] });
    render(<PrintCenter />);
    expect(await screen.findByText(/waiting for your ok/i)).toBeInTheDocument();
    expect(screen.getByText(/big worksheet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('pr_1', 'dad'));
  });
});
