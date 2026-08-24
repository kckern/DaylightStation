import { describe, expect, it } from 'vitest';
import { resolvePianoPlayerName } from './playerName.js';

describe('resolvePianoPlayerName', () => {
  it('prefers the roster-resolved name supplied by the host', () => {
    expect(resolvePianoPlayerName('felix-kern', 'Felix')).toBe('Felix');
  });

  it('understands kiosk profile naming shapes', () => {
    expect(resolvePianoPlayerName({ id: 'parent-1', name: 'Katherine', group_label: 'Mom' })).toBe('Mom');
    expect(resolvePianoPlayerName({ id: 'alan', display_name: 'Alan' })).toBe('Alan');
    expect(resolvePianoPlayerName({ id: 'felix', first_name: 'Felix' })).toBe('Felix');
  });

  it('never prints a raw unresolved id', () => {
    expect(resolvePianoPlayerName('felix-kern')).toBe('Player');
    expect(resolvePianoPlayerName({ id: 'alan' })).toBe('Player');
    expect(resolvePianoPlayerName(null)).toBe('Guest');
  });
});

