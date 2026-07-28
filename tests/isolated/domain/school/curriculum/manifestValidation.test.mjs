import { describe, it, expect } from 'vitest';
import { LOCATOR_KINDS, validateManifest } from '#domains/school/curriculum/manifestValidation.mjs';

const valid = (over = {}) => ({
  id: 'liberty-kids-01',
  locator: 'plex:619845',
  title: 'The Boston Tea Party',
  series: "Liberty's Kids",
  provenance: { source: 'plex-library-scan', addedBy: 'kc' },
  ...over,
});

const errs = (raw) => validateManifest(raw).errors;

describe('LOCATOR_KINDS', () => {
  it('is the table of known locator kinds — plex only, for now', () => {
    expect(Object.keys(LOCATOR_KINDS)).toEqual(['plex']);
  });

  it('is frozen — a new locator kind is a code change, never config', () => {
    expect(Object.isFrozen(LOCATOR_KINDS)).toBe(true);
  });
});

describe('validateManifest: shape', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'plex:619845'],
  ])('rejects a manifest that is %s', (_label, raw) => {
    expect(errs(raw)).toEqual(['manifest must be a mapping']);
  });

  it('does not throw on a self-referencing manifest', () => {
    const raw = valid();
    raw.provenance.manifest = raw;
    expect(() => validateManifest(raw)).not.toThrow();
    expect(errs(raw)).toEqual([]);
  });

  it('returns the normalised manifest only when it is valid', () => {
    expect(validateManifest(valid()).manifest).toMatchObject({
      id: 'liberty-kids-01',
      locator: 'plex:619845',
      title: 'The Boston Tea Party',
      series: "Liberty's Kids",
      aliases: [],
    });
    expect(validateManifest(valid({ title: '' })).manifest).toBeUndefined();
  });
});

describe('validateManifest: id', () => {
  it('accepts a lowercase slug', () => {
    expect(errs(valid({ id: 'liberty-kids-01' }))).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '  '],
    ['not a string', 12],
    ['missing', undefined],
  ])('rejects an id that is %s', (_label, id) => {
    expect(errs(valid({ id }))).toContain('id is required');
  });

  it.each([
    ['uppercase', 'Liberty-Kids'],
    ['leading hyphen', '-liberty'],
    ['a dot', 'liberty.kids'],
    ['a space', 'liberty kids'],
    ['an underscore', 'liberty_kids'],
  ])('rejects an id with %s', (_label, id) => {
    expect(errs(valid({ id }))).toContain(`id must match ^[a-z0-9][a-z0-9-]*$, got: ${id}`);
  });
});

describe('validateManifest: locator', () => {
  it('accepts a plex rating key locator', () => {
    expect(errs(valid({ locator: 'plex:0' }))).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['not a string', 619845],
    ['missing', undefined],
  ])('rejects a locator that is %s', (_label, locator) => {
    expect(errs(valid({ locator }))).toContain('locator is required');
  });

  it('rejects an unknown kind, naming it', () => {
    expect(errs(valid({ locator: 'jellyfin:abc' }))).toContain('unknown locator kind: jellyfin');
  });

  it('rejects a bare locator with no kind prefix', () => {
    expect(errs(valid({ locator: '619845' }))).toContain('unknown locator kind: 619845');
  });

  it.each([
    ['a non-numeric rating key', 'plex:abc'],
    ['an empty rating key', 'plex:'],
    ['trailing junk', 'plex:619845x'],
  ])('rejects %s', (_label, locator) => {
    expect(errs(valid({ locator }))).toContain(`locator is not a valid plex locator: ${locator}`);
  });
});

describe('validateManifest: durable metadata (spec §3.2 — a locator is not an identity)', () => {
  it('requires a title', () => {
    expect(errs(valid({ title: '   ' }))).toContain('title is required');
    expect(errs(valid({ title: undefined }))).toContain('title is required');
  });

  it('rejects a manifest carrying nothing but a locator and a title', () => {
    expect(errs(valid({ series: undefined })))
      .toContain('manifest needs series or aliases — a locator is not an identity');
  });

  it('accepts aliases alone as the durable identity', () => {
    expect(errs(valid({ series: undefined, aliases: ['Boston Tea Party', 'Tea Party episode'] }))).toEqual([]);
  });

  it('rejects a non-string series', () => {
    expect(errs(valid({ series: 42 }))).toContain('series must be a non-empty string');
  });

  it.each([
    ['empty', []],
    ['not an array', 'Boston Tea Party'],
    ['holding an empty string', ['Boston Tea Party', '  ']],
    ['holding a non-string', ['Boston Tea Party', { title: 'x' }]],
  ])('rejects aliases that are %s', (_label, aliases) => {
    expect(errs(valid({ series: undefined, aliases })))
      .toContain('aliases must be a non-empty array of non-empty strings');
  });

  it('does not accept malformed series/aliases as satisfying the durable rule', () => {
    expect(errs({ ...valid({ series: '  ' }) }))
      .toContain('manifest needs series or aliases — a locator is not an identity');
  });
});

describe('validateManifest: optional numerics', () => {
  it('accepts season and episode when integers >= 0', () => {
    expect(errs(valid({ season: 0, episode: 12 }))).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '1'],
    ['null', null],
  ])('rejects a season that is %s', (_label, season) => {
    expect(errs(valid({ season }))).toContain('season must be an integer >= 0');
  });

  it.each([
    ['negative', -1],
    ['fractional', 2.5],
    ['a numeric string', '2'],
  ])('rejects an episode that is %s', (_label, episode) => {
    expect(errs(valid({ episode }))).toContain('episode must be an integer >= 0');
  });

  it('accepts a positive integer durationSec', () => {
    expect(errs(valid({ durationSec: 1560 }))).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['negative', -10],
    ['fractional', 1560.5],
    ['a numeric string', '1560'],
  ])('rejects a durationSec that is %s', (_label, durationSec) => {
    expect(errs(valid({ durationSec }))).toContain('durationSec must be an integer > 0');
  });
});

describe('validateManifest: provenance', () => {
  it('accepts any object contents', () => {
    expect(errs(valid({ provenance: { anything: { nested: true } } }))).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['an array', []],
    ['a string', 'plex-library-scan'],
    ['null', null],
  ])('rejects provenance that is %s', (_label, provenance) => {
    expect(errs(valid({ provenance }))).toContain('provenance must be an object');
  });
});
