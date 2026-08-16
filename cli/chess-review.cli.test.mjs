import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findGames, parseArgs, renderTrend } from './chess-review.cli.mjs';

describe('parseArgs', () => {
  it('defaults to a full report at a reproducible depth', () => {
    const options = parseArgs([]);
    expect(options.format).toBe('report');
    expect(options.depth).toBe(16);
    expect(options.all).toBe(false);
  });

  it('reads selection and output flags', () => {
    const options = parseArgs(['--user', 'test-user', '--date', '2026-08-15', '--brief']);
    expect(options).toMatchObject({ user: 'test-user', date: '2026-08-15', brief: true });
  });

  it('takes a bare path as the file', () => {
    expect(parseArgs(['/tmp/game.yml']).file).toBe('/tmp/game.yml');
  });

  it('rejects a flag with no value rather than swallowing the next flag', () => {
    expect(() => parseArgs(['--user', '--json'])).toThrow(/requires a value/);
  });

  it('refuses two output formats at once', () => {
    expect(() => parseArgs(['--pgn', '--json'])).toThrow(/one output format/);
  });

  it('rejects a depth outside the useful range', () => {
    expect(() => parseArgs(['--depth', '2'])).toThrow(/--depth/);
    expect(() => parseArgs(['--depth', '99'])).toThrow(/--depth/);
    expect(() => parseArgs(['--depth', 'deep'])).toThrow(/--depth/);
  });

  it('widens the selection for --trend, which is meaningless over one game', () => {
    expect(parseArgs(['--trend']).all).toBe(true);
  });

  it('leaves an explicit --trend selection alone', () => {
    expect(parseArgs(['--trend', '--date', '2026-08-15']).all).toBe(false);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('findGames', () => {
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-archive-'));
    for (const [day, names] of [
      ['2026-08-14', ['test-user_level0_a.yml', 'other-user_level2_b.yml']],
      ['2026-08-15', ['test-user_level0_c.yml', 'notes.txt']],
    ]) {
      fs.mkdirSync(path.join(root, day));
      for (const name of names) fs.writeFileSync(path.join(root, day, name), '{}');
    }
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('returns newest first, so --latest means latest', () => {
    const games = findGames({ root });
    expect(games[0].day).toBe('2026-08-15');
  });

  it('filters by user from the filename, without parsing every game', () => {
    expect(findGames({ root, user: 'test-user' })).toHaveLength(2);
    expect(findGames({ root, user: 'other-user' })).toHaveLength(1);
  });

  it('filters to a single day', () => {
    expect(findGames({ root, date: '2026-08-14' })).toHaveLength(2);
  });

  it('filters from a start date', () => {
    expect(findGames({ root, since: '2026-08-15' })).toHaveLength(1);
  });

  it('ignores non-YAML files sitting in the archive', () => {
    expect(findGames({ root }).some((game) => game.name.endsWith('.txt'))).toBe(false);
  });

  it('returns nothing for a missing archive rather than throwing', () => {
    expect(findGames({ root: path.join(root, 'nope') })).toEqual([]);
  });
});

describe('renderTrend', () => {
  const row = (over) => ({
    played_on: '2026-08-15', opponent: 'Caterpie', result: 'loss', acpl: 100, blunders: 2, opponentAcpl: 70, ...over,
  });

  it('summarises the set with a band', () => {
    const text = renderTrend([row(), row({ acpl: 120 })]);
    expect(text).toContain('2 games');
    expect(text).toContain('110 ACPL');
  });

  it('calls out a direction only once there are enough games', () => {
    const few = renderTrend([row(), row()]);
    expect(few).not.toContain('improving');

    // Newest first, so the LAST rows are the oldest: 200s early, 50s late.
    const many = renderTrend([
      row({ acpl: 50 }), row({ acpl: 50 }), row({ acpl: 50 }),
      row({ acpl: 200 }), row({ acpl: 200 }), row({ acpl: 200 }),
    ]);
    expect(many).toContain('improving');
  });

  it('reads a flat run as flat rather than as a trend', () => {
    const rows = Array.from({ length: 6 }, () => row({ acpl: 100 }));
    expect(renderTrend(rows)).toContain('flat');
  });
});
