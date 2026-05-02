// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseArgv } from '../../../cli/_argv.mjs';

describe('parseArgv', () => {
  it('returns help=true for empty argv', () => {
    const r = parseArgv([]);
    expect(r.help).toBe(true);
    expect(r.subcommand).toBe(null);
  });

  it('returns help=true for --help', () => {
    expect(parseArgv(['--help']).help).toBe(true);
    expect(parseArgv(['-h']).help).toBe(true);
  });

  it('parses subcommand and action positionals', () => {
    const r = parseArgv(['ha', 'state', 'light.office']);
    expect(r.subcommand).toBe('ha');
    expect(r.positional).toEqual(['state', 'light.office']);
    expect(r.help).toBe(false);
  });

  it('parses --key value flags', () => {
    const r = parseArgv(['content', 'search', 'workout', '--source', 'plex', '--take', '5']);
    expect(r.subcommand).toBe('content');
    expect(r.positional).toEqual(['search', 'workout']);
    expect(r.flags).toEqual({ source: 'plex', take: '5' });
  });

  it('parses --bool flags as true when no value follows', () => {
    const r = parseArgv(['finance', 'accounts', '--refresh']);
    expect(r.flags.refresh).toBe(true);
  });

  it('treats subcommand-level --help as help-for-subcommand', () => {
    const r = parseArgv(['ha', '--help']);
    expect(r.subcommand).toBe('ha');
    expect(r.help).toBe(true);
  });

  it('stops flag parsing after --', () => {
    const r = parseArgv(['memory', 'write', 'notes', '--', '--literal-text']);
    expect(r.positional).toEqual(['write', 'notes', '--literal-text']);
    expect(r.flags).toEqual({});
  });

  it('preserves negative-number positionals (not flags)', () => {
    const r = parseArgv(['finance', 'add', '732539', '-50.00', 'Lunch']);
    expect(r.positional).toEqual(['add', '732539', '-50.00', 'Lunch']);
  });
});
