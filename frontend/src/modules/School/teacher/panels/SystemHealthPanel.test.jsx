import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SystemHealthPanel from './SystemHealthPanel.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    bankHealth: vi.fn(),
    periods: vi.fn(),
    reportCardFrozenVersions: vi.fn(),
  },
}));
import { schoolApi } from '../../schoolApi.js';

const KIDS = [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }];
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
});
