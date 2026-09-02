import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FrozenHistory from './FrozenHistory.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    reportCardFrozen: vi.fn(),
    curriculumUnits: vi.fn(),
  },
}));
import { schoolApi } from '../../schoolApi.js';

describe('FrozenHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.curriculumUnits.mockResolvedValue({ ok: true, status: 200, data: { units: [] } });
  });

  it('lists closed periods, newest concerns first as the read returns them', async () => {
    schoolApi.reportCardFrozen.mockResolvedValue({
      ok: true, status: 200, data: [
        { periodId: 'fall-2026', period: { label: 'Fall 2026' }, closedBy: 'kckern', closedAt: '2026-12-20T00:00:00Z' },
      ],
    });
    render(<FrozenHistory learnerId="user_4" />);
    expect(await screen.findByText('Fall 2026')).toBeInTheDocument();
    expect(screen.getByText(/Closed by kckern/)).toBeInTheDocument();
  });

  // Point 3 of the System-health brief: frozen VERSIONS (what a supersede
  // preserves rather than destroys) get one home, School Operations' System
  // health panel — this list links there instead of duplicating it.
  it('links to System health for a period\'s preserved (superseded) versions', async () => {
    schoolApi.reportCardFrozen.mockResolvedValue({ ok: true, status: 200, data: [] });
    render(<FrozenHistory learnerId="user_4" />);
    const link = await screen.findByRole('link', { name: /System health/ });
    expect(link).toHaveAttribute('href', '/school/teacher/operations');
  });

  it('renders the link even while the closed-periods read is still loading', () => {
    schoolApi.reportCardFrozen.mockReturnValue(new Promise(() => {})); // never resolves
    render(<FrozenHistory learnerId="user_4" />);
    expect(screen.getByRole('link', { name: /System health/ })).toBeInTheDocument();
  });
});
