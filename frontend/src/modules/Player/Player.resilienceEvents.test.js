// Review SHOULD-FIX (a): resilience events added for Media (source waits,
// exhaustion before clear) must not reach existing `onError` owners —
// FitnessMusicPlayer shows "Music unavailable" on any onError and
// DancePartyWidget warns per event. They travel on the opt-in
// `onResilienceEvent` prop, which only Media's PlayerBridge passes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve(__dirname, 'Player.jsx'), 'utf8');

describe('Player resilience events are opt-in', () => {
  it('never routes the new kinds through onError', () => {
    expect(src).not.toMatch(/onError\?\.\(\{\s*kind:\s*'resilience-exhausted'/);
    expect(src).not.toMatch(/onError\?\.\(\{\s*kind:\s*event\.waiting/);
  });

  it('emits them on onResilienceEvent instead', () => {
    expect(src).toMatch(/onResilienceEvent\?\.\(\{\s*kind:\s*'resilience-exhausted'/);
    expect(src).toMatch(/onResilienceEvent\?\.\(\{\s*kind:\s*event\.waiting \? 'source-wait' : 'source-wait-ended'/);
  });
});
