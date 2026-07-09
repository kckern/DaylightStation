import { describe, it, expect, afterEach } from 'vitest';
import { getScreenOverrideService, _resetForTests } from '#composition/modules/screenOverride.mjs';

afterEach(() => _resetForTests());

describe('getScreenOverrideService', () => {
  it('returns the same instance across calls (shared singleton)', () => {
    const a = getScreenOverrideService();
    const b = getScreenOverrideService();
    expect(a).toBe(b);
  });

  it('the shared instance stores + reads windows', () => {
    const svc = getScreenOverrideService();
    svc.set('dev', 'off', 30);
    expect(getScreenOverrideService().get('dev')?.state).toBe('off');
  });

  it('_resetForTests() drops the singleton', () => {
    const a = getScreenOverrideService();
    _resetForTests();
    expect(getScreenOverrideService()).not.toBe(a);
  });
});
