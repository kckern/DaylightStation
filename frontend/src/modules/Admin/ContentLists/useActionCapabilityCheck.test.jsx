// useActionCapabilityCheck.test.jsx — the admin row's early warning.
//
// Behaviour under test: given a row's input + action, does the hook notice the
// source can't perform the action, and does it find an id that can?
//
// The quietness requirements are as load-bearing as the detection ones. A row
// that warns spuriously (or that warns while still loading) is worse than no
// warning, because it teaches you to ignore the colour.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { default: () => logger };
});

import { useActionCapabilityCheck, __resetCapabilityCache } from './useActionCapabilityCheck.js';

const FILES_IMAGE = 'files:art/fhe/esther.jpg';

/** Route each mocked call by URL so tests read as fixtures, not call-order. */
function route(map) {
  apiMock.mockImplementation((url) => {
    for (const [fragment, payload] of Object.entries(map)) {
      if (url.includes(fragment)) return Promise.resolve(payload);
    }
    return Promise.reject(new Error(`unexpected call: ${url}`));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  __resetCapabilityCache();
});

describe('useActionCapabilityCheck', () => {
  it('reports the mismatch and the id that can satisfy the action', async () => {
    route({
      '/info/': { capabilities: ['playable'], title: 'esther' },
      '/alternates/': {
        alternates: [
          { contentId: 'canvas:fhe/esther.jpg', capabilities: ['displayable'] },
        ],
      },
    });

    const { result } = renderHook(() => useActionCapabilityCheck(FILES_IMAGE, 'Display'));

    await waitFor(() => expect(result.current.mismatch).toBeTruthy());
    expect(result.current.mismatch).toEqual({ action: 'Display', accepts: ['displayable'] });
    expect(result.current.suggestion).toBe('canvas:fhe/esther.jpg');
  });

  it('offers no suggestion when no alternate can satisfy the action either', async () => {
    route({
      '/info/': { capabilities: ['playable'] },
      '/alternates/': {
        alternates: [{ contentId: 'other:x.jpg', capabilities: ['playable'] }],
      },
    });

    const { result } = renderHook(() => useActionCapabilityCheck(FILES_IMAGE, 'Display'));

    await waitFor(() => expect(result.current.mismatch).toBeTruthy());
    expect(result.current.suggestion).toBeNull();
  });

  it('stays silent while the lookup is in flight', async () => {
    let release;
    apiMock.mockImplementation(() => new Promise(resolve => { release = resolve; }));

    const { result } = renderHook(() => useActionCapabilityCheck(FILES_IMAGE, 'Display'));

    expect(result.current.mismatch).toBeNull();
    expect(result.current.loading).toBe(true);
    release({ capabilities: ['displayable'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('stays silent when the action and the source agree', async () => {
    route({ '/info/': { capabilities: ['displayable'] } });

    const { result } = renderHook(() =>
      useActionCapabilityCheck('canvas:fhe/esther.jpg', 'Display'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mismatch).toBeNull();
    // No point asking for alternates when nothing is wrong.
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the info lookup fails', async () => {
    // A 404 or a network blip must not be reported as a misconfigured row.
    apiMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useActionCapabilityCheck(FILES_IMAGE, 'Display'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mismatch).toBeNull();
  });

  it('does not call the API for an action it has no rule for', async () => {
    const { result } = renderHook(() => useActionCapabilityCheck(FILES_IMAGE, 'Read'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.mismatch).toBeNull();
  });

  it('does not call the API without an input', async () => {
    const { result } = renderHook(() => useActionCapabilityCheck('', 'Display'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('looks a content id up once no matter how many rows ask', async () => {
    // A long list re-renders constantly; one info request per row per render
    // would be a self-inflicted load test on the API.
    route({ '/info/': { capabilities: ['displayable'] } });

    const a = renderHook(() => useActionCapabilityCheck('canvas:fhe/esther.jpg', 'Display'));
    const b = renderHook(() => useActionCapabilityCheck('canvas:fhe/esther.jpg', 'Display'));

    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
