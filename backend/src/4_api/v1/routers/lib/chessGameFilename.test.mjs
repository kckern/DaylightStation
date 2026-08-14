// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildChessArchiveFilename, buildGameRecordFilename } from './chessGameFilename.mjs';

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

describe('buildChessArchiveFilename', () => {
  it('puts the game facts needed for a directory listing in the filename', () => {
    const name = buildChessArchiveFilename({
      opponent: { level: 0 }, duration_ms: 3_499_621, move_count: 94, result: 'loss', outcome: 'checkmate',
    }, 'milo', new Date('2026-08-13T17:03:53.612Z'));
    expect(name).toMatch(/^milo_level0_58m19s_94ply_loss_checkmate_2026-08-13T17-03-53-612Z-/);
  });

  it('honestly marks an archive made before opponent telemetry resolved', () => {
    const name = buildChessArchiveFilename({ duration_ms: 500, move_count: 1, ended_by: 'left' }, 'guest', new Date(0));
    expect(name).toMatch(/^guest_levelunknown_0s_1ply_quit_quit_1970-01-01T00-00-00-000Z-/);
  });
});
