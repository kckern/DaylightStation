import { describe, it, expect } from 'vitest';
import { matchRingToClip } from './matchRingToClip.js';

const clip = (s, e, name) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), name, labels: [] });
const clips = [clip(1_000_000, 1_030_000, 'a'), clip(2_000_000, 2_040_000, 'b')];
describe('matchRingToClip', () => {
  it('prefers the clip the ring falls inside', () => { expect(matchRingToClip(1_010_000, clips).name).toBe('a'); });
  it('takes a clip that starts just after the ring', () => { expect(matchRingToClip(1_950_000, clips).name).toBe('b'); });
  it('no clip near the ring is null', () => { expect(matchRingToClip(1_500_000, clips)).toBeNull(); expect(matchRingToClip(1, [])).toBeNull(); });
});
