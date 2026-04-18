import { describe, it, expect } from 'vitest';
import { PLAYBACK_STATE_TOPIC, ERROR_CODES } from '#shared-contracts/media/index.mjs';

describe('shared-contracts import alias', () => {
  it('resolves from the backend via the alias', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
    expect(ERROR_CODES.DEVICE_OFFLINE).toBe('DEVICE_OFFLINE');
  });
});
