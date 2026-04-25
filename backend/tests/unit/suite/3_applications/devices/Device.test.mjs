/**
 * Device — facade method tests.
 *
 * Pure unit tests with mocked capability adapters. Verifies that Device
 * methods correctly delegate to the underlying contentControl while gating
 * on capability presence and method availability.
 */
import { describe, it, expect, vi } from 'vitest';

import { Device } from '#apps/devices/services/Device.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeDevice({ contentControl = null, deviceControl = null, osControl = null } = {}) {
  return new Device(
    { id: 'test-device', type: 'shield-tv' },
    { deviceControl, osControl, contentControl },
    { logger: makeMockLogger() }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Device.clearContent', () => {
  it('delegates to contentControl.loadStartUrl', async () => {
    const loadStartUrl = vi.fn(async () => ({ ok: true }));
    const contentControl = {
      load: vi.fn(),
      getStatus: vi.fn(),
      loadStartUrl,
    };
    const device = makeDevice({ contentControl });

    const result = await device.clearContent();

    expect(loadStartUrl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when content control is missing', async () => {
    const device = makeDevice({ contentControl: null });

    const result = await device.clearContent();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no content control|content control/i);
  });

  it('returns ok:false when content control lacks loadStartUrl', async () => {
    const contentControl = {
      load: vi.fn(),
      getStatus: vi.fn(),
      // no loadStartUrl
    };
    const device = makeDevice({ contentControl });

    const result = await device.clearContent();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported|loadStartUrl/i);
  });
});
