// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildGameRecordFilename } from './chessGameFilename.mjs';

describe('buildGameRecordFilename', () => {
  it('prefixes with the calendar day so the games directory still sorts by day', () => {
    const name = buildGameRecordFilename(new Date('2026-08-12T10:00:00Z'));
    expect(name.startsWith('2026-08-12-')).toBe(true);
  });

  it('does not collide across a burst of same-instant generations, since dataService.user.write overwrites whole files on a name collision', () => {
    // The reviewer measured 199,202 collisions in 200,000 back-to-back
    // Date.now()-only names. Fix the clock at a single instant here so the
    // test can't accidentally pass by crossing a millisecond boundary.
    const frozen = new Date(0);
    const names = new Set();
    for (let i = 0; i < 5000; i += 1) names.add(buildGameRecordFilename(frozen));
    expect(names.size).toBe(5000);
  });
});
