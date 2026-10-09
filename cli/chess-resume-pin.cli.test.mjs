// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, run } from './chess-resume-pin.cli.mjs';
import { selectResumable } from '../shared/gaming/rulesets/chess/resumeSlot.mjs';
import incident from '../shared/gaming/rulesets/chess/__fixtures__/incident-74ply.json' with { type: 'json' };

const NOW = new Date('2026-10-09T15:00:00Z');
let data;
const put = (rel, value) => {
  const file = path.join(data, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value));
};
const tree = (root) => fs.readdirSync(root, { recursive: true }).sort();
const night = { ...incident, user_id: 'kid' };
const mv = (ply, from, to) => ({ ply, san: `${from}${to}`, from, to, undone: false });
const morning = {
  game_id: 'chess-morning', user_id: 'kid', started_at: '2026-10-09T13:00:00.000Z', ended_at: '2026-10-09T13:20:00.000Z',
  completed: false, ended_by: 'left', initial_fen: incident.initial_fen, moves: [mv(1, 'd2', 'd4')], move_count: 1,
};

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-pin-'));
  put('household/gaming/log/chess/2026-10-08/night.yml', night);
  put('household/gaming/log/chess/2026-10-09/morning.yml', morning);
});

describe('chess-resume-pin', () => {
  it('parses arguments', () => {
    expect(parseArgs(['--user', 'kid', '--game', 'g', '--write', '--data', '/d'])).toMatchObject({ user: 'kid', game: 'g', write: true, data: '/d' });
    expect(() => parseArgs(['--user'])).toThrow(/requires a value/);
  });

  it('dry run touches nothing', () => {
    const before = tree(data);
    const result = run({ user: 'kid', game: night.game_id, data, write: false }, { now: NOW, log() {} });
    expect(result.wrote).toBe(false);
    expect(tree(data)).toEqual(before);
  });

  it('pins last night over this morning, files the morning game as superseded, deletes nothing', () => {
    run({ user: 'kid', game: night.game_id, data, write: true }, { now: NOW, log() {} });
    const slot = YAML.parse(fs.readFileSync(path.join(data, 'users/kid/apps/chess/resume.yml'), 'utf8'));
    expect(slot.pinned).toBe(night.game_id);
    expect(slot.games['chess-morning'].state).toBe('superseded');
    const pick = selectResumable(slot, { now: NOW, maxDays: 3 });
    expect(pick).toMatchObject({ gameId: night.game_id, pinned: true });
    expect(pick.record.final_fen).toBe(incident.final_fen);
    // archive untouched
    expect(fs.existsSync(path.join(data, 'household/gaming/log/chess/2026-10-09/morning.yml'))).toBe(true);
  });

  it('is idempotent', () => {
    run({ user: 'kid', game: night.game_id, data, write: true }, { now: NOW, log() {} });
    const first = fs.readFileSync(path.join(data, 'users/kid/apps/chess/resume.yml'), 'utf8');
    run({ user: 'kid', game: night.game_id, data, write: true }, { now: NOW, log() {} });
    expect(fs.readFileSync(path.join(data, 'users/kid/apps/chess/resume.yml'), 'utf8')).toBe(first);
  });

  it('refuses an unknown game, another player\'s game, and a finished game', () => {
    expect(() => run({ user: 'kid', game: 'nope', data, write: true }, { log() {} })).toThrow(/No archived game/);
    expect(() => run({ user: 'other', game: night.game_id, data, write: true }, { log() {} })).toThrow(/No archived game/);
    put('household/gaming/log/chess/2026-10-08/done.yml', { ...night, game_id: 'done', completed: true, ended_by: 'game_over', result: 'win' });
    expect(() => run({ user: 'kid', game: 'done', data, write: true }, { log() {} })).toThrow(/finished/);
  });

  it('rejects an unsafe user or game id', () => {
    expect(() => run({ user: '../x', game: 'g', data }, { log() {} })).toThrow(/--user/);
    expect(() => run({ user: 'kid', game: 'a/b', data }, { log() {} })).toThrow(/--game/);
  });
});
