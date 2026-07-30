import { describe, it, expect } from 'vitest';
import {
  classifyHeldMs, classifyHeldMsToType, DURATION_CLASS_TYPE, SHORT_MAX_MS, MEDIUM_MAX_MS,
} from './durationClass.js';

describe('classifyHeldMs', () => {
  it('classifies below SHORT_MAX_MS as short', () => {
    expect(classifyHeldMs(0)).toBe('short');
    expect(classifyHeldMs(1)).toBe('short');
    expect(classifyHeldMs(SHORT_MAX_MS - 1)).toBe('short');
  });

  it('classifies [SHORT_MAX_MS, MEDIUM_MAX_MS) as medium', () => {
    expect(classifyHeldMs(SHORT_MAX_MS)).toBe('medium');
    expect(classifyHeldMs(300)).toBe('medium');
    expect(classifyHeldMs(MEDIUM_MAX_MS - 1)).toBe('medium');
  });

  it('classifies >= MEDIUM_MAX_MS as long', () => {
    expect(classifyHeldMs(MEDIUM_MAX_MS)).toBe('long');
    expect(classifyHeldMs(1000)).toBe('long');
    expect(classifyHeldMs(10000)).toBe('long');
  });
});

describe('classifyHeldMsToType', () => {
  it('maps short/medium/long to 16th/eighth/quarter (the model\'s canonical type strings)', () => {
    expect(classifyHeldMsToType(50)).toBe('16th');
    expect(classifyHeldMsToType(300)).toBe('eighth');
    expect(classifyHeldMsToType(600)).toBe('quarter');
  });

  it('never produces a half or dotted value (spec: light classifier only)', () => {
    for (const ms of [0, 50, 149, 150, 300, 449, 450, 900, 5000]) {
      expect(Object.values(DURATION_CLASS_TYPE)).toContain(classifyHeldMsToType(ms));
    }
    expect(Object.values(DURATION_CLASS_TYPE)).toEqual(['16th', 'eighth', 'quarter']);
  });
});
