import { describe, expect, it } from 'vitest';
import { cuesFromConfig } from './chessCues.js';

describe('cuesFromConfig', () => {
  it('translates snake_case refusal loudness, treating only explicit false as off', () => {
    expect(cuesFromConfig({ feedback: { flash_rejected: false, toast: false } })).toEqual({
      flashRejected: false,
      toast: false,
    });
    expect(cuesFromConfig({ feedback: {} })).toEqual({ flashRejected: true, toast: true });
  });

  it('defaults both cues on when the config is missing entirely', () => {
    expect(cuesFromConfig(null)).toEqual({ flashRejected: true, toast: true });
    expect(cuesFromConfig({})).toEqual({ flashRejected: true, toast: true });
  });

  it('ignores a stale hint_level — legality marks are a gesture channel, not config', () => {
    // toEqual (not toMatchObject) on purpose: a resurrected highlightSources /
    // gateOnMistake key is exactly the regression this pins down.
    expect(cuesFromConfig({ feedback: { hint_level: 'always' } })).toEqual({
      flashRejected: true,
      toast: true,
    });
  });
});
