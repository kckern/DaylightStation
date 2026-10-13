import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The module memoizes its AudioContext for the life of the process, so each
 * test has to re-import it after installing its own stub — otherwise every cue
 * after the first is scheduled onto the previous test's context and the
 * assertions read an empty array.
 */
function stubAudio() {
  const started = [];
  const node = () => ({
    connect(next) { return next; },
    frequency: { setValueAtTime: () => {} },
    gain: {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    },
    start: (at) => started.push(at),
    stop: () => {},
    type: '',
  });
  window.AudioContext = function AudioContextStub() {
    return {
      currentTime: 0,
      state: 'running',
      destination: {},
      createOscillator: node,
      createGain: node,
      resume: () => {},
    };
  };
  return started;
}

async function freshModule() {
  vi.resetModules();
  return import('./chessSounds.js');
}

describe('chessSounds', () => {
  let started;
  beforeEach(() => { started = stubAudio(); });
  afterEach(() => { delete window.AudioContext; vi.restoreAllMocks(); });

  it('has a cue for every event the board can report', async () => {
    const { CUES } = await freshModule();
    expect(Object.keys(CUES).sort()).toEqual(
      ['capture', 'check', 'lose', 'move', 'promote', 'refuse', 'win'],
    );
  });

  it('schedules a single tone for a plain move', async () => {
    const { playCue } = await freshModule();
    playCue('move');
    expect(started).toHaveLength(1);
  });

  it('makes a capture audibly different from a quiet move', async () => {
    const { playCue } = await freshModule();
    playCue('capture');
    expect(started.length).toBeGreaterThan(1);
  });

  it('schedules the win phrase as a sequence, not a chord', async () => {
    const { playCue } = await freshModule();
    playCue('win');
    // Four notes, each later than the last — a phrase rather than a stack.
    expect(started).toHaveLength(4);
    expect([...started].sort((a, b) => a - b)).toEqual(started);
    expect(new Set(started).size).toBe(4);
  });

  it('does nothing at all for a name it does not have', async () => {
    const { playCue } = await freshModule();
    playCue('nonsense');
    expect(started).toHaveLength(0);
  });

  it('never throws when the platform has no audio', async () => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
    const { playCue } = await freshModule();
    // A WebView that refuses an AudioContext must cost the game nothing.
    expect(() => playCue('move')).not.toThrow();
    expect(started).toHaveLength(0);
  });
});
