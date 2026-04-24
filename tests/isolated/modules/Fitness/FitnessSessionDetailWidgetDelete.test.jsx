import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const mockRestore = vi.fn();
const mockRefetch = vi.fn().mockResolvedValue(undefined);

vi.mock('@/screen-framework/providers/ScreenProvider.jsx', () => ({
  useScreen: () => ({ restore: mockRestore, replace: () => () => {} }),
}));

vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({
  useScreenDataRefetch: () => mockRefetch,
  useScreenData: () => null,
}));

vi.mock('@/screen-framework/widgets/registry.js', () => ({
  getWidgetRegistry: () => ({ get: () => null }),
}));

vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ onNavigate: null }),
}));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ openVoiceMemoCapture: null }),
}));

vi.mock('@/modules/Fitness/lib/dateFormatter.js', () => ({
  formatFitnessDate: () => '',
}));

vi.mock('#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/RouteMap.jsx', () => ({ default: () => null }));
vi.mock('#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx', () => ({ default: () => null }));
vi.mock('#frontend/modules/Fitness/widgets/_shared/SportIcon.jsx', () => ({ default: () => null, formatSportType: () => '' }));

import FitnessSessionDetailWidget from '#frontend/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx';

function findDeleteButton(container) {
  // Prefer data-testid for a stable selector; fall back to text match.
  const byTestId = container.querySelector('[data-testid="delete-session"]');
  if (byTestId) return byTestId;
  return Array.from(container.querySelectorAll('button')).find(
    (b) => /delete/i.test(b.textContent || '') || /delete/i.test(b.getAttribute('title') || '')
  );
}

describe('FitnessSessionDetailWidget — delete flow', () => {
  beforeEach(() => {
    mockRestore.mockClear();
    mockRefetch.mockClear();
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sessionId: '20260422193014',
          session: { duration_seconds: 600 },
          summary: { media: [] },
          participants: {},
        }),
      });
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('invalidates the sessions cache after a successful DELETE, then restores right-area', async () => {
    const { container } = render(
      <MantineProvider>
        <FitnessSessionDetailWidget sessionId="20260422193014" />
      </MantineProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/fitness/sessions/20260422193014');
    });

    const deleteBtn = findDeleteButton(container);
    expect(deleteBtn).toBeTruthy();

    await act(async () => { deleteBtn.click(); });

    await waitFor(() => { expect(mockRefetch).toHaveBeenCalledWith('sessions'); });
    expect(mockRestore).toHaveBeenCalledWith('right-area');
    const refetchOrder = mockRefetch.mock.invocationCallOrder[0];
    const restoreOrder = mockRestore.mock.invocationCallOrder[0];
    expect(refetchOrder).toBeLessThan(restoreOrder);
  });

  it('does NOT invalidate the cache if DELETE fails', async () => {
    global.fetch = vi.fn((url, opts) => {
      if (opts?.method === 'DELETE') return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sessionId: '20260422193014',
          session: { duration_seconds: 600 },
          summary: { media: [] },
          participants: {},
        }),
      });
    });

    const { container } = render(
      <MantineProvider>
        <FitnessSessionDetailWidget sessionId="20260422193014" />
      </MantineProvider>
    );
    await waitFor(() => { expect(global.fetch).toHaveBeenCalled(); });
    const deleteBtn = findDeleteButton(container);
    if (!deleteBtn) return;
    await act(async () => { deleteBtn.click(); });
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
