import { describe, expect, it } from 'vitest';
import { cuesFromConfig } from './chessCues.js';

describe('cuesFromConfig', () => {
  it('turns both legality cues off for hint_level off', () => {
    expect(cuesFromConfig({ feedback: { hint_level: 'off' } })).toEqual({
      highlightSources: false,
      highlightTargets: false,
      gateOnMistake: false,
      flashRejected: true,
      toast: true,
    });
  });

  it('gates the cues on a mistake for hint_level after-mistake', () => {
    expect(cuesFromConfig({ feedback: { hint_level: 'after-mistake' } })).toEqual({
      highlightSources: true,
      highlightTargets: true,
      gateOnMistake: true,
      flashRejected: true,
      toast: true,
    });
  });

  it('shows the cues ungated for hint_level always', () => {
    expect(cuesFromConfig({ feedback: { hint_level: 'always' } })).toEqual({
      highlightSources: true,
      highlightTargets: true,
      gateOnMistake: false,
      flashRejected: true,
      toast: true,
    });
  });

  it('defaults to after-mistake when hint_level is missing', () => {
    expect(cuesFromConfig({})).toMatchObject({
      highlightSources: true,
      highlightTargets: true,
      gateOnMistake: true,
    });
    expect(cuesFromConfig(null)).toMatchObject({ gateOnMistake: true });
  });

  it('defaults to after-mistake when hint_level is unknown', () => {
    expect(cuesFromConfig({ feedback: { hint_level: 'sometimes' } })).toMatchObject({
      highlightSources: true,
      highlightTargets: true,
      gateOnMistake: true,
    });
  });

  it('translates snake_case refusal loudness, treating only explicit false as off', () => {
    expect(cuesFromConfig({ feedback: { flash_rejected: false, toast: false } })).toMatchObject({
      flashRejected: false,
      toast: false,
    });
    expect(cuesFromConfig({ feedback: {} })).toMatchObject({ flashRejected: true, toast: true });
  });
});
