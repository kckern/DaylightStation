import { describe, it, expect } from 'vitest';
import { parseEditionConfig, checkEditionSources, isEditionReporter } from './editionConfig.mjs';
import { sampleEditionConfig } from './fixtures/editionFixtures.mjs';

describe('parseEditionConfig', () => {
  it('accepts the spec config and fills defaults', () => {
    const cfg = parseEditionConfig(sampleEditionConfig());
    expect(cfg.kind).toBe('edition');
    expect(cfg.news.categories[1].optional).toBe(false);
    expect(cfg.day.rotation.slots).toBe(1);
    expect(cfg.day.weather.weight).toBe(1);
  });

  it('defaults deliver.fallback to false and expiry to noon', () => {
    const raw = sampleEditionConfig({ deliver: { printer: 'office' } });
    const cfg = parseEditionConfig(raw);
    expect(cfg.deliver).toEqual({ printer: 'office', fallback: false, once_per_day: true, expires_after: '12:00' });
  });

  it('rejects a repeated category id, naming the key', () => {
    const raw = sampleEditionConfig();
    raw.news.categories[2].id = 'us';
    expect(() => parseEditionConfig(raw, 'office-paper')).toThrow(/news\.categories\[2\]\.id: category id "us" repeats/);
  });

  it('rejects an unknown day module, naming it', () => {
    const raw = sampleEditionConfig();
    raw.day.horoscope = { show: 'always' };
    let error;
    try { parseEditionConfig(raw); } catch (e) { error = e; }
    expect(error?.name).toBe('ValidationError');
    expect(error.message).toMatch(/day/);
    expect(error.message).toMatch(/horoscope/);
  });

  it('rejects an unknown show policy and an unknown module part', () => {
    const a = sampleEditionConfig();
    a.day.weather.show = 'sometimes';
    expect(() => parseEditionConfig(a)).toThrow(/day\.weather\.show/);
    const b = sampleEditionConfig();
    b.day.yesterday.parts = ['strava', 'garmin'];
    expect(() => parseEditionConfig(b)).toThrow(/day\.yesterday\.parts\[1\]/);
  });

  it('rejects a bad expiry time', () => {
    const raw = sampleEditionConfig({ deliver: { printer: 'office', expires_after: 'noon' } });
    expect(() => parseEditionConfig(raw)).toThrow(/deliver\.expires_after/);
  });

  it('tells edition reporters from report reporters', () => {
    expect(isEditionReporter({ kind: 'edition' })).toBe(true);
    expect(isEditionReporter({ sources: [] })).toBe(false);
  });
});

describe('checkEditionSources', () => {
  const cfg = parseEditionConfig(sampleEditionConfig());

  it('passes when every page and source exists', () => {
    expect(() => checkEditionSources(cfg, { pages: ['mainstream'], sourceIds: ['arstechnica', 'bbc', 'ksl'] })).not.toThrow();
  });

  it('names the unknown source id and its key', () => {
    expect(() => checkEditionSources(cfg, { pages: ['mainstream'], sourceIds: ['arstechnica', 'bbc'] }))
      .toThrow(/news\.categories\[3\]\.sources\[0\]: unknown source id "ksl"/);
  });

  it('names an unknown page', () => {
    expect(() => checkEditionSources(cfg, { pages: ['topics'], sourceIds: ['arstechnica', 'bbc', 'ksl'] }))
      .toThrow(/news\.pages\[0\]: unknown headline page "mainstream"/);
  });
});
