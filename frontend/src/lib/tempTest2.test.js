import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// EXACT same pattern as useContentInfo.test.jsx
const apiMock = vi.fn();
vi.mock('./api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { useContentInfo } from '../modules/Media/browse/useContentInfo.js';

beforeEach(() => { apiMock.mockReset(); });

describe('useContentInfo from lib dir', () => {
  it('captures error', async () => {
    apiMock.mockRejectedValue(new Error('not found'));
    const { result } = renderHook(() => useContentInfo('plex:bad'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('not found');
  });
});
