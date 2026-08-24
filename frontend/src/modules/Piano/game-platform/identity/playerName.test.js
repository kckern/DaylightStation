import { describe, expect, it } from 'vitest';
import { resolvePianoPlayerName } from './playerName.js';

describe('resolvePianoPlayerName', () => {
  it('prefers the roster-resolved name supplied by the host', () => {
    expect(resolvePianoPlayerName('user_2-kern', 'User_2')).toBe('User_2');
  });

  it('understands kiosk profile naming shapes', () => {
    expect(resolvePianoPlayerName({ id: 'parent-1', name: 'Katherine', group_label: 'Mom' })).toBe('Mom');
    expect(resolvePianoPlayerName({ id: 'user_4', display_name: 'User_4' })).toBe('User_4');
    expect(resolvePianoPlayerName({ id: 'user_2', first_name: 'User_2' })).toBe('User_2');
  });

  it('never prints a raw unresolved id', () => {
    expect(resolvePianoPlayerName('user_2-kern')).toBe('Player');
    expect(resolvePianoPlayerName({ id: 'user_4' })).toBe('Player');
    expect(resolvePianoPlayerName(null)).toBe('Guest');
  });
});

