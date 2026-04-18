import { describe, it, expect } from 'vitest';
import { PLAYBACK_STATE_TOPIC } from '@shared-contracts/media/index.mjs';

describe('@shared-contracts alias', () => {
  it('resolves from frontend', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
  });
});
