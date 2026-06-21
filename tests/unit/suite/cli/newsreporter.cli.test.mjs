import { describe, it, expect } from '@jest/globals';
import { parse, buildBody } from '#backend/../cli/newsreporter.cli.mjs';

describe('newsreporter CLI arg parser', () => {
  it('parses reporter id and all flags', () => {
    const p = parse(['world-cup-reporter', '--date', '2026-06-19', '--printer', 'downstairs', '--dry-run', '--force', '--base-url', 'http://x:9/']);
    expect(p).toMatchObject({
      id: 'world-cup-reporter',
      date: '2026-06-19',
      printer: 'downstairs',
      dryRun: true,
      force: true,
      baseUrl: 'http://x:9/',
      help: false,
    });
  });

  it('defaults to no overrides and the default base url', () => {
    const p = parse(['my-reporter']);
    expect(p.id).toBe('my-reporter');
    expect(p.dryRun).toBe(false);
    expect(p.force).toBe(false);
    expect(p.baseUrl).toBe(process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111');
  });

  it('flags help with -h/--help', () => {
    expect(parse(['-h']).help).toBe(true);
    expect(parse(['--help']).help).toBe(true);
  });

  it('throws on unknown flags', () => {
    expect(() => parse(['r', '--bogus'])).toThrow(/unknown flag/);
  });

  it('throws on a second positional arg', () => {
    expect(() => parse(['a', 'b'])).toThrow(/unexpected argument/);
  });

  it('buildBody omits absent overrides', () => {
    expect(buildBody({ date: null, printer: null, dryRun: false, force: false })).toEqual({});
    expect(buildBody({ date: '2026-06-19', printer: 'x', dryRun: true, force: true }))
      .toEqual({ date: '2026-06-19', printer: 'x', dryRun: true, force: true });
  });
});
