import { describe, it, expect, vi, beforeEach } from 'vitest';

const warnSpy = vi.fn();
const sampledSpy = vi.fn();
const debugSpy = vi.fn();
vi.mock('../../lib/logging/Logger.js', () => ({
  default: () => ({ warn: warnSpy, info: vi.fn(), debug: debugSpy, error: vi.fn(), sampled: sampledSpy }),
  __esModule: true
}));

import { PersistenceManager } from './PersistenceManager.js';

beforeEach(() => { warnSpy.mockClear(); sampledSpy.mockClear(); });

// A session that fails validation with reason 'session-too-short'.
function tooShortSession() {
  const now = Date.now();
  return {
    sessionId: 'fs_test', startTime: now - 1000, endTime: now, durationMs: 1000,
    roster: [{ userId: 'felix' }], timeline: { series: { felix: { hr: [1, 2, 3] } } }, tickCount: 100
  };
}

describe('PersistenceManager — validation log spam', () => {
  it('routes session-too-short to sampled (not warn)', () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    for (let i = 0; i < 20; i += 1) pm.persistSession(tooShortSession(), { force: true });

    // No warn-level validation_failed for the benign reason.
    const warnedValidationFailed = warnSpy.mock.calls.some(
      ([ev]) => ev === 'fitness.persistence.validation_failed'
    );
    expect(warnedValidationFailed).toBe(false);
    // It used the rate-limited sampled path instead.
    expect(sampledSpy).toHaveBeenCalledWith(
      'fitness.persistence.validation_skipped',
      expect.objectContaining({ reason: 'session-too-short' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number) })
    );
  });
});
