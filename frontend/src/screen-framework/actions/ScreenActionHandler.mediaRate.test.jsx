import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dispatchCyclePlaybackRate } from './ScreenActionHandler.jsx';

describe('dispatchCyclePlaybackRate', () => {
  let received;
  const listener = () => { received += 1; };
  beforeEach(() => { received = 0; window.addEventListener('player:cycle-playback-rate', listener); });
  afterEach(() => { window.removeEventListener('player:cycle-playback-rate', listener); });

  it('dispatches a player:cycle-playback-rate event', () => {
    dispatchCyclePlaybackRate();
    expect(received).toBe(1);
  });
});
