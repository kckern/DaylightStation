import { describe, it, expect } from 'vitest';
import { parseRules, matchesWhen, firstRule, rankOffers, stableIndex, needsContentFilter, parseSecondary, secondaryLogoFor } from './rules.mjs';
import { isLongAbsence, parseServices } from './provenance.mjs';

describe('matchesWhen', () => {
  const facts = { key: '1', kind: 'movie', year: 1931, durationMs: 30 * 60000, studio: 'Metro-Goldwyn-Mayer (MGM)',
    collections: ['Living Scriptures', 'LDS'], labels: ['Family'], library: 'Movies', contentFilterActive: false };
  const when = (w) => parseRules({ fallbacks: [{ provider: 'x', when: w }] }).fallbacks[0].when;
  it('every key must hold; a list matches any item, case-insensitive', () => {
    expect(matchesWhen(when({ kind: ['movie'], year_before: 1950 }), facts)).toBe(true);
    expect(matchesWhen(when({ kind: ['show'], year_before: 1950 }), facts)).toBe(false);
    expect(matchesWhen(when({ collection: ['living scriptures'] }), facts)).toBe(true);
    expect(matchesWhen(when({ label: ['family'] }), facts)).toBe(true);
    expect(matchesWhen(when({ library: ['Documentaries'] }), facts)).toBe(false);
  });
  it('studio matches whole words inside the name', () => {
    expect(matchesWhen(when({ studio: ['MGM'] }), facts)).toBe(true);
    expect(matchesWhen(when({ studio: ['Metro-Goldwyn'] }), facts)).toBe(true);
    expect(matchesWhen(when({ studio: ['Fox'] }), facts)).toBe(false);
    expect(matchesWhen(when({ studio: ['Fox'] }), { studio: '20th Century Fox' })).toBe(true);
    expect(matchesWhen(when({ studio: ['AMC'] }), { studio: 'DreamCrew' })).toBe(false);
    expect(matchesWhen(when({ studio: ['AMC'] }), { studio: 'Bandai Namco Games' })).toBe(false);
    expect(matchesWhen(when({ studio: ['AMC'] }), { studio: 'AMC Studios' })).toBe(true);
    expect(matchesWhen(when({ studio: ['Warner'] }), { studio: 'Warner Bros. Pictures' })).toBe(true);
  });
  it('length and year need the fact to be known', () => {
    expect(matchesWhen(when({ shorter_than_min: 40 }), facts)).toBe(true);
    expect(matchesWhen(when({ shorter_than_min: 40 }), { ...facts, durationMs: null })).toBe(false);
    expect(matchesWhen(when({ year_before: 1950 }), { ...facts, year: null })).toBe(false);
  });
  it('always matches; an unknown key never does (a typo must not catch everything)', () => {
    expect(matchesWhen(when('always'), facts)).toBe(true);
    expect(matchesWhen(when(undefined), facts)).toBe(true);
    expect(matchesWhen(when({ stuido: ['MGM'] }), facts)).toBe(false);
  });
  it('content filter', () => {
    expect(matchesWhen(when({ content_filter: 'active' }), facts)).toBe(false);
    expect(matchesWhen(when({ content_filter: 'active' }), { ...facts, contentFilterActive: true })).toBe(true);
  });
});

describe('rules', () => {
  it('reads an older file as free > subscribed > any', () => {
    const r = parseRules({ providers: { free: ['hoopla'], subscribed: ['peacock'] } });
    expect(r.priority.map((g) => g.name)).toEqual(['free', 'subscribed', 'other']);
    expect(rankOffers([{ provider: 'netflix' }, { provider: 'peacock' }], r.priority).offer.provider).toBe('peacock');
  });
  it('ranks offers by group order, then the order inside a group', () => {
    const { priority } = parseRules({ priority: [{ name: 'paid', providers: ['prime-video', 'peacock'] }, { name: 'library', providers: ['hoopla'] }, { name: 'rest', providers: 'any' }] });
    expect(rankOffers([{ provider: 'hoopla' }, { provider: 'peacock' }], priority)).toMatchObject({ group: { name: 'paid' }, offer: { provider: 'peacock' } });
    expect(rankOffers([{ provider: 'netflix' }, { provider: 'hoopla' }], priority).offer.provider).toBe('hoopla');
    expect(rankOffers([{ provider: 'netflix' }], priority).offer.provider).toBe('netflix');
    expect(rankOffers([{ provider: 'netflix' }], priority, () => false)).toBeNull();
  });
  it('picks one of several providers stably per title', () => {
    const { fallbacks } = parseRules({ fallbacks: [{ provider: ['peacock', 'prime-video'], when: 'always' }] });
    const seen = new Set(Array.from({ length: 40 }, (_, k) => firstRule(fallbacks, { key: String(k) }).provider));
    expect(seen).toEqual(new Set(['peacock', 'prime-video']));
    expect(firstRule(fallbacks, { key: '7' }).provider).toBe(firstRule(fallbacks, { key: '7' }).provider);
    expect(stableIndex('anything', 1)).toBe(0);
  });
  it('knows when the content filter must be asked', () => {
    expect(needsContentFilter(parseRules({ overrides: [{ provider: 'vidangel', when: { content_filter: 'active' } }] }))).toBe(true);
    expect(needsContentFilter(parseRules({ fallbacks: [{ provider: 'youtube', when: 'always' }] }))).toBe(false);
  });
});

describe('isLongAbsence', () => {
  const now = new Date('2026-11-21T20:00:00Z');
  it('is true past the hours, false otherwise or when unknown', () => {
    expect(isLongAbsence('2026-11-21T13:00:00Z', now, 6)).toBe(true);
    expect(isLongAbsence('2026-11-21T15:00:00Z', now, 6)).toBe(false);
    expect(isLongAbsence(null, now, 6)).toBe(false);
    expect(isLongAbsence('not a date', now, 6)).toBe(false);
    expect(isLongAbsence('2026-11-01T00:00:00Z', now, 0)).toBe(false);
  });
});

describe('secondary logos', () => {
  const services = parseServices([
    { provider: 'netflix', names: ['Netflix'], paid: true },
    { provider: 'peacock', names: ['Peacock'], paid: true },
    { provider: 'tubi', names: ['Tubi'] },
  ]);
  const secondary = parseSecondary([
    { logo: 'pass-a', label: 'Pass A', for: 'paid', except: ['peacock'] },
    { logo: 'badge-b', for: ['tubi'] },
    { for: 'paid' },
  ]);
  it('reads rules, skipping ones without a logo', () => {
    expect(secondary).toHaveLength(2);
    expect(secondary[1].label).toBe('badge-b');
    expect(parseSecondary(undefined)).toEqual([]);
  });
  it('gives paid services the logo, except the ones listed', () => {
    expect(secondaryLogoFor('netflix', secondary, services)).toEqual({ logo: 'pass-a', label: 'Pass A' });
    expect(secondaryLogoFor('peacock', secondary, services)).toBeNull();
  });
  it('matches a listed provider, and nothing for no provider', () => {
    expect(secondaryLogoFor('tubi', secondary, services)).toEqual({ logo: 'badge-b', label: 'badge-b' });
    expect(secondaryLogoFor(null, secondary, services)).toBeNull();
  });
  it('skips a logo that cannot be shown', () => {
    expect(secondaryLogoFor('netflix', secondary, services, (id) => id !== 'pass-a')).toBeNull();
  });
});
