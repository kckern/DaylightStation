import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('./api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { usePianoCoursePlayable } from '../modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js';

beforeEach(() => api.mockReset());

describe('usePianoCoursePlayable from lib dir', () => {
  it('handles rejection', async () => {
    api.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });
});
