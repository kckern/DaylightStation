import { describe, it, expect } from 'vitest';
import { menuChoices, MENU_KEYS } from './officeMenu.js';
import { noteName } from './officeKeys.js';

const ids = (choices) => choices.map((choice) => choice.id);
const on = () => {};

describe('menuChoices (the Sheet Music menu, one key per choice)', () => {
  it('every choice keeps its key whatever is enabled', () => {
    expect(MENU_KEYS.map((key) => [key.id, noteName(key.note)])).toEqual([
      ['resume', 'C4'], ['pieces', 'D4'], ['previous', 'E4'], ['next', 'F4'], ['retry', 'G4'], ['later', 'A4'], ['leave', 'B4'],
    ]);
    const none = menuChoices({ inDrill: true, actions: {} });
    const all = menuChoices({ inDrill: true, paused: true, actions: {
      previous: { onSelect: on }, next: { onSelect: on }, retry: { onSelect: on }, later: { label: 'Skip rhythm', onSelect: on },
    } });
    expect(ids(none)).toEqual(ids(all));
    expect(none.map((choice) => choice.note)).toEqual(all.map((choice) => choice.note));
    expect(none.map((choice) => choice.enabled)).toEqual([true, true, false, false, false, false, true]);
    expect(all.every((choice) => choice.enabled)).toBe(true);
    expect(all.find((choice) => choice.id === 'later').label).toBe('Skip rhythm');
  });

  it('in the picker only Close and Leave are offered', () => {
    const choices = menuChoices({ inDrill: false, actions: { next: { onSelect: on } } });
    expect(choices.filter((choice) => choice.enabled).map((choice) => [choice.id, choice.label])).toEqual([['resume', 'Close'], ['leave', 'Leave']]);
  });

  it('says Resume over a paused take and Close otherwise', () => {
    expect(menuChoices({ inDrill: true, paused: true, actions: {} })[0].label).toBe('Resume');
    expect(menuChoices({ inDrill: true, paused: false, actions: {} })[0].label).toBe('Close');
  });
});
