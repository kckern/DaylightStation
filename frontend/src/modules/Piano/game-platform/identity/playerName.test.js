import { describe, expect, it } from 'vitest';
import { resolvePianoPlayerName } from './playerName.js';

describe('resolvePianoPlayerName', () => {
  it('prefers the roster-resolved name supplied by the host', () => {
    expect(resolvePianoPlayerName('learner4-kern', 'Learner4')).toBe('Learner4');
  });

  it('understands kiosk profile naming shapes', () => {
    expect(resolvePianoPlayerName({ id: 'parent-1', name: 'Katherine', group_label: 'Mom' })).toBe('Mom');
    expect(resolvePianoPlayerName({ id: 'learner2', display_name: 'Learner2' })).toBe('Learner2');
    expect(resolvePianoPlayerName({ id: 'learner4', first_name: 'Learner4' })).toBe('Learner4');
  });

  it('never prints a raw unresolved id', () => {
    expect(resolvePianoPlayerName('learner4-kern')).toBe('Player');
    expect(resolvePianoPlayerName({ id: 'learner2' })).toBe('Player');
    expect(resolvePianoPlayerName(null)).toBe('Guest');
  });
});

