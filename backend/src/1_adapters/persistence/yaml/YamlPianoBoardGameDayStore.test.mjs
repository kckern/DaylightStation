import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlPianoBoardGameDayStore } from './YamlPianoBoardGameDayStore.mjs';
import { BOARD_GAME_DAY_SCHEMA } from '#apps/piano-games/PianoBoardGameDayService.mjs';

const roots = [];

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('YamlPianoBoardGameDayStore', () => {
  it('round-trips one study day and creates an empty missing day', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-board-game-day-'));
    roots.push(root);
    const store = new YamlPianoBoardGameDayStore({ historyRoot: root });

    assert.deepEqual(store.loadDay('2026-08-28'), {
      schema: BOARD_GAME_DAY_SCHEMA,
      studyDate: '2026-08-28',
      learners: {},
    });

    const day = {
      schema: BOARD_GAME_DAY_SCHEMA,
      studyDate: '2026-08-28',
      learners: { Milo: { completedGames: 2, gameSessionIds: ['a', 'b'] } },
    };
    store.saveDay(day);
    assert.deepEqual(store.loadDay('2026-08-28'), day);
  });

  it('rejects unsafe study-day paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-board-game-day-'));
    roots.push(root);
    const store = new YamlPianoBoardGameDayStore({ historyRoot: root });
    assert.throws(() => store.loadDay('../outside'), /invalid study date/);
  });
});
