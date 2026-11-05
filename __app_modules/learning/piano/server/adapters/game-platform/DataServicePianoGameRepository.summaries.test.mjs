import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataServicePianoGameRepository } from './DataServicePianoGameRepository.mjs';

const scratch = [];
afterEach(() => { for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-games-'));
  scratch.push(root);
  const dataService = {
    user: { resolveDir: (rel, user) => path.join(root, 'users', user, rel), read: () => null, write: () => true },
    household: { resolveDir: (rel) => path.join(root, 'household', rel), write: () => true },
  };
  const put = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  return { repository: new DataServicePianoGameRepository({ dataService, configService: {} }), put };
}

describe('DataServicePianoGameRepository.listGameSummaries', () => {
  it('reads per-user records and the household archive, filtered to the asked players', async () => {
    const { repository, put } = setup();
    put('users/kidB/apps/checkers/games/1.yml', 'result: win\nlevel: 4\ncompleted: true\nplayed_on: "2026-11-03"\ncreated_at: "2026-11-03T18:00:00Z"\nmoves: [1, 2]\n');
    put('household/gaming/log/checkers/2026-11-04/kidB-2.yml', 'result: loss\nlevel: 5\ncompleted: true\nuser_id: kidB\narchived_at: "2026-11-04T18:00:00Z"\n');
    put('household/gaming/log/checkers/2026-11-04/kidC-3.yml', 'result: win\nlevel: 1\ncompleted: true\nuser_id: kidC\n');
    put('household/gaming/log/checkers/2026-11-04/torn.yml', 'result: [unclosed\n');
    const out = await repository.listGameSummaries('checkers', ['kidB']);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({
      gameId: 'checkers', userId: 'kidB', result: 'win', completed: true, endedBy: null, level: 4,
      atMs: Date.parse('2026-11-03T18:00:00Z'), playedOn: '2026-11-03',
    });
    expect(out).toContainEqual(expect.objectContaining({ result: 'loss', level: 5, playedOn: '2026-11-04' }));
  });

  it('takes the chess opponent level from opponent.level and reads the pianochess archive too', async () => {
    const { repository, put } = setup();
    put('household/gaming/log/chess/2026-11-03/kidB_level5.yml', 'user_id: kidB\nresult: win\ncompleted: true\nended_by: game_over\nended_at: "2026-11-03T21:43:14Z"\nopponent:\n  level: 5\n  position: 6\n');
    put('household/gaming/log/pianochess/2026-08-24/kidB_level0.yml', 'user_id: kidB\nresult: null\ncompleted: false\nended_by: left\nopponent:\n  level: 0\n');
    const out = await repository.listGameSummaries('chess', ['kidB']);
    expect(out.map((g) => [g.level, g.result, g.endedBy])).toEqual(expect.arrayContaining([[5, 'win', 'game_over'], [0, null, 'left']]));
  });
});
