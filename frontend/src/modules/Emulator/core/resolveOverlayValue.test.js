import { describe, it, expect } from 'vitest';
import { resolveOverlayValue, formatOverlayValue } from './resolveOverlayValue.js';

describe('resolveOverlayValue', () => {
  const ctx = {
    gameState: { badges: 5, money: 1234 },
    governance: { state: 'playing', credit: 480 },
    overlayData: {
      'fitness.heart_rate': 142,
      'session.current_player': { name: 'KC', avatar: '/a.png' },
    },
  };

  it('reads state.* from the live game state map', () => {
    expect(resolveOverlayValue('state.badges', ctx)).toBe(5);
  });

  it('reads governance.* from the governance context', () => {
    expect(resolveOverlayValue('governance.credit', ctx)).toBe(480);
  });

  it('reads any other dotted source from the injected overlayData by full key', () => {
    expect(resolveOverlayValue('fitness.heart_rate', ctx)).toBe(142);
    expect(resolveOverlayValue('session.current_player', ctx)).toEqual({ name: 'KC', avatar: '/a.png' });
  });

  it('returns undefined for an unknown source or absent context', () => {
    expect(resolveOverlayValue('fitness.cadence', ctx)).toBeUndefined();
    expect(resolveOverlayValue('state.badges', {})).toBeUndefined();
    expect(resolveOverlayValue('state.badges', undefined)).toBeUndefined();
  });
});

describe('formatOverlayValue', () => {
  it('marks empty when the value is null/undefined', () => {
    expect(formatOverlayValue('bpm', undefined)).toEqual({ empty: true, text: '' });
    expect(formatOverlayValue('bpm', null)).toEqual({ empty: true, text: '' });
  });

  it('rounds numeric stats and attaches a unit for bpm/rpm', () => {
    expect(formatOverlayValue('bpm', 142.6)).toEqual({ kind: 'stat', text: '143', unit: 'BPM' });
    expect(formatOverlayValue('rpm', 88.2)).toEqual({ kind: 'stat', text: '88', unit: 'RPM' });
  });

  it('formats coins as a bare rounded number', () => {
    expect(formatOverlayValue('coins', 480.9)).toEqual({ kind: 'stat', text: '481', unit: '' });
  });

  it('passes a player_card through as name + avatar', () => {
    expect(formatOverlayValue('player_card', { name: 'KC', avatar: '/a.png' })).toEqual({
      kind: 'player',
      name: 'KC',
      avatar: '/a.png',
    });
  });

  it('stringifies an unknown format', () => {
    expect(formatOverlayValue('badge_meter', 5)).toEqual({ kind: 'text', text: '5' });
    expect(formatOverlayValue(undefined, 'hi')).toEqual({ kind: 'text', text: 'hi' });
  });

  it('formats a count-up timer (seconds → mm:ss, h:mm:ss past an hour)', () => {
    expect(formatOverlayValue('timer', 0)).toEqual({ kind: 'stat', text: '0:00', unit: '' });
    expect(formatOverlayValue('timer', 75)).toEqual({ kind: 'stat', text: '1:15', unit: '' });
    expect(formatOverlayValue('timer', 3725)).toEqual({ kind: 'stat', text: '1:02:05', unit: '' });
  });

  it('renders the coin placeholder literally (non-numeric coins → text)', () => {
    expect(formatOverlayValue('coins', '—')).toEqual({ kind: 'stat', text: '—', unit: '' });
    expect(formatOverlayValue('coins', 12)).toEqual({ kind: 'stat', text: '12', unit: '' });
  });
});
