import { describe, expect, it } from 'vitest';
import { cuesFromConfig } from './chessCues.js';

describe('cuesFromConfig', () => {
  const ALL_ON = { flashRejected: true, toast: true, showDestinationLabels: true };

  it('translates snake_case refusal loudness, treating only explicit false as off', () => {
    expect(cuesFromConfig({ feedback: { flash_rejected: false, toast: false } })).toEqual({
      flashRejected: false,
      toast: false,
      showDestinationLabels: true,
    });
    expect(cuesFromConfig({ feedback: {} })).toEqual(ALL_ON);
  });

  it('defaults every cue on when the config is missing entirely', () => {
    expect(cuesFromConfig(null)).toEqual(ALL_ON);
    expect(cuesFromConfig({})).toEqual(ALL_ON);
  });

  it('turns destination labels off only on explicit false', () => {
    // Absent → on (covered above); explicit true and explicit false both honoured.
    expect(cuesFromConfig({ feedback: { show_destination_labels: true } })).toEqual(ALL_ON);
    expect(cuesFromConfig({ feedback: { show_destination_labels: false } })).toEqual({
      ...ALL_ON,
      showDestinationLabels: false,
    });
  });

  it('ignores a stale hint_level — legality marks are a gesture channel, not config', () => {
    // toEqual (not toMatchObject) on purpose: a resurrected highlightSources /
    // gateOnMistake key is exactly the regression this pins down.
    expect(cuesFromConfig({ feedback: { hint_level: 'always' } })).toEqual(ALL_ON);
  });
});
