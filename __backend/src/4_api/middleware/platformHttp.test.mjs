import { describe, expect, it, vi } from 'vitest';
import {
  conciergeContextFromRequest,
  crossOriginIsolationHeaders,
  skipWebSocketPaths,
} from './platformHttp.mjs';

describe('platform HTTP middleware', () => {
  it('sets the established cross-origin isolation headers', () => {
    const res = { setHeader: vi.fn() };
    const next = vi.fn();
    crossOriginIsolationHeaders({}, res, next);
    expect(res.setHeader.mock.calls).toEqual([
      ['Cross-Origin-Opener-Policy', 'same-origin'],
      ['Cross-Origin-Embedder-Policy', 'credentialless'],
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves websocket bypass behavior', () => {
    const next = vi.fn();
    skipWebSocketPaths({ path: '/ws/device' }, {}, next);
    expect(next).toHaveBeenCalledWith('route');
  });

  it('preserves the concierge request context shape', () => {
    expect(conciergeContextFromRequest({
      satellite: { id: 'kitchen' },
      body: { conversation_id: 'thread-1' },
    })).toEqual({ satellite: { id: 'kitchen' }, conversationId: 'thread-1' });
  });
});
