import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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


it('loads a saved household hold and release into the first shared service of each new process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piano-hold-'));
  try {
    const clock = {now: () => 1800000000000};
    const configService = {
      getHouseholdAppConfig: () => ({midi_wake: {enabled:true, device_id:'fixture-tablet'}}),
      getHouseholdPath: relative => join(dir, relative),
    };
    const start = () => getScreenOverrideService({clock, configService});
    start().set('fixture-tablet', 'off', 15);
    _resetForTests();
    expect(start().get('fixture-tablet')).toEqual({state:'off', until:clock.now() + 900000});
    start().clear('fixture-tablet');
    _resetForTests();
    expect(start().hasDecision('fixture-tablet')).toBe(true);
    expect(start().get('fixture-tablet')).toBeNull();
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
