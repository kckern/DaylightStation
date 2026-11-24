import { describe, it, expect } from 'vitest';
import { parse, buildRequest, decodePng } from './newsreporter.cli.mjs';

describe('newsreporter CLI — edition flags', () => {
  it('--compose --dry-run --out builds a dry-run compose', () => {
    const p = parse(['office-paper', '--compose', '--dry-run', '--out', '/tmp/p.png']);
    expect(p).toMatchObject({ id: 'office-paper', compose: true, dryRun: true, out: '/tmp/p.png' });
    expect(buildRequest(p)).toEqual({ path: '/api/v1/newsreporter/office-paper/compose', body: { dryRun: true } });
  });

  it('--deliver passes printer, force and date, and says it came from the CLI', () => {
    const p = parse(['office-paper', '--deliver', '--printer', 'upstairs', '--force', '--date', '2026-11-24']);
    expect(buildRequest(p)).toEqual({
      path: '/api/v1/newsreporter/office-paper/deliver',
      body: { date: '2026-11-24', printer: 'upstairs', force: true, trigger: 'cli' },
    });
  });

  it('no mode flag keeps the report-kind run', () => {
    expect(buildRequest(parse(['world-cup-reporter', '--dry-run']))).toEqual({ path: '/api/v1/newsreporter/world-cup-reporter/run', body: { dryRun: true } });
  });

  it('refuses --compose with --deliver, and --out without --compose', () => {
    expect(() => parse(['x', '--compose', '--deliver'])).toThrow(/separate steps/);
    expect(() => parse(['x', '--out', 'a.png'])).toThrow(/--out needs --compose/);
  });

  it('decodes base64 with or without a data: prefix', () => {
    const b64 = Buffer.from('PNGDATA').toString('base64');
    expect(decodePng(b64).toString()).toBe('PNGDATA');
    expect(decodePng(`data:image/png;base64,${b64}`).toString()).toBe('PNGDATA');
    expect(decodePng('')).toBeNull();
  });
});
