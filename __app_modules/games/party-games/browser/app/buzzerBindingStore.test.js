import { afterEach, describe, expect, it } from 'vitest';
import { saveBuzzerBindings, loadBuzzerBindings, forgetBuzzerBindings } from './buzzerBindingStore.js';

describe('buzzerBindingStore', () => {
  afterEach(() => window.localStorage.clear());
  it('round-trips bindings per session', () => {
    saveBuzzerBindings('s1', { 'gamepad:0:Pad': 'team_1' });
    expect(loadBuzzerBindings('s1')).toEqual({ 'gamepad:0:Pad': 'team_1' });
    expect(loadBuzzerBindings('s2')).toBe(null);
    forgetBuzzerBindings('s1');
    expect(loadBuzzerBindings('s1')).toBe(null);
  });
  it('treats corrupt storage as absent', () => {
    window.localStorage.setItem('party-games:buzzers:s1', '{nope');
    expect(loadBuzzerBindings('s1')).toBe(null);
  });
});
