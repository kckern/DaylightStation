// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, renderReport, run } from './chess-backfill.cli.mjs';

const NOW = new Date('2026-09-15T12:00:00');
const DELETED = '_deleteme/2026-09-15-chess-record-consolidation';

const put = (root, rel, value) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value));
};
const read = (root, rel) => YAML.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const tree = (root) => {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  };
  walk(root);
  return files;
};
const game = (over) => ({
  completed: true, ended_by: 'game_over', user_id: 'kid', result: 'win', outcome: 'checkmate',
  help: { hints: 0, best_moves: 0, takebacks: 0 }, moves: [{ san: 'e4' }], move_count: 1, ...over,
});

let data;

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-backfill-'));
  put(data, 'household/gaming/chess.yml', { ladder: { roster_pack: 'generic', promotion: { window: 7, wins_required: 5 } } });
  put(data, 'users/kid/apps/chess/config.yml', { ladder: { roster_pack: 'pokemon' } });
  put(data, 'users/kid/apps/chess/ladder.yml', { unlocked_through: 0, results: [] });
  put(data, 'users/kid/apps/chess/rivalries.yml', { version: 2, rivals: {} });
  // Old directory, old filename, no opponent: from before ladder telemetry.
  put(data, 'household/gaming/log/pianochess/2026-08-13/kid-2026-08-13T17-03-53-612Z.yml', game({
    game_id: 'chess-1', result: 'loss', ended_at: '2026-08-13T17:03:52.804Z', archived_at: '2026-08-13T17:03:53.612Z',
    duration_ms: 3_499_621, help: { hints: 21, best_moves: 30, takebacks: 0 },
  }));
  // Old directory, current filename, an opponent with a name but no id yet.
  put(data, 'household/gaming/log/pianochess/2026-08-23/kid_level0_31m29s_1ply_win_checkmate_2026-08-23T23-44-11-865Z-aaaa.yml', game({
    game_id: 'chess-2', ended_at: '2026-08-23T23:44:11.850Z', duration_ms: 1_889_550, opponent: { level: 0, name: 'Caterpie' },
  }));
  // An abandoned game, which neither the ladder nor rivalry memory ever saw.
  put(data, 'household/gaming/log/pianochess/2026-08-24/kid_level0_2m38s_7ply_quit_quit_2026-08-24T16-30-30-633Z-bbbb.yml', game({
    game_id: 'chess-3', completed: false, ended_by: 'left', result: null, ended_at: '2026-08-24T16:30:30.000Z',
    opponent: { level: 0, name: 'Caterpie' },
  }));
  // Current directory, carrying the id the old records lacked.
  put(data, 'household/gaming/log/chess/2026-09-13/kid_level0_18m31s_1ply_win_checkmate_2026-09-13T16-12-09-595Z-cccc.yml', game({
    game_id: 'chess-4', ended_at: '2026-09-13T16:12:08.352Z', duration_ms: 1_111_425,
    opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
  }));
  // Scorecards: one from before game ids, one with an id, one the archive never received.
  put(data, 'users/kid/apps/chess/games/2026-08-23-1111.yml', { result: 'win', duration_ms: 1_889_550, user_id: 'kid' });
  put(data, 'users/kid/apps/chess/games/2026-09-13-2222.yml', { game_id: 'chess-4', result: 'win', duration_ms: 1_111_425, user_id: 'kid' });
  put(data, 'users/kid/apps/chess/games/2026-09-14-3333.yml', { game_id: 'chess-99', result: 'win', duration_ms: 5, user_id: 'kid' });
});

afterEach(() => fs.rmSync(data, { recursive: true, force: true }));

describe('parseArgs', () => {
  it('is a dry run unless told to write', () => {
    expect(parseArgs(['--data', '/srv/data'])).toMatchObject({ data: '/srv/data', write: false, user: null });
    expect(parseArgs(['--data', '/srv/data', '--write', '--user', 'kid'])).toMatchObject({ write: true, user: 'kid' });
  });

  it('refuses a flag without its value, and an unknown flag', () => {
    expect(() => parseArgs(['--data'])).toThrow('--data requires a value');
    expect(() => parseArgs(['--force'])).toThrow('Unknown argument: --force');
  });

  it('accepts --allow-decrease', () => {
    expect(parseArgs(['--data', '/srv/data'])).toMatchObject({ allowDecrease: false });
    expect(parseArgs(['--data', '/srv/data', '--write', '--allow-decrease'])).toMatchObject({ allowDecrease: true });
  });
});

describe('dry run', () => {
  it('reports the whole plan and changes nothing on disk', async () => {
    const before = tree(data);
    const report = await run({ data, now: NOW });
    expect(tree(data)).toEqual(before);
    expect(report.consolidation).toMatchObject({ moved: 3, renamed: 1, conflicts: [] });
    expect(report.scorecards.kid).toEqual({ matched: 2, unmatched: ['2026-09-14-3333.yml'] });
    expect(report.derived.kid.rivalries.after).toEqual({ 'Caterpie (pokemon:level-1)': '2-0-0' });
    expect(renderReport(report)).toContain('DRY RUN');
  });

  it('flags a DECREASE, but never refuses, when the stored ladder counts more wins than the archive supports', async () => {
    // The stored ladder claims four counted wins at level 1 - the archive holds none.
    put(data, 'users/kid/apps/chess/ladder.yml', {
      unlocked_through: 1,
      results: [1, 2, 3, 4].map((n) => ({ level: 1, result: 'win', counted: true, at: `2026-09-0${n}T00:00:00.000Z` })),
    });
    const before = tree(data);
    const report = await run({ data, now: NOW });
    expect(tree(data)).toEqual(before);
    expect(report.decreases.kid.some((line) => /ladder wins/.test(line))).toBe(true);
    expect(renderReport(report)).toMatch(/DECREASE/);
  });
});

describe('--write', () => {
  it('moves the old archive in under current names and retires the old directory', async () => {
    await run({ data, write: true, now: NOW });
    const files = tree(data);
    expect(files.some((file) => file.startsWith('household/gaming/log/pianochess'))).toBe(false);
    expect(fs.existsSync(path.join(data, DELETED, 'pianochess-archive'))).toBe(true);
    const aug13 = files.filter((file) => file.startsWith('household/gaming/log/chess/2026-08-13/'));
    expect(aug13).toHaveLength(1);
    expect(path.basename(aug13[0])).toMatch(/^kid_levelunknown_58m19s_1ply_loss_checkmate_2026-08-13T17-03-53-612Z-.+\.yml$/);
    expect(files).toContain('household/gaming/log/chess/2026-08-23/kid_level0_31m29s_1ply_win_checkmate_2026-08-23T23-44-11-865Z-aaaa.yml');
  });

  it('retires only the scorecards the archive holds', async () => {
    await run({ data, write: true, now: NOW });
    expect(fs.readdirSync(path.join(data, 'users/kid/apps/chess/games'))).toEqual(['2026-09-14-3333.yml']);
    expect(fs.readdirSync(path.join(data, DELETED, 'scorecards/kid')).sort()).toEqual(['2026-08-23-1111.yml', '2026-09-13-2222.yml']);
  });

  it('rebuilds the ladder and rivalry files from every finished game, with real times', async () => {
    await run({ data, write: true, now: NOW });
    const ladder = read(data, 'users/kid/apps/chess/ladder.yml');
    expect(ladder).toEqual({
      unlocked_through: 0,
      results: [
        { level: 0, result: 'loss', counted: false, at: '2026-08-13T17:03:52.804Z' },
        { level: 0, result: 'win', counted: true, at: '2026-08-23T23:44:11.850Z' },
        { level: 0, result: 'win', counted: true, at: '2026-09-13T16:12:08.352Z' },
      ],
    });
    const rivalries = read(data, 'users/kid/apps/chess/rivalries.yml');
    expect(Object.keys(rivalries.rivals)).toEqual(['pokemon:level-1']);
    expect(rivalries.rivals['pokemon:level-1'].record).toEqual({ win: 2, loss: 0, draw: 0 });
  });

  it('recognizes a legacy game the current archive already holds, and never files it twice', async () => {
    const dup = game({
      game_id: 'chess-dup', ended_at: '2026-08-20T10:00:00.000Z',
      opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    });
    // Already in the current archive, filed under its real current-style name.
    put(data, 'household/gaming/log/chess/2026-08-20/kid_level0_0s_1ply_win_checkmate_2026-08-20T10-00-00-000Z-real.yml', dup);
    // The same game, duplicated in the legacy directory: once under an old-style name...
    put(data, 'household/gaming/log/pianochess/2026-08-20/kid-2026-08-20T10-00-00-000Z.yml', dup);
    // ...and once under a name identical to the one already filed, which used to be a permanent conflict.
    put(data, 'household/gaming/log/pianochess/2026-08-20/kid_level0_0s_1ply_win_checkmate_2026-08-20T10-00-00-000Z-real.yml', dup);

    const report = await run({ data, write: true, now: NOW });
    expect(report.consolidation.alreadyArchived).toBe(2);
    expect(report.consolidation.conflicts).toEqual([]);
    const currentDay = tree(data).filter((file) => file.startsWith('household/gaming/log/chess/2026-08-20/'));
    expect(currentDay).toHaveLength(1);
    expect(fs.existsSync(path.join(data, DELETED, 'pianochess-archive'))).toBe(true);
  });

  it('dedupes an id-less legacy game by its identity fields, not its filename, so it is never counted twice', async () => {
    const record = game({
      ended_at: '2026-08-25T10:00:00.000Z', move_count: 5,
      opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    });
    // Already in the current archive, under its real current-style name.
    put(data, 'household/gaming/log/chess/2026-08-25/kid_level0_0s_5ply_win_checkmate_2026-08-25T10-00-00-000Z-real.yml', record);
    // The identical game, no game_id on either copy, filed under a completely different legacy filename.
    put(data, 'household/gaming/log/pianochess/2026-08-25/kid-2026-08-25T10-00-00-000Z.yml', record);

    const report = await run({ data, write: true, now: NOW });
    expect(report.consolidation.alreadyArchived).toBe(1);
    const currentDay = tree(data).filter((file) => file.startsWith('household/gaming/log/chess/2026-08-25/'));
    expect(currentDay).toHaveLength(1);
    const ladder = read(data, 'users/kid/apps/chess/ladder.yml');
    expect(ladder.results.filter((entry) => entry.at === '2026-08-25T10:00:00.000Z')).toHaveLength(1);
  });

  it('dedupes an id-less legacy duplicate even when only one copy recorded move_count', async () => {
    const withCount = game({
      ended_at: '2026-08-26T10:00:00.000Z',
      moves: [{ san: 'e4' }, { san: 'e5' }],
      move_count: 2,
      opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    });
    const withoutCount = { ...withCount };
    delete withoutCount.move_count;
    // Already in the current archive, under its real current-style name, with move_count set.
    put(data, 'household/gaming/log/chess/2026-08-26/kid_level0_0s_2ply_win_checkmate_2026-08-26T10-00-00-000Z-real.yml', withCount);
    // The identical game in the legacy directory, but its record never recorded move_count.
    put(data, 'household/gaming/log/pianochess/2026-08-26/kid-2026-08-26T10-00-00-000Z.yml', withoutCount);

    const report = await run({ data, write: true, now: NOW });
    expect(report.consolidation.alreadyArchived).toBe(1);
    const currentDay = tree(data).filter((file) => file.startsWith('household/gaming/log/chess/2026-08-26/'));
    expect(currentDay).toHaveLength(1);
  });

  it('derives a ply count for a renamed legacy file that never recorded move_count, without rewriting its content', async () => {
    const record = game({
      game_id: 'chess-noply', ended_at: '2026-08-22T09:00:00.000Z', archived_at: '2026-08-22T09:00:01.000Z',
      moves: [{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }],
    });
    delete record.move_count;
    put(data, 'household/gaming/log/pianochess/2026-08-22/kid-2026-08-22T09-00-01-000Z.yml', record);
    await run({ data, write: true, now: NOW });
    const files = tree(data).filter((file) => file.startsWith('household/gaming/log/chess/2026-08-22/'));
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toMatch(/_3ply_/);
    expect(read(data, files[0]).move_count).toBeUndefined();
  });

  it('never overwrites an existing copy already in _deleteme, appending -1 to a taken destination', async () => {
    put(data, `${DELETED}/scorecards/kid/2026-08-23-1111.yml`, { already: 'here' });
    await run({ data, write: true, now: NOW });
    expect(read(data, `${DELETED}/scorecards/kid/2026-08-23-1111.yml`)).toEqual({ already: 'here' });
    expect(read(data, `${DELETED}/scorecards/kid/2026-08-23-1111-1.yml`)).toEqual({ result: 'win', duration_ms: 1_889_550, user_id: 'kid' });
  });

  it('creates no chess profile for a player who never had one', async () => {
    put(data, 'users/visitor/profile.yml', { name: 'Visitor' });
    put(data, 'household/gaming/log/chess/2026-09-13/visitor_level0_1s_1ply_win_checkmate_2026-09-13T10-00-00-000Z-dddd.yml', game({
      game_id: 'chess-5', user_id: 'visitor', ended_at: '2026-09-13T10:00:00.000Z', opponent: { level: 0, name: 'Pip' },
    }));
    const report = await run({ data, write: true, now: NOW });
    expect(report.derived.visitor).toEqual({ games: 1, skipped: 'no chess profile' });
    expect(fs.existsSync(path.join(data, 'users/visitor/apps'))).toBe(false);
  });

  it("keeps a copy of each player's derived files as they were before the first write", async () => {
    // A stale rival the archive knows nothing about: this is itself a
    // decrease (FI1) once the ladder is replayed, so both writes need
    // allowDecrease — the point of this test is the backup, not the guard.
    put(data, 'users/kid/apps/chess/rivalries.yml', { version: 2, rivals: { stale: { opponent: { id: 'stale', name: 'Old' }, record: { win: 9, loss: 0, draw: 0 }, recent: [] } } });
    await run({
      data, write: true, allowDecrease: true, now: NOW,
    });
    await run({
      data, write: true, allowDecrease: true, now: NOW,
    });
    const backup = read(data, `${DELETED}/derived-before/kid/rivalries.yml`);
    expect(backup.rivals.stale.record.win).toBe(9);
    expect(read(data, `${DELETED}/derived-before/kid/ladder.yml`)).toEqual({ unlocked_through: 0, results: [] });
  });

  it('refuses to write anything when counted progress would decrease, naming the player', async () => {
    put(data, 'users/kid/apps/chess/ladder.yml', {
      unlocked_through: 1,
      results: [1, 2, 3, 4].map((n) => ({ level: 1, result: 'win', counted: true, at: `2026-09-0${n}T00:00:00.000Z` })),
    });
    const before = tree(data);
    const beforeLadder = read(data, 'users/kid/apps/chess/ladder.yml');
    await expect(run({ data, write: true, now: NOW })).rejects.toThrow(/kid/);
    expect(tree(data)).toEqual(before);
    expect(read(data, 'users/kid/apps/chess/ladder.yml')).toEqual(beforeLadder);
  });

  it('never reports a promotion as a decrease, even with fewer wins counted at the new rung', async () => {
    put(data, 'users/kid/apps/chess/ladder.yml', {
      unlocked_through: 1,
      results: [1, 2, 3, 4].map((n) => ({ level: 1, result: 'win', counted: true, at: `2026-09-0${n}T00:00:00.000Z` })),
    });
    // One archived game proves level 2 was played, which promotes the replay
    // past the stored level and, with it, only one counted win at the new rung.
    put(data, 'household/gaming/log/chess/2026-09-14/kid_level2_0s_1ply_win_checkmate_2026-09-14T09-00-00-000Z-prom.yml', game({
      game_id: 'chess-promo', ended_at: '2026-09-14T09:00:00.000Z', level: 2,
    }));
    const report = await run({ data, write: true, now: NOW });
    expect(report.derived.kid.ladder.after).toMatchObject({ unlocked_through: 2, wins: 1 });
    expect(report.decreases.kid).toBeUndefined();
  });

  it('writes anyway when allowDecrease is passed', async () => {
    put(data, 'users/kid/apps/chess/ladder.yml', {
      unlocked_through: 1,
      results: [1, 2, 3, 4].map((n) => ({ level: 1, result: 'win', counted: true, at: `2026-09-0${n}T00:00:00.000Z` })),
    });
    const report = await run({
      data, write: true, allowDecrease: true, now: NOW,
    });
    expect(report.write).toBe(true);
    expect(report.decreases.kid.length).toBeGreaterThan(0);
    // unlocked_through is a floor: even an allowed decrease never lowers it.
    expect(read(data, 'users/kid/apps/chess/ladder.yml').unlocked_through).toBe(1);
  });

  it('validates the household chess config before moving anything, and leaves the tree unchanged if it is missing', async () => {
    fs.rmSync(path.join(data, 'household/gaming/chess.yml'));
    const before = tree(data);
    await expect(run({ data, write: true, now: NOW })).rejects.toThrow(/household chess config/);
    expect(tree(data)).toEqual(before);
  });

  it('recovers a level from the matching scorecard for an archive record that has none, avoiding a false DECREASE', async () => {
    // Isolate: only the level-less game under test, so the ladder replay is
    // predictable without accounting for the shared fixture's other games.
    fs.rmSync(path.join(data, 'household/gaming/log/pianochess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'household/gaming/log/chess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'users/kid/apps/chess/games'), { recursive: true, force: true });
    const archiveFile = 'household/gaming/log/chess/2026-08-21/kid_levelunknown_0s_1ply_win_checkmate_2026-08-21T10-00-00-000Z-aaaa.yml';
    // An old archive record with no `level` and no `opponent`: nothing left in
    // the archive says what level it was played at.
    put(data, archiveFile, game({ game_id: 'chess-noLevel', ended_at: '2026-08-21T10:00:00.000Z', opponent: null }));
    // The retiring scorecard for the same game is the only place level 2 survives.
    put(data, 'users/kid/apps/chess/games/2026-08-21-9999.yml', {
      game_id: 'chess-noLevel', level: 2, user_id: 'kid', result: 'win',
    });
    put(data, 'users/kid/apps/chess/ladder.yml', {
      unlocked_through: 2,
      results: [{
        level: 2, result: 'win', counted: true, at: '2026-08-21T10:00:00.000Z',
      }],
    });
    const beforeContent = read(data, archiveFile);

    const report = await run({
      data, write: true, now: NOW,
    });

    expect(report.levelsRecovered).toBe(1);
    expect(report.derived.kid.ladder.after).toEqual({
      unlocked_through: 2, wins: 1, needed: 5, results: 1,
    });
    expect(report.decreases.kid).toBeUndefined();
    expect(renderReport(report)).toContain('Levels recovered from scorecards: 1');
    // Enrichment is in-memory only: the archived file itself is never rewritten.
    expect(read(data, archiveFile)).toEqual(beforeContent);
    expect(read(data, archiveFile).level).toBeUndefined();
    // The recovered level is for the ladder replay only — the record still
    // has no `opponent` block, so it must never fabricate a nameless rival
    // (G1: this game used to mint `chess:level-3` under a `pokemon` roster).
    expect(report.derived.kid.rivalries.after).toEqual({});
    expect(read(data, 'users/kid/apps/chess/rivalries.yml').rivals).toEqual({});
  });

  it('re-keying a rival to a new id is not a decrease when the new totals are equal or higher, and is reported as a re-key', async () => {
    // Isolate: only the re-key scenario, so the totals are exactly what the
    // test sets up rather than the shared fixture's other games.
    fs.rmSync(path.join(data, 'household/gaming/log/pianochess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'household/gaming/log/chess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'users/kid/apps/chess/games'), { recursive: true, force: true });
    // Stored rivalry memory keyed under the pre-migration id nothing reads any more.
    put(data, 'users/kid/apps/chess/rivalries.yml', {
      version: 2,
      rivals: { 'chess:level-1': { opponent: { id: 'chess:level-1', name: 'Caterpie' }, record: { win: 3, loss: 0, draw: 0 }, recent: [] } },
    });
    // Every archived game carries the live `pokemon` id: 3 wins, 2 losses.
    for (let n = 1; n <= 3; n += 1) {
      put(data, `household/gaming/log/chess/2026-08-2${n}/kid_level0_1s_1ply_win_checkmate_2026-08-2${n}T10-00-00-000Z-w${n}.yml`, game({
        game_id: `rekey-win-${n}`, ended_at: `2026-08-2${n}T10:00:00.000Z`, opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
      }));
    }
    for (let n = 4; n <= 5; n += 1) {
      put(data, `household/gaming/log/chess/2026-08-2${n}/kid_level0_1s_1ply_loss_checkmate_2026-08-2${n}T10-00-00-000Z-l${n}.yml`, game({
        game_id: `rekey-loss-${n}`, result: 'loss', ended_at: `2026-08-2${n}T10:00:00.000Z`, opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
      }));
    }
    const report = await run({ data, now: NOW });
    expect(report.decreases.kid).toBeUndefined();
    const rendered = renderReport(report);
    expect(rendered).toContain('re-keyed: Caterpie chess:level-1 -> pokemon:level-1 (3-0-0 -> 3-2-0)');
    expect(rendered).not.toMatch(/DECREASE/);
  });

  it('still reports a decrease when a re-keyed rival\'s totals actually fall', async () => {
    fs.rmSync(path.join(data, 'household/gaming/log/pianochess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'household/gaming/log/chess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'users/kid/apps/chess/games'), { recursive: true, force: true });
    put(data, 'users/kid/apps/chess/rivalries.yml', {
      version: 2,
      rivals: { 'chess:level-1': { opponent: { id: 'chess:level-1', name: 'Caterpie' }, record: { win: 5, loss: 0, draw: 0 }, recent: [] } },
    });
    // Only one archived win survives under the live id — real lost ground, not a re-key.
    put(data, 'household/gaming/log/chess/2026-08-21/kid_level0_1s_1ply_win_checkmate_2026-08-21T10-00-00-000Z-w1.yml', game({
      game_id: 'rekey-fall-1', ended_at: '2026-08-21T10:00:00.000Z', opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    }));
    const report = await run({ data, now: NOW });
    expect(report.decreases.kid).toEqual(['rival Caterpie (chess:level-1) disappeared, was 5-0-0']);
    expect(renderReport(report)).toMatch(/DECREASE/);
  });

  it('still reports a decrease when a rival vanishes with no same-name replacement', async () => {
    fs.rmSync(path.join(data, 'household/gaming/log/pianochess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'household/gaming/log/chess'), { recursive: true, force: true });
    fs.rmSync(path.join(data, 'users/kid/apps/chess/games'), { recursive: true, force: true });
    put(data, 'users/kid/apps/chess/rivalries.yml', {
      version: 2,
      rivals: { 'pokemon:level-2': { opponent: { id: 'pokemon:level-2', name: 'Weedle' }, record: { win: 2, loss: 0, draw: 0 }, recent: [] } },
    });
    // The archive holds a completely different opponent — no same-name candidate anywhere.
    put(data, 'household/gaming/log/chess/2026-08-21/kid_level0_1s_1ply_win_checkmate_2026-08-21T10-00-00-000Z-w1.yml', game({
      game_id: 'other-opponent-1', ended_at: '2026-08-21T10:00:00.000Z', opponent: { level: 0, name: 'Metapod', id: 'pokemon:level-3' },
    }));
    const report = await run({ data, now: NOW });
    expect(report.decreases.kid).toEqual(['rival Weedle (pokemon:level-2) disappeared, was 2-0-0']);
    expect(renderReport(report)).toMatch(/DECREASE/);
  });

  it('is safe to run twice', async () => {
    await run({ data, write: true, now: NOW });
    const once = tree(data);
    const again = await run({ data, write: true, now: NOW });
    expect(tree(data)).toEqual(once);
    expect(again.consolidation.moved).toBe(0);
    expect(again.scorecards.kid).toEqual({ matched: 0, unmatched: ['2026-09-14-3333.yml'] });
  });
});
