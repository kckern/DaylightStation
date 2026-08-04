import { describe, expect, it } from 'vitest';
import {
  missingCapabilities,
  parseCapabilityId,
  validateCapabilityList,
} from './capabilities.mjs';

describe('SchoolCalc capability contracts', () => {
  it('parses one exact versioned capability', () => {
    expect(parseCapabilityId('activity.timed-drill@12')).toEqual({
      id: 'activity.timed-drill@12', name: 'activity.timed-drill', version: 12,
    });
    expect(parseCapabilityId('TI86@1')).toBeNull();
    expect(parseCapabilityId('reader@0')).toBeNull();
    expect(parseCapabilityId('reader')).toBeNull();
  });

  it('rejects duplicates and malformed declared capabilities', () => {
    expect(validateCapabilityList(['reader@1', 'reader@1', 'bad']).errors).toEqual([
      "capabilities[1]: duplicate capability 'reader@1'",
      'capabilities[2]: must look like name@version',
    ]);
  });

  it('requires exact contracts instead of guessing version compatibility', () => {
    expect(missingCapabilities(['reader@1', 'quiz@1'], ['reader@2', 'quiz@1']))
      .toEqual(['reader@1']);
  });
});

