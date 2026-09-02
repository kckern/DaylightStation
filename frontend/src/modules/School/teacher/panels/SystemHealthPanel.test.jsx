import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SystemHealthPanel from './SystemHealthPanel.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    bankHealth: vi.fn(),
    periods: vi.fn(),
    reportCardFrozenVersions: vi.fn(),
  },
}));
import { schoolApi } from '../../schoolApi.js';

const KIDS = [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }];
const PERIODS = [{ periodId: 'fall-2026', label: 'Fall 2026', startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-12-19T00:00:00Z' }];

describe('SystemHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.periods.mockResolvedValue({ ok: true, status: 200, data: PERIODS });
    schoolApi.reportCardFrozenVersions.mockResolvedValue({ ok: true, status: 200, data: { versions: [] } });
  });

  it('names malformed banks by id', async () => {
    schoolApi.bankHealth.mockResolvedValue({
      ok: true, status: 200, data: { warmedAt: '2026-08-26T10:00:00Z', banks: 40, failed: ['bad/one/quiz', 'unparseable/one/quiz'] },
    });
    render(<SystemHealthPanel kids={KIDS} />);
    const list = await screen.findByTestId('system-health-malformed-banks');
    expect(list.textContent).toContain('bad/one/quiz');
    expect(list.textContent).toContain('unparseable/one/quiz');
    expect(screen.queryByTestId('system-health-banks-ok')).toBeNull();
  });

  it('a healthy bank read renders a reassuring sentence, not an empty card', async () => {
    schoolApi.bankHealth.mockResolvedValue({
      ok: true, status: 200, data: { warmedAt: '2026-08-26T10:00:00Z', banks: 40, failed: [] },
    });
    render(<SystemHealthPanel kids={KIDS} />);
    const ok = await screen.findByTestId('system-health-banks-ok');
    expect(ok.textContent).toMatch(/No malformed banks/);
    expect(ok.textContent).toMatch(/40 warmed cleanly/);
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
  });

  it('a healthy versions read (no superseded freezes) also reassures rather than going blank', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: true, status: 200, data: { warmedAt: null, banks: 1, failed: [] } });
    render(<SystemHealthPanel kids={KIDS} />);
    const ok = await screen.findByTestId('system-health-versions-ok');
    expect(ok.textContent).toMatch(/No superseded versions/);
  });

  it('lists superseded versions once a learner+period resolves', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: true, status: 200, data: { warmedAt: null, banks: 1, failed: [] } });
    schoolApi.reportCardFrozenVersions.mockResolvedValue({
      ok: true, status: 200, data: { versions: [
        { version: 1, record: { period: { label: 'Fall 2026' }, closedBy: 'kckern', closedAt: '2026-09-01T00:00:00Z' } },
      ] },
    });
    render(<SystemHealthPanel kids={KIDS} />);
    const list = await screen.findByTestId('system-health-frozen-versions');
    expect(list.textContent).toContain('Fall 2026');
    expect(list.textContent).toContain('v1');
    expect(list.textContent).toContain('Closed by kckern');
  });

  it('a failed bank-health read does not blank the versions section', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SystemHealthPanel kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load Quiz bank health/)).toBeInTheDocument());
    await screen.findByTestId('system-health-versions-ok');
  });

  it('a failed versions read does not blank the bank-health section', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: true, status: 200, data: { warmedAt: null, banks: 3, failed: [] } });
    schoolApi.reportCardFrozenVersions.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SystemHealthPanel kids={KIDS} />);
    await screen.findByTestId('system-health-banks-ok');
    await waitFor(() => expect(screen.getByText(/Couldn.t load Superseded report-card versions/)).toBeInTheDocument());
  });

  // Review finding (IMPORTANT #1): a failed versions read must never render
  // the reassuring "all clear" sentence beside its own error banner — that
  // contradiction is exactly what this panel exists to prevent.
  it('a failed versions read shows ONLY the error — never the reassuring sentence alongside it', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: true, status: 200, data: { warmedAt: null, banks: 3, failed: [] } });
    schoolApi.reportCardFrozenVersions.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SystemHealthPanel kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load Superseded report-card versions/)).toBeInTheDocument());
    expect(screen.queryByTestId('system-health-versions-ok')).toBeNull();
    expect(screen.queryByTestId('system-health-frozen-versions')).toBeNull();
  });

  // Review finding (IMPORTANT #2): the learner/period controls choose what
  // to fetch, so they must live outside the PanelFrame they drive and
  // survive every selection instead of unmounting to a loading skeleton.
  it('the learner and period controls survive a selection change', async () => {
    schoolApi.bankHealth.mockResolvedValue({ ok: true, status: 200, data: { warmedAt: null, banks: 1, failed: [] } });
    render(<SystemHealthPanel kids={KIDS} />);
    await screen.findByTestId('system-health-versions-ok');
    const learnerSelect = screen.getByLabelText('Learner');
    expect(learnerSelect).toBeInTheDocument();
    fireEvent.change(learnerSelect, { target: { value: 'user_2' } });
    // Immediately after the selection — the versions read is now re-entering
    // 'loading' — the control itself must still be in the document, not
    // unmounted by the PanelFrame it lives outside of.
    expect(screen.getByLabelText('Learner')).toBeInTheDocument();
    expect(screen.getByLabelText('Learner').value).toBe('user_2');
    await waitFor(() => expect(schoolApi.reportCardFrozenVersions).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'user_2' }),
    ));
    expect(screen.getByLabelText('Learner')).toBeInTheDocument();
  });
});
