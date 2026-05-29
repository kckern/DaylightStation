import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Stub Mantine components so tests run without MantineProvider
vi.mock('@mantine/core', () => ({
  Text: ({ children, ...props }) => React.createElement('span', props, children),
  Skeleton: ({ children, ...props }) => React.createElement('div', props, children),
}));

let sessionsValue = [];
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({
  useScreenData: (key) => (key === 'sessions' ? sessionsValue : null),
  useScreenDataRefetch: () => vi.fn()
}));
// Stub the FitnessContext hook the widget uses (voice memo add path).
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ openVoiceMemoCapture: vi.fn() }),
  useFitness: () => ({ openVoiceMemoCapture: vi.fn() })
}));
// Stub FitnessScreenProvider (used for navigation)
vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ onNavigate: vi.fn() })
}));
// Stub ScreenProvider (used by useScreen)
vi.mock('@/screen-framework/providers/ScreenProvider.jsx', () => ({
  useScreen: () => ({ restore: vi.fn() })
}));
// Stub widget registry
vi.mock('@/screen-framework/widgets/registry.js', () => ({
  getWidgetRegistry: () => ({ get: vi.fn() })
}));

import FitnessSessionDetailWidget from './FitnessSessionDetailWidget.jsx';

beforeEach(() => {
  sessionsValue = [];
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sessionId: '20260528194117', summary: { voiceMemos: [] }, timeline: {} })
  });
});

describe('FitnessSessionDetailWidget — refetch on sessions change', () => {
  it('re-fetches its detail when the sessions store updates', async () => {
    const { rerender } = render(<FitnessSessionDetailWidget sessionId="20260528194117" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // Simulate the post-save sessions refetch producing a new array reference.
    sessionsValue = [{ sessionId: '20260528194117', voiceMemos: [{ memoId: 'm1' }] }];
    rerender(<FitnessSessionDetailWidget sessionId="20260528194117" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
