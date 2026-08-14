import { describe, expect, it } from 'vitest';
import { MUSICAL_INPUT_TYPES, musicalInput } from './events.js';

describe('normalized musical input', () => {
  it('creates immutable timestamped events', () => {
    const event = musicalInput(MUSICAL_INPUT_TYPES.PITCH_ATTACK, { note: 60 }, 123);
    expect(event).toEqual({ type: 'pitch-attack', note: 60, timestamp: 123 });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('rejects unknown event types', () => {
    expect(() => musicalInput('mouse-click', {}, 0)).toThrow(/Unsupported musical input/);
  });
});
