import { describe, expect, it, vi } from 'vitest';
import { createLibbyRuntime } from './libby.mjs';

const base = { dataPath: '/data', username: 'test-user', fetch: async () => new Response('{}') };

describe('createLibbyRuntime identity renewal', () => {
  it('arms renewal on the instance that owns scheduled work', () => {
    const startRenewal = vi.fn(() => () => {});

    const runtime = createLibbyRuntime({ ...base, renewalEnabled: true, startRenewal });

    expect(startRenewal).toHaveBeenCalledTimes(1);
    expect(startRenewal.mock.calls[0][0].service).toBe(runtime.identityRenewal);
    expect(typeof runtime.stopIdentityRenewal).toBe('function');
  });

  it('does not arm renewal on a secondary instance, so only one writer rotates the shared credential', () => {
    const startRenewal = vi.fn(() => () => {});
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const runtime = createLibbyRuntime({ ...base, renewalEnabled: false, startRenewal, logger });

    expect(startRenewal).not.toHaveBeenCalled();
    expect(typeof runtime.stopIdentityRenewal).toBe('function');
    expect(() => runtime.stopIdentityRenewal()).not.toThrow();
  });
});
