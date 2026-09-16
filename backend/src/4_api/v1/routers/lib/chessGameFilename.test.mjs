// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildChessArchiveFilename } from '../../../../1_adapters/persistence/chess/ChessRecordNames.mjs';

describe('buildChessArchiveFilename', () => {
  it('puts the game facts needed for a directory listing in the filename', () => {
    const name = buildChessArchiveFilename({
      opponent: { level: 0 }, duration_ms: 3_499_621, move_count: 94, result: 'loss', outcome: 'checkmate',
    }, 'learner3', new Date('2026-08-13T17:03:53.612Z'));
    expect(name).toMatch(/^learner3_level0_58m19s_94ply_loss_checkmate_2026-08-13T17-03-53-612Z-/);
  });

  it('honestly marks an archive made before opponent telemetry resolved', () => {
    const name = buildChessArchiveFilename({ duration_ms: 500, move_count: 1, ended_by: 'left' }, 'guest', new Date(0));
    expect(name).toMatch(/^guest_levelunknown_0s_1ply_quit_quit_1970-01-01T00-00-00-000Z-/);
  });
});
