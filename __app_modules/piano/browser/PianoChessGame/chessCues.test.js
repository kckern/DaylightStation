import { describe, expect, it } from 'vitest';
import { cuesFromConfig } from './chessCues.js';

describe('cuesFromConfig', () => {
  const ALL_ON = { flashRejected: true, toast: true, showDestinationLabels: true, ghostNotes: true, sound: true };

  it('translates snake_case refusal loudness, treating only explicit false as off', () => {
    expect(cuesFromConfig({ feedback: { flash_rejected: false, toast: false } })).toEqual({
      ...ALL_ON,
      flashRejected: false,
      toast: false,
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

  it('turns ghost notes off only on explicit false', () => {
    // Default ON. Without them the board's only reply to a wrong press is "that
    // chord is not on the board", so a child walking up the scale toward a note
    // gets nothing back for getting closer — and getting closer is the skill.
    expect(cuesFromConfig({ feedback: { ghost_notes: false } })).toEqual({ ...ALL_ON, ghostNotes: false });
    expect(cuesFromConfig({ feedback: { ghost_notes: true } })).toEqual(ALL_ON);
  });

  it('turns sound off only on explicit false', () => {
    // The screen sits in front of an instrument, so audible confirmation is the
    // default and a household silences it deliberately.
    expect(cuesFromConfig({ feedback: { sound: false } })).toEqual({ ...ALL_ON, sound: false });
    expect(cuesFromConfig({ feedback: { sound: true } })).toEqual(ALL_ON);
  });

  it('ignores a stale hint_level — legality marks are a gesture channel, not config', () => {
    // toEqual (not toMatchObject) on purpose: a resurrected highlightSources /
    // gateOnMistake key is exactly the regression this pins down.
    expect(cuesFromConfig({ feedback: { hint_level: 'always' } })).toEqual(ALL_ON);
  });
});
